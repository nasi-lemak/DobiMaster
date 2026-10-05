import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json } from '../src/db/index.js';
import { sha256 } from '../src/lib/ids.js';
import { initialDetectorState } from '../src/modules/telemetry/detector.js';
import { checkDryerHeating, sweepDevices } from '../src/modules/telemetry/service.js';
import { recomputeMachineState } from '../src/modules/machines/state.js';
import { createHarness, guest, loginAs, seedFixture, type Fixture, type Harness } from './helpers.js';

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
  h.push.sent = [];
  h.mail.sent = [];
});

const telemetry = (token: string, samples: Array<{ ts: number; powerW: number }>) =>
  h.app.inject({ method: 'POST', url: '/api/v1/device/telemetry', headers: { authorization: `Bearer ${token}` }, payload: { samples } });

/** Let time pass while a running machine's sensor keeps reporting (real sensors report every ~10 s). */
async function busy(token: string, minutes: number, powerW: number) {
  for (let left = minutes; left > 0; left -= 5) {
    h.clock.advance(Math.min(5, left));
    await telemetry(token, [{ ts: h.clock.now.getTime(), powerW }]);
  }
}

/** Let time pass while the sensor keeps reporting idle power (so it doesn't look offline). */
async function idle(token: string, minutes: number) {
  for (let i = 0; i < minutes; i++) {
    await h.tick(1);
    await telemetry(token, [{ ts: h.clock.now.getTime(), powerW: 2 }]);
  }
  await h.tick(0.05);
}

/** A sensored dryer (instant-debounce sensor) in the fixture shop. */
async function addSensoredDryer(code: string) {
  const token = `tok-${randomUUID()}`;
  const d = await h.ctx.db
    .insertInto('devices')
    .values({ tenant_id: f.tenantId, shop_id: f.shopId, kind: 'simulator', token_hash: sha256(token), config: json({ startW: 30, endW: 10, startSec: 0, endSec: 0, minCycleSec: 0, maxCycleMin: 180 }), detector: json(initialDetectorState()), last_seen_at: h.clock.now, online: true })
    .returning('id')
    .executeTakeFirstOrThrow();
  const m = await h.ctx.db
    .insertInto('machines')
    .values({ tenant_id: f.tenantId, shop_id: f.shopId, code, qr_token: `qr-${code}-${randomUUID().slice(0, 6)}`, type: 'dryer', capacity_kg: 15, programs: json([{ id: 'd30', name: { en: '30 min' }, durationMin: 30, priceSen: 500 }]), observation: 'power_monitor', device_id: d.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  await recomputeMachineState(h.ctx, m.id);
  return { id: m.id, token };
}

describe('passwords', () => {
  it('changing my password keeps this device signed in and signs out the others', async () => {
    const here = await loginAs(h, f.users.owner);
    const elsewhere = await loginAs(h, f.users.owner);
    const change = (current: string, next: string) => h.app.inject({ method: 'POST', url: '/api/v1/owner/me/password', headers: here, payload: { currentPassword: current, newPassword: next } });
    expect((await change('wrong', 'a-new-password-1')).statusCode).toBe(401);
    expect((await change('password123', 'short')).statusCode).toBe(400);
    const ok = await change('password123', 'a-new-password-1');
    expect(ok.json()).toMatchObject({ ok: true, otherSessionsSignedOut: 1 });
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/owner/me', headers: here })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/owner/me', headers: elsewhere })).statusCode).toBe(401);
  });

  it('forgot password emails a single-use link that signs out every device', async () => {
    const session = await loginAs(h, f.users.owner);
    const forgot = (email: string) => h.app.inject({ method: 'POST', url: '/api/v1/owner/auth/forgot', payload: { email } });
    expect((await forgot('nobody@example.test')).statusCode).toBe(200); // no account enumeration
    expect(h.mail.sent).toHaveLength(0);
    await forgot(f.users.owner);
    const mail = h.mail.sent.at(-1)!;
    expect(mail.to).toBe(f.users.owner);
    const token = decodeURIComponent(mail.text.match(/token=([^\s]+)/)![1]!);

    const reset = (t: string) => h.app.inject({ method: 'POST', url: '/api/v1/owner/auth/reset', payload: { token: t, newPassword: 'brand-new-pass-2' } });
    expect((await reset(token)).statusCode).toBe(200);
    expect((await reset(token)).statusCode).toBe(400); // single use
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/owner/me', headers: session })).statusCode).toBe(401);
    const { login } = await import('../src/auth/owner.js');
    await expect(login(h.ctx, f.users.owner, 'brand-new-pass-2')).resolves.toBeTruthy();
  });

  it('reset links expire after 30 minutes', async () => {
    await h.app.inject({ method: 'POST', url: '/api/v1/owner/auth/forgot', payload: { email: f.users.owner } });
    const token = decodeURIComponent(h.mail.sent.at(-1)!.text.match(/token=([^\s]+)/)![1]!);
    h.clock.advance(31);
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/owner/auth/reset', payload: { token, newPassword: 'brand-new-pass-3' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('"notify me when a dryer is free"', () => {
  it('is only offered where the class is sensored and busy, and serves waiters first-come first-served', async () => {
    const dryer = await addSensoredDryer('D9');
    const slug = (await h.ctx.db.selectFrom('shops').select('slug').where('id', '=', f.shopId).executeTakeFirstOrThrow()).slug;
    const watch = (g: { auth: Record<string, string> }, type = 'dryer', capacityKg = 15) =>
      h.app.inject({ method: 'POST', url: '/api/v1/public/watches', headers: g.auth, payload: { shopSlug: slug, type, capacityKg } });

    const a = await guest(h);
    const b = await guest(h);
    expect((await watch(a)).json().error).toBe('already_free'); // it's free right now
    expect((await watch(a, 'washer', 10)).json().error).toBe('not_live'); // W1 has no sensor

    await telemetry(dryer.token, [{ ts: h.clock.now.getTime(), powerW: 4000 }]); // dryer starts
    expect((await watch(a)).statusCode).toBe(200);
    h.clock.advance(1);
    expect((await watch(b)).statusCode).toBe(200);

    await busy(dryer.token, 30, 4000);
    await telemetry(dryer.token, [{ ts: h.clock.now.getTime(), powerW: 2 }]); // finished (laundry inside)
    expect(h.push.sent.filter((p) => p.payload.title === 'A dryer is free')).toHaveLength(0);
    await idle(dryer.token, 21); // finished-hold expires → free
    const freed = h.push.sent.filter((p) => p.payload.title === 'A dryer is free');
    expect(freed.map((p) => p.endpoint)).toEqual([a.endpoint]); // only the first in line

    // The next time it frees up, the second customer gets it.
    await telemetry(dryer.token, [{ ts: h.clock.now.getTime(), powerW: 4000 }]);
    await busy(dryer.token, 30, 4000);
    await telemetry(dryer.token, [{ ts: h.clock.now.getTime(), powerW: 2 }]);
    await idle(dryer.token, 21);
    expect(h.push.sent.filter((p) => p.payload.title === 'A dryer is free').map((p) => p.endpoint)).toEqual([a.endpoint, b.endpoint]);
  });
});

