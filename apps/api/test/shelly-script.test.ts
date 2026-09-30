import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json } from '../src/db/index.js';
import { sha256 } from '../src/lib/ids.js';
import { initialDetectorState } from '../src/modules/telemetry/detector.js';
import { recomputeMachineState } from '../src/modules/machines/state.js';
import { createHarness, machineState, seedFixture, type Fixture, type Harness } from './helpers.js';

/**
 * Runs the real on-device script (devices/shelly/dobimaster-sensor.js) against a simulated Shelly:
 * Shelly.getComponentStatus / Shelly.call("HTTP.Request") / Timer.set, with its HTTP requests
 * delivered to the actual API. Verifies batching, heartbeats, outage buffering and cycle detection.
 */
const SCRIPT = readFileSync(resolve(__dirname, '../../../devices/shelly/dobimaster-sensor.js'), 'utf8');

let h: Harness;
let f: Fixture;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  f = await seedFixture(h);
});

interface Req {
  at: number;
  samples: Array<{ ts?: number; powerW: number }>;
  status: number;
}

function fakeShelly(opts: { token: string; component: string; power: () => number; now: () => number; networkUp: () => boolean }) {
  const timers: Array<{ every: number; next: number; fn: () => void }> = [];
  const pending: Array<Promise<void>> = [];
  const requests: Req[] = [];
  const logs: string[] = [];
  const Shelly = {
    getComponentStatus(c: string) {
      if (c === 'sys') return { unixtime: Math.floor(opts.now() / 1000) };
      if (c === opts.component) return { act_power: -opts.power() }; // clamp fitted backwards on purpose
      return null;
    },
    call(method: string, params: { method: string; url: string; headers: Record<string, string>; body: string }, cb: (res: unknown, code: number, msg: string) => void) {
      expect(method).toBe('HTTP.Request');
      if (!opts.networkUp()) {
        pending.push(Promise.resolve().then(() => cb(null, -104, 'Connection refused')));
        return;
      }
      const body = JSON.parse(params.body);
      pending.push(
        h.app
          .inject({ method: 'POST', url: '/api/v1/device/telemetry', headers: { 'content-type': 'application/json', authorization: params.headers.Authorization }, payload: body })
          .then((res) => {
            requests.push({ at: opts.now(), samples: body.samples, status: res.statusCode });
            cb({ code: res.statusCode, body: res.body }, 0, '');
          }),
      );
    },
  };
  const Timer = { set: (ms: number, repeat: boolean, fn: () => void) => timers.push({ every: ms, next: opts.now() + ms, fn }) };
  const script = SCRIPT.replace('__INGEST_URL__', 'https://dobimaster.test/api/v1/device/telemetry').replace('__COMPONENT__', opts.component).replace('__TOKEN__', opts.token);
  new Function('Shelly', 'Timer', 'print', script)(Shelly, Timer, (m: string) => logs.push(m));
  return {
    requests,
    logs,
    /** Fire every timer due by now and wait for the resulting HTTP round-trips. */
    async runDue() {
      for (const t of timers) {
        while (t.next <= opts.now()) {
          t.fn();
          t.next += t.every;
          while (pending.length) await pending.shift();
        }
      }
    },
  };
}

async function shellyWasher() {
  const token = `shelly-${randomUUID()}`;
  const d = await h.ctx.db
    .insertInto('devices')
    .values({ tenant_id: f.tenantId, shop_id: f.shopId, kind: 'shelly', label: 'W1 Shelly EM', token_hash: sha256(token), config: json({}), detector: json(initialDetectorState()), heartbeat_sec: 60, last_seen_at: h.clock.now, online: true })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.ctx.db.updateTable('machines').set({ observation: 'power_monitor', device_id: d.id }).where('id', '=', f.washer.id).execute();
  await recomputeMachineState(h.ctx, f.washer.id);
  return token;
}

describe('Shelly on-device script', () => {
  it('uses only syntax the Shelly scripting engine supports', () => {
    const code = SCRIPT.replace(/\/\/.*$/gm, '');
    for (const [name, re] of [
      ['arrow functions', /=>/],
      ['template strings', /`/],
      ['spread / rest', /\.\.\./],
      ['async/await', /\basync\b|\bawait\b/],
      ['classes', /\bclass\s/],
      ['optional chaining', /\?\./],
    ] as const) {
      expect(re.test(code), name).toBe(false);
    }
  });

  it('reports a real-looking wash, survives a Wi-Fi drop, and the server sees exactly one cycle', async () => {
    const token = await shellyWasher();
    let power = 2;
    let network = true;
    const sim = fakeShelly({ token, component: 'em1:0', power: () => power, now: () => h.clock.now.getTime(), networkUp: () => network });
    const minutes = async (n: number, w: number) => {
      power = w;
      for (let s = 0; s < n * 60; s += 5) {
        h.clock.now = new Date(h.clock.now.getTime() + 5000);
        await sim.runDue();
      }
      await h.ctx.jobs.runDue();
    };

    await minutes(3, 2); // idle: heartbeats only
    const idleRequests = sim.requests.length;
    expect(idleRequests).toBeGreaterThanOrEqual(2);
    expect(idleRequests).toBeLessThanOrEqual(4);

    await minutes(4, 420); // fill + wash
    expect((await machineState(h, f.washer.id)).state).toBe('running');

    network = false; // shop Wi-Fi drops mid-wash
    await minutes(3, 450);
    network = true;
    await minutes(2, 5); // soak: low power, shorter than the washer end-debounce
    expect((await machineState(h, f.washer.id)).state).toBe('running');
    // After the outage, the buffered readings arrived as a catch-up batch — nothing was lost.
    const batches = sim.requests.map((r) => r.samples.length);
    expect(Math.max(...batches)).toBeGreaterThanOrEqual(30);

    await minutes(6, 900); // rinse + spin
    await minutes(6, 2); // done: low power for longer than the end-debounce
    expect((await machineState(h, f.washer.id)).state).toBe('finished');

    const cycles = await h.ctx.db.selectFrom('cycles').select(['status', 'started_at', 'ended_at', 'energy_wh']).where('machine_id', '=', f.washer.id).execute();
    expect(cycles).toHaveLength(1); // the soak pause and the outage did not split it
    const ranMin = (cycles[0]!.ended_at!.getTime() - cycles[0]!.started_at.getTime()) / 60_000;
    // 4 min wash + 3 min (during the outage) + 2 min soak + 6 min spin = 15 min, measured from the readings
    expect(ranMin).toBeGreaterThan(14.5);
    expect(ranMin).toBeLessThan(15.5);
    // (4×420 + 3×450 + 2×5 + 6×900) W·min / 60 ≈ 141 Wh
    expect(cycles[0]!.energy_wh).toBeGreaterThan(130);
    expect(cycles[0]!.energy_wh).toBeLessThan(150);
    expect(sim.requests.every((r) => r.status === 200)).toBe(true);
    expect(sim.logs.some((l) => l.includes('unreachable'))).toBe(true);
  });

  it('says so in the Shelly log when the token is rejected', async () => {
    const sim = fakeShelly({ token: 'not-registered', component: 'em1:0', power: () => 2, now: () => h.clock.now.getTime(), networkUp: () => true });
    h.clock.now = new Date(h.clock.now.getTime() + 10_000);
    await sim.runDue();
    expect(sim.logs.some((l) => l.includes('rejected the token'))).toBe(true);
  });
});
