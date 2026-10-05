/**
 * Regression tests for issues found in the code review. Each test reproduces the original problem.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { json } from '../src/db/index.js';
import { sweepDevices } from '../src/modules/telemetry/service.js';
import { verifyWebhookSignature } from '../src/modules/whatsapp/service.js';
import { MAX_RUNNING_TIMERS_PER_GUEST } from '../src/modules/cycles/service.js';
import { createHarness, guest, loginAs, machineState, seedFixture, type Fixture, type Harness } from './helpers.js';

let h: Harness;
let f: Fixture;
let owner: { cookie: string };

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  f = await seedFixture(h);
  owner = await loginAs(h, f.users.owner);
  h.push.sent = [];
});

const api = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  h.app.inject({ method, url: `/api/v1${url}`, headers, payload: payload as object });
const telemetry = (token: string, samples: Array<{ ts: number | string; powerW: number }>) => api('POST', '/device/telemetry', { authorization: `Bearer ${token}` }, { samples });
const cycleOf = (machineId: string) => h.ctx.db.selectFrom('cycles').selectAll().where('machine_id', '=', machineId).orderBy('started_at', 'desc').executeTakeFirstOrThrow();

describe('tickets: ids and assignees', () => {
  it('re-using another business’s ticket id is refused instead of returning their ticket', async () => {
    const g = await guest(h, false);
    const report = await api('POST', '/public/reports', g.auth, { id: randomUUID(), qrToken: f.washer.qr, category: 'coin_jammed', amountClaimedSen: 500, contactPhone: '0123456789' });
    const ticketId = report.json().ticket?.id ?? report.json().id;

    const other = await seedFixture(h);
    const rival = await loginAs(h, other.users.owner);
    const res = await api('POST', '/owner/tickets', rival, { id: ticketId, shopId: other.shopId, category: 'other', title: 'x' });
    expect(res.statusCode).toBe(409);
    expect(res.body).not.toContain('0123456789');

    // Staff limited to the other shop can't fish it out either.
    const staff = await loginAs(h, f.users.staff);
    expect((await api('POST', '/owner/tickets', staff, { id: ticketId, shopId: f.otherShopId, category: 'other', title: 'x' })).statusCode).toBe(403);
  });

  it('tickets can only be assigned to someone in the same business who can see that shop', async () => {
    const other = await seedFixture(h);
    const t = await api('POST', '/owner/tickets', owner, { id: randomUUID(), shopId: f.shopId, category: 'other', title: 'Leaking pipe' });
    const id = t.json().ticket?.id ?? t.json().id;
    expect((await api('PATCH', `/owner/tickets/${id}`, owner, { assignedTo: other.users.ownerId })).statusCode).toBe(400);
    expect((await api('PATCH', `/owner/tickets/${id}`, owner, { assignedTo: f.users.staffId })).statusCode).toBe(200);
    expect((await api('POST', '/owner/tickets', owner, { id: randomUUID(), shopId: f.otherShopId, category: 'other', title: 'x', assignedTo: f.users.staffId })).statusCode).toBe(400);
  });
});

describe('public data and abuse limits', () => {
  it('the public shop page never hands out machine QR tokens or internal settings', async () => {
    const slug = f.shopSlug;
    const res = await api('GET', `/public/shops/${slug}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(f.washer.qr);
    expect(res.json().machines[0]).not.toHaveProperty('qrToken');
    expect(Object.keys(res.json().settings).sort()).toEqual(['finishedHoldMin', 'remindBeforeMin', 'uncollectedReminderMin']);
    // The sticker page still works for whoever is standing at the machine.
    expect((await api('GET', `/public/machines/${f.washer.qr}`)).json().machine.qrToken).toBe(f.washer.qr);
  });

  it(`one guest can run at most ${MAX_RUNNING_TIMERS_PER_GUEST} timers at once`, async () => {
    const g = await guest(h, false);
    for (let i = 0; i < MAX_RUNNING_TIMERS_PER_GUEST; i++) {
      const m = await h.ctx.db
        .insertInto('machines')
        .values({ tenant_id: f.tenantId, shop_id: f.shopId, code: `W${10 + i}`, qr_token: `cap-${i}-${randomUUID().slice(0, 6)}`, type: 'washer', capacity_kg: 10, programs: json([{ id: 'c', name: { en: 'Cold' }, durationMin: 30, priceSen: 500 }]) })
        .returning('qr_token')
        .executeTakeFirstOrThrow();
      expect((await api('POST', '/public/cycles', g.auth, { id: randomUUID(), qrToken: m.qr_token })).statusCode).toBe(200);
    }
    const res = await api('POST', '/public/cycles', g.auth, { id: randomUUID(), qrToken: f.washer.qr });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('too_many_timers');
  });

  it('push subscriptions must be real browser push services, at most 5 per customer', async () => {
    const g = await guest(h, false);
    const sub = (endpoint: string) => api('POST', '/public/push/subscribe', g.auth, { endpoint, keys: { p256dh: 'x', auth: 'y' } });
    for (const bad of ['https://10.0.0.5:5432/x', 'https://169.254.169.254/latest', 'http://fcm.googleapis.com/fcm/send/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com:8443/x']) {
      expect((await sub(bad)).statusCode).toBe(400);
    }
    for (let i = 0; i < 7; i++) expect((await sub(`https://fcm.googleapis.com/fcm/send/${g.customerId}-${i}`)).statusCode).toBe(200);
    expect(await h.ctx.db.selectFrom('push_subscriptions').select('id').where('customer_id', '=', g.customerId).execute()).toHaveLength(5);
  });

  it('reports by shop name are refused for a shop that isn’t live', async () => {
    await h.ctx.db.updateTable('shops').set({ is_published: false }).where('id', '=', f.shopId).execute();
    const g = await guest(h, false);
    expect((await api('POST', '/public/reports', g.auth, { id: randomUUID(), shopSlug: f.shopSlug, category: 'other', details: 'spam' })).statusCode).toBe(404);
  });
});

describe('owner push alerts follow the sign-in session', () => {
  async function ownerSubscribe(headers: { cookie: string }, endpoint: string) {
    expect((await api('POST', '/owner/push/subscribe', headers, { endpoint, keys: { p256dh: 'x', auth: 'y' } })).statusCode).toBe(200);
  }

  it('stop after logging out on that device', async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/owner-${randomUUID()}`;
    const session = await loginAs(h, f.users.owner);
    await ownerSubscribe(session, endpoint);
    await h.ctx.notify.toTenant(f.tenantId, { title: 'T1', body: 'b' });
    expect(h.push.sent.filter((p) => p.endpoint === endpoint)).toHaveLength(1);

    await api('POST', '/owner/auth/logout', session);
    await h.ctx.notify.toTenant(f.tenantId, { title: 'T2', body: 'b' });
    expect(h.push.sent.filter((p) => p.endpoint === endpoint)).toHaveLength(1);
  });

  it('survive a customer using the same browser, and the customer deleting their data', async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/shared-${randomUUID()}`;
    await ownerSubscribe(owner, endpoint);
    const g = await guest(h, false);
    await api('POST', '/public/push/subscribe', g.auth, { endpoint, keys: { p256dh: 'x', auth: 'y' } });
    await h.ctx.notify.toTenant(f.tenantId, { title: 'Owner alert', body: 'b' });
    expect(h.push.sent.filter((p) => p.endpoint === endpoint && p.payload.title === 'Owner alert')).toHaveLength(1);

    await api('DELETE', '/public/me', g.auth);
    await h.ctx.notify.toTenant(f.tenantId, { title: 'Still here', body: 'b' });
    expect(h.push.sent.filter((p) => p.endpoint === endpoint && p.payload.title === 'Still here')).toHaveLength(1);
  });
});

describe('WhatsApp', () => {
  it('a non-ASCII signature is simply rejected (it used to crash the request)', () => {
    const before = config.whatsapp.appSecret;
    config.whatsapp.appSecret = 'test-secret';
    try {
      expect(verifyWebhookSignature('{}', 'sha256=' + 'é'.repeat(64))).toBe(false);
    } finally {
      config.whatsapp.appSecret = before;
    }
  });

  it('a guest deleting their data keeps the owner’s WhatsApp link on the same number', async () => {
    const g = await guest(h, false);
    await h.ctx.db.insertInto('wa_contacts').values({ wa_id: '60111222333', customer_id: g.customerId, user_id: f.users.ownerId, last_inbound_at: h.clock.now }).execute();
    await api('DELETE', '/public/me', g.auth);
    const c = await h.ctx.db.selectFrom('wa_contacts').select(['customer_id', 'user_id']).where('wa_id', '=', '60111222333').executeTakeFirst();
    expect(c).toEqual({ customer_id: null, user_id: f.users.ownerId });
  });
});

describe('sensors and cycles never get stuck', () => {
  it('a reading dated a year ahead doesn’t blind the detector; garbage and stale times are handled', async () => {
    const now = h.clock.now.getTime();
    expect((await telemetry(f.paid.token, [{ ts: now + 365 * 86_400_000, powerW: 2 }])).statusCode).toBe(200);
    h.clock.advance(1);
    expect((await telemetry(f.paid.token, [{ ts: 'not-a-date', powerW: 2 }])).statusCode).toBe(200);
    h.clock.advance(1);
    await telemetry(f.paid.token, [{ ts: h.clock.now.getTime() - 5 * 3600_000, powerW: 3000 }]); // too old: ignored
    expect((await machineState(h, f.paid.id)).state).toBe('available');
    await telemetry(f.paid.token, [{ ts: h.clock.now.getTime(), powerW: 3000 }]); // a real start
    expect((await machineState(h, f.paid.id)).state).toBe('running');
  });

  it('a power blip on a customer’s checked-in cycle hands it back to the timer instead of running forever', async () => {
    const g = await guest(h);
    const id = randomUUID();
    await api('POST', '/public/cycles', g.auth, { id, qrToken: f.sensored.qr, programId: 'cold' }); // 30 min
    const t = h.clock.now.getTime();
    await telemetry(f.sensored.token, [{ ts: t, powerW: 450 }, { ts: t + 25_000, powerW: 450 }]); // sensor confirms
    expect((await cycleOf(f.sensored.id)).sensor_confirmed).toBe(true);
    await telemetry(f.sensored.token, [{ ts: t + 40_000, powerW: 2 }, { ts: t + 110_000, powerW: 2 }]); // stopped after 40 s: a blip
    await h.tick(31);
    const c = await h.ctx.db.selectFrom('cycles').select(['status']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(c.status).toBe('finished');
  });

  it('if the sensor goes silent after the expected end, the cycle still finishes (at the expected end)', async () => {
    const g = await guest(h);
    const t = h.clock.now.getTime();
    await telemetry(f.sensored.token, [{ ts: t, powerW: 450 }, { ts: t + 25_000, powerW: 450 }]);
    await api('POST', '/public/cycles', g.auth, { id: randomUUID(), qrToken: f.sensored.qr, programId: 'cold' });
    const cyc = await cycleOf(f.sensored.id);
    // Still running a bit past its expected end, then Wi-Fi drops.
    for (let i = 0; i < 7; i++) {
      await h.tick(5);
      await telemetry(f.sensored.token, [{ ts: h.clock.now.getTime(), powerW: 450 }]);
    }
    for (let i = 0; i < 20; i++) {
      await h.tick(1);
      await sweepDevices(h.ctx);
    }
    const after = await h.ctx.db.selectFrom('cycles').select(['status', 'ended_at', 'expected_end_at']).where('id', '=', cyc.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('finished');
    expect(after.ended_at?.getTime()).toBe(after.expected_end_at.getTime());
  });

  it('after a long silence an idle machine ends its cycle at the last moment it was seen, with no false "stuck" alert', async () => {
    const t = h.clock.now.getTime();
    await telemetry(f.sensored.token, [{ ts: t, powerW: 450 }, { ts: t + 25_000, powerW: 450 }]);
    h.clock.advance(10);
    await telemetry(f.sensored.token, [{ ts: t + 10 * 60_000, powerW: 450 }]);
    h.clock.advance(5 * 60); // device off for hours
    await telemetry(f.sensored.token, [{ ts: h.clock.now.getTime(), powerW: 2 }]);
    const c = await cycleOf(f.sensored.id);
    expect(c.status).not.toBe('running');
    expect(c.ended_at?.getTime()).toBe(t + 10 * 60_000);
    const stuck = await h.ctx.db.selectFrom('alerts').select('id').where('tenant_id', '=', f.tenantId).where('kind', '=', 'stuck_cycle').execute();
    expect(stuck).toHaveLength(0);
  });

  it('a machine wrongly stored as offline recovers on the next heartbeat', async () => {
    await h.ctx.db.updateTable('machines').set({ state: 'offline' }).where('id', '=', f.sensored.id).execute();
    await api('POST', '/device/heartbeat', { authorization: `Bearer ${f.sensored.token}` }, {});
    expect((await machineState(h, f.sensored.id)).state).toBe('available');
  });

  it('staff can clear a stuck sensor-confirmed cycle once the sensor reads idle', async () => {
    const g = await guest(h);
    const t = h.clock.now.getTime();
    await telemetry(f.sensored.token, [{ ts: t, powerW: 450 }, { ts: t + 25_000, powerW: 450 }]);
    await api('POST', '/public/cycles', g.auth, { id: randomUUID(), qrToken: f.sensored.qr, programId: 'cold' });
    const staff = await loginAs(h, f.users.staff);
    // Still drawing power: clearing leaves it alone.
    await api('POST', `/owner/machines/${f.sensored.id}/clear`, staff, {});
    expect((await cycleOf(f.sensored.id)).status).toBe('running');
    await h.ctx.db.updateTable('devices').set({ last_power_w: 1 }).where('id', '=', f.sensored.deviceId).execute();
    await api('POST', `/owner/machines/${f.sensored.id}/clear`, staff, {});
    expect((await cycleOf(f.sensored.id)).status).toBe('aborted');
  });
});

describe('staff see operations, not money or other branches', () => {
  /** A manager limited to one branch (all permissions except staff management). */
  async function branchManager(shopId: string) {
    const { hashPassword } = await import('../src/auth/owner.js');
    const u = await h.ctx.db.insertInto('users').values({ email: `mgr-${randomUUID().slice(0, 6)}@test.my`, name: 'Mgr', password_hash: await hashPassword('password123') }).returning(['id', 'email']).executeTakeFirstOrThrow();
    await h.ctx.db.insertInto('memberships').values({ tenant_id: f.tenantId, user_id: u.id, role: 'manager', shop_ids: [shopId] }).execute();
    return loginAs(h, u.email);
  }

  it('the machine page shows staff no revenue, prices or costs', async () => {
    const g = await guest(h, false);
    await api('POST', '/public/cycles', g.auth, { id: randomUUID(), qrToken: f.washer.qr, programId: 'hot' });
    const staff = await loginAs(h, f.users.staff);
    const d = (await api('GET', `/owner/machines/${f.washer.id}`, staff)).json();
    expect(d.stats30d.estimatedRevenueSen).toBeNull();
    expect(d.cycles.every((c: { price_sen: number | null }) => c.price_sen === null)).toBe(true);
    const o = (await api('GET', `/owner/machines/${f.washer.id}`, owner)).json();
    expect(o.cycles[0].price_sen).toBe(700);
  });

  it('refund phone numbers are masked for staff on the ticket page', async () => {
    const g = await guest(h, false);
    const r = await api('POST', '/public/reports', g.auth, { id: randomUUID(), qrToken: f.washer.qr, category: 'coin_jammed', amountClaimedSen: 500, contactPhone: '0123456789' });
    const ticketId = r.json().ticket?.id ?? r.json().id;
    await api('POST', '/owner/refunds', owner, { ticketId, amountSen: 500, method: 'duitnow', payoutPhone: '0123456789' });
    const staff = await loginAs(h, f.users.staff);
    const body = (await api('GET', `/owner/tickets/${ticketId}`, staff)).body;
    expect(body).not.toContain('0123456789');
    expect(body).toContain('••••789');
  });

  it('a branch-limited manager can’t read the all-branch audit log; QR codes respect branches', async () => {
    const mgr = await branchManager(f.shopId);
    expect((await api('GET', '/owner/audit', mgr)).statusCode).toBe(403);
    expect((await api('GET', '/owner/audit', owner)).statusCode).toBe(200);
    const other = await h.ctx.db
      .insertInto('machines')
      .values({ tenant_id: f.tenantId, shop_id: f.otherShopId, code: 'O1', qr_token: `o-${randomUUID().slice(0, 6)}`, type: 'washer', capacity_kg: 10, programs: json([]) })
      .returning('id')
      .executeTakeFirstOrThrow();
    const staff = await loginAs(h, f.users.staff);
    expect((await api('GET', `/owner/machines/${other.id}/qr.svg`, staff)).statusCode).toBe(403);
  });

  it('the setup wizard shows branch-limited staff only their branch', async () => {
    const mgr = await branchManager(f.otherShopId);
    const s = (await api('GET', '/owner/onboarding', mgr)).json();
    expect(s.shop.id).toBe(f.otherShopId);
  });

  it('staff can’t backdate a cash collection; owners can within 30 days', async () => {
    const staff = await loginAs(h, f.users.staff);
    const weekAgo = new Date(h.clock.now.getTime() - 7 * 86_400_000).toISOString();
    const s = (await api('POST', '/owner/collections', staff, { shopId: f.shopId, collectedAt: weekAgo, lines: [{ machineId: f.washer.id, amountSen: 1000 }] })).json();
    expect(new Date(s.collection.collected_at).getTime()).toBe(h.clock.now.getTime());
    const o = (await api('POST', '/owner/collections', owner, { shopId: f.shopId, collectedAt: weekAgo, lines: [{ machineId: f.washer.id, amountSen: 1000 }] })).json();
    expect(o.collection.collected_at).toBe(weekAgo);
    const old = new Date(h.clock.now.getTime() - 60 * 86_400_000).toISOString();
    expect((await api('POST', '/owner/collections', owner, { shopId: f.shopId, collectedAt: old, lines: [{ machineId: f.washer.id, amountSen: 1 }] })).statusCode).toBe(400);
  });

  it('a retried collection (same id) is recorded once', async () => {
    const id = randomUUID();
    const send = () => api('POST', '/owner/collections', owner, { id, shopId: f.shopId, lines: [{ machineId: f.washer.id, amountSen: 1500 }] });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).json().collection.id).toBe(id);
    expect(await h.ctx.db.selectFrom('collections').select('id').where('shop_id', '=', f.shopId).execute()).toHaveLength(1);
  });

  it('staff see the amounts they entered themselves (matched by account, not by name)', async () => {
    const staff = await loginAs(h, f.users.staff);
    await api('POST', '/owner/collections', staff, { shopId: f.shopId, lines: [{ machineId: f.washer.id, amountSen: 1234 }] });
    // A second staff member with the very same display name.
    const { hashPassword } = await import('../src/auth/owner.js');
    const twin = await h.ctx.db.insertInto('users').values({ email: `twin-${randomUUID().slice(0, 6)}@test.my`, name: 'Staff', password_hash: await hashPassword('password123') }).returning(['id', 'email']).executeTakeFirstOrThrow();
    await h.ctx.db.insertInto('memberships').values({ tenant_id: f.tenantId, user_id: twin.id, role: 'staff', shop_ids: [f.shopId] }).execute();
    const list = (who: { cookie: string }) => api('GET', '/owner/collections', who).then((r) => r.json().collections[0].lines[0].amount_sen);
    expect(await list(staff)).toBe(1234);
    expect(await list(await loginAs(h, twin.email))).toBeNull();
  });
});

