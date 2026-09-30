import type { RefundMethod } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { channels } from '../../events/bus.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { raiseAlert } from '../alerts/service.js';

export async function requestRefund(
  ctx: Ctx,
  input: { tenantId: string; ticketId?: string | null; paymentId?: string | null; amountSen: number; method: RefundMethod; payoutPhone?: string | null; note?: string | null },
) {
  let shopId: string | null = null;
  if (input.ticketId) {
    const t = await ctx.db.selectFrom('tickets').select(['shop_id', 'payment_id']).where('id', '=', input.ticketId).where('tenant_id', '=', input.tenantId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    shopId = t.shop_id;
    input.paymentId ??= t.payment_id;
  }
  if (input.paymentId) {
    const p = await ctx.db.selectFrom('payments').select(['shop_id', 'amount_sen', 'refunded_sen']).where('id', '=', input.paymentId).where('tenant_id', '=', input.tenantId).executeTakeFirst();
    if (!p) throw notFound('Payment');
    if (input.amountSen > p.amount_sen - p.refunded_sen) throw badRequest('Refund exceeds the refundable amount');
    shopId = p.shop_id;
  }
  if (!shopId) throw badRequest('A refund must reference a ticket or a payment');
  if (input.method === 'original' && !input.paymentId) throw badRequest('"original" refunds need an app payment');
  if (input.method === 'duitnow' && !input.payoutPhone) throw badRequest('DuitNow refunds need a phone number');

  const r = await ctx.db
    .insertInto('refunds')
    .values({
      tenant_id: input.tenantId,
      shop_id: shopId,
      ticket_id: input.ticketId ?? null,
      payment_id: input.paymentId ?? null,
      amount_sen: input.amountSen,
      method: input.method,
      payout_phone: input.payoutPhone ?? null,
      note: input.note ?? null,
      created_at: ctx.now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.bus.publish(channels.tenant(input.tenantId), 'refund.updated', { id: r.id, status: r.status });
  return r;
}

/**
 * Owner decision. Approving an "original"-method refund pays it through the gateway (durable job);
 * DuitNow/cash refunds are paid by the owner outside the system and then marked paid with a reference.
 */
export async function decideRefund(
  ctx: Ctx,
  tenantId: string,
  refundId: string,
  userId: string,
  decision: { action: 'approve' | 'reject' | 'mark_paid'; reference?: string | null; note?: string | null },
) {
  const r = await ctx.db.selectFrom('refunds').selectAll().where('id', '=', refundId).where('tenant_id', '=', tenantId).executeTakeFirst();
  if (!r) throw notFound('Refund');
  const now = ctx.now();
  if (decision.action === 'approve' || decision.action === 'reject') {
    if (r.status !== 'requested') throw conflict('invalid_state', `Refund is already ${r.status}`);
    await ctx.db
      .updateTable('refunds')
      .set({ status: decision.action === 'approve' ? 'approved' : 'rejected', decided_by: userId, decided_at: now, note: decision.note ?? r.note })
      .where('id', '=', refundId)
      .execute();
    if (decision.action === 'approve' && r.method === 'original') {
      await ctx.jobs.schedule('refund.process', now, { refundId }, `refund.process:${refundId}`);
    }
  } else {
    if (r.method === 'original') throw badRequest('Gateway refunds are marked paid automatically');
    if (r.status !== 'approved' && r.status !== 'requested') throw conflict('invalid_state', `Refund is ${r.status}`);
    if (!decision.reference?.trim()) throw badRequest('Enter the transfer reference or a note on how it was paid');
    await ctx.db
      .updateTable('refunds')
      .set({ status: 'paid', paid_at: now, reference: decision.reference.trim(), decided_by: r.decided_by ?? userId, decided_at: r.decided_at ?? now })
      .where('id', '=', refundId)
      .execute();
  }
  if (r.ticket_id) {
    await ctx.db
      .insertInto('ticket_events')
      .values({ ticket_id: r.ticket_id, actor_id: userId, kind: 'refund', body: `Refund ${decision.action.replace('_', ' ')}`, created_at: now })
      .execute();
  }
  const updated = await ctx.db.selectFrom('refunds').selectAll().where('id', '=', refundId).executeTakeFirstOrThrow();
  await ctx.bus.publish(channels.tenant(tenantId), 'refund.updated', { id: refundId, status: updated.status });
  return updated;
}

/** Pays an approved gateway refund. Runs as a job so failures retry with backoff. */
export async function processGatewayRefund(ctx: Ctx, refundId: string, attempt: number) {
  const r = await ctx.db.selectFrom('refunds').selectAll().where('id', '=', refundId).executeTakeFirst();
  if (!r || r.status !== 'approved' || !r.payment_id) return;
  const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', r.payment_id).executeTakeFirstOrThrow();
  try {
    const res = await ctx.gateway.refund({ paymentId: p.id, providerRef: p.provider_ref ?? '', amountSen: r.amount_sen, idempotencyKey: `refund:${r.id}` });
    const now = ctx.now();
    await ctx.db.transaction().execute(async (trx) => {
      await trx.updateTable('refunds').set({ status: 'paid', paid_at: now, reference: res.refundRef }).where('id', '=', r.id).execute();
      const refunded = p.refunded_sen + r.amount_sen;
      await trx
        .updateTable('payments')
        .set({ refunded_sen: refunded, status: refunded >= p.amount_sen ? 'refunded' : p.status === 'refund_pending' ? 'succeeded' : p.status, updated_at: now })
        .where('id', '=', p.id)
        .execute();
    });
    await ctx.bus.publish([channels.tenant(r.tenant_id), channels.customer(p.customer_id)], 'payment.updated', { id: p.id });
  } catch (err) {
    if (attempt >= 5) {
      await ctx.db.updateTable('refunds').set({ status: 'failed' }).where('id', '=', r.id).execute();
      await raiseAlert(ctx, {
        tenantId: r.tenant_id,
        shopId: r.shop_id,
        kind: 'start_failed',
        severity: 'high',
        message: `Automatic refund of RM ${(r.amount_sen / 100).toFixed(2)} failed — refund the customer manually`,
        dedupeKey: `refund_failed:${r.id}`,
      });
      return;
    }
    throw err; // job queue retries with backoff
  }
}
