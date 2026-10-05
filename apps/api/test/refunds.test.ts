import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, guest, loginAs, seedFixture, type Fixture, type Harness } from './helpers.js';

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
  h.gateway.refunds = [];
  h.gateway.failRefunds = false;
});

const post = (url: string, payload: unknown, headers = owner) => h.app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload: payload as object });
const decide = (id: string, payload: Record<string, unknown>, headers = owner) => post(`/owner/refunds/${id}/decision`, payload, headers);
const refundRow = (id: string) => h.ctx.db.selectFrom('refunds').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

/** A succeeded in-app payment of `amountSen` on the paid machine. */
async function payment(amountSen = 700) {
  const g = await guest(h, false);
  return h.ctx.db
    .insertInto('payments')
    .values({ tenant_id: f.tenantId, shop_id: f.shopId, machine_id: f.paid.id, customer_id: g.customerId, program_id: 'hot', amount_sen: amountSen, provider: 'mock', provider_ref: `mock_${randomUUID().slice(0, 8)}`, status: 'succeeded', idempotency_key: randomUUID() })
    .returning(['id', 'amount_sen'])
    .executeTakeFirstOrThrow();
}

/** A customer money report ("coin jammed", RM 5 claimed) on the washer. */
async function moneyTicket() {
  const g = await guest(h, false);
  const res = await h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category: 'coin_jammed', amountClaimedSen: 500, contactPhone: '012-345 6789' } });
  const body = res.json();
  return (body.ticket?.id ?? body.id) as string;
}

describe('manual refunds (cash / DuitNow) for a problem report', () => {
  it('request → approve → mark paid with a reference, logged on the ticket', async () => {
    const ticketId = await moneyTicket();
    const req = await post('/owner/refunds', { ticketId, amountSen: 500, method: 'duitnow', payoutPhone: '0123456789' });
    expect(req.statusCode).toBe(200);
    const id = req.json().refund.id as string;
    expect(req.json().refund.status).toBe('requested');

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/owner/refunds?status=pending', headers: owner });
    expect(list.json().refunds.map((r: { id: string }) => r.id)).toContain(id);

    expect((await decide(id, { action: 'approve' })).json().refund.status).toBe('approved');
    expect((await decide(id, { action: 'approve' })).statusCode).toBe(409); // already decided
    expect((await decide(id, { action: 'mark_paid' })).statusCode).toBe(400); // needs a reference
    const paid = await decide(id, { action: 'mark_paid', reference: '  DN-778812  ' });
    expect(paid.json().refund).toMatchObject({ status: 'paid', reference: 'DN-778812' });
    expect((await refundRow(id)).paid_at).not.toBeNull();

    const events = await h.ctx.db.selectFrom('ticket_events').select(['kind', 'body']).where('ticket_id', '=', ticketId).where('kind', '=', 'refund').orderBy('created_at').execute();
    expect(events.map((e) => e.body)).toEqual([
      'Refund of RM 5.00 requested (DuitNow transfer)',
      'Refund of RM 5.00 approved',
      'Refund of RM 5.00 marked as paid (ref DN-778812)',
    ]);
  });

  it('a rejected refund can’t be paid; bad requests are refused', async () => {
    const ticketId = await moneyTicket();
    expect((await post('/owner/refunds', { ticketId, amountSen: 500, method: 'duitnow' })).statusCode).toBe(400); // DuitNow needs a phone
    expect((await post('/owner/refunds', { ticketId, amountSen: 500, method: 'original' })).statusCode).toBe(400); // no app payment
    expect((await post('/owner/refunds', { amountSen: 500, method: 'cash' })).statusCode).toBe(400); // nothing to refund against
    expect((await post('/owner/refunds', { ticketId, amountSen: 0, method: 'cash' })).statusCode).toBe(400);

    const id = (await post('/owner/refunds', { ticketId, amountSen: 500, method: 'cash' })).json().refund.id as string;
    expect((await decide(id, { action: 'reject', note: 'Coin box was fine' })).json().refund.status).toBe('rejected');
    expect((await decide(id, { action: 'mark_paid', reference: 'x' })).statusCode).toBe(409);
  });
});

