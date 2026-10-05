import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRIVACY_RETENTION } from '@dobi/shared';
import { createHarness, guest, seedFixture, type Fixture, type Harness } from './helpers.js';

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

describe('"Delete my data" (guest erasure)', () => {
  it('erases the person but keeps the shop’s business records, unlinked', async () => {
    const g = await guest(h); // with a push subscription
    const db = h.ctx.db;

    // A timer, two refund reports with a phone number (one later resolved), a payment and a linked WhatsApp number.
    const cycleId = randomUUID();
    await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id: cycleId, qrToken: f.washer.qr } });
    const report = (category: string) =>
      h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category, amountClaimedSen: 500, contactPhone: '012-345 6789' } });
    const closed = (await report('coin_jammed')).json();
    await report('not_starting');
    const closedId = closed.ticket?.id ?? closed.id;
    await db.updateTable('tickets').set({ status: 'resolved', resolved_at: h.clock.now }).where('id', '=', closedId).execute();
    const pay = await db
      .insertInto('payments')
      .values({ tenant_id: f.tenantId, shop_id: f.shopId, machine_id: f.paid.id, customer_id: g.customerId, program_id: 'cold', amount_sen: 500, provider: 'mock', status: 'succeeded', idempotency_key: 'erase-test-1' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.insertInto('wa_contacts').values({ wa_id: '60123456789', customer_id: g.customerId, last_inbound_at: h.clock.now }).execute();
    await db.insertInto('wa_messages').values({ direction: 'in', wa_id: '60123456789', kind: 'text', body: 'DOBI-ABC123' }).execute();

    const res = await h.app.inject({ method: 'DELETE', url: '/api/v1/public/me', headers: g.auth });
    expect(res.statusCode).toBe(200);
    // The open report keeps its phone so the shop can still refund; the user is told so.
    expect(res.json().openReportsKeepingPhone).toBe(1);

    // The person is gone…
    expect(await db.selectFrom('customers').select('id').where('id', '=', g.customerId).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom('push_subscriptions').select('id').where('endpoint', '=', g.endpoint).execute()).toHaveLength(0);
    expect(await db.selectFrom('wa_contacts').select('id').where('wa_id', '=', '60123456789').execute()).toHaveLength(0);
    expect(await db.selectFrom('wa_messages').select('id').where('wa_id', '=', '60123456789').execute()).toHaveLength(0);

    // …the shop's records stay, unlinked.
    const cycle = await db.selectFrom('cycles').select('customer_id').where('id', '=', cycleId).executeTakeFirstOrThrow();
    expect(cycle.customer_id).toBeNull();
    const payment = await db.selectFrom('payments').select(['customer_id', 'amount_sen']).where('id', '=', pay.id).executeTakeFirstOrThrow();
    expect(payment).toEqual({ customer_id: null, amount_sen: 500 });
    const tickets = await db.selectFrom('tickets').select(['id', 'customer_id', 'contact_phone', 'status']).where('shop_id', '=', f.shopId).where('source', '=', 'customer').execute();
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.customer_id === null)).toBe(true);
    expect(tickets.find((t) => t.id === closedId)!.contact_phone).toBeNull();
    expect(tickets.find((t) => t.id !== closedId)!.contact_phone).toBe('012-345 6789');

    // The old token no longer works; the app then starts a fresh anonymous guest.
    const after = await h.app.inject({ method: 'GET', url: '/api/v1/public/me/cycles', headers: g.auth });
    expect(after.statusCode).toBe(401);
    expect((await h.app.inject({ method: 'DELETE', url: '/api/v1/public/me', headers: g.auth })).statusCode).toBe(401);
  });

  it('publishes who runs the server and the real retention periods for the privacy notice', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/public/legal' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retention).toEqual(PRIVACY_RETENTION);
    expect(body.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body).toHaveProperty('operatorName');
    expect(body).toHaveProperty('contactEmail');
  });
});