describe('accounts', () => {
  it('a rejected new password doesn’t use up the reset link', async () => {
    await api('POST', '/owner/auth/forgot', {}, { email: f.users.owner });
    const token = decodeURIComponent(h.mail.sent.at(-1)!.text.match(/token=([^\s]+)/)![1]!);
    expect((await api('POST', '/owner/auth/reset', {}, { token, newPassword: 'short' })).statusCode).toBe(400);
    expect((await api('POST', '/owner/auth/reset', {}, { token, newPassword: 'a-much-better-pass-7' })).statusCode).toBe(200);
  });

  it('adding someone whose email belongs to another business says so instead of failing silently', async () => {
    const other = await seedFixture(h);
    const res = await api('POST', '/owner/staff', owner, { email: other.users.owner, name: 'X', role: 'staff', password: 'whatever-123', shopIds: null });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('email_in_use');
    expect((await api('POST', '/owner/staff', owner, { email: `new-${randomUUID().slice(0, 6)}@test.my`, name: 'X', role: 'staff', password: 'whatever-123', shopIds: [other.shopId] })).statusCode).toBe(400);
  });

  it('maintenance can only be logged against this business’s plan for that machine', async () => {
    const other = await seedFixture(h);
    const rival = await loginAs(h, other.users.owner);
    const plan = (await api('POST', '/owner/maintenance/plans', rival, { shopId: other.shopId, machineType: 'washer', title: 'Secret plan', intervalDays: 30 })).json();
    const planId = plan.plan?.id ?? plan.id;
    expect((await api('POST', '/owner/maintenance/logs', owner, { machineId: f.washer.id, planId })).statusCode).toBe(400);
  });
});

