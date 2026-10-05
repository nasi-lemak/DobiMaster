import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, guest, loginAs, seedFixture, type Fixture, type Harness } from './helpers.js';

let h: Harness;
let f: Fixture;
let owner: { cookie: string };
let staff: { cookie: string };

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  f = await seedFixture(h);
  owner = await loginAs(h, f.users.owner);
  staff = await loginAs(h, f.users.staff);
});

const api = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string> = owner, payload?: unknown) =>
  h.app.inject({ method, url: `/api/v1${url}`, headers, payload: payload as object });
const H24 = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, { open: '00:00', close: '24:00' }]));
const programs = [
  { id: 'cold', name: { en: 'Cold' }, durationMin: 30, priceSen: 500 },
  { id: 'hot', name: { en: 'Hot' }, durationMin: 40, priceSen: 700 },
];

describe('shops', () => {
  it('create, rename, change settings, unpublish; addresses are unique; staff can’t', async () => {
    const slug = `dobi-${randomUUID().slice(0, 8)}`;
    const body = { name: 'Dobi Baharu', slug, openingHours: H24 };
    expect((await api('POST', '/owner/shops', staff, body)).statusCode).toBe(403);
    const created = await api('POST', '/owner/shops', owner, body);
    expect(created.statusCode).toBe(200);
    const id = created.json().shop?.id ?? created.json().id;
    expect((await api('POST', '/owner/shops', owner, body)).statusCode).toBe(409); // slug taken

    const patched = await api('PATCH', `/owner/shops/${id}`, owner, { name: 'Dobi Baharu Cheras', settings: { electricitySenPerKwh: 57 } });
    expect(patched.statusCode).toBe(200);
    const row = await h.ctx.db.selectFrom('shops').select(['name', 'settings', 'is_published']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.name).toBe('Dobi Baharu Cheras');
    expect((row.settings as { electricitySenPerKwh?: number }).electricitySenPerKwh).toBe(57);

    expect((await api('GET', `/public/shops/${slug}`, {})).statusCode).toBe(200);
    await api('PATCH', `/owner/shops/${id}`, owner, { isPublished: false });
    expect((await api('GET', `/public/shops/${slug}`, {})).statusCode).toBe(404);
    expect((await api('GET', '/public/shops', {})).json().shops.map((s: { slug: string }) => s.slug)).not.toContain(slug);
  });

  it('owners see every branch, branch staff only theirs', async () => {
    const mine = (await api('GET', '/owner/shops', owner)).json().shops.map((s: { id: string }) => s.id);
    expect(mine).toEqual(expect.arrayContaining([f.shopId, f.otherShopId]));
    const theirs = (await api('GET', '/owner/shops', staff)).json().shops.map((s: { id: string }) => s.id);
    expect(theirs).toEqual([f.shopId]);
    expect((await api('GET', `/owner/shops/${f.otherShopId}`, staff)).statusCode).toBe(403);
  });
});