describe('gateway refunds back to the original payment', () => {
  it('approving pays it through the gateway once, and updates the payment', async () => {
    const p = await payment(700);
    const id = (await post('/owner/refunds', { paymentId: p.id, amountSen: 300, method: 'original' })).json().refund.id as string;
    expect((await decide(id, { action: 'mark_paid', reference: 'x' })).statusCode).toBe(400); // gateway refunds are marked paid automatically
    await decide(id, { action: 'approve' });
    await h.tick(1);

    expect(h.gateway.refunds).toEqual([expect.objectContaining({ paymentId: p.id, amountSen: 300, idempotencyKey: `refund:${id}` })]);
    expect(await refundRow(id)).toMatchObject({ status: 'paid' });
    const after = await h.ctx.db.selectFrom('payments').select(['status', 'refunded_sen']).where('id', '=', p.id).executeTakeFirstOrThrow();
    expect(after).toEqual({ status: 'succeeded', refunded_sen: 300 }); // partly refunded

    // Only the remaining RM 4.00 can still be refunded.
    expect((await post('/owner/refunds', { paymentId: p.id, amountSen: 500, method: 'original' })).statusCode).toBe(400);
    const rest = (await post('/owner/refunds', { paymentId: p.id, amountSen: 400, method: 'original' })).json().refund.id as string;
    await decide(rest, { action: 'approve' });
    await h.tick(1);
    expect(await h.ctx.db.selectFrom('payments').select(['status', 'refunded_sen']).where('id', '=', p.id).executeTakeFirstOrThrow()).toEqual({ status: 'refunded', refunded_sen: 700 });
  });

  it('retries a failing gateway, then marks the refund failed and alerts the owner', async () => {
    const p = await payment(700);
    const id = (await post('/owner/refunds', { paymentId: p.id, amountSen: 700, method: 'original' })).json().refund.id as string;
    h.gateway.failRefunds = true;
    await decide(id, { action: 'approve' });
    for (let i = 0; i < 6; i++) await h.tick(3); // backoff: 10 s, 20 s, 40 s, 80 s
    expect((await refundRow(id)).status).toBe('failed');
    const alert = await h.ctx.db.selectFrom('alerts').select(['message', 'severity']).where('tenant_id', '=', f.tenantId).where('dedupe_key', '=', `refund_failed:${id}`).executeTakeFirst();
    expect(alert?.severity).toBe('high');
    expect(alert?.message).toMatch(/refund the customer manually/);
    expect((await h.ctx.db.selectFrom('payments').select('refunded_sen').where('id', '=', p.id).executeTakeFirstOrThrow()).refunded_sen).toBe(0);
  });
});

describe('who may handle refunds', () => {
  it('staff can’t see or decide refunds; another business can’t touch them', async () => {
    const ticketId = await moneyTicket();
    const id = (await post('/owner/refunds', { ticketId, amountSen: 500, method: 'cash' })).json().refund.id as string;

    const staff = await loginAs(h, f.users.staff);
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/owner/refunds', headers: staff })).statusCode).toBe(403);
    expect((await post('/owner/refunds', { ticketId, amountSen: 500, method: 'cash' }, staff)).statusCode).toBe(403);
    expect((await decide(id, { action: 'approve' }, staff)).statusCode).toBe(403);

    const other = await seedFixture(h);
    const rival = await loginAs(h, other.users.owner);
    expect((await decide(id, { action: 'approve' }, rival)).statusCode).toBe(404);
    expect((await post('/owner/refunds', { ticketId, amountSen: 500, method: 'cash' }, rival)).statusCode).toBe(404);
    expect((await refundRow(id)).status).toBe('requested');
  });
});