describe('privacy retention', () => {
  it('refund phone numbers are removed for failed refunds and for refunds on long-closed reports', async () => {
    const { sweepPrivacy } = await import('../src/modules/privacy/service.js');
    const g = await guest(h, false);
    const r = await api('POST', '/public/reports', g.auth, { id: randomUUID(), qrToken: f.washer.qr, category: 'coin_jammed', amountClaimedSen: 500, contactPhone: '0123456789' });
    const ticketId = r.json().ticket?.id ?? r.json().id;
    const req = (await api('POST', '/owner/refunds', owner, { ticketId, amountSen: 500, method: 'duitnow', payoutPhone: '0199999999' })).json().refund.id as string;
    await api('PATCH', `/owner/tickets/${ticketId}`, owner, { status: 'resolved' });
    h.clock.advance(100 * 24 * 60);
    await sweepPrivacy(h.ctx);
    expect((await h.ctx.db.selectFrom('refunds').select('payout_phone').where('id', '=', req).executeTakeFirstOrThrow()).payout_phone).toBeNull();
  });
});

describe('machine state, analytics and alerts over time', () => {
  const KL_OFFSET_MS = 8 * 3600_000;
  /** Earlier tests move the shared clock; jump forward to the next 10:00 in Kuala Lumpur (02:00 UTC). */
  function toTenAmKL() {
    const t = h.clock.now.getTime();
    h.clock.now = new Date(Math.ceil((t - 2 * 3600_000) / 86_400_000) * 86_400_000 + 2 * 3600_000);
  }
  async function cycle(machineId: string, startUtc: Date, endUtc: Date) {
    await h.ctx.db
      .insertInto('cycles')
      .values({
        id: randomUUID(),
        tenant_id: f.tenantId,
        shop_id: f.shopId,
        machine_id: machineId,
        source: 'customer',
        status: 'finished',
        duration_min: Math.round((endUtc.getTime() - startUtc.getTime()) / 60_000),
        started_at: startUtc,
        expected_end_at: endUtc,
        ended_at: endUtc,
      })
      .execute();
  }

  it('live updates resume after the database drops the listening connection', async () => {
    const got: string[] = [];
    const off = h.ctx.bus.onRemote((e) => got.push(e.type));
    await h.ctx.pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = 'LISTEN dobi_events' AND datname = current_database() AND pid <> pg_backend_pid()`);
    await expect
      .poll(
        async () => {
          await h.ctx.bus.publish(`shop:${f.shopId}`, 'probe', {});
          return got.includes('probe');
        },
        { timeout: 8000, interval: 500 },
      )
      .toBe(true);
    off();
  });

  it('a fault from customer reports lapses after 24 h on its own', async () => {
    for (let i = 0; i < 2; i++) {
      const g = await guest(h, false);
      await api('POST', '/public/reports', g.auth, { id: randomUUID(), qrToken: f.washer.qr, category: 'not_starting' });
    }
    expect((await machineState(h, f.washer.id)).state).toBe('fault');
    await h.tick(24 * 60 + 2);
    expect((await machineState(h, f.washer.id)).state).toBe('available');
  });

  it('utilisation only counts busy time while the shop is open, so it never exceeds 100%', async () => {
    const { utilisation } = await import('../src/modules/analytics/service.js');
    const daily = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, { open: '08:00', close: '10:00' }]));
    await h.ctx.db.updateTable('shops').set({ opening_hours: json(daily) }).where('id', '=', f.shopId).execute();
    toTenAmKL();
    // Clock is 10:00 in Kuala Lumpur. A cycle from 06:00 to 10:00 local: only 08:00–10:00 is open time.
    const now = h.clock.now.getTime();
    await cycle(f.washer.id, new Date(now - 4 * 3600_000), new Date(now));
    const dayStartUtc = new Date(Math.floor((now + KL_OFFSET_MS) / 86_400_000) * 86_400_000 - KL_OFFSET_MS);
    const u = await utilisation(h.ctx, f.tenantId, [f.shopId], dayStartUtc, h.clock.now);
    const m = u.machines.find((x) => x.machineId === f.washer.id)!;
    expect(m.busyMin).toBe(120);
    expect(m.utilisation).toBeLessThanOrEqual(1);
    expect(u.byShop.every((s) => s.utilisation <= 1)).toBe(true);
  });

  it('a shop open past midnight shows its real closing time', async () => {
    const late = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, { open: '08:00', close: '02:00' }]));
    await h.ctx.db.updateTable('shops').set({ opening_hours: json(late) }).where('id', '=', f.shopId).execute();
    toTenAmKL();
    h.clock.advance(13 * 60); // 23:00 in Kuala Lumpur
    const s = (await api('GET', `/public/shops/${f.shopSlug}`)).json();
    expect(s.openNow).toBe(true);
    expect(s.closesAt).toBe('02:00');
  });

  it('no "low usage" alert for a machine that was in maintenance', async () => {
    const { lowUsage } = await import('../src/modules/analytics/service.js');
    const now = h.clock.now.getTime();
    // Two busy peers (W2, W3), one idle washer (W1) that staff put into maintenance.
    for (const id of [f.sensored.id, f.paid.id]) for (let i = 0; i < 8; i++) await cycle(id, new Date(now - (i + 1) * 6 * 3600_000), new Date(now - (i + 1) * 6 * 3600_000 + 30 * 60_000));
    expect((await lowUsage(h.ctx, f.tenantId, [f.shopId])).flagged.map((m) => m.machineId)).toContain(f.washer.id);
    await api('POST', `/owner/machines/${f.washer.id}/admin-state`, owner, { adminState: 'maintenance', reason: 'New motor' });
    expect((await lowUsage(h.ctx, f.tenantId, [f.shopId])).flagged.map((m) => m.machineId)).not.toContain(f.washer.id);
  });

  it('sensors dropping out a minute apart in a power cut give one shop alert; a sensor still dead after recovery gets its own', async () => {
    const now = h.clock.now.getTime();
    await h.ctx.db.updateTable('devices').set({ last_seen_at: new Date(now - 200_000) }).where('id', '=', f.sensored.deviceId).execute();
    await h.ctx.db.updateTable('devices').set({ last_seen_at: new Date(now - 150_000) }).where('id', '=', f.paid.deviceId).execute();
    await sweepDevices(h.ctx); // only the first is overdue yet
    h.clock.advance(1);
    await sweepDevices(h.ctx); // now the second
    const open = async () => (await h.ctx.db.selectFrom('alerts').select(['kind', 'dedupe_key']).where('tenant_id', '=', f.tenantId).where('status', '<>', 'resolved').execute()).map((a) => a.dedupe_key);
    expect(await open()).toEqual([`shop_offline:${f.shopId}`]);

    // Power returns: one sensor reports, the other is broken.
    await telemetry(f.sensored.token, [{ ts: h.clock.now.getTime(), powerW: 2 }]);
    expect(await open()).toEqual([]);
    await h.tick(4);
    expect(await open()).toEqual([`device_offline:${f.paid.deviceId}`]);
  });
});