describe('machines', () => {
  it('add several at once, edit prices, refuse duplicate codes, remove', async () => {
    const add = await api('POST', '/owner/machines', owner, { shopId: f.shopId, code: 'W5', codes: ['W5', 'W6'], type: 'washer', capacityKg: 12, programs });
    expect(add.statusCode).toBe(200);
    const list = (await api('GET', `/owner/machines?shopId=${f.shopId}`)).json().machines as Array<{ id: string; code: string }>;
    const w6 = list.find((m) => m.code === 'W6')!;
    expect(list.map((m) => m.code)).toEqual(expect.arrayContaining(['W5', 'W6']));
    expect((await api('POST', '/owner/machines', owner, { shopId: f.shopId, code: 'W6', type: 'washer', capacityKg: 12, programs })).statusCode).toBe(409);

    expect((await api('PATCH', `/owner/machines/${w6.id}`, staff, { programs: [{ ...programs[0], priceSen: 550 }] })).statusCode).toBe(403);
    expect((await api('PATCH', `/owner/machines/${w6.id}`, owner, { programs: [{ ...programs[0], priceSen: 550 }] })).statusCode).toBe(200);
    expect((await api('PATCH', `/owner/machines/${w6.id}`, owner, { code: 'W5' })).statusCode).toBe(409);

    const qr = (await h.ctx.db.selectFrom('machines').select('qr_token').where('id', '=', w6.id).executeTakeFirstOrThrow()).qr_token;
    expect((await api('GET', `/public/machines/${qr}`, {})).json().machine.programs[0].priceSen).toBe(550);
    expect((await api('DELETE', `/owner/machines/${w6.id}`)).statusCode).toBe(200);
    expect((await api('GET', `/public/machines/${qr}`, {})).statusCode).toBe(404);
    expect((await api('GET', `/public/shops/${f.shopSlug}`, {})).json().machines.map((m: { code: string }) => m.code)).not.toContain('W6');
  });

  it('maintenance with a reason customers see, then back in service', async () => {
    expect((await api('POST', `/owner/machines/${f.washer.id}/admin-state`, staff, { adminState: 'maintenance', reason: 'Technician Friday' })).statusCode).toBe(200);
    let pub = (await api('GET', `/public/machines/${f.washer.qr}`, {})).json().machine;
    expect(pub).toMatchObject({ state: 'maintenance', stateReason: 'Technician Friday' });
    const g = await guest(h, false);
    expect((await api('POST', '/public/cycles', g.auth, { id: randomUUID(), qrToken: f.washer.qr })).statusCode).toBe(409);
    await api('POST', `/owner/machines/${f.washer.id}/admin-state`, staff, { adminState: 'active' });
    pub = (await api('GET', `/public/machines/${f.washer.qr}`, {})).json().machine;
    expect(pub.state).toBe('available');
  });

  it('the QR sticker sheet has one sticker per machine', async () => {
    const sheet = (await api('GET', `/owner/shops/${f.shopId}/qr-sheet`)).json();
    expect(sheet.items.map((i: { code: string }) => i.code).sort()).toEqual(['W1', 'W2', 'W3']);
    expect(sheet.items[0].svg).toContain('<svg');
    expect(sheet.shop.url).toContain(`/s/${f.shopSlug}`);
  });
});

describe('sensors and announcements', () => {
  it('registering a sensor shows its token once; the token then works and is never listed', async () => {
    const w = await api('POST', '/owner/machines', owner, { shopId: f.shopId, code: 'W9', type: 'washer', capacityKg: 10, programs });
    const machineId = (w.json().machines?.[0] ?? w.json().machine).id as string;
    expect((await api('POST', '/owner/devices', staff, { shopId: f.shopId, machineId, kind: 'shelly' })).statusCode).toBe(403);
    expect((await api('POST', '/owner/devices', owner, { shopId: f.otherShopId, machineId, kind: 'shelly' })).statusCode).toBe(400); // machine is elsewhere
    const reg = (await api('POST', '/owner/devices', owner, { shopId: f.shopId, machineId, kind: 'shelly', label: 'W9 clamp' })).json();
    expect(reg.token).toBeTruthy();
    expect(reg.ingestUrl).toMatch(/\/api\/v1\/device\/telemetry$/);
    const listed = (await api('GET', '/owner/devices')).body;
    expect(listed).not.toContain(reg.token);
    const t = await api('POST', '/device/telemetry', { authorization: `Bearer ${reg.token}` }, { samples: [{ powerW: 2 }] });
    expect(t.statusCode).toBe(200);
    expect((await api('POST', '/device/telemetry', { authorization: 'Bearer nope' }, { samples: [{ powerW: 2 }] })).statusCode).toBe(401);
  });

  it('announcements appear on the shop page until removed; staff can’t post them', async () => {
    const message = { en: 'Dryers 1–2 out of order today', ms: 'Pengering 1–2 rosak hari ini' };
    expect((await api('POST', '/owner/announcements', staff, { shopId: f.shopId, message })).statusCode).toBe(403);
    const a = (await api('POST', '/owner/announcements', owner, { shopId: f.shopId, message, level: 'warning' })).json().announcement;
    const shown = () => api('GET', `/public/shops/${f.shopSlug}`, {}).then((r) => r.json().announcements.map((x: { id: string }) => x.id));
    expect(await shown()).toContain(a.id);
    await api('DELETE', `/owner/announcements/${a.id}`);
    expect(await shown()).not.toContain(a.id);
  });
});