describe('money safety (review fixes)', () => {
  it('two requests can’t refund the same money twice', async () => {
    const p = await payment(500);
    expect((await post('/owner/refunds', { paymentId: p.id, amountSen: 500, method: 'original' })).statusCode).toBe(200);
    const second = await post('/owner/refunds', { paymentId: p.id, amountSen: 500, method: 'original' });
    expect(second.statusCode).toBe(400);
    expect(second.json().message).toMatch(/exceeds the refundable amount/);
  });

  it('the automatic refund supersedes a pending manual request instead of paying twice', async () => {
    const p = await payment(500);
    const manual = (await post('/owner/refunds', { paymentId: p.id, amountSen: 500, method: 'original' })).json().refund.id as string;
    const { autoRefund } = await import('../src/modules/payments/service.js');
    await autoRefund(h.ctx, p.id, 'start_not_confirmed');
    await h.tick(1);
    expect((await refundRow(manual)).status).toBe('rejected');
    expect((await decide(manual, { action: 'approve' })).statusCode).toBe(409);
    expect(h.gateway.refunds.reduce((s, r) => s + r.amountSen, 0)).toBe(500);
    expect((await h.ctx.db.selectFrom('payments').select(['refunded_sen', 'status']).where('id', '=', p.id).executeTakeFirstOrThrow())).toEqual({ refunded_sen: 500, status: 'refunded' });
    // Nothing left: a second automatic refund is a no-op, not a crash.
    await expect(autoRefund(h.ctx, p.id, 'again')).resolves.toBeUndefined();
  });

  it('a DuitNow refund marked paid counts against the payment', async () => {
    const p = await payment(500);
    const id = (await post('/owner/refunds', { paymentId: p.id, amountSen: 500, method: 'duitnow', payoutPhone: '0123456789' })).json().refund.id as string;
    expect((await decide(id, { action: 'mark_paid', reference: 'DN-1' })).statusCode).toBe(200);
    expect(await h.ctx.db.selectFrom('payments').select(['refunded_sen', 'status']).where('id', '=', p.id).executeTakeFirstOrThrow()).toEqual({ refunded_sen: 500, status: 'refunded' });
    expect((await post('/owner/refunds', { paymentId: p.id, amountSen: 100, method: 'cash' })).statusCode).toBe(400);
  });

  it('a failed gateway refund can be retried, or marked paid by hand', async () => {
    const p = await payment(700);
    const id = (await post('/owner/refunds', { paymentId: p.id, amountSen: 700, method: 'original' })).json().refund.id as string;
    h.gateway.failRefunds = true;
    await decide(id, { action: 'approve' });
    for (let i = 0; i < 6; i++) await h.tick(3);
    expect((await refundRow(id)).status).toBe('failed');

    h.gateway.failRefunds = false;
    expect((await decide(id, { action: 'retry' })).statusCode).toBe(200);
    await h.tick(1);
    expect((await refundRow(id)).status).toBe('paid');
    expect((await h.ctx.db.selectFrom('payments').select('refunded_sen').where('id', '=', p.id).executeTakeFirstOrThrow()).refunded_sen).toBe(700);

    const p2 = await payment(300);
    const id2 = (await post('/owner/refunds', { paymentId: p2.id, amountSen: 300, method: 'original' })).json().refund.id as string;
    h.gateway.failRefunds = true;
    await decide(id2, { action: 'approve' });
    for (let i = 0; i < 6; i++) await h.tick(3);
    expect((await decide(id2, { action: 'mark_paid', reference: 'Paid by DuitNow DN-9' })).json().refund.status).toBe('paid');
    expect((await h.ctx.db.selectFrom('payments').select('refunded_sen').where('id', '=', p2.id).executeTakeFirstOrThrow()).refunded_sen).toBe(300);
  });

  it('a refund the gateway reports as pending is not shown as paid until it settles', async () => {
    const p = await payment(500);
    const id = (await post('/owner/refunds', { paymentId: p.id, amountSen: 500, method: 'original' })).json().refund.id as string;
    h.gateway.pendingRefunds = true;
    await decide(id, { action: 'approve' });
    await h.tick(1);
    expect(await refundRow(id)).toMatchObject({ status: 'approved' });
    expect((await h.ctx.db.selectFrom('payments').select('refunded_sen').where('id', '=', p.id).executeTakeFirstOrThrow()).refunded_sen).toBe(0);
    h.gateway.pendingRefunds = false;
    await h.tick(16);
    expect((await refundRow(id)).status).toBe('paid');
    expect((await h.ctx.db.selectFrom('payments').select('refunded_sen').where('id', '=', p.id).executeTakeFirstOrThrow()).refunded_sen).toBe(500);
  });

  it('a ticket from one shop can’t carry a payment from another shop', async () => {
    const ticketId = await moneyTicket();
    const g = await guest(h, false);
    const other = await h.ctx.db
      .insertInto('machines')
      .values({ tenant_id: f.tenantId, shop_id: f.otherShopId, code: 'X1', qr_token: `x-${randomUUID().slice(0, 6)}`, type: 'washer', capacity_kg: 10, programs: '[]' as never })
      .returning('id')
      .executeTakeFirstOrThrow();
    const foreign = await h.ctx.db
      .insertInto('payments')
      .values({ tenant_id: f.tenantId, shop_id: f.otherShopId, machine_id: other.id, customer_id: g.customerId, program_id: 'x', amount_sen: 500, provider: 'mock', status: 'succeeded', idempotency_key: randomUUID() })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect((await post('/owner/refunds', { ticketId, paymentId: foreign.id, amountSen: 500, method: 'cash' })).statusCode).toBe(400);
  });
});

