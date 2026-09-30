import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import { config } from '../../config.js';
import {
  SESSION_COOKIE,
  accessibleShopIds,
  actorOf,
  can,
  hashPassword,
  login,
  requireOwner,
  requirePerm,
  setSessionCookie,
} from '../../auth/owner.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../modules/audit/service.js';
import { ownerOverview } from '../../modules/overview/service.js';

export async function ownerCoreRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/owner/auth/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const { token } = await login(ctx, body.email, body.password);
    setSessionCookie(reply, token, config.isProd);
    return { ok: true };
  });

  app.post('/owner/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/owner/me', async (req) => {
    const o = requireOwner(req);
    const tenant = await ctx.db.selectFrom('tenants').select(['id', 'name', 'plan']).where('id', '=', o.tenantId).executeTakeFirstOrThrow();
    const shopIds = await accessibleShopIds(ctx, o);
    const shops = shopIds.length
      ? await ctx.db.selectFrom('shops').select(['id', 'name', 'slug']).where('id', 'in', shopIds).orderBy('name').execute()
      : [];
    const prefs = await ctx.db.selectFrom('users').select('digest_opt_out').where('id', '=', o.userId).executeTakeFirstOrThrow();
    const wa = await ctx.notify.whatsapp.contactFor({ userId: o.userId });
    return {
      user: { id: o.userId, name: o.name, email: o.email },
      role: o.role,
      permissions: o.permissions,
      tenant,
      shops,
      preferences: { digestOptOut: prefs.digest_opt_out, whatsappLinked: !!wa && !wa.opted_out, whatsappMode: ctx.notify.whatsapp.mode },
    };
  });

  app.get('/owner/overview', async (req) => {
    const o = requireOwner(req);
    return ownerOverview(ctx, o.tenantId, await accessibleShopIds(ctx, o), can(o, 'revenue.view'));
  });

  // ---- alerts ----
  app.get('/owner/alerts', async (req) => {
    const o = requireOwner(req);
    const q = z.object({ status: z.enum(['open', 'acknowledged', 'resolved', 'all']).default('open') }).parse(req.query);
    const shopIds = await accessibleShopIds(ctx, o);
    let query = ctx.db
      .selectFrom('alerts as a')
      .leftJoin('shops as s', 's.id', 'a.shop_id')
      .leftJoin('machines as m', 'm.id', 'a.machine_id')
      .select(['a.id', 'a.kind', 'a.severity', 'a.message', 'a.status', 'a.created_at', 'a.resolved_at', 'a.shop_id', 'a.machine_id', 's.name as shop_name', 'm.code as machine_code'])
      .where('a.tenant_id', '=', o.tenantId)
      .where((eb) => eb.or([eb('a.shop_id', 'is', null), ...(shopIds.length ? [eb('a.shop_id', 'in', shopIds)] : [])]))
      .orderBy('a.created_at', 'desc')
      .limit(200);
    if (q.status !== 'all') query = query.where('a.status', '=', q.status);
    return { alerts: await query.execute() };
  });

  app.post('/owner/alerts/:id/ack', async (req) => {
    const o = requireOwner(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { resolve } = z.object({ resolve: z.boolean().default(false) }).parse(req.body ?? {});
    const r = await ctx.db
      .updateTable('alerts')
      .set(resolve ? { status: 'resolved', resolved_at: ctx.now() } : { status: 'acknowledged' })
      .where('id', '=', id)
      .where('tenant_id', '=', o.tenantId)
      .returning('id')
      .executeTakeFirst();
    if (!r) throw notFound('Alert');
    await audit(ctx, actorOf(req), resolve ? 'alert.resolve' : 'alert.ack', 'alert', id);
    return { ok: true };
  });

  // ---- owner push subscriptions ----
  app.post('/owner/push/subscribe', async (req) => {
    const o = requireOwner(req);
    const body = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(req.body);
    await ctx.db
      .insertInto('push_subscriptions')
      .values({ user_id: o.userId, endpoint: body.endpoint, keys: json(body.keys) })
      .onConflict((oc) => oc.column('endpoint').doUpdateSet({ user_id: o.userId, customer_id: null, keys: json(body.keys), failed_count: 0 }))
      .execute();
    return { ok: true };
  });

  // ---- staff ----
  app.get('/owner/staff', async (req) => {
    const o = requireOwner(req);
    const rows = await ctx.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.name', 'u.email', 'm.role', 'm.shop_ids'])
      .where('m.tenant_id', '=', o.tenantId)
      .orderBy('u.name')
      .execute();
    return { staff: rows };
  });

  app.post('/owner/staff', async (req) => {
    const o = requirePerm(req, 'staff.manage');
    const body = z
      .object({
        email: z.string().email(),
        name: z.string().min(1).max(100),
        role: z.enum(ROLES),
        password: z.string().min(8).max(200),
        shopIds: z.array(z.string().uuid()).nullable().default(null),
      })
      .parse(req.body);
    if (body.role === 'owner' && o.role !== 'owner') throw badRequest('Only owners can add owners');
    const email = body.email.toLowerCase();
    let user = await ctx.db.selectFrom('users').select(['id']).where('email', '=', email).executeTakeFirst();
    if (!user) {
      user = await ctx.db
        .insertInto('users')
        .values({ email, name: body.name, password_hash: await hashPassword(body.password) })
        .returning('id')
        .executeTakeFirstOrThrow();
    }
    const exists = await ctx.db.selectFrom('memberships').select('id').where('tenant_id', '=', o.tenantId).where('user_id', '=', user.id).executeTakeFirst();
    if (exists) throw conflict('already_member', 'This person is already on your team');
    await ctx.db.insertInto('memberships').values({ tenant_id: o.tenantId, user_id: user.id, role: body.role, shop_ids: body.shopIds }).execute();
    await audit(ctx, actorOf(req), 'staff.add', 'user', user.id, undefined, { email, role: body.role, shopIds: body.shopIds });
    return { ok: true, userId: user.id };
  });

  // ---- audit log ----
  app.get('/owner/audit', async (req) => {
    const o = requirePerm(req, 'audit.view');
    const q = z.object({ entityType: z.string().max(40).optional(), entityId: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    let query = ctx.db.selectFrom('audit_log').selectAll().where('tenant_id', '=', o.tenantId).orderBy('created_at', 'desc').limit(q.limit);
    if (q.entityType) query = query.where('entity_type', '=', q.entityType);
    if (q.entityId) query = query.where('entity_id', '=', q.entityId);
    return { entries: await query.execute() };
  });
}