describe('analytics', () => {
  async function cycle(machineId: string, minutesAgo: number, priceSen: number, durationMin = 30) {
    const start = new Date(h.clock.now.getTime() - minutesAgo * 60_000);
    const end = new Date(start.getTime() + durationMin * 60_000);
    await h.ctx.db
      .insertInto('cycles')
      .values({ id: randomUUID(), tenant_id: f.tenantId, shop_id: f.shopId, machine_id: machineId, source: 'customer', status: 'finished', duration_min: durationMin, price_sen: priceSen, started_at: start, expected_end_at: end, ended_at: end })
      .execute();
  }

  it('revenue adds cash and app payments (net of refunds) and estimates from cycles', async () => {
    await cycle(f.washer.id, 120, 500);
    await cycle(f.washer.id, 60, 700);
    await api('POST', '/owner/collections', owner, { shopId: f.shopId, lines: [{ machineId: f.washer.id, amountSen: 1200 }] });
    const g = await guest(h, false);
    await h.ctx.db
      .insertInto('payments')
      .values({ tenant_id: f.tenantId, shop_id: f.shopId, machine_id: f.paid.id, customer_id: g.customerId, program_id: 'hot', amount_sen: 700, refunded_sen: 200, provider: 'mock', status: 'succeeded', succeeded_at: h.clock.now, idempotency_key: randomUUID() })
      .execute();
    h.clock.advance(1);
    const r = (await api('GET', '/owner/analytics/revenue?days=1&groupBy=machine')).json();
    expect(r.totals).toMatchObject({ cashSen: 1200, appSen: 500, recordedSen: 1700, estimatedSen: 1200, cycles: 2 });
    expect(r.rows.find((x: { code?: string }) => x.code === 'W1')).toMatchObject({ cashSen: 1200, estimatedSen: 1200, cycles: 2 });
    // Hourly view doesn't pretend to know when bulk-collected cash was taken.
    expect((await api('GET', '/owner/analytics/revenue?days=1&groupBy=hour')).json().totals.cashSen).toBe(0);
    expect((await api('GET', '/owner/analytics/revenue?days=1', staff)).statusCode).toBe(403);
  });

  it('peak hours, capacity and energy endpoints answer for a shop with history', async () => {
    for (let i = 1; i <= 6; i++) await cycle(f.washer.id, i * 90, 500);
    h.clock.advance(1);
    const peak = await api('GET', `/owner/analytics/peak-hours?days=7&shopId=${f.shopId}`);
    expect(peak.statusCode).toBe(200);
    const cap = await api('GET', `/owner/analytics/capacity?days=7&shopId=${f.shopId}`);
    expect(cap.statusCode).toBe(200);
    expect((await api('GET', `/owner/analytics/capacity?days=7&shopId=${f.otherShopId}`, staff)).statusCode).toBe(403);
    const util = (await api('GET', `/owner/analytics/utilisation?days=1&shopId=${f.shopId}`)).json();
    const w1 = util.machines.find((m: { code: string }) => m.code === 'W1');
    expect(w1.cycles).toBeGreaterThan(0);
    expect(w1.utilisation).toBeGreaterThan(0);
    expect(w1.utilisation).toBeLessThanOrEqual(1);
    expect((await api('GET', '/owner/analytics/energy?days=7')).statusCode).toBe(200);
  });
});

