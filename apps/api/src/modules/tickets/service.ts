import { FAULT_CATEGORIES, MONEY_CATEGORIES, type TicketCategory, type TicketSeverity, type TicketStatus } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { Ticket } from '../../db/types.js';
import { channels } from '../../events/bus.js';
import { conflict, notFound } from '../../lib/errors.js';
import { raiseAlert } from '../alerts/service.js';
import { recomputeMachineState } from '../machines/state.js';
import { machineEvidence } from '../telemetry/service.js';
import { linkToTicket } from '../attachments/service.js';

export const CATEGORY_TITLES: Record<TicketCategory, string> = {
  not_starting: 'Machine not starting',
  payment_no_start: 'Payment deducted, machine not running',
  coin_jammed: 'Coin jammed / money swallowed',
  dirty_machine: 'Dirty machine',
  water_leak: 'Water leak',
  not_drying: 'Dryer not drying',
  damaged: 'Damaged machine',
  abandoned_clothing: 'Abandoned clothing',
  cleanliness: 'Shop cleanliness',
  other: 'Other problem',
};

const SEVERITY: Record<TicketCategory, TicketSeverity> = {
  not_starting: 'high',
  payment_no_start: 'high',
  coin_jammed: 'high',
  water_leak: 'high',
  not_drying: 'medium',
  damaged: 'medium',
  dirty_machine: 'medium',
  abandoned_clothing: 'low',
  cleanliness: 'low',
  other: 'low',
};

/** Three fault reports on one machine within a week means something is wrong beyond a one-off. */
export const REPEAT_FAULT_COUNT = 3;
export const REPEAT_FAULT_DAYS = 7;

export interface CustomerReportInput {
  id: string;
  customerId: string;
  qrToken?: string;
  shopSlug?: string;
  category: TicketCategory;
  details?: string | null;
  amountClaimedSen?: number | null;
  contactPhone?: string | null;
  /** Photos uploaded by this customer via /public/uploads. */
  attachmentIds?: string[];
}

