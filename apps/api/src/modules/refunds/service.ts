import type { RefundMethod } from '@dobi/shared';
import { sql } from 'kysely';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import { channels } from '../../events/bus.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { raiseAlert } from '../alerts/service.js';

/**
 * What can still be refunded on a payment: paid amount − already refunded − refunds requested or approved
 * but not paid yet (those are reserved). Prevents two requests from refunding the same money twice.
 */
export async function refundableSen(ctx: Ctx, paymentId: string, excludeRefundId?: string) {
  const p = await ctx.db.selectFrom('payments').select(['amount_sen', 'refunded_sen']).where('id', '=', paymentId).executeTakeFirstOrThrow();
  let q = ctx.db
    .selectFrom('refunds')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('amount_sen'), eb.lit(0)).as('n'))
    .where('payment_id', '=', paymentId)
    .where('status', 'in', ['requested', 'approved']);
  if (excludeRefundId) q = q.where('id', '<>', excludeRefundId);
  const open = Number((await q.executeTakeFirst())?.n ?? 0);
  return p.amount_sen - p.refunded_sen - open;
}

/** Count a paid refund against its payment, atomically and never beyond the paid amount. */
async function applyToPayment(db: Ctx['db'], paymentId: string, amountSen: number, now: Date) {
  const r = await sql<{ id: string }>`
    UPDATE payments SET
      refunded_sen = refunded_sen + ${amountSen},
      status = CASE WHEN refunded_sen + ${amountSen} >= amount_sen THEN 'refunded'
                    WHEN status = 'refund_pending' THEN 'succeeded' ELSE status END,
      updated_at = ${now}
    WHERE id = ${paymentId} AND refunded_sen + ${amountSen} <= amount_sen
    RETURNING id
  `.execute(db);
  return r.rows.length > 0;
}

