import { randomUUID } from 'node:crypto';
import { formatRM, pickText } from '@dobi/shared';
import { sql } from 'kysely';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { Payment } from '../../db/types.js';
import { channels } from '../../events/bus.js';
import { AppError, notFound } from '../../lib/errors.js';
import { isOpenAt, addMinutes } from '../../lib/time.js';
import { raiseAlert } from '../alerts/service.js';
import { pickProgram } from '../cycles/service.js';
import { recomputeMachineState } from '../machines/state.js';
import { processGatewayRefund } from '../refunds/service.js';
import { createSystemTicket } from '../tickets/service.js';
import { config } from '../../config.js';

const PAYMENT_EXPIRY_MIN = 15;

export function serializePayment(p: Payment) {
  return {
    id: p.id,
    machineId: p.machine_id,
    shopId: p.shop_id,
    cycleId: p.cycle_id,
    programId: p.program_id,
    amountSen: p.amount_sen,
    refundedSen: p.refunded_sen,
    currency: p.currency,
    provider: p.provider,
    status: p.status,
    failureReason: p.failure_reason,
    createdAt: p.created_at.toISOString(),
    succeededAt: p.succeeded_at?.toISOString() ?? null,
  };
}

/** Why a machine can't be paid for in the app right now (null = it can). */
export async function payBlocker(ctx: Ctx, machineId: string): Promise<string | null> {
  const m = await ctx.db.selectFrom('machines').selectAll().where('id', '=', machineId).executeTakeFirst();
  if (!m) return 'not_found';
  if (m.control === 'none' || !ctx.controllers.get(m.control)) return 'not_controllable';
  if (m.observation === 'none') return 'not_observable'; // we must be able to confirm the start
  if (m.state !== 'available') return `machine_${m.state}`;
  const shop = await ctx.db.selectFrom('shops').select(['opening_hours', 'timezone']).where('id', '=', m.shop_id).executeTakeFirstOrThrow();
  if (!isOpenAt(shop.opening_hours, ctx.now(), shop.timezone)) return 'shop_closed';
  return null;
}

/**
 * Create a payment for a controllable machine. Idempotent per (customer, idempotencyKey):
 * a retried request returns the same payment and never charges twice.
 */
