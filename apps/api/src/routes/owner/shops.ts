import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { CONTROL_KINDS, OBSERVATION_KINDS, ADMIN_STATES, MACHINE_TYPES } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { Machine } from '../../db/types.js';
import { config } from '../../config.js';
import { accessibleShopIds, actorOf, assertShopAccess, requireOwner, requirePerm, scopeShops, can } from '../../auth/owner.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { secretToken, sha256, shortToken } from '../../lib/ids.js';
import { audit } from '../../modules/audit/service.js';
import { recomputeMachineState } from '../../modules/machines/state.js';
import { staffClearMachine } from '../../modules/cycles/service.js';
import { utilisation } from '../../modules/analytics/service.js';
import { maintenanceDue } from '../../modules/maintenance/service.js';

const hhmm = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/);
const dayHours = z.object({ open: hhmm, close: hhmm }).nullable();
export const openingHoursSchema = z.object({ '1': dayHours, '2': dayHours, '3': dayHours, '4': dayHours, '5': dayHours, '6': dayHours, '7': dayHours });
const i18n = z.object({ en: z.string().max(2000), ms: z.string().max(2000).optional(), zh: z.string().max(2000).optional(), ta: z.string().max(2000).optional() });
const i18nPartial = i18n.partial();
const programSchema = z.object({
  id: z.string().min(1).max(40),
  name: i18n,
  durationMin: z.number().int().min(1).max(240),
  priceSen: z.number().int().min(0).max(100_000),
});

const shopSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
  address: z.string().max(300).default(''),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  whatsapp: z.string().max(30).nullable().optional(),
  openingHours: openingHoursSchema,
  facilities: z.record(z.string(), z.boolean()).default({}),
  policy: i18nPartial.default({}),
  settings: z
    .object({
      faultReportThreshold: z.number().int().min(1).max(10),
      remindBeforeMin: z.number().int().min(1).max(30),
      finishedHoldMin: z.number().int().min(5).max(120),
      uncollectedReminderMin: z.number().int().min(1).max(120),
      electricitySenPerKwh: z.number().min(1).max(500),
    })
    .partial()
    .default({}),
  isPublished: z.boolean().default(true),
});

const machineSchema = z.object({
  shopId: z.string().uuid(),
  code: z.string().min(1).max(12),
  type: z.enum(MACHINE_TYPES),
  capacityKg: z.number().min(1).max(100),
  brand: z.string().max(60).nullable().optional(),
  model: z.string().max(60).nullable().optional(),
  programs: z.array(programSchema).min(1).max(12),
  instructions: i18nPartial.default({}),
  recommendedLoad: i18nPartial.default({}),
  detergentAuto: z.boolean().default(false),
  softenerAuto: z.boolean().default(false),
  observation: z.enum(OBSERVATION_KINDS).default('none'),
  control: z.enum(CONTROL_KINDS).default('none'),
  purchaseCostSen: z.number().int().min(0).nullable().optional(),
  installedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sortOrder: z.number().int().default(0),
});

export function ownerMachine(m: Machine) {
  return {
    id: m.id,
    shopId: m.shop_id,
    code: m.code,
    qrToken: m.qr_token,
    qrUrl: `${config.publicUrl}/m/${m.qr_token}`,
    type: m.type,
    capacityKg: Number(m.capacity_kg),
    brand: m.brand,
    model: m.model,
    programs: m.programs,
    instructions: m.instructions,
    recommendedLoad: m.recommended_load,
    detergentAuto: m.detergent_auto,
    softenerAuto: m.softener_auto,
    observation: m.observation,
    control: m.control,
    deviceId: m.device_id,
    purchaseCostSen: m.purchase_cost_sen,
    installedAt: m.installed_at,
    sortOrder: m.sort_order,
    adminState: m.admin_state,
    adminReason: m.admin_reason,
    staffFault: m.staff_fault,
    state: m.state,
    stateSource: m.state_source,
    stateSince: m.state_since.toISOString(),
    currentCycleId: m.current_cycle_id,
  };
}

