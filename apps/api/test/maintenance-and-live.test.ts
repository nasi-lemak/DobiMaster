import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { json } from '../src/db/index.js';
import { recomputeMachineState } from '../src/modules/machines/state.js';
import { sweepMaintenance } from '../src/modules/maintenance/service.js';
import { createHarness, guest, loginAs, seedFixture, type Fixture, type Harness } from './helpers.js';

let h: Harness;
let f: Fixture;
let owner: { cookie: string };

beforeAll(async () => {
  h = await createHarness({ wsRevalidateMs: 200 });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  f = await seedFixture(h);
  owner = await loginAs(h, f.users.owner);
});

const DAY_MIN = 24 * 60;
const post = (url: string, payload: unknown, headers = owner) => h.app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload: payload as object });
/** Plans and fixture machines get the database's wall-clock time; put them on the test clock. */
async function onTestClock(planId: string) {
  await h.ctx.db.updateTable('maintenance_plans').set({ created_at: h.clock.now }).where('id', '=', planId).execute();
  await h.ctx.db.updateTable('machines').set({ created_at: h.clock.now }).where('shop_id', '=', f.shopId).execute();
}
const due = async () => (await h.app.inject({ method: 'GET', url: `/api/v1/owner/maintenance/due?shopId=${f.shopId}`, headers: owner })).json().items as Array<Record<string, any>>;

async function addDryer(code: string) {
  const m = await h.ctx.db
    .insertInto('machines')
    .values({ tenant_id: f.tenantId, shop_id: f.shopId, code, qr_token: `qr-${code}-${Date.now()}`, type: 'dryer', capacity_kg: 15, programs: json([{ id: 'd30', name: { en: '30 min' }, durationMin: 30, priceSen: 500 }]), created_at: h.clock.now })
    .returning('id')
    .executeTakeFirstOrThrow();
  await recomputeMachineState(h.ctx, m.id);
  return m.id;
}

describe('maintenance plans', () => {
  it('time-based: ok → due soon → due (one alert per plan) → logged → ok again', async () => {
    const d1 = await addDryer('D1');
    await addDryer('D2');
    const plan = await post('/owner/maintenance/plans', { shopId: f.shopId, machineType: 'dryer', title: 'Clean lint duct', intervalDays: 30 });
    expect(plan.statusCode).toBe(200);
    const planId = plan.json().plan?.id ?? plan.json().id;
    await onTestClock(planId);

    let items = (await due()).filter((i) => i.planId === planId);
    expect(items.map((i) => [i.machineCode, i.status])).toEqual(expect.arrayContaining([['D1', 'ok'], ['D2', 'ok']]));
    expect(items).toHaveLength(2); // only dryers

    h.clock.advance(26 * DAY_MIN); // 26/30 ≥ 85%
    owner = await loginAs(h, f.users.owner); // sessions last 14 days
    expect((await due()).filter((i) => i.planId === planId).every((i) => i.status === 'due_soon')).toBe(true);

    h.clock.advance(5 * DAY_MIN);
    owner = await loginAs(h, f.users.owner);
    items = (await due()).filter((i) => i.planId === planId);
    expect(items.every((i) => i.status === 'due' && i.daysSince === 31)).toBe(true);
    await sweepMaintenance(h.ctx);
    const alerts = await h.ctx.db.selectFrom('alerts').select(['message', 'status']).where('dedupe_key', '=', `maintenance_due:${planId}`).execute();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toBe('"Clean lint duct" is due on 2 machines (D1, D2)');

    // Staff log the work on D1; D1 is fine again, D2 still due, alert now names only D2.
    const staff = await loginAs(h, f.users.staff);
    expect((await post('/owner/maintenance/logs', { machineId: d1, planId, notes: 'Lint duct vacuumed' }, staff)).statusCode).toBe(200);
    items = (await due()).filter((i) => i.planId === planId);
    expect(items.find((i) => i.machineCode === 'D1')).toMatchObject({ status: 'ok', daysSince: 0 });
    await sweepMaintenance(h.ctx);
    expect((await h.ctx.db.selectFrom('alerts').select('message').where('dedupe_key', '=', `maintenance_due:${planId}`).executeTakeFirstOrThrow()).message).toMatch(/due on D2$/);
  });

  it('cycle-based: counts cycles from cash-collection counter readings when there are no sensors', async () => {
    const plan = await post('/owner/maintenance/plans', { shopId: f.shopId, machineId: f.washer.id, title: 'Descale', intervalCycles: 4 });
    const planId = plan.json().plan?.id ?? plan.json().id;
    await onTestClock(planId);
    h.clock.advance(60);
    await post('/owner/collections', { shopId: f.shopId, lines: [{ machineId: f.washer.id, amountSen: 0, counterReading: 1000 }] });
    h.clock.advance(60);
    await post('/owner/collections', { shopId: f.shopId, lines: [{ machineId: f.washer.id, amountSen: 2500, counterReading: 1005 }] });
    const item = (await due()).find((i) => i.planId === planId)!;
    expect(item).toMatchObject({ machineCode: 'W1', cyclesSince: 5, cycleSource: 'counter', status: 'due' });
  });

  it('staff can log work but not change plans; plans need a target and an interval', async () => {
    const staff = await loginAs(h, f.users.staff);
    expect((await post('/owner/maintenance/plans', { shopId: f.shopId, machineType: 'washer', title: 'x x', intervalDays: 7 }, staff)).statusCode).toBe(403);
    expect((await post('/owner/maintenance/plans', { shopId: f.shopId, title: 'No target', intervalDays: 7 })).statusCode).toBe(400);
    expect((await post('/owner/maintenance/plans', { shopId: f.shopId, machineType: 'washer', title: 'No interval' })).statusCode).toBe(400);
    const other = await seedFixture(h);
    expect([403, 404]).toContain((await post('/owner/maintenance/logs', { machineId: other.washer.id }, staff)).statusCode);
  });
});

