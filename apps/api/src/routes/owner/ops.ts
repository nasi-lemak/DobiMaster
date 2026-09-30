import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MACHINE_TYPES, REFUND_METHODS, TICKET_CATEGORIES, TICKET_SEVERITIES, TICKET_STATUSES } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import { accessibleShopIds, actorOf, assertShopAccess, can, requireOwner, requirePerm, scopeShops } from '../../auth/owner.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit } from '../../modules/audit/service.js';
import { createStaffTicket, updateTicket } from '../../modules/tickets/service.js';
import { decideRefund, requestRefund } from '../../modules/refunds/service.js';
import { logMaintenance, maintenanceDue } from '../../modules/maintenance/service.js';
import { assignItemIds, todaysChecklists, toggleChecklistItem } from '../../modules/checklists/service.js';
import { attachmentUrl } from '../../modules/attachments/service.js';
import { reconciliation, recordCollection } from '../../modules/collections/service.js';
import { capacityInsight, energyCost, lowUsage, peakHours, revenue, utilisation, type RevenueGroup } from '../../modules/analytics/service.js';

const uuid = z.string().uuid();
/** Item ids are assigned by the server; send the existing id when editing so completions stay attached. */
const itemSchema = z.object({ id: z.string().min(1).max(40).optional(), label: z.string().min(1).max(200), photoRequired: z.boolean().optional() });

function range(q: { from?: string; to?: string; days?: number }, now: Date) {
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - (q.days ?? 30) * 86_400_000);
  return { from, to };
}
const rangeQuery = z.object({
  shopId: uuid.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  days: z.coerce.number().int().min(1).max(400).optional(),
});