export async function requestRefund(
  ctx: Ctx,
  input: { tenantId: string; ticketId?: string | null; paymentId?: string | null; amountSen: number; method: RefundMethod; payoutPhone?: string | null; note?: string | null; actorId?: string },
) {
  let shopId: string | null = null;
  if (input.ticketId) {
    const t = await ctx.db.selectFrom('tickets').select(['shop_id', 'payment_id']).where('id', '=', input.ticketId).where('tenant_id', '=', input.tenantId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    if (input.paymentId && t.payment_id && input.paymentId !== t.payment_id) throw badRequest('That payment does not belong to this ticket');
    shopId = t.shop_id;
    input.paymentId ??= t.payment_id;
  }
  if (input.paymentId) {
    const p = await ctx.db.selectFrom('payments').select(['shop_id']).where('id', '=', input.paymentId).where('tenant_id', '=', input.tenantId).executeTakeFirst();
    if (!p) throw notFound('Payment');
    if (shopId && p.shop_id !== shopId) throw badRequest('That payment is from another shop');
    if (input.amountSen > (await refundableSen(ctx, input.paymentId))) throw badRequest('Refund exceeds the refundable amount');
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
  if (r.ticket_id) {
    await ctx.db
      .insertInto('ticket_events')
      .values({ ticket_id: r.ticket_id, actor_id: input.actorId ?? null, kind: 'refund', body: `Refund of ${sen(r.amount_sen)} requested (${METHOD_LABEL[r.method]})`, data: json({ refundId: r.id, action: 'requested' }), created_at: ctx.now() })
      .execute();
  }
  await ctx.bus.publish(channels.tenant(input.tenantId), 'refund.updated', { id: r.id, status: r.status });
  return r;
}

const METHOD_LABEL: Record<RefundMethod, string> = { original: 'back to original payment', duitnow: 'DuitNow transfer', cash: 'cash', other: 'other' };
const ACTION_TEXT = { approve: 'approved', reject: 'rejected', mark_paid: 'marked as paid', retry: 'retried through the gateway' } as const;
const sen = (v: number) => `RM ${(v / 100).toFixed(2)}`;

/**
 * Owner decision. Approving an "original"-method refund pays it through the gateway (durable job);
 * DuitNow/cash refunds are paid by the owner outside the system and then marked paid with a reference.
 */
export async function decideRefund(
  ctx: Ctx,
  tenantId: string,
  refundId: string,
  userId: string,
  decision: { action: 'approve' | 'reject' | 'mark_paid' | 'retry'; reference?: string | null; note?: string | null },
) {
  const r = await ctx.db.selectFrom('refunds').selectAll().where('id', '=', refundId).where('tenant_id', '=', tenantId).executeTakeFirst();
  if (!r) throw notFound('Refund');
  const now = ctx.now();
  if (decision.action === 'retry') {
    // A gateway refund that failed after its retries: try the gateway again.
    if (r.status !== 'failed' || r.method !== 'original') throw conflict('invalid_state', 'Only a failed gateway refund can be retried');
    await ctx.db.updateTable('refunds').set({ status: 'approved' }).where('id', '=', refundId).where('status', '=', 'failed').execute();
    await ctx.jobs.schedule('refund.process', now, { refundId }, `refund.process:${refundId}:${now.getTime()}`);
  } else if (decision.action === 'approve' || decision.action === 'reject') {
    if (r.status !== 'requested') throw conflict('invalid_state', `Refund is already ${r.status}`);
    if (decision.action === 'approve' && r.payment_id && r.amount_sen > (await refundableSen(ctx, r.payment_id, r.id))) {
      throw badRequest('Refund exceeds the refundable amount (it may already have been refunded)');
    }
    await ctx.db
      .updateTable('refunds')
      .set({ status: decision.action === 'approve' ? 'approved' : 'rejected', decided_by: userId, decided_at: now, note: decision.note ?? r.note })
      .where('id', '=', refundId)
      .execute();
    if (decision.action === 'approve' && r.method === 'original') {
      await ctx.jobs.schedule('refund.process', now, { refundId }, `refund.process:${refundId}`);
    }
  } else {
    // Paid outside the system (cash, DuitNow), or a failed gateway refund the owner paid by hand.
    if (r.method === 'original' && r.status !== 'failed') throw badRequest('Gateway refunds are marked paid automatically');
    if (!['approved', 'requested', 'failed'].includes(r.status)) throw conflict('invalid_state', `Refund is ${r.status}`);
    if (!decision.reference?.trim()) throw badRequest('Enter the transfer reference or a note on how it was paid');
    await ctx.db.transaction().execute(async (trx) => {
      const done = await trx
        .updateTable('refunds')
        .set({ status: 'paid', paid_at: now, reference: decision.reference!.trim(), decided_by: r.decided_by ?? userId, decided_at: r.decided_at ?? now })
        .where('id', '=', refundId)
        .where('status', 'in', ['approved', 'requested', 'failed'])
        .returning('id')
        .executeTakeFirst();
      if (!done) throw conflict('invalid_state', 'Refund was changed meanwhile');
      // Money back on an app payment reduces what can still be refunded (and the revenue figures).
      if (r.payment_id && !(await applyToPayment(trx, r.payment_id, r.amount_sen, now))) throw badRequest('Refund exceeds the refundable amount');
    });
  }
  if (r.ticket_id) {
    await ctx.db
      .insertInto('ticket_events')
      .values({
        ticket_id: r.ticket_id,
        actor_id: userId,
        kind: 'refund',
        body: `Refund of ${sen(r.amount_sen)} ${ACTION_TEXT[decision.action]}${decision.action === 'mark_paid' && decision.reference ? ` (ref ${decision.reference.trim()})` : ''}`,
        data: json({ refundId: r.id, action: decision.action }),
        created_at: now,
      })
      .execute();
  }
  const updated = await ctx.db.selectFrom('refunds').selectAll().where('id', '=', refundId).executeTakeFirstOrThrow();
  await ctx.bus.publish(channels.tenant(tenantId), 'refund.updated', { id: refundId, status: updated.status });
  return updated;
}

export const REFUND_SETTLE_DAYS = 3;

/** Pays an approved gateway refund. Runs as a job so failures retry with backoff. */
export async function processGatewayRefund(ctx: Ctx, refundId: string, attempt: number) {
  const r = await ctx.db.selectFrom('refunds').selectAll().where('id', '=', refundId).executeTakeFirst();
  if (!r || r.status !== 'approved' || !r.payment_id) return;
  const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', r.payment_id).executeTakeFirstOrThrow();
  if (p.refunded_sen + r.amount_sen > p.amount_sen) {
    // Never send the gateway more than is left (e.g. refunded by hand meanwhile).
    await ctx.db.updateTable('refunds').set({ status: 'rejected', note: 'Not sent: the payment was already refunded' }).where('id', '=', r.id).execute();
    return;
  }
  try {
    const res = await ctx.gateway.refund({ paymentId: p.id, providerRef: p.provider_ref ?? '', amountSen: r.amount_sen, idempotencyKey: `refund:${r.id}` });
    const now = ctx.now();
    if (res.status === 'pending') {
      // Accepted but not settled yet: ask again later (same idempotency key), up to REFUND_SETTLE_DAYS.
      await ctx.db.updateTable('refunds').set({ reference: res.refundRef }).where('id', '=', r.id).execute();
      if (now.getTime() - r.created_at.getTime() > REFUND_SETTLE_DAYS * 86_400_000) throw new Error('refund still pending at the gateway');
      await ctx.jobs.schedule('refund.process', new Date(now.getTime() + 15 * 60_000), { refundId: r.id }, `refund.process:${r.id}:${now.getTime()}`);
      return;
    }
    await ctx.db.transaction().execute(async (trx) => {
      await trx.updateTable('refunds').set({ status: 'paid', paid_at: now, reference: res.refundRef }).where('id', '=', r.id).where('status', '=', 'approved').execute();
      if (!(await applyToPayment(trx, p.id, r.amount_sen, now))) ctx.log.error({ refundId: r.id }, 'gateway refund exceeded the paid amount');
    });
    await ctx.bus.publish([channels.tenant(r.tenant_id), ...(p.customer_id ? [channels.customer(p.customer_id)] : [])], 'payment.updated', { id: p.id });
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