export async function createCustomerReport(ctx: Ctx, input: CustomerReportInput): Promise<Ticket> {
  const existing = await ctx.db.selectFrom('tickets').selectAll().where('id', '=', input.id).executeTakeFirst();
  if (existing) {
    if (existing.customer_id !== input.customerId) throw conflict('id_taken', 'Report id already used');
    return existing;
  }

  let machine = null;
  let shopId: string;
  let tenantId: string;
  if (input.qrToken) {
    machine = await ctx.db.selectFrom('machines').selectAll().where('qr_token', '=', input.qrToken).where('deleted_at', 'is', null).executeTakeFirst();
    if (!machine) throw notFound('Machine');
    shopId = machine.shop_id;
    tenantId = machine.tenant_id;
  } else {
    const shop = await ctx.db.selectFrom('shops').select(['id', 'tenant_id']).where('slug', '=', input.shopSlug ?? '').executeTakeFirst();
    if (!shop) throw notFound('Shop');
    shopId = shop.id;
    tenantId = shop.tenant_id;
  }

  const now = ctx.now();
  // Link the reporter's own recent cycle and payment on this machine automatically.
  const cycle = machine
    ? await ctx.db
        .selectFrom('cycles')
        .select(['id'])
        .where('machine_id', '=', machine.id)
        .where('customer_id', '=', input.customerId)
        .where('started_at', '>=', new Date(now.getTime() - 3 * 3600_000))
        .orderBy('started_at', 'desc')
        .executeTakeFirst()
    : undefined;
  const payment = machine
    ? await ctx.db
        .selectFrom('payments')
        .select(['id'])
        .where('machine_id', '=', machine.id)
        .where('customer_id', '=', input.customerId)
        .where('created_at', '>=', new Date(now.getTime() - 3600_000))
        .orderBy('created_at', 'desc')
        .executeTakeFirst()
    : undefined;

  const category = input.category;
  const title = `${machine ? `${machine.code} · ` : ''}${CATEGORY_TITLES[category]}`;
  const countsAsFault = !!machine && FAULT_CATEGORIES.includes(category);
  const moneyInvolved = MONEY_CATEGORIES.includes(category);

  const ticket = await ctx.db.transaction().execute(async (trx) => {
    const t = await trx
      .insertInto('tickets')
      .values({
        id: input.id,
        tenant_id: tenantId,
        shop_id: shopId,
        machine_id: machine?.id ?? null,
        category,
        severity: SEVERITY[category],
        source: 'customer',
        title,
        details: input.details?.slice(0, 2000) ?? null,
        customer_id: input.customerId,
        contact_phone: moneyInvolved ? (input.contactPhone ?? null) : null,
        amount_claimed_sen: moneyInvolved ? (input.amountClaimedSen ?? null) : null,
        cycle_id: cycle?.id ?? null,
        payment_id: payment?.id ?? null,
        counts_as_fault: countsAsFault,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx.insertInto('ticket_events').values({ ticket_id: t.id, kind: 'created', body: t.details, created_at: now }).execute();
    return t;
  });

  if (input.attachmentIds?.length) await linkToTicket(ctx, input.attachmentIds, ticket, input.customerId);

  // Attach sensor evidence at the moment of the report — settles "did it run?" disputes objectively.
  if (machine) {
    const evidence = await machineEvidence(ctx, machine.id, now);
    if (evidence.observed) {
      await ctx.db.insertInto('ticket_events').values({ ticket_id: ticket.id, kind: 'evidence', data: json(evidence), created_at: now }).execute();
    }
  }

  await afterTicketChange(ctx, ticket, true);
  return ticket;
}

export interface StaffTicketInput {
  id: string;
  tenantId: string;
  shopId: string;
  machineId?: string | null;
  category: TicketCategory;
  title?: string;
  details?: string | null;
  severity?: TicketSeverity;
  userId: string;
  assignedTo?: string | null;
}

export async function createStaffTicket(ctx: Ctx, input: StaffTicketInput) {
  const now = ctx.now();
  const machine = input.machineId
    ? await ctx.db.selectFrom('machines').select(['code', 'shop_id']).where('id', '=', input.machineId).where('tenant_id', '=', input.tenantId).executeTakeFirst()
    : null;
  if (input.machineId && (!machine || machine.shop_id !== input.shopId)) throw notFound('Machine');
  const ticket = await ctx.db
    .insertInto('tickets')
    .values({
      id: input.id,
      tenant_id: input.tenantId,
      shop_id: input.shopId,
      machine_id: input.machineId ?? null,
      category: input.category,
      severity: input.severity ?? SEVERITY[input.category],
      source: 'staff',
      title: input.title || `${machine ? `${machine.code} · ` : ''}${CATEGORY_TITLES[input.category]}`,
      details: input.details ?? null,
      created_by: input.userId,
      assigned_to: input.assignedTo ?? null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .returningAll()
    .executeTakeFirst();
  const t = ticket ?? (await ctx.db.selectFrom('tickets').selectAll().where('id', '=', input.id).executeTakeFirstOrThrow());
  if (ticket) {
    await ctx.db.insertInto('ticket_events').values({ ticket_id: t.id, actor_id: input.userId, kind: 'created', body: t.details, created_at: now }).execute();
    await afterTicketChange(ctx, t, false);
  }
  return t;
}

export async function createSystemTicket(
  ctx: Ctx,
  input: { id: string; tenantId: string; shopId: string; machineId: string; category: TicketCategory; title: string; details: string; paymentId?: string; customerId?: string | null },
) {
  const now = ctx.now();
  const t = await ctx.db
    .insertInto('tickets')
    .values({
      id: input.id,
      tenant_id: input.tenantId,
      shop_id: input.shopId,
      machine_id: input.machineId,
      category: input.category,
      severity: 'high',
      source: 'system',
      title: input.title,
      details: input.details,
      payment_id: input.paymentId ?? null,
      customer_id: input.customerId ?? null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .returningAll()
    .executeTakeFirst();
  if (t) {
    await ctx.db.insertInto('ticket_events').values({ ticket_id: t.id, kind: 'created', body: t.details, created_at: now }).execute();
    await ctx.bus.publish(channels.tenant(t.tenant_id), 'ticket.created', { id: t.id, ref: t.ref, title: t.title, shopId: t.shop_id, severity: t.severity });
  }
  return t;
}

async function afterTicketChange(ctx: Ctx, ticket: Ticket, notifyOwner: boolean) {
  if (ticket.machine_id) {
    await recomputeMachineState(ctx, ticket.machine_id, `report: ${ticket.category}`);
    if (FAULT_CATEGORIES.includes(ticket.category as TicketCategory)) await checkRepeatFaults(ctx, ticket);
  }
  await ctx.bus.publish(channels.tenant(ticket.tenant_id), 'ticket.created', {
    id: ticket.id,
    ref: ticket.ref,
    title: ticket.title,
    shopId: ticket.shop_id,
    machineId: ticket.machine_id,
    severity: ticket.severity,
  });
  if (notifyOwner && ticket.severity !== 'low') {
    const shop = await ctx.db.selectFrom('shops').select('name').where('id', '=', ticket.shop_id).executeTakeFirstOrThrow();
    await ctx.notify.toTenant(
      ticket.tenant_id,
      { title: `New report · ${shop.name}`, body: ticket.title, url: `/owner/tickets/${ticket.id}`, tag: `ticket-${ticket.id}` },
      ticket.shop_id,
    );
  }
}

async function checkRepeatFaults(ctx: Ctx, ticket: Ticket) {
  const since = new Date(ctx.now().getTime() - REPEAT_FAULT_DAYS * 86_400_000);
  const row = await ctx.db
    .selectFrom('tickets')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('machine_id', '=', ticket.machine_id!)
    .where('category', 'in', [...FAULT_CATEGORIES])
    .where('created_at', '>=', since)
    .executeTakeFirst();
  const n = Number(row?.n ?? 0);
  if (n >= REPEAT_FAULT_COUNT) {
    const m = await ctx.db.selectFrom('machines').select('code').where('id', '=', ticket.machine_id!).executeTakeFirstOrThrow();
    await raiseAlert(ctx, {
      tenantId: ticket.tenant_id,
      shopId: ticket.shop_id,
      machineId: ticket.machine_id,
      kind: 'repeat_fault',
      severity: 'high',
      message: `${m.code} has ${n} fault reports in the last ${REPEAT_FAULT_DAYS} days — consider a technician visit`,
      dedupeKey: `repeat_fault:${ticket.machine_id}`,
    });
  }
}

export interface TicketUpdate {
  status?: TicketStatus;
  severity?: TicketSeverity;
  assignedTo?: string | null;
  comment?: string;
}

export async function updateTicket(ctx: Ctx, tenantId: string, ticketId: string, userId: string, patch: TicketUpdate) {
  const t = await ctx.db.selectFrom('tickets').selectAll().where('id', '=', ticketId).where('tenant_id', '=', tenantId).executeTakeFirst();
  if (!t) throw notFound('Ticket');
  const now = ctx.now();
  const set: Record<string, unknown> = { updated_at: now };
  const events: Array<{ kind: string; body?: string | null; data?: Record<string, unknown> }> = [];
  if (patch.status && patch.status !== t.status) {
    set.status = patch.status;
    set.resolved_at = patch.status === 'resolved' || patch.status === 'rejected' ? now : null;
    events.push({ kind: 'status', data: { from: t.status, to: patch.status } });
  }
  if (patch.severity && patch.severity !== t.severity) {
    set.severity = patch.severity;
    events.push({ kind: 'severity', data: { from: t.severity, to: patch.severity } });
  }
  if (patch.assignedTo !== undefined && patch.assignedTo !== t.assigned_to) {
    set.assigned_to = patch.assignedTo;
    events.push({ kind: 'assign', data: { to: patch.assignedTo } });
  }
  if (patch.comment?.trim()) events.push({ kind: 'comment', body: patch.comment.trim().slice(0, 4000) });

  const updated = await ctx.db.transaction().execute(async (trx) => {
    const u = await trx.updateTable('tickets').set(set).where('id', '=', ticketId).returningAll().executeTakeFirstOrThrow();
    for (const e of events) {
      await trx
        .insertInto('ticket_events')
        .values({ ticket_id: ticketId, actor_id: userId, kind: e.kind, body: e.body ?? null, data: json(e.data ?? {}), created_at: now })
        .execute();
    }
    return u;
  });
  if (t.machine_id && set.status) await recomputeMachineState(ctx, t.machine_id, `ticket ${updated.status}`);
  await ctx.bus.publish(channels.tenant(tenantId), 'ticket.updated', { id: ticketId, status: updated.status });
  return updated;
}