describe('sensor analytics', () => {
  it('stores measured energy per cycle and prices it with the shop tariff', async () => {
    const t0 = h.clock.now.getTime();
    await telemetry(f.sensored.token, [{ ts: t0, powerW: 1200 }, { ts: t0 + 25_000, powerW: 1200 }]);
    await busy(f.sensored.token, 30, 1200);
    const t1 = h.clock.now.getTime();
    h.clock.advance(2);
    await telemetry(f.sensored.token, [{ ts: t1 + 1000, powerW: 2 }, { ts: t1 + 2 * 60_000, powerW: 2 }]);
    const cycle = await h.ctx.db.selectFrom('cycles').select(['energy_wh', 'avg_power_w']).where('machine_id', '=', f.sensored.id).where('energy_wh', 'is not', null).executeTakeFirstOrThrow();
    expect(cycle.avg_power_w).toBeGreaterThan(1100);
    expect(cycle.energy_wh).toBeGreaterThan(550); // ~0.6 kWh

    const owner = await loginAs(h, f.users.owner);
    await h.app.inject({ method: 'PATCH', url: `/api/v1/owner/shops/${f.shopId}`, headers: owner, payload: { settings: { electricitySenPerKwh: 60 } } });
    h.clock.advance(60);
    const e = (await h.app.inject({ method: 'GET', url: '/api/v1/owner/analytics/energy?days=7', headers: owner })).json();
    const row = e.machines.find((m: { machineId: string }) => m.machineId === f.sensored.id);
    expect(row.tariffSenPerKwh).toBe(60);
    expect(row.energyCostPerCycleSen).toBe(Math.round((cycle.energy_wh! / 1000) * 60));
  });

  it('a whole shop going silent raises one outage alert instead of one per machine', async () => {
    await h.tick(5);
    await sweepDevices(h.ctx);
    const alerts = await h.ctx.db.selectFrom('alerts').select(['kind', 'severity']).where('tenant_id', '=', f.tenantId).execute();
    expect(alerts).toEqual([{ kind: 'shop_offline', severity: 'high' }]);
    await telemetry(f.sensored.token, [{ ts: h.clock.now.getTime(), powerW: 1 }]); // power is back
    const open = await h.ctx.db.selectFrom('alerts').select('kind').where('tenant_id', '=', f.tenantId).where('status', '=', 'open').execute();
    expect(open).toHaveLength(0);
  });

  it('flags a dryer drawing far less power than its own usual', async () => {
    const dryer = await addSensoredDryer('D8');
    for (let i = 0; i < 10; i++) {
      await h.ctx.db
        .insertInto('cycles')
        .values({ id: randomUUID(), tenant_id: f.tenantId, shop_id: f.shopId, machine_id: dryer.id, source: 'sensor', status: 'collected', duration_min: 30, started_at: new Date(h.clock.now.getTime() - (i + 2) * 3600_000), expected_end_at: new Date(h.clock.now.getTime() - (i + 1.5) * 3600_000), ended_at: new Date(h.clock.now.getTime() - (i + 1.5) * 3600_000), sensor_confirmed: true, avg_power_w: 4400 + i * 20 })
        .execute();
    }
    const m = await h.ctx.db.selectFrom('machines').selectAll().where('id', '=', dryer.id).executeTakeFirstOrThrow();
    await h.ctx.db
      .insertInto('cycles')
      .values({ id: randomUUID(), tenant_id: f.tenantId, shop_id: f.shopId, machine_id: dryer.id, source: 'sensor', status: 'finished', duration_min: 30, started_at: new Date(h.clock.now.getTime() - 1800_000), expected_end_at: h.clock.now, ended_at: h.clock.now, sensor_confirmed: true, avg_power_w: 4450 })
      .execute();
    await checkDryerHeating(h.ctx, m, 4450, 30);
    expect(await h.ctx.db.selectFrom('alerts').select('kind').where('machine_id', '=', dryer.id).execute()).toHaveLength(0);
    await checkDryerHeating(h.ctx, m, 1700, 30);
    const a = await h.ctx.db.selectFrom('alerts').select(['kind', 'message']).where('machine_id', '=', dryer.id).executeTakeFirstOrThrow();
    expect(a.kind).toBe('weak_heating');
    expect(a.message).toContain('less power than usual');
  });
});