describe('paid starts (review fixes)', () => {
  const pay = (g: { auth: Record<string, string> }) =>
    h.app.inject({ method: 'POST', url: '/api/v1/public/payments', headers: { ...g.auth, 'idempotency-key': randomUUID() }, payload: { qrToken: f.paid.qr, programId: 'cold' } });

  it('a webhook arriving while the expiry job checks the gateway doesn’t get the started wash refunded', async () => {
    const g = await guest(h);
    const paymentId = (await pay(g)).json().payment.id as string;
    const { handleGatewayWebhook } = await import('../src/modules/payments/service.js');
    const original = h.gateway.getStatus.bind(h.gateway);
    h.gateway.getStatus = async (ref: string) => {
      // The real webhook lands right now, while the expiry job is waiting for the gateway.
      const hook = h.gateway.buildWebhook(paymentId, ref, 'succeeded');
      await handleGatewayWebhook(h.ctx, { 'x-mock-signature': hook.signature }, hook.body);
      return 'succeeded';
    };
    try {
      await h.tick(16);
    } finally {
      h.gateway.getStatus = original;
    }
    const p = await h.ctx.db.selectFrom('payments').select(['status', 'cycle_id', 'refunded_sen']).where('id', '=', paymentId).executeTakeFirstOrThrow();
    expect(p.cycle_id).not.toBeNull();
    expect(p.refunded_sen).toBe(0);
    expect(await h.ctx.db.selectFrom('refunds').select('id').where('payment_id', '=', paymentId).execute()).toHaveLength(0);
  });

  it('a webhook that fails halfway is processed on the gateway’s retry, not ignored as a duplicate', async () => {
    const g = await guest(h);
    const paymentId = (await pay(g)).json().payment.id as string;
    const p = await h.ctx.db.selectFrom('payments').select('provider_ref').where('id', '=', paymentId).executeTakeFirstOrThrow();
    const hook = h.gateway.buildWebhook(paymentId, p.provider_ref!, 'succeeded');
    const deliver = () => h.app.inject({ method: 'POST', url: '/api/v1/webhooks/payments/mock', headers: { 'content-type': 'application/json', 'x-mock-signature': hook.signature }, payload: hook.body });
    const get = h.ctx.controllers.get.bind(h.ctx.controllers);
    let broken = true;
    (h.ctx.controllers as any).get = (kind: string) => {
      if (broken) {
        broken = false;
        throw new Error('transient failure');
      }
      return get(kind as never);
    };
    try {
      expect((await deliver()).statusCode).toBe(500);
      const retry = await deliver();
      expect(retry.statusCode).toBe(200);
      expect(retry.json().duplicate).not.toBe(true);
    } finally {
      (h.ctx.controllers as any).get = get;
    }
  });

  it('the reconcile sweep refunds a paid order whose start was never sent', async () => {
    const { reconcilePayments } = await import('../src/modules/payments/service.js');
    const p = await payment(500);
    await h.ctx.db.updateTable('payments').set({ succeeded_at: new Date(h.clock.now.getTime() - 20 * 60_000) }).where('id', '=', p.id).execute();
    expect(await reconcilePayments(h.ctx)).toBe(1);
    await h.tick(1);
    expect(await h.ctx.db.selectFrom('payments').select(['status', 'refunded_sen']).where('id', '=', p.id).executeTakeFirstOrThrow()).toEqual({ status: 'refunded', refunded_sen: 500 });
    expect(await reconcilePayments(h.ctx)).toBe(0);
  });
});