async function machineForOwner(ctx: Ctx, tenantId: string, id: string) {
  const m = await ctx.db.selectFrom('machines').selectAll().where('id', '=', id).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!m) throw notFound('Machine');
  return m;
}

export async function ownerShopRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- shops ----
  app.get('/owner/shops', async (req) => {
    const o = requireOwner(req);
    const ids = await accessibleShopIds(ctx, o);
    const shops = ids.length ? await ctx.db.selectFrom('shops').selectAll().where('id', 'in', ids).orderBy('name').execute() : [];
    return { shops };
  });

  app.get('/owner/shops/:id', async (req) => {
    const o = requireOwner(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await assertShopAccess(ctx, o, id);
    const shop = await ctx.db.selectFrom('shops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const machines = await ctx.db.selectFrom('machines').selectAll().where('shop_id', '=', id).where('deleted_at', 'is', null).orderBy('type', 'desc').orderBy('sort_order').orderBy('code').execute();
    const cycleIds = machines.map((m) => m.current_cycle_id).filter((x): x is string => !!x);
    const cycles = cycleIds.length ? await ctx.db.selectFrom('cycles').select(['id', 'expected_end_at', 'ended_at', 'source', 'customer_id', 'status']).where('id', 'in', cycleIds).execute() : [];
    return {
      shop,
      machines: machines.map((m) => {
        const c = cycles.find((x) => x.id === m.current_cycle_id);
        return { ...ownerMachine(m), cycle: c ? { expectedEndAt: c.expected_end_at, endedAt: c.ended_at, source: c.source, hasCustomer: !!c.customer_id, status: c.status } : null };
      }),
    };
  });

  app.post('/owner/shops', async (req) => {
    const o = requirePerm(req, 'shops.manage');
    const b = shopSchema.parse(req.body);
    const exists = await ctx.db.selectFrom('shops').select('id').where('slug', '=', b.slug).executeTakeFirst();
    if (exists) throw conflict('slug_taken', 'That web address is taken');
    const shop = await ctx.db
      .insertInto('shops')
      .values({
        tenant_id: o.tenantId,
        name: b.name,
        slug: b.slug,
        address: b.address,
        lat: b.lat ?? null,
        lng: b.lng ?? null,
        phone: b.phone ?? null,
        whatsapp: b.whatsapp ?? null,
        opening_hours: json(b.openingHours),
        facilities: json(b.facilities),
        policy: json(b.policy),
        settings: json(b.settings),
        is_published: b.isPublished,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(ctx, actorOf(req), 'shop.create', 'shop', shop.id, undefined, b);
    return { shop };
  });

  app.patch('/owner/shops/:id', async (req) => {
    const o = requirePerm(req, 'shops.manage');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await assertShopAccess(ctx, o, id);
    const b = shopSchema.partial().parse(req.body);
    const before = await ctx.db.selectFrom('shops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    if (b.slug && b.slug !== before.slug) {
      const exists = await ctx.db.selectFrom('shops').select('id').where('slug', '=', b.slug).executeTakeFirst();
      if (exists) throw conflict('slug_taken', 'That web address is taken');
    }
    const shop = await ctx.db
      .updateTable('shops')
      .set({
        ...(b.name !== undefined && { name: b.name }),
        ...(b.slug !== undefined && { slug: b.slug }),
        ...(b.address !== undefined && { address: b.address }),
        ...(b.lat !== undefined && { lat: b.lat }),
        ...(b.lng !== undefined && { lng: b.lng }),
        ...(b.phone !== undefined && { phone: b.phone }),
        ...(b.whatsapp !== undefined && { whatsapp: b.whatsapp }),
        ...(b.openingHours !== undefined && { opening_hours: json(b.openingHours) }),
        ...(b.facilities !== undefined && { facilities: json(b.facilities) }),
        ...(b.policy !== undefined && { policy: json(b.policy) }),
        ...(b.settings !== undefined && { settings: json({ ...before.settings, ...b.settings }) }),
        ...(b.isPublished !== undefined && { is_published: b.isPublished }),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(ctx, actorOf(req), 'shop.update', 'shop', id, before, shop);
    return { shop };
  });

  // ---- machines ----
  app.get('/owner/machines', async (req) => {
    const o = requireOwner(req);
    const q = z.object({ shopId: z.string().uuid().optional() }).parse(req.query);
    const ids = await scopeShops(ctx, o, q.shopId);
    const rows = ids.length
      ? await ctx.db.selectFrom('machines').selectAll().where('shop_id', 'in', ids).where('deleted_at', 'is', null).orderBy('shop_id').orderBy('type', 'desc').orderBy('sort_order').orderBy('code').execute()
      : [];
    return { machines: rows.map(ownerMachine) };
  });

  app.post('/owner/machines', async (req) => {
    const o = requirePerm(req, 'machines.manage');
    const b = machineSchema.extend({ codes: z.array(z.string().min(1).max(12)).max(40).optional() }).parse(req.body);
    await assertShopAccess(ctx, o, b.shopId);
    const codes = b.codes?.length ? b.codes : [b.code];
    const dupes = await ctx.db.selectFrom('machines').select('code').where('shop_id', '=', b.shopId).where('code', 'in', codes).where('deleted_at', 'is', null).execute();
    if (dupes.length) throw conflict('code_taken', `Machine code already used: ${dupes.map((d) => d.code).join(', ')}`);
    const created = [];
    for (const [i, code] of codes.entries()) {
      const m = await ctx.db
        .insertInto('machines')
        .values({
          tenant_id: o.tenantId,
          shop_id: b.shopId,
          code,
          qr_token: shortToken(10),
          type: b.type,
          capacity_kg: b.capacityKg,
          brand: b.brand ?? null,
          model: b.model ?? null,
          programs: json(b.programs),
          instructions: json(b.instructions),
          recommended_load: json(b.recommendedLoad),
          detergent_auto: b.detergentAuto,
          softener_auto: b.softenerAuto,
          observation: b.observation,
          control: b.control,
          purchase_cost_sen: b.purchaseCostSen ?? null,
          installed_at: b.installedAt ?? null,
          sort_order: b.sortOrder + i,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await recomputeMachineState(ctx, m.id, 'created');
      created.push(m);
      await audit(ctx, actorOf(req), 'machine.create', 'machine', m.id, undefined, { code, shopId: b.shopId });
    }
    return { machines: created.map(ownerMachine) };
  });

  app.patch('/owner/machines/:id', async (req) => {
    const o = requirePerm(req, 'machines.manage');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const before = await machineForOwner(ctx, o.tenantId, id);
    await assertShopAccess(ctx, o, before.shop_id);
    const b = machineSchema.omit({ shopId: true }).partial().parse(req.body);
    if (b.code && b.code !== before.code) {
      const dupe = await ctx.db.selectFrom('machines').select('id').where('shop_id', '=', before.shop_id).where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
      if (dupe) throw conflict('code_taken', 'Machine code already used');
    }
    const m = await ctx.db
      .updateTable('machines')
      .set({
        ...(b.code !== undefined && { code: b.code }),
        ...(b.type !== undefined && { type: b.type }),
        ...(b.capacityKg !== undefined && { capacity_kg: b.capacityKg }),
        ...(b.brand !== undefined && { brand: b.brand }),
        ...(b.model !== undefined && { model: b.model }),
        ...(b.programs !== undefined && { programs: json(b.programs) }),
        ...(b.instructions !== undefined && { instructions: json(b.instructions) }),
        ...(b.recommendedLoad !== undefined && { recommended_load: json(b.recommendedLoad) }),
        ...(b.detergentAuto !== undefined && { detergent_auto: b.detergentAuto }),
        ...(b.softenerAuto !== undefined && { softener_auto: b.softenerAuto }),
        ...(b.observation !== undefined && { observation: b.observation }),
        ...(b.control !== undefined && { control: b.control }),
        ...(b.purchaseCostSen !== undefined && { purchase_cost_sen: b.purchaseCostSen }),
        ...(b.installedAt !== undefined && { installed_at: b.installedAt }),
        ...(b.sortOrder !== undefined && { sort_order: b.sortOrder }),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await recomputeMachineState(ctx, id, 'machine edited');
    await audit(ctx, actorOf(req), 'machine.update', 'machine', id, ownerMachine(before), ownerMachine(m));
    return { machine: ownerMachine(m) };
  });

  app.delete('/owner/machines/:id', async (req) => {
    const o = requirePerm(req, 'machines.manage');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const m = await machineForOwner(ctx, o.tenantId, id);
    await assertShopAccess(ctx, o, m.shop_id);
    await ctx.db.updateTable('machines').set({ deleted_at: ctx.now(), device_id: null }).where('id', '=', id).execute();
    await audit(ctx, actorOf(req), 'machine.delete', 'machine', id, ownerMachine(m));
    return { ok: true };
  });

  /** Take a machine out of service / put it back. Reason is shown to customers. */
  app.post('/owner/machines/:id/admin-state', async (req) => {
    const o = requirePerm(req, 'machines.state');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z
      .object({ adminState: z.enum(ADMIN_STATES).optional(), reason: z.string().max(200).nullable().optional(), staffFault: z.boolean().optional() })
      .parse(req.body);
    const m = await machineForOwner(ctx, o.tenantId, id);
    await assertShopAccess(ctx, o, m.shop_id);
    if (b.adminState && b.adminState !== 'active' && !b.reason?.trim()) throw badRequest('Give a short reason — customers will see it');
    const returningToService = b.adminState === 'active' || b.staffFault === false;
    await ctx.db
      .updateTable('machines')
      .set({
        ...(b.adminState !== undefined && { admin_state: b.adminState }),
        ...(b.staffFault !== undefined && { staff_fault: b.staffFault }),
        admin_reason: returningToService && !b.reason ? null : (b.reason ?? m.admin_reason),
      })
      .where('id', '=', id)
      .execute();
    await recomputeMachineState(ctx, id, b.reason ?? (returningToService ? 'returned to service' : undefined));
    const after = await machineForOwner(ctx, o.tenantId, id);
    await audit(ctx, actorOf(req), 'machine.admin_state', 'machine', id, { adminState: m.admin_state, staffFault: m.staff_fault, reason: m.admin_reason }, { adminState: after.admin_state, staffFault: after.staff_fault, reason: after.admin_reason });
    return { machine: ownerMachine(after) };
  });

  /** Staff emptied a "finished" machine or cleared a stale check-in. */
  app.post('/owner/machines/:id/clear', async (req) => {
    const o = requirePerm(req, 'machines.state');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const m = await machineForOwner(ctx, o.tenantId, id);
    await assertShopAccess(ctx, o, m.shop_id);
    await staffClearMachine(ctx, id);
    await audit(ctx, actorOf(req), 'machine.clear', 'machine', id);
    return { machine: ownerMachine(await machineForOwner(ctx, o.tenantId, id)) };
  });

  app.get('/owner/machines/:id', async (req) => {
    const o = requireOwner(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const m = await machineForOwner(ctx, o.tenantId, id);
    await assertShopAccess(ctx, o, m.shop_id);
    const now = ctx.now();
    const from = new Date(now.getTime() - 30 * 86_400_000);
    const [stateLog, cycles, tickets, maint, device, util, due] = await Promise.all([
      ctx.db.selectFrom('machine_state_log').selectAll().where('machine_id', '=', id).orderBy('started_at', 'desc').limit(60).execute(),
      ctx.db.selectFrom('cycles').selectAll().where('machine_id', '=', id).orderBy('started_at', 'desc').limit(30).execute(),
      ctx.db.selectFrom('tickets').select(['id', 'ref', 'title', 'status', 'severity', 'created_at', 'source']).where('machine_id', '=', id).orderBy('created_at', 'desc').limit(20).execute(),
      ctx.db
        .selectFrom('maintenance_logs as l')
        .leftJoin('maintenance_plans as p', 'p.id', 'l.plan_id')
        .leftJoin('users as u', 'u.id', 'l.performed_by')
        .select(['l.id', 'l.performed_at', 'l.notes', 'l.cost_sen', 'p.title as plan_title', 'u.name as by_name'])
        .where('l.machine_id', '=', id)
        .orderBy('l.performed_at', 'desc')
        .limit(20)
        .execute(),
      m.device_id ? ctx.db.selectFrom('devices').select(['id', 'kind', 'label', 'last_seen_at', 'last_power_w', 'online', 'heartbeat_sec']).where('id', '=', m.device_id).executeTakeFirst() : undefined,
      utilisation(ctx, o.tenantId, [m.shop_id], from, now),
      maintenanceDue(ctx, o.tenantId, [m.shop_id]),
    ]);
    // Downtime (last 30 days) from the state interval history.
    const down: Record<string, number> = {};
    for (const s of stateLog) {
      if (!['offline', 'fault', 'maintenance', 'disabled'].includes(s.state)) continue;
      const a = Math.max(s.started_at.getTime(), from.getTime());
      const b = (s.ended_at ?? now).getTime();
      if (b > a) down[s.state] = (down[s.state] ?? 0) + (b - a) / 3600_000;
    }
    const u = util.machines.find((x) => x.machineId === id);
    // Staff without revenue access see machine health, not money (the dashboard hides it; so must the API).
    const money = can(o, 'revenue.view');
    return {
      machine: ownerMachine(m),
      device: device ?? null,
      stats30d: { cycles: u?.cycles ?? 0, utilisation: u?.utilisation ?? 0, estimatedRevenueSen: money ? (u?.estimatedRevenueSen ?? 0) : null, downtimeHours: down },
      stateLog,
      cycles: money ? cycles : cycles.map((c) => ({ ...c, price_sen: null })),
      tickets,
      maintenance: money ? maint : maint.map((l) => ({ ...l, cost_sen: null })),
      due: due.filter((d) => d.machineId === id),
    };
  });

  app.get('/owner/machines/:id/qr.svg', async (req, reply) => {
    const o = requireOwner(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const m = await machineForOwner(ctx, o.tenantId, id);
    await assertShopAccess(ctx, o, m.shop_id);
    const svg = await QRCode.toString(`${config.publicUrl}/m/${m.qr_token}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return reply.type('image/svg+xml').send(svg);
  });

  /** Printable A4 sticker sheet data: QR SVG + big machine code for each machine. */
  app.get('/owner/shops/:id/qr-sheet', async (req) => {
    const o = requireOwner(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await assertShopAccess(ctx, o, id);
    const shop = await ctx.db.selectFrom('shops').select(['name', 'slug']).where('id', '=', id).executeTakeFirstOrThrow();
    const machines = await ctx.db.selectFrom('machines').selectAll().where('shop_id', '=', id).where('deleted_at', 'is', null).orderBy('type', 'desc').orderBy('sort_order').orderBy('code').execute();
    const items = await Promise.all(
      machines.map(async (m) => {
        const url = `${config.publicUrl}/m/${m.qr_token}`;
        return { code: m.code, type: m.type, capacityKg: Number(m.capacity_kg), url, svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
      }),
    );
    const shopUrl = `${config.publicUrl}/s/${shop.slug}`;
    return { shop: { name: shop.name, url: shopUrl, svg: await QRCode.toString(shopUrl, { type: 'svg', margin: 1 }) }, items };
  });

  // ---- devices (sensors) ----
  app.get('/owner/devices', async (req) => {
    const o = requireOwner(req);
    const ids = await accessibleShopIds(ctx, o);
    const rows = ids.length
      ? await ctx.db
          .selectFrom('devices as d')
          .leftJoin('machines as m', 'm.device_id', 'd.id')
          .select(['d.id', 'd.shop_id', 'd.kind', 'd.label', 'd.last_seen_at', 'd.last_power_w', 'd.online', 'd.heartbeat_sec', 'd.config', 'm.id as machine_id', 'm.code as machine_code'])
          .where('d.shop_id', 'in', ids)
          .orderBy('d.created_at')
          .execute()
      : [];
    return { devices: rows };
  });

  /** Register a sensor and link it to a machine. The token is shown once. */
  app.post('/owner/devices', async (req) => {
    const o = requirePerm(req, 'machines.manage');
    const b = z
      .object({
        shopId: z.string().uuid(),
        machineId: z.string().uuid().nullable().optional(),
        kind: z.enum(['generic_power', 'shelly', 'esp32_ct', 'simulator']),
        label: z.string().max(80).default(''),
        heartbeatSec: z.number().int().min(10).max(3600).default(60),
        config: z.record(z.string(), z.number()).default({}),
      })
      .parse(req.body);
    await assertShopAccess(ctx, o, b.shopId);
    const token = secretToken();
    const device = await ctx.db
      .insertInto('devices')
      .values({ tenant_id: o.tenantId, shop_id: b.shopId, kind: b.kind, label: b.label, token_hash: sha256(token), heartbeat_sec: b.heartbeatSec, config: json(b.config) })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (b.machineId) {
      const m = await machineForOwner(ctx, o.tenantId, b.machineId);
      if (m.shop_id !== b.shopId) throw badRequest('Machine is in another shop');
      await ctx.db.updateTable('machines').set({ device_id: device.id, observation: 'power_monitor' }).where('id', '=', m.id).execute();
      await recomputeMachineState(ctx, m.id, 'sensor attached');
    }
    await audit(ctx, actorOf(req), 'device.create', 'device', device.id, undefined, { kind: b.kind, machineId: b.machineId });
    return { device: { id: device.id, kind: device.kind, label: device.label }, token, ingestUrl: `${config.publicUrl.replace(/\/$/, '')}/api/v1/device/telemetry` };
  });

  // ---- announcements ----
  app.get('/owner/announcements', async (req) => {
    const o = requireOwner(req);
    const ids = await accessibleShopIds(ctx, o);
    const rows = ids.length ? await ctx.db.selectFrom('announcements').selectAll().where('shop_id', 'in', ids).orderBy('created_at', 'desc').limit(100).execute() : [];
    return { announcements: rows };
  });

  app.post('/owner/announcements', async (req) => {
    const o = requirePerm(req, 'announcements.manage');
    const b = z
      .object({ shopId: z.string().uuid(), message: i18n, level: z.enum(['info', 'warning']).default('info'), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().nullable().optional() })
      .parse(req.body);
    await assertShopAccess(ctx, o, b.shopId);
    const a = await ctx.db
      .insertInto('announcements')
      .values({ tenant_id: o.tenantId, shop_id: b.shopId, message: json(b.message), level: b.level, starts_at: b.startsAt ?? ctx.now(), ends_at: b.endsAt ?? null, created_by: o.userId })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(ctx, actorOf(req), 'announcement.create', 'announcement', a.id, undefined, b);
    return { announcement: a };
  });

  app.delete('/owner/announcements/:id', async (req) => {
    const o = requirePerm(req, 'announcements.manage');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const a = await ctx.db.selectFrom('announcements').selectAll().where('id', '=', id).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!a) throw notFound('Announcement');
    await assertShopAccess(ctx, o, a.shop_id);
    await ctx.db.updateTable('announcements').set({ ends_at: ctx.now() }).where('id', '=', id).execute();
    await audit(ctx, actorOf(req), 'announcement.end', 'announcement', id, a);
    return { ok: true };
  });
}