export async function createPayment(ctx: Ctx, input: { customerId: string; qrToken: string; programId?: string; idempotencyKey: string }) {
  const existing = await ctx.db
    .selectFrom('payments')
    .selectAll()
    .where('customer_id', '=', input.customerId)
    .where('idempotency_key', '=', input.idempotencyKey)
    .executeTakeFirst();
  if (existing) return { payment: existing, redirectUrl: `${config.publicUrl}/pay/${existing.id}`, reused: true };

  const machine = await ctx.db.selectFrom('machines').selectAll().where('qr_token', '=', input.qrToken).where('deleted_at', 'is', null).executeTakeFirst();
  if (!machine) throw notFound('Machine');
  const blocker = await payBlocker(ctx, machine.id);
  if (blocker) throw new AppError(409, blocker, 'This machine cannot be paid for in the app right now');
  const program = pickProgram(machine, input.programId);

  const inserted = await ctx.db
    .insertInto('payments')
    .values({
      tenant_id: machine.tenant_id,
      shop_id: machine.shop_id,
      machine_id: machine.id,
      customer_id: input.customerId,
      program_id: program.id,
      amount_sen: program.priceSen,
      provider: ctx.gateway.name,
      idempotency_key: input.idempotencyKey,
      created_at: ctx.now(),
      updated_at: ctx.now(),
    })
    .onConflict((oc) => oc.columns(['customer_id', 'idempotency_key']).doNothing())
    .returningAll()
    .executeTakeFirst();
  if (!inserted) return createPayment(ctx, input); // concurrent duplicate: return the winner

  const charge = await ctx.gateway.createCharge({
    paymentId: inserted.id,
    amountSen: inserted.amount_sen,
    description: `${machine.code} ${pickText(program.name, 'en')}`,
    returnUrl: `${config.publicUrl}/pay/${inserted.id}`,
  });
  const payment = await ctx.db
    .updateTable('payments')
    .set({ provider_ref: charge.providerRef, status: 'pending', updated_at: ctx.now() })
    .where('id', '=', inserted.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.jobs.schedule('payment.expire', addMinutes(ctx.now(), PAYMENT_EXPIRY_MIN), { paymentId: payment.id }, `payment.expire:${payment.id}`);
  return { payment, redirectUrl: charge.redirectUrl, reused: false };
}

/** Gateway callback. Verified, deduplicated, and every transition is a guarded single UPDATE. */
export async function handleGatewayWebhook(ctx: Ctx, headers: Record<string, string | string[] | undefined>, rawBody: string) {
  const evt = ctx.gateway.parseWebhook(headers, rawBody);
  const payment = await ctx.db.selectFrom('payments').selectAll().where('id', '=', evt.paymentId).executeTakeFirst();
  const logged = await ctx.db
    .insertInto('payment_events')
    .values({ provider: ctx.gateway.name, provider_event_id: evt.eventId, payment_id: payment?.id ?? null, type: evt.type, payload: json(evt.raw) })
    .onConflict((oc) => oc.columns(['provider', 'provider_event_id']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!logged) return { duplicate: true };
  if (!payment) {
    ctx.log.warn({ evt }, 'webhook for unknown payment');
    return { duplicate: false };
  }
  if (evt.type === 'payment.succeeded') await markSucceeded(ctx, payment.id);
  if (evt.type === 'payment.failed') {
    const r = await ctx.db
      .updateTable('payments')
      .set({ status: 'failed', failure_reason: 'declined', updated_at: ctx.now() })
      .where('id', '=', payment.id)
      .where('status', 'in', ['created', 'pending'])
      .returning('id')
      .executeTakeFirst();
    if (r) await publishPayment(ctx, payment.id);
  }
  return { duplicate: false };
}

async function publishPayment(ctx: Ctx, paymentId: string) {
  const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirstOrThrow();
  await ctx.bus.publish([channels.customer(p.customer_id), channels.tenant(p.tenant_id)], 'payment.updated', serializePayment(p));
}

async function markSucceeded(ctx: Ctx, paymentId: string) {
  const now = ctx.now();
  const res = await sql<{ id: string; prev: string }>`
    UPDATE payments p SET status = 'succeeded', succeeded_at = ${now}, updated_at = ${now}
    FROM (SELECT id, status AS prev FROM payments WHERE id = ${paymentId} FOR UPDATE) old
    WHERE p.id = old.id AND p.status IN ('created','pending','expired','failed')
    RETURNING p.id, old.prev
  `.execute(ctx.db);
  const row = res.rows[0];
  if (!row) return; // already processed
  await ctx.jobs.cancel(`payment.expire:${paymentId}`);
  if (row.prev === 'expired' || row.prev === 'failed') {
    // Money arrived after we gave up on it — never start a machine for a customer who has left.
    await autoRefund(ctx, paymentId, 'late_payment');
    return;
  }
  await startPaidCycle(ctx, paymentId);
}

/** Create the cycle + start command, then ask the controller to start the machine. */
async function startPaidCycle(ctx: Ctx, paymentId: string) {
  const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirstOrThrow();
  const machine = await ctx.db.selectFrom('machines').selectAll().where('id', '=', p.machine_id).executeTakeFirstOrThrow();
  const program = pickProgram(machine, p.program_id);
  const controller = ctx.controllers.get(machine.control);
  const blocker = await payBlocker(ctx, machine.id);
  if (!controller || blocker) {
    await autoRefund(ctx, paymentId, blocker ?? 'not_controllable');
    return;
  }
  const now = ctx.now();
  const cycleId = randomUUID();
  let commandId: string;
  try {
    commandId = await ctx.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('cycles')
        .values({
          id: cycleId,
          tenant_id: p.tenant_id,
          shop_id: p.shop_id,
          machine_id: p.machine_id,
          source: 'payment',
          status: 'running',
          program_id: program.id,
          program_name: pickText(program.name, 'en'),
          duration_min: program.durationMin,
          price_sen: p.amount_sen,
          started_at: now,
          expected_end_at: addMinutes(now, program.durationMin),
          customer_id: p.customer_id,
          payment_id: p.id,
        })
        .execute();
      await trx.updateTable('payments').set({ cycle_id: cycleId }).where('id', '=', p.id).execute();
      const cmd = await trx
        .insertInto('machine_commands')
        .values({ machine_id: p.machine_id, payment_id: p.id, payload: json({ programId: program.id }) })
        .returning('id')
        .executeTakeFirstOrThrow();
      return cmd.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      // Someone started the machine with coins meanwhile (one running cycle per machine).
      await autoRefund(ctx, paymentId, 'machine_busy');
      return;
    }
    throw err;
  }
  await recomputeMachineState(ctx, machine.id, 'paid start requested');
  await sendStart(ctx, commandId, 1);
  await publishPayment(ctx, paymentId);
}

async function sendStart(ctx: Ctx, commandId: string, attempt: number) {
  const cmd = await ctx.db.selectFrom('machine_commands').selectAll().where('id', '=', commandId).executeTakeFirstOrThrow();
  const machine = await ctx.db.selectFrom('machines').selectAll().where('id', '=', cmd.machine_id).executeTakeFirstOrThrow();
  const program = pickProgram(machine, (cmd.payload as { programId?: string }).programId);
  await ctx.db.updateTable('machine_commands').set({ status: 'sent', attempts: attempt, updated_at: ctx.now() }).where('id', '=', commandId).execute();
  try {
    await ctx.controllers.get(machine.control)?.start(ctx, { commandId, machine, program });
  } catch (err) {
    ctx.log.warn({ err, commandId }, 'controller start failed');
  }
  await ctx.jobs.schedule(
    'payment.start_timeout',
    new Date(ctx.now().getTime() + config.startConfirmSec * 1000),
    { paymentId: cmd.payment_id, commandId, attempt },
    `payment.start_timeout:${commandId}:${attempt}`,
  );
}

/** No sensor confirmation in time: retry once (same command id), then refund automatically. */
async function onStartTimeout(ctx: Ctx, payload: { paymentId: string; commandId: string; attempt: number }) {
  const cmd = await ctx.db.selectFrom('machine_commands').selectAll().where('id', '=', payload.commandId).executeTakeFirst();
  if (!cmd || cmd.status === 'confirmed' || cmd.status === 'failed') return;
  if (payload.attempt < 2) {
    await sendStart(ctx, payload.commandId, payload.attempt + 1);
    return;
  }
  const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', payload.paymentId).executeTakeFirstOrThrow();
  const machine = await ctx.db.selectFrom('machines').selectAll().where('id', '=', p.machine_id).executeTakeFirstOrThrow();
  await ctx.db.updateTable('machine_commands').set({ status: 'failed', updated_at: ctx.now() }).where('id', '=', cmd.id).execute();
  if (p.cycle_id) {
    await ctx.db.updateTable('cycles').set({ status: 'aborted', ended_at: ctx.now() }).where('id', '=', p.cycle_id).where('status', '=', 'running').execute();
    await ctx.jobs.cancel(`cycle.remind:${p.cycle_id}`);
    await ctx.jobs.cancel(`cycle.finish:${p.cycle_id}`);
  }
  // Protect the next customer: mark the machine faulty until staff check it.
  await ctx.db
    .updateTable('machines')
    .set({ staff_fault: true, admin_reason: 'Auto: did not start after an app payment' })
    .where('id', '=', machine.id)
    .execute();
  await autoRefund(ctx, p.id, 'start_not_confirmed');
  await createSystemTicket(ctx, {
    id: randomUUID(),
    tenantId: p.tenant_id,
    shopId: p.shop_id,
    machineId: machine.id,
    category: 'payment_no_start',
    title: `${machine.code} · Did not start after app payment (auto-refunded)`,
    details: `Payment ${formatRM(p.amount_sen)} succeeded but the sensor did not confirm a start after ${payload.attempt} attempts. The customer was refunded automatically and the machine was marked faulty.`,
    paymentId: p.id,
    customerId: p.customer_id,
  });
  await raiseAlert(ctx, {
    tenantId: p.tenant_id,
    shopId: p.shop_id,
    machineId: machine.id,
    kind: 'start_failed',
    severity: 'high',
    message: `${machine.code} did not start after a paid start — customer auto-refunded, machine marked faulty`,
    dedupeKey: `start_failed:${machine.id}`,
  });
  await recomputeMachineState(ctx, machine.id, 'paid start not confirmed');
}

/** Refund the full amount through the gateway. Idempotent: at most one automatic refund per payment. */
export async function autoRefund(ctx: Ctx, paymentId: string, reason: string) {
  const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirstOrThrow();
  const refund = await ctx.db
    .insertInto('refunds')
    .values({
      tenant_id: p.tenant_id,
      shop_id: p.shop_id,
      payment_id: p.id,
      amount_sen: p.amount_sen - p.refunded_sen,
      method: 'original',
      status: 'approved',
      automatic: true,
      note: `Automatic: ${reason}`,
      decided_at: ctx.now(),
      created_at: ctx.now(),
    })
    .onConflict((oc) => oc.column('payment_id').where('automatic', '=', true).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!refund) return;
  await ctx.db
    .updateTable('payments')
    .set({ status: 'refund_pending', failure_reason: reason, updated_at: ctx.now() })
    .where('id', '=', p.id)
    .execute();
  if (p.customer_id) {
    const machine = await ctx.db.selectFrom('machines').select('code').where('id', '=', p.machine_id).executeTakeFirstOrThrow();
    await ctx.notify.toCustomer(p.customer_id, 'payment_start_failed', { machine: machine.code, amount: formatRM(p.amount_sen) }, { url: `/pay/${p.id}` });
  }
  await ctx.jobs.schedule('refund.process', ctx.now(), { refundId: refund.id }, `refund.process:${refund.id}`);
  await publishPayment(ctx, p.id);
}

export function registerPaymentJobs(ctx: Ctx) {
  ctx.jobs.register('payment.start_timeout', (payload) => onStartTimeout(ctx, payload as { paymentId: string; commandId: string; attempt: number }));
  ctx.jobs.register('refund.process', ({ refundId }, job) => processGatewayRefund(ctx, refundId, job.attempts));
  ctx.jobs.register('payment.expire', async ({ paymentId }) => {
    const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirst();
    if (!p || (p.status !== 'pending' && p.status !== 'created')) return;
    // Reconcile with the gateway before giving up — the webhook may have been lost.
    const status = p.provider_ref ? await ctx.gateway.getStatus(p.provider_ref) : 'pending';
    if (status === 'succeeded') {
      await ctx.db.updateTable('payments').set({ status: 'expired', updated_at: ctx.now() }).where('id', '=', p.id).execute();
      await markSucceeded(ctx, p.id); // late → auto refund
      return;
    }
    await ctx.db
      .updateTable('payments')
      .set({ status: status === 'failed' ? 'failed' : 'expired', updated_at: ctx.now() })
      .where('id', '=', p.id)
      .where('status', 'in', ['created', 'pending'])
      .execute();
    await publishPayment(ctx, p.id);
  });
}
