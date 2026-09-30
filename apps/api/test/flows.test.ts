import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, guest, loginAs, machineState, pushesTo, seedFixture, type Fixture, type Harness } from './helpers.js';

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
});

const telemetry = (token: string, samples: Array<{ ts: number; powerW: number }>) =>
  h.app.inject({ method: 'POST', url: '/api/v1/device/telemetry', headers: { authorization: `Bearer ${token}` }, payload: { samples } });

describe('customer timer on a machine without sensors', () => {
  it('check-in → "almost done" → "finished" → uncollected reminder → collected frees the machine', async () => {
    const g = await guest(h);
    const id = randomUUID();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id, qrToken: f.washer.qr, programId: 'cold' } });
    expect(res.statusCode).toBe(200);
    expect(await machineState(h, f.washer.id)).toMatchObject({ state: 'running', state_source: 'customer' });

    // Retrying the same request (flaky shop Wi-Fi) is a no-op.
    const retry = await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id, qrToken: f.washer.qr, programId: 'cold' } });
    expect(retry.json().cycle.id).toBe(id);

    await h.tick(25);
    expect(pushesTo(h, g.endpoint)).toEqual(['W1 almost done']);
    await h.tick(5);
    expect(pushesTo(h, g.endpoint)).toEqual(['W1 almost done', 'W1 finished']);
    expect((await machineState(h, f.washer.id)).state).toBe('finished');
    await h.tick(10);
    expect(pushesTo(h, g.endpoint).at(-1)).toBe('Laundry still in W1');

    const col = await h.app.inject({ method: 'POST', url: `/api/v1/public/cycles/${id}/collected`, headers: g.auth });
    expect(col.statusCode).toBe(200);
    expect((await machineState(h, f.washer.id)).state).toBe('available');
    await h.tick(30);
    expect(pushesTo(h, g.endpoint).filter((t) => t.startsWith('Laundry still'))).toHaveLength(1); // reminders stopped
  });

  it('a second customer cannot silently take over a running machine, but can force a stale check-in', async () => {
    const a = await guest(h, false);
    const b = await guest(h, false);
    await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: a.auth, payload: { id: randomUUID(), qrToken: f.washer.qr } });
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: b.auth, payload: { id: randomUUID(), qrToken: f.washer.qr } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('machine_in_use');
    const forced = await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: b.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, force: true } });
    expect(forced.statusCode).toBe(200);
  });

  it('the public machine page never exposes customer identity', async () => {
    const g = await guest(h, false);
    await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr } });
    const page = await h.app.inject({ method: 'GET', url: `/api/v1/public/machines/${f.washer.qr}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain(g.customerId);
    expect(page.json().machine.state).toBe('running');
    expect(page.json().machine.expectedEndAt).toBeTruthy();
  });
});

describe('sensor-observed machine', () => {
  it('detects a cycle from power, then merges a customer check-in into it', async () => {
    const t0 = h.clock.now.getTime();
    await telemetry(f.sensored.token, [{ ts: t0, powerW: 400 }, { ts: t0 + 25_000, powerW: 450 }]);
    let st = await machineState(h, f.sensored.id);
    expect(st).toMatchObject({ state: 'running', state_source: 'sensor' });
    const sensorCycle = st.current_cycle_id;

    h.clock.advance(1);
    const g = await guest(h);
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id: randomUUID(), qrToken: f.sensored.qr, programId: 'hot' } });
    expect(res.json().cycle.id).toBe(sensorCycle); // merged, not a second cycle
    expect(res.json().cycle.durationMin).toBe(40);

    // The sensor, not the timer, decides the end.
    h.clock.advance(44);
    const t1 = h.clock.now.getTime();
    await telemetry(f.sensored.token, [{ ts: t1, powerW: 2 }, { ts: t1 + 61_000, powerW: 2 }]);
    st = await machineState(h, f.sensored.id);
    expect(st.state).toBe('finished');
    expect(pushesTo(h, g.endpoint)).toContain('W2 finished');
  });

  it('goes offline when the sensor stops reporting and recovers on the next reading', async () => {
    await h.tick(5); // > 3 × 60 s heartbeat
    await h.ctx.jobs.runDue();
    const { sweepDevices } = await import('../src/modules/telemetry/service.js');
    await sweepDevices(h.ctx);
    expect((await machineState(h, f.sensored.id)).state).toBe('offline');
    const alerts = await h.ctx.db.selectFrom('alerts').select(['kind', 'status']).where('tenant_id', '=', f.tenantId).execute();
    expect(alerts).toContainEqual({ kind: 'device_offline', status: 'open' });

    await telemetry(f.sensored.token, [{ ts: h.clock.now.getTime(), powerW: 1 }]);
    expect((await machineState(h, f.sensored.id)).state).toBe('available');
    const after = await h.ctx.db.selectFrom('alerts').select(['kind', 'status']).where('tenant_id', '=', f.tenantId).where('kind', '=', 'device_offline').where('machine_id', '=', f.sensored.id).execute();
    expect(after[0]?.status).toBe('resolved');
  });

  it('rejects telemetry with an unknown token', async () => {
    const res = await telemetry('nope', [{ ts: Date.now(), powerW: 1 }]);
    expect(res.statusCode).toBe(401);
  });
});

describe('problem reports', () => {
  it('one report warns; a second independent report marks the machine faulty; resolving clears it', async () => {
    const a = await guest(h, false);
    const b = await guest(h, false);
    const report = (g: typeof a) =>
      h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category: 'not_starting', details: 'nothing happens' } });
    const r1 = await report(a);
    expect(r1.statusCode).toBe(200);
    expect((await machineState(h, f.washer.id)).state).toBe('available');
    const page = await h.app.inject({ method: 'GET', url: `/api/v1/public/machines/${f.washer.qr}` });
    expect(page.json().machine.openIssues).toBe(1);

    await report(a); // same person again does not count twice
    expect((await machineState(h, f.washer.id)).state).toBe('available');
    await report(b);
    expect((await machineState(h, f.washer.id)).state).toBe('fault');

    const owner = await loginAs(h, f.users.owner);
    const tickets = (await h.app.inject({ method: 'GET', url: '/api/v1/owner/tickets', headers: owner })).json().tickets as Array<{ id: string }>;
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      await h.app.inject({ method: 'PATCH', url: `/api/v1/owner/tickets/${t.id}`, headers: owner, payload: { status: 'resolved', comment: 'Reset breaker' } });
    }
    expect((await machineState(h, f.washer.id)).state).toBe('available');
    const alerts = await h.ctx.db.selectFrom('alerts').select('kind').where('tenant_id', '=', f.tenantId).execute();
    expect(alerts.map((a) => a.kind)).toContain('repeat_fault');
  });

  it('attaches sensor evidence to reports on observed machines', async () => {
    const g = await guest(h, false);
    const r = await h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.sensored.qr, category: 'coin_jammed', amountClaimedSen: 500, contactPhone: '+60123456789' } });
    const events = await h.ctx.db.selectFrom('ticket_events').select(['kind', 'data']).where('ticket_id', '=', r.json().ticket.id).execute();
    expect(events.map((e) => e.kind)).toEqual(['created', 'evidence']);
    expect(events[1]!.data).toMatchObject({ observed: true, deviceOnline: true });
  });
});

describe('pay-and-start (controllable machine)', () => {
  const pay = (g: { auth: Record<string, string> }, key: string) =>
    h.app.inject({ method: 'POST', url: '/api/v1/public/payments', headers: { ...g.auth, 'idempotency-key': key }, payload: { qrToken: f.paid.qr, programId: 'cold' } });

  it('is idempotent, starts on webhook, and is confirmed by the sensor', async () => {
    const g = await guest(h);
    const key = randomUUID();
    const p1 = await pay(g, key);
    const p2 = await pay(g, key);
    expect(p1.statusCode).toBe(200);
    expect(p2.json().payment.id).toBe(p1.json().payment.id);
    const paymentId = p1.json().payment.id;

    // Customer approves on the (mock) hosted page → signed webhook.
    const done = await h.app.inject({ method: 'POST', url: `/api/v1/public/payments/${paymentId}/mock-complete`, headers: g.auth, payload: { outcome: 'succeeded' } });
    expect(done.statusCode).toBe(200);
    let p = (await h.app.inject({ method: 'GET', url: `/api/v1/public/payments/${paymentId}`, headers: g.auth })).json();
    expect(p.payment.status).toBe('succeeded');
    expect(p.cycle).toMatchObject({ status: 'running', source: 'payment', sensorConfirmed: false });

    await h.tick(0.05); // simulated controller emits power 2 s later
    p = (await h.app.inject({ method: 'GET', url: `/api/v1/public/payments/${paymentId}`, headers: g.auth })).json();
    expect(p.cycle.sensorConfirmed).toBe(true);
    const cmd = await h.ctx.db.selectFrom('machine_commands').select('status').where('payment_id', '=', paymentId).executeTakeFirstOrThrow();
    expect(cmd.status).toBe('confirmed');

    await h.tick(3); // past the confirmation window: no refund
    const refunds = await h.ctx.db.selectFrom('refunds').selectAll().where('payment_id', '=', paymentId).execute();
    expect(refunds).toHaveLength(0);
  });

  it('refunds automatically and protects the next customer when the machine does not start', async () => {
    await h.ctx.db.updateTable('devices').set({ config: JSON.stringify({ startW: 30, endW: 10, startSec: 0, endSec: 0, minCycleSec: 0, maxCycleMin: 180, simFail: 1 }) }).where('id', '=', f.paid.deviceId).execute();
    const g = await guest(h);
    const paymentId = (await pay(g, randomUUID())).json().payment.id;
    await h.app.inject({ method: 'POST', url: `/api/v1/public/payments/${paymentId}/mock-complete`, headers: g.auth, payload: { outcome: 'succeeded' } });

    // Keep the sensor "alive" (heartbeats) while waiting, so it's a start failure, not an offline device.
    for (let i = 0; i < 4; i++) {
      await h.tick(1);
      await telemetry(f.paid.token, [{ ts: h.clock.now.getTime(), powerW: 1 }]);
    }
    const p = (await h.app.inject({ method: 'GET', url: `/api/v1/public/payments/${paymentId}`, headers: g.auth })).json();
    expect(p.payment.status).toBe('refunded');
    expect(p.payment.refundedSen).toBe(500);
    expect(h.gateway.refunds).toHaveLength(1);
    expect(pushesTo(h, g.endpoint)).toContain('W3 did not start');
    expect((await machineState(h, f.paid.id)).state).toBe('fault');
    const ticket = await h.ctx.db.selectFrom('tickets').select(['source', 'category']).where('payment_id', '=', paymentId).executeTakeFirstOrThrow();
    expect(ticket).toEqual({ source: 'system', category: 'payment_no_start' });

    // The next customer can't pay for the broken machine.
    const again = await pay(await guest(h, false), randomUUID());
    expect(again.statusCode).toBe(409);
  });

  it('ignores duplicate webhooks and rejects bad signatures', async () => {
    const g = await guest(h, false);
    const paymentId = (await pay(g, randomUUID())).json().payment.id;
    const row = await h.ctx.db.selectFrom('payments').select('provider_ref').where('id', '=', paymentId).executeTakeFirstOrThrow();
    const hook = h.gateway.buildWebhook(paymentId, row.provider_ref!, 'succeeded');
    const send = (sig: string) => h.app.inject({ method: 'POST', url: '/api/v1/webhooks/payments/mock', headers: { 'content-type': 'application/json', 'x-mock-signature': sig }, payload: hook.body });
    expect((await send('bad'.padEnd(64, '0'))).statusCode).toBe(401);
    expect((await send(hook.signature)).json().duplicate).toBe(false);
    expect((await send(hook.signature)).json().duplicate).toBe(true);
    const cycles = await h.ctx.db.selectFrom('cycles').select('id').where('payment_id', '=', paymentId).execute();
    expect(cycles).toHaveLength(1);
  });

  it('refuses app payment on machines that cannot be controlled', async () => {
    const g = await guest(h, false);
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/public/payments', headers: { ...g.auth, 'idempotency-key': randomUUID() }, payload: { qrToken: f.washer.qr } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not_controllable');
  });
});

describe('owner permissions & tenancy', () => {
  it('staff can operate their shop but cannot see revenue or other shops', async () => {
    const staff = await loginAs(h, f.users.staff);
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/owner/analytics/revenue', headers: staff })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url: `/api/v1/owner/shops/${f.otherShopId}`, headers: staff })).statusCode).toBe(403);
    const ok = await h.app.inject({ method: 'POST', url: `/api/v1/owner/machines/${f.washer.id}/admin-state`, headers: staff, payload: { adminState: 'maintenance', reason: 'Leaking door seal' } });
    expect(ok.statusCode).toBe(200);
    const pub = await h.app.inject({ method: 'GET', url: `/api/v1/public/machines/${f.washer.qr}` });
    expect(pub.json().machine).toMatchObject({ state: 'maintenance', stateReason: 'Leaking door seal' });
    const overview = (await h.app.inject({ method: 'GET', url: '/api/v1/owner/overview', headers: staff })).json();
    expect(overview.totals.estRevenueTodaySen).toBeUndefined();
    const audit = await h.ctx.db.selectFrom('audit_log').select('action').where('tenant_id', '=', f.tenantId).execute();
    expect(audit.map((a) => a.action)).toContain('machine.admin_state');
  });

  it('a manager limited to one branch cannot act on another branch', async () => {
    const { hashPassword } = await import('../src/auth/owner.js');
    const { raiseAlert } = await import('../src/modules/alerts/service.js');
    const u = await h.ctx.db
      .insertInto('users')
      .values({ email: `mgr-${randomUUID().slice(0, 6)}@test.my`, name: 'Branch manager', password_hash: await hashPassword('password123') })
      .returning(['id', 'email'])
      .executeTakeFirstOrThrow();
    await h.ctx.db.insertInto('memberships').values({ tenant_id: f.tenantId, user_id: u.id, role: 'manager', shop_ids: [f.otherShopId] }).execute();
    const mgr = await loginAs(h, u.email);

    // Refund against a ticket in the other shop: refused, and nothing is created.
    const g = await guest(h, false);
    const t = (await h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category: 'coin_jammed' } })).json().ticket;
    const refund = await h.app.inject({ method: 'POST', url: '/api/v1/owner/refunds', headers: mgr, payload: { ticketId: t.id, amountSen: 500, method: 'cash' } });
    expect(refund.statusCode).toBe(403);
    expect(await h.ctx.db.selectFrom('refunds').select('id').where('ticket_id', '=', t.id).execute()).toHaveLength(0);

    // Alerts, maintenance plans and checklist templates of the other shop.
    await raiseAlert(h.ctx, { tenantId: f.tenantId, shopId: f.shopId, kind: 'low_usage', message: 'x', dedupeKey: `t:${randomUUID()}` });
    const alert = await h.ctx.db.selectFrom('alerts').select('id').where('shop_id', '=', f.shopId).executeTakeFirstOrThrow();
    expect((await h.app.inject({ method: 'POST', url: `/api/v1/owner/alerts/${alert.id}/ack`, headers: mgr, payload: {} })).statusCode).toBe(403);

    const owner = await loginAs(h, f.users.owner);
    const plan = (await h.app.inject({ method: 'POST', url: '/api/v1/owner/maintenance/plans', headers: owner, payload: { shopId: f.shopId, machineType: 'washer', title: 'Descale', intervalDays: 30 } })).json().plan;
    expect((await h.app.inject({ method: 'PATCH', url: `/api/v1/owner/maintenance/plans/${plan.id}`, headers: mgr, payload: { active: false } })).statusCode).toBe(403);
    const tpl = (await h.app.inject({ method: 'POST', url: '/api/v1/owner/checklists/templates', headers: owner, payload: { shopId: f.shopId, name: 'Open', items: [{ label: 'Mop' }] } })).json().template;
    expect((await h.app.inject({ method: 'PATCH', url: `/api/v1/owner/checklists/templates/${tpl.id}`, headers: mgr, payload: { active: false } })).statusCode).toBe(403);

    // A plan can't attach one shop's machine to another shop.
    const mixed = await h.app.inject({ method: 'POST', url: '/api/v1/owner/maintenance/plans', headers: owner, payload: { shopId: f.otherShopId, machineId: f.washer.id, title: 'Belt', intervalDays: 30 } });
    expect(mixed.statusCode).toBe(400);
  });

  it('one tenant cannot touch another tenant’s machines', async () => {
    const other = await seedFixture(h);
    const owner = await loginAs(h, other.users.owner);
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/owner/machines/${f.washer.id}/admin-state`, headers: owner, payload: { adminState: 'disabled', reason: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it('owner overview lists what needs attention', async () => {
    const g = await guest(h, false);
    await h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category: 'water_leak' } });
    const owner = await loginAs(h, f.users.owner);
    const o = (await h.app.inject({ method: 'GET', url: '/api/v1/owner/overview', headers: owner })).json();
    expect(o.attention[0]).toMatchObject({ kind: 'ticket', severity: 'high' });
    expect(o.totals.machines).toBe(3);
  });

  it('records cash collections and flags shortfalls against cycle counters', async () => {
    const owner = await loginAs(h, f.users.owner);
    const post = (amountSen: number, counterReading: number) =>
      h.app.inject({ method: 'POST', url: '/api/v1/owner/collections', headers: owner, payload: { shopId: f.shopId, lines: [{ machineId: f.washer.id, amountSen, counterReading }] } });
    expect((await post(0, 1000)).statusCode).toBe(200);
    h.clock.advance(7 * 24 * 60);
    await post(20_000, 1080); // 80 cycles × RM5 = RM400 expected, RM200 collected
    const rows = (await h.app.inject({ method: 'GET', url: '/api/v1/owner/collections/reconciliation', headers: owner })).json().rows;
    expect(rows[0]).toMatchObject({ expectedCycles: 80, expectedSen: 40_000, collectedSen: 20_000, flag: true, basis: 'counter' });
  });
});