describe('live updates (WebSocket) only reach people allowed to see them', () => {
  async function open(headers: Record<string, string> = {}) {
    // injectWS fakes the upgrade request; give it a socket address so the IP-based hooks work.
    const ws = (await (h.app as any).injectWS('/ws', { headers, socket: { remoteAddress: '127.0.0.1' } })) as WebSocket;
    const inbox: any[] = [];
    ws.on('message', (raw) => inbox.push(JSON.parse(String(raw))));
    const subscribe = async (channels: string[], token?: string) => {
      ws.send(JSON.stringify({ op: 'sub', channels, token }));
      await expect.poll(() => inbox.find((m) => m.op === 'subscribed')).toBeTruthy();
      const msg = inbox.splice(inbox.findIndex((m) => m.op === 'subscribed'), 1)[0];
      return msg.channels as string[];
    };
    return { ws, inbox, subscribe };
  }

  it('guests get shop channels and their own customer channel only', async () => {
    const me = await guest(h, false);
    const someoneElse = await guest(h, false);
    const c = await open();
    const granted = await c.subscribe([`shop:${f.shopId}`, `customer:${me.customerId}`, `customer:${someoneElse.customerId}`, `tenant:${f.tenantId}`], me.token);
    expect(granted.sort()).toEqual([`customer:${me.customerId}`, `shop:${f.shopId}`].sort());
    c.ws.terminate();
  });

  it('owners get their own business channel, never another business’s', async () => {
    const other = await seedFixture(h);
    const c = await open({ cookie: owner.cookie });
    expect(await c.subscribe([`tenant:${f.tenantId}`, `tenant:${other.tenantId}`])).toEqual([`tenant:${f.tenantId}`]);
    c.ws.terminate();
    const anon = await open();
    expect(await anon.subscribe([`tenant:${f.tenantId}`])).toEqual([]);
    anon.ws.terminate();
  });

  it('delivers an event only to sockets subscribed to that channel', async () => {
    const me = await guest(h, false);
    const a = await open();
    const b = await open();
    await a.subscribe([`customer:${me.customerId}`], me.token);
    await b.subscribe([`shop:${f.shopId}`]);
    await h.ctx.bus.publish(`customer:${me.customerId}`, 'cycle.updated', { id: 'x' });
    await expect.poll(() => a.inbox.find((m) => m.op === 'evt')).toMatchObject({ channel: `customer:${me.customerId}`, type: 'cycle.updated' });
    await new Promise((r) => setTimeout(r, 150));
    expect(b.inbox.filter((m) => m.op === 'evt' && m.channel.startsWith('customer:'))).toHaveLength(0);
    a.ws.terminate();
    b.ws.terminate();
  });

  it('survives a malformed cookie instead of crashing the server', async () => {
    const c = await open({ cookie: 'x=%E0%A4%A' });
    expect(await c.subscribe([`shop:${f.shopId}`])).toEqual([`shop:${f.shopId}`]);
    expect((await h.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    c.ws.terminate();
  });

  it('business-channel events are refresh hints only: no payload reaches the browser', async () => {
    const c = await open({ cookie: owner.cookie });
    await c.subscribe([`tenant:${f.tenantId}`]);
    await h.ctx.bus.publish(`tenant:${f.tenantId}`, 'payment.updated', { id: 'p1', amountSen: 700, customerId: 'secret' });
    await expect.poll(() => c.inbox.find((m) => m.op === 'evt')).toBeTruthy();
    const evt = c.inbox.find((m) => m.op === 'evt');
    expect(evt).toMatchObject({ channel: `tenant:${f.tenantId}`, type: 'payment.updated' });
    expect(evt).not.toHaveProperty('data');
    c.ws.terminate();
  });

  it('a removed staff member’s open socket is cut off from business events', async () => {
    const staff = await loginAs(h, f.users.staff);
    const c = await open({ cookie: staff.cookie });
    expect(await c.subscribe([`tenant:${f.tenantId}`])).toEqual([`tenant:${f.tenantId}`]);
    let closed = false;
    c.ws.on('close', () => (closed = true));
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/owner/staff/${f.users.staffId}`, headers: owner })).statusCode).toBe(200);
    await expect.poll(() => closed, { timeout: 3000 }).toBe(true);
  });
});