describe('job queue', () => {
  it('retries a failing job with back-off, then gives up after 5 attempts', async () => {
    let calls = 0;
    h.ctx.jobs.register('test.flaky', async () => {
      calls++;
      throw new Error('boom');
    });
    await h.ctx.jobs.schedule('test.flaky', h.clock.now, {}, `test.flaky:${randomUUID()}`);
    for (let i = 0; i < 12; i++) await h.tick(2);
    expect(calls).toBe(5);
    const row = await h.ctx.db.selectFrom('jobs').select(['status', 'attempts', 'last_error']).where('kind', '=', 'test.flaky').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'failed', attempts: 5, last_error: 'boom' });
  });

  it('a dedupe key schedules once; cancel and reschedule replace it', async () => {
    const ran: string[] = [];
    h.ctx.jobs.register('test.once', async (p) => {
      ran.push(String(p.v));
    });
    const key = `test.once:${randomUUID()}`;
    await h.ctx.jobs.schedule('test.once', h.clock.now, { v: 'a' }, key);
    await h.ctx.jobs.schedule('test.once', h.clock.now, { v: 'b' }, key); // ignored: already queued
    await h.tick(0.1);
    expect(ran).toEqual(['a']);

    const later = `test.once:${randomUUID()}`;
    await h.ctx.jobs.schedule('test.once', new Date(h.clock.now.getTime() + 60_000), { v: 'c' }, later);
    await h.ctx.jobs.reschedule('test.once', new Date(h.clock.now.getTime() + 5 * 60_000), { v: 'd' }, later);
    await h.tick(2);
    expect(ran).toEqual(['a']); // c was cancelled, d not due yet
    await h.tick(4);
    expect(ran).toEqual(['a', 'd']);

    const gone = `test.once:${randomUUID()}`;
    await h.ctx.jobs.schedule('test.once', h.clock.now, { v: 'e' }, gone);
    await h.ctx.jobs.cancel(gone);
    await h.tick(1);
    expect(ran).toEqual(['a', 'd']);
  });

  it('a job stuck "running" (crashed worker) is picked up again after 5 minutes', async () => {
    let calls = 0;
    h.ctx.jobs.register('test.stuck', async () => {
      calls++;
    });
    await h.ctx.db.insertInto('jobs').values({ kind: 'test.stuck', run_at: h.clock.now, payload: '{}' as never, status: 'running', attempts: 1, updated_at: h.clock.now } as never).execute();
    await h.tick(1);
    expect(calls).toBe(0);
    await h.tick(5);
    expect(calls).toBe(1);
  });

  it('a job that keeps killing its worker is abandoned after 5 attempts instead of looping forever', async () => {
    let calls = 0;
    h.ctx.jobs.register('test.crasher', async () => {
      calls++;
    });
    await h.ctx.db.insertInto('jobs').values({ kind: 'test.crasher', run_at: h.clock.now, payload: '{}' as never, status: 'running', attempts: 5, updated_at: h.clock.now } as never).execute();
    await h.tick(6);
    expect(calls).toBe(0);
    const row = await h.ctx.db.selectFrom('jobs').select(['status', 'last_error']).where('kind', '=', 'test.crasher').executeTakeFirstOrThrow();
    expect(row.status).toBe('failed');
    expect(row.last_error).toMatch(/abandoned/);
  });
});

describe('weekly summary', () => {
  it('one business failing doesn’t stop the others, and it is retried on the next run', async () => {
    const { sweepDigest } = await import('../src/modules/digest/service.js');
    const other = await seedFixture(h);
    // Next Monday 08:30 in Kuala Lumpur (00:30 UTC).
    const t = h.clock.now.getTime();
    const day = 86_400_000;
    let monday = Math.ceil(t / day) * day + 30 * 60_000;
    while (new Date(monday).getUTCDay() !== 1) monday += day;
    h.clock.now = new Date(monday);
    await h.ctx.db.deleteFrom('digest_log').execute();

    const wa = h.ctx.notify.whatsapp;
    const original = wa.sendInWindow.bind(wa);
    wa.sendInWindow = (async (to: { userId?: string }, text: string) => {
      if (to.userId === f.users.ownerId) throw new Error('WhatsApp down');
      return original(to as never, text);
    }) as typeof wa.sendInWindow;
    h.mail.sent = [];
    try {
      await sweepDigest(h.ctx);
    } finally {
      wa.sendInWindow = original;
    }
    expect(h.mail.sent.some((m) => m.to === other.users.owner)).toBe(true);
    const logged = await h.ctx.db.selectFrom('digest_log').select('tenant_id').execute();
    expect(logged.map((l) => l.tenant_id)).toContain(other.tenantId);
    expect(logged.map((l) => l.tenant_id)).not.toContain(f.tenantId); // released for a retry

    await sweepDigest(h.ctx); // next run: succeeds now
    expect((await h.ctx.db.selectFrom('digest_log').select('tenant_id').execute()).map((l) => l.tenant_id)).toContain(f.tenantId);
  });
});