export async function ownerOpsRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- tickets ----
  app.get('/owner/tickets', async (req) => {
    const o = requireOwner(req);
    const q = z.object({ shopId: uuid.optional(), status: z.enum([...TICKET_STATUSES, 'active', 'all']).default('active'), machineId: uuid.optional(), category: z.enum(TICKET_CATEGORIES).optional() }).parse(req.query);
    const ids = await scopeShops(ctx, o, q.shopId);
    if (!ids.length) return { tickets: [] };
    let query = ctx.db
      .selectFrom('tickets as t')
      .innerJoin('shops as s', 's.id', 't.shop_id')
      .leftJoin('machines as m', 'm.id', 't.machine_id')
      .leftJoin('users as a', 'a.id', 't.assigned_to')
      .select([
        't.id', 't.ref', 't.title', 't.category', 't.severity', 't.status', 't.source', 't.created_at', 't.updated_at',
        't.amount_claimed_sen', 't.machine_id', 't.shop_id', 't.assigned_to', 's.name as shop_name', 'm.code as machine_code', 'a.name as assignee_name',
      ])
      .where('t.shop_id', 'in', ids)
      .orderBy('t.created_at', 'desc')
      .limit(200);
    if (q.status === 'active') query = query.where('t.status', 'in', ['open', 'in_progress']);
    else if (q.status !== 'all') query = query.where('t.status', '=', q.status);
    if (q.machineId) query = query.where('t.machine_id', '=', q.machineId);
    if (q.category) query = query.where('t.category', '=', q.category);
    return { tickets: await query.execute() };
  });

  app.get('/owner/tickets/:id', async (req) => {
    const o = requireOwner(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const t = await ctx.db.selectFrom('tickets').selectAll().where('id', '=', id).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    await assertShopAccess(ctx, o, t.shop_id);
    const [events, shop, machine, payment, refunds, cycle] = await Promise.all([
      ctx.db.selectFrom('ticket_events as e').leftJoin('users as u', 'u.id', 'e.actor_id').selectAll('e').select('u.name as actor_name').where('e.ticket_id', '=', id).orderBy('e.created_at').execute(),
      ctx.db.selectFrom('shops').select(['id', 'name']).where('id', '=', t.shop_id).executeTakeFirstOrThrow(),
      t.machine_id ? ctx.db.selectFrom('machines').select(['id', 'code', 'type', 'state', 'observation']).where('id', '=', t.machine_id).executeTakeFirst() : undefined,
      t.payment_id ? ctx.db.selectFrom('payments').select(['id', 'amount_sen', 'status', 'refunded_sen', 'created_at']).where('id', '=', t.payment_id).executeTakeFirst() : undefined,
      ctx.db.selectFrom('refunds').selectAll().where('ticket_id', '=', id).orderBy('created_at').execute(),
      t.cycle_id ? ctx.db.selectFrom('cycles').select(['id', 'status', 'started_at', 'ended_at', 'source', 'sensor_confirmed', 'program_name']).where('id', '=', t.cycle_id).executeTakeFirst() : undefined,
    ]);
    // Staff without refund permission don't see the customer's phone number.
    const ticket = can(o, 'refunds.decide') ? t : { ...t, contact_phone: t.contact_phone ? '••••' + t.contact_phone.slice(-3) : null };
    const photos = await ctx.db.selectFrom('attachments').select(['id', 'content_type', 'created_at']).where('ticket_id', '=', id).orderBy('created_at').execute();
    return {
      ticket,
      events,
      shop,
      machine: machine ?? null,
      payment: payment ?? null,
      refunds,
      cycle: cycle ?? null,
      photos: photos.map((p) => ({ id: p.id, url: attachmentUrl(p.id), createdAt: p.created_at.toISOString() })),
    };
  });

  app.post('/owner/tickets', async (req) => {
    const o = requirePerm(req, 'tickets.manage');
    const b = z
      .object({
        id: uuid,
        shopId: uuid,
        machineId: uuid.nullable().optional(),
        category: z.enum(TICKET_CATEGORIES),
        title: z.string().max(200).optional(),
        details: z.string().max(4000).nullable().optional(),
        severity: z.enum(TICKET_SEVERITIES).optional(),
        assignedTo: uuid.nullable().optional(),
      })
      .parse(req.body);
    await assertShopAccess(ctx, o, b.shopId);
    const t = await createStaffTicket(ctx, { ...b, tenantId: o.tenantId, userId: o.userId });
    await audit(ctx, actorOf(req), 'ticket.create', 'ticket', t.id, undefined, b);
    return { ticket: t };
  });

  app.patch('/owner/tickets/:id', async (req) => {
    const o = requirePerm(req, 'tickets.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z
      .object({ status: z.enum(TICKET_STATUSES).optional(), severity: z.enum(TICKET_SEVERITIES).optional(), assignedTo: uuid.nullable().optional(), comment: z.string().max(4000).optional() })
      .parse(req.body);
    const before = await ctx.db.selectFrom('tickets').select(['shop_id', 'status', 'severity', 'assigned_to']).where('id', '=', id).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!before) throw notFound('Ticket');
    await assertShopAccess(ctx, o, before.shop_id);
    const t = await updateTicket(ctx, o.tenantId, id, o.userId, b);
    await audit(ctx, actorOf(req), 'ticket.update', 'ticket', id, before, { status: t.status, severity: t.severity, assigned_to: t.assigned_to });
    return { ticket: t };
  });

  // ---- refunds ----
  app.get('/owner/refunds', async (req) => {
    const o = requirePerm(req, 'refunds.decide');
    const q = z.object({ status: z.enum(['pending', 'all']).default('pending') }).parse(req.query);
    const ids = await accessibleShopIds(ctx, o);
    if (!ids.length) return { refunds: [] };
    let query = ctx.db
      .selectFrom('refunds as r')
      .innerJoin('shops as s', 's.id', 'r.shop_id')
      .leftJoin('tickets as t', 't.id', 'r.ticket_id')
      .leftJoin('users as u', 'u.id', 'r.decided_by')
      .selectAll('r')
      .select(['s.name as shop_name', 't.ref as ticket_ref', 't.title as ticket_title', 'u.name as decided_by_name'])
      .where('r.shop_id', 'in', ids)
      .orderBy('r.created_at', 'desc')
      .limit(200);
    if (q.status === 'pending') query = query.where('r.status', 'in', ['requested', 'approved', 'failed']);
    return { refunds: await query.execute() };
  });

  app.post('/owner/refunds', async (req) => {
    const o = requirePerm(req, 'refunds.decide');
    const b = z
      .object({
        ticketId: uuid.nullable().optional(),
        paymentId: uuid.nullable().optional(),
        amountSen: z.number().int().min(1).max(100_000),
        method: z.enum(REFUND_METHODS),
        payoutPhone: z.string().max(20).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
      })
      .parse(req.body);
    // Check access to the shop the ticket/payment belongs to *before* creating anything.
    const source = b.ticketId
      ? await ctx.db.selectFrom('tickets').select('shop_id').where('id', '=', b.ticketId).where('tenant_id', '=', o.tenantId).executeTakeFirst()
      : b.paymentId
        ? await ctx.db.selectFrom('payments').select('shop_id').where('id', '=', b.paymentId).where('tenant_id', '=', o.tenantId).executeTakeFirst()
        : undefined;
    if (source) await assertShopAccess(ctx, o, source.shop_id);
    const r = await requestRefund(ctx, { ...b, tenantId: o.tenantId, actorId: o.userId });
    await audit(ctx, actorOf(req), 'refund.create', 'refund', r.id, undefined, b);
    return { refund: r };
  });

  app.post('/owner/refunds/:id/decision', async (req) => {
    const o = requirePerm(req, 'refunds.decide');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ action: z.enum(['approve', 'reject', 'mark_paid']), reference: z.string().max(100).nullable().optional(), note: z.string().max(500).nullable().optional() }).parse(req.body);
    const before = await ctx.db.selectFrom('refunds').selectAll().where('id', '=', id).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!before) throw notFound('Refund');
    await assertShopAccess(ctx, o, before.shop_id);
    const r = await decideRefund(ctx, o.tenantId, id, o.userId, b);
    await audit(ctx, actorOf(req), `refund.${b.action}`, 'refund', id, { status: before.status }, { status: r.status, reference: r.reference });
    return { refund: r };
  });

  // ---- collections (cash) ----
  app.get('/owner/collections', async (req) => {
    const o = requireOwner(req);
    const q = z.object({ shopId: uuid.optional() }).parse(req.query);
    const ids = await scopeShops(ctx, o, q.shopId);
    if (!ids.length) return { collections: [] };
    const cols = await ctx.db
      .selectFrom('collections as c')
      .innerJoin('shops as s', 's.id', 'c.shop_id')
      .leftJoin('users as u', 'u.id', 'c.collected_by')
      .select(['c.id', 'c.shop_id', 'c.collected_at', 'c.note', 's.name as shop_name', 'u.name as collected_by_name'])
      .where('c.shop_id', 'in', ids)
      .orderBy('c.collected_at', 'desc')
      .limit(100)
      .execute();
    const lines = cols.length
      ? await ctx.db
          .selectFrom('collection_lines as l')
          .innerJoin('machines as m', 'm.id', 'l.machine_id')
          .select(['l.collection_id', 'l.machine_id', 'l.amount_sen', 'l.counter_reading', 'm.code'])
          .where('l.collection_id', 'in', cols.map((c) => c.id))
          .execute()
      : [];
    const showMoney = can(o, 'revenue.view');
    return {
      collections: cols.map((c) => {
        const ls = lines.filter((l) => l.collection_id === c.id);
        return {
          ...c,
          // Staff see only what they entered structurally, not totals over time.
          totalSen: showMoney ? ls.reduce((s, l) => s + l.amount_sen, 0) : null,
          lines: ls.map((l) => ({ ...l, amount_sen: showMoney || c.collected_by_name === o.name ? l.amount_sen : null })),
        };
      }),
    };
  });

  app.post('/owner/collections', async (req) => {
    const o = requirePerm(req, 'collections.create');
    const b = z
      .object({
        shopId: uuid,
        collectedAt: z.string().datetime().optional(),
        note: z.string().max(500).nullable().optional(),
        lines: z.array(z.object({ machineId: uuid, amountSen: z.number().int().min(0).max(10_000_000), counterReading: z.number().int().min(0).nullable().optional() })).min(1).max(60),
      })
      .parse(req.body);
    await assertShopAccess(ctx, o, b.shopId);
    const c = await recordCollection(ctx, { ...b, collectedAt: b.collectedAt ? new Date(b.collectedAt) : undefined, tenantId: o.tenantId, userId: o.userId });
    await audit(ctx, actorOf(req), 'collection.create', 'collection', c.id, undefined, b);
    return { collection: c };
  });

  app.get('/owner/collections/reconciliation', async (req) => {
    const o = requirePerm(req, 'revenue.view');
    const q = z.object({ shopId: uuid.optional() }).parse(req.query);
    return { rows: await reconciliation(ctx, o.tenantId, await scopeShops(ctx, o, q.shopId)) };
  });

  // ---- maintenance ----
  app.get('/owner/maintenance/plans', async (req) => {
    const o = requireOwner(req);
    const ids = await accessibleShopIds(ctx, o);
    const plans = ids.length
      ? await ctx.db
          .selectFrom('maintenance_plans as p')
          .innerJoin('shops as s', 's.id', 'p.shop_id')
          .leftJoin('machines as m', 'm.id', 'p.machine_id')
          .selectAll('p')
          .select(['s.name as shop_name', 'm.code as machine_code'])
          .where('p.shop_id', 'in', ids)
          .orderBy('p.created_at')
          .execute()
      : [];
    return { plans };
  });

  const planSchema = z
    .object({
      shopId: uuid,
      machineId: uuid.nullable().optional(),
      machineType: z.enum(MACHINE_TYPES).nullable().optional(),
      title: z.string().min(2).max(120),
      intervalDays: z.number().int().min(1).max(3650).nullable().optional(),
      intervalCycles: z.number().int().min(1).max(100_000).nullable().optional(),
      intervalRunHours: z.number().int().min(1).max(100_000).nullable().optional(),
      active: z.boolean().default(true),
    })
    .refine((p) => p.machineId || p.machineType, 'Choose a machine or a machine type')
    .refine((p) => p.intervalDays || p.intervalCycles || p.intervalRunHours, 'Set at least one interval');

  app.post('/owner/maintenance/plans', async (req) => {
    const o = requirePerm(req, 'maintenance.manage');
    const b = planSchema.parse(req.body);
    await assertShopAccess(ctx, o, b.shopId);
    if (b.machineId) {
      const m = await ctx.db.selectFrom('machines').select('shop_id').where('id', '=', b.machineId).where('tenant_id', '=', o.tenantId).executeTakeFirst();
      if (!m) throw notFound('Machine');
      if (m.shop_id !== b.shopId) throw badRequest('That machine is in a different shop');
    }
    const p = await ctx.db
      .insertInto('maintenance_plans')
      .values({
        tenant_id: o.tenantId,
        shop_id: b.shopId,
        machine_id: b.machineId ?? null,
        machine_type: b.machineId ? null : (b.machineType ?? null),
        title: b.title,
        interval_days: b.intervalDays ?? null,
        interval_cycles: b.intervalCycles ?? null,
        interval_run_hours: b.intervalRunHours ?? null,
        active: b.active,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(ctx, actorOf(req), 'maintenance_plan.create', 'maintenance_plan', p.id, undefined, b);
    return { plan: p };
  });

  app.patch('/owner/maintenance/plans/:id', async (req) => {
    const o = requirePerm(req, 'maintenance.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ active: z.boolean().optional(), title: z.string().min(2).max(120).optional() }).parse(req.body);
    const existing = await ctx.db.selectFrom('maintenance_plans').select('shop_id').where('id', '=', id).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!existing) throw notFound('Plan');
    await assertShopAccess(ctx, o, existing.shop_id);
    const p = await ctx.db.updateTable('maintenance_plans').set(b).where('id', '=', id).where('tenant_id', '=', o.tenantId).returningAll().executeTakeFirst();
    if (!p) throw notFound('Plan');
    await audit(ctx, actorOf(req), 'maintenance_plan.update', 'maintenance_plan', id, undefined, b);
    return { plan: p };
  });

  app.get('/owner/maintenance/due', async (req) => {
    const o = requireOwner(req);
    const q = z.object({ shopId: uuid.optional() }).parse(req.query);
    return { items: await maintenanceDue(ctx, o.tenantId, await scopeShops(ctx, o, q.shopId)) };
  });

  app.post('/owner/maintenance/logs', async (req) => {
    const o = requirePerm(req, 'maintenance.log');
    const b = z
      .object({ machineId: uuid, planId: uuid.nullable().optional(), performedAt: z.string().datetime().optional(), notes: z.string().max(2000).nullable().optional(), costSen: z.number().int().min(0).nullable().optional() })
      .parse(req.body);
    const m = await ctx.db.selectFrom('machines').select('shop_id').where('id', '=', b.machineId).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!m) throw notFound('Machine');
    await assertShopAccess(ctx, o, m.shop_id);
    const log = await logMaintenance(ctx, { ...b, performedAt: b.performedAt ? new Date(b.performedAt) : undefined, tenantId: o.tenantId, userId: o.userId });
    await audit(ctx, actorOf(req), 'maintenance.log', 'machine', b.machineId, undefined, b);
    return { log };
  });

  // ---- checklists ----
  app.get('/owner/checklists/templates', async (req) => {
    const o = requireOwner(req);
    const ids = await accessibleShopIds(ctx, o);
    const rows = ids.length ? await ctx.db.selectFrom('checklist_templates').selectAll().where('shop_id', 'in', ids).orderBy('created_at').execute() : [];
    return { templates: rows };
  });

  app.post('/owner/checklists/templates', async (req) => {
    const o = requirePerm(req, 'checklists.manage');
    const b = z
      .object({ shopId: uuid, name: z.string().min(2).max(100), items: z.array(itemSchema).min(1).max(40), active: z.boolean().default(true) })
      .parse(req.body);
    await assertShopAccess(ctx, o, b.shopId);
    const t = await ctx.db
      .insertInto('checklist_templates')
      .values({ tenant_id: o.tenantId, shop_id: b.shopId, name: b.name, items: json(assignItemIds(b.items)), active: b.active })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(ctx, actorOf(req), 'checklist_template.create', 'checklist_template', t.id, undefined, b);
    return { template: t };
  });

  app.patch('/owner/checklists/templates/:id', async (req) => {
    const o = requirePerm(req, 'checklists.manage');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z
      .object({ name: z.string().min(2).max(100).optional(), items: z.array(itemSchema).min(1).max(40).optional(), active: z.boolean().optional() })
      .parse(req.body);
    const existing = await ctx.db.selectFrom('checklist_templates').select('shop_id').where('id', '=', id).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!existing) throw notFound('Checklist');
    await assertShopAccess(ctx, o, existing.shop_id);
    const t = await ctx.db
      .updateTable('checklist_templates')
      .set({ ...(b.name && { name: b.name }), ...(b.items && { items: json(assignItemIds(b.items)) }), ...(b.active !== undefined && { active: b.active }) })
      .where('id', '=', id)
      .where('tenant_id', '=', o.tenantId)
      .returningAll()
      .executeTakeFirst();
    if (!t) throw notFound('Checklist');
    await audit(ctx, actorOf(req), 'checklist_template.update', 'checklist_template', id, undefined, b);
    return { template: t };
  });

  app.get('/owner/checklists/today', async (req) => {
    const o = requireOwner(req);
    const q = z.object({ shopId: uuid.optional() }).parse(req.query);
    return { runs: await todaysChecklists(ctx, o.tenantId, await scopeShops(ctx, o, q.shopId)) };
  });

  app.post('/owner/checklists/runs/:runId/items/:itemId', async (req) => {
    const o = requirePerm(req, 'checklists.complete');
    const { runId, itemId } = z.object({ runId: uuid, itemId: z.string().max(40) }).parse(req.params);
    const { done, photoId } = z.object({ done: z.boolean(), photoId: uuid.optional() }).parse(req.body);
    const run = await ctx.db.selectFrom('checklist_runs').select('shop_id').where('id', '=', runId).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!run) throw notFound('Checklist');
    await assertShopAccess(ctx, o, run.shop_id);
    await toggleChecklistItem(ctx, o.tenantId, runId, itemId, { id: o.userId, name: o.name }, done, photoId);
    return { ok: true };
  });

  // ---- analytics (revenue.view) ----
  app.get('/owner/analytics/revenue', async (req) => {
    const o = requirePerm(req, 'revenue.view');
    const q = rangeQuery.extend({ groupBy: z.enum(['day', 'week', 'month', 'hour', 'shop', 'machine', 'type', 'capacity']).default('day') }).parse(req.query);
    const { from, to } = range(q, ctx.now());
    return revenue(ctx, o.tenantId, await scopeShops(ctx, o, q.shopId), from, to, q.groupBy as RevenueGroup);
  });

  app.get('/owner/analytics/utilisation', async (req) => {
    const o = requirePerm(req, 'revenue.view');
    const q = rangeQuery.parse(req.query);
    const { from, to } = range(q, ctx.now());
    return utilisation(ctx, o.tenantId, await scopeShops(ctx, o, q.shopId), from, to);
  });

  app.get('/owner/analytics/peak-hours', async (req) => {
    const o = requirePerm(req, 'revenue.view');
    const q = rangeQuery.extend({ type: z.enum(MACHINE_TYPES).optional() }).parse(req.query);
    const { from, to } = range(q, ctx.now());
    return peakHours(ctx, o.tenantId, await scopeShops(ctx, o, q.shopId), from, to, q.type);
  });

  app.get('/owner/analytics/capacity', async (req) => {
    const o = requirePerm(req, 'revenue.view');
    const q = rangeQuery.extend({ shopId: uuid }).parse(req.query);
    await assertShopAccess(ctx, o, q.shopId);
    const { from, to } = range(q, ctx.now());
    return capacityInsight(ctx, o.tenantId, q.shopId, from, to);
  });

  app.get('/owner/analytics/energy', async (req) => {
    const o = requirePerm(req, 'revenue.view');
    const q = rangeQuery.parse(req.query);
    const { from, to } = range(q, ctx.now());
    return energyCost(ctx, o.tenantId, await scopeShops(ctx, o, q.shopId), from, to);
  });

  app.get('/owner/analytics/low-usage', async (req) => {
    const o = requirePerm(req, 'revenue.view');
    const q = z.object({ shopId: uuid.optional(), days: z.coerce.number().int().min(1).max(60).default(7) }).parse(req.query);
    return lowUsage(ctx, o.tenantId, await scopeShops(ctx, o, q.shopId), q.days);
  });

}
