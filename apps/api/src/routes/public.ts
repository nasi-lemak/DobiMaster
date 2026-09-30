import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TICKET_CATEGORIES } from '@dobi/shared';
import type { Ctx } from '../context.js';
import { json } from '../db/index.js';
import { createGuest, customerFromRequest } from '../auth/guest.js';
import { badRequest, notFound } from '../lib/errors.js';
import { cancelCycle, collectCycle, serializeCycle, startCustomerCycle } from '../modules/cycles/service.js';
import { listShops, machineByQr, shopDetail } from '../modules/public/service.js';
import { createCustomerReport } from '../modules/tickets/service.js';
import { createPayment, handleGatewayWebhook, serializePayment } from '../modules/payments/service.js';
import { MockGateway } from '../modules/payments/gateway.js';

const uuid = z.string().uuid();

export async function publicRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/public/guest', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) => {
    const body = z.object({ locale: z.string().max(5).optional() }).parse(req.body ?? {});
    return createGuest(ctx, body.locale ?? 'en');
  });

  app.get('/public/shops', async (req) => {
    const q = z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }).parse(req.query);
    return { shops: await listShops(ctx, q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : undefined) };
  });

  app.get('/public/shops/:slug', async (req) => {
    const { slug } = z.object({ slug: z.string().max(80) }).parse(req.params);
    const shop = await shopDetail(ctx, slug);
    if (!shop) throw notFound('Shop');
    return shop;
  });

  app.get('/public/machines/:qr', async (req) => {
    const { qr } = z.object({ qr: z.string().max(40) }).parse(req.params);
    const res = await machineByQr(ctx, qr);
    if (!res) throw notFound('Machine');
    return res;
  });

  // ---- cycles (timer) ----
  app.post('/public/cycles', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const body = z.object({ id: uuid, qrToken: z.string().max(40), programId: z.string().max(40).optional(), force: z.boolean().optional() }).parse(req.body);
    const cycle = await startCustomerCycle(ctx, { ...body, customerId });
    return { cycle: serializeCycle(cycle) };
  });

  app.get('/public/me/cycles', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const rows = await ctx.db
      .selectFrom('cycles as c')
      .innerJoin('machines as m', 'm.id', 'c.machine_id')
      .innerJoin('shops as s', 's.id', 'c.shop_id')
      .selectAll('c')
      .select(['m.code as machine_code', 'm.type as machine_type', 'm.qr_token', 'm.programs', 's.name as shop_name', 's.slug as shop_slug'])
      .where('c.customer_id', '=', customerId)
      .orderBy('c.started_at', 'desc')
      .limit(30)
      .execute();
    return {
      cycles: rows.map((r) => ({
        ...serializeCycle(r),
        programLabel: r.programs.find((p) => p.id === r.program_id)?.name ?? (r.program_name ? { en: r.program_name } : null),
        machineCode: r.machine_code,
        machineType: r.machine_type,
        qrToken: r.qr_token,
        shopName: r.shop_name,
        shopSlug: r.shop_slug,
      })),
    };
  });

  app.post('/public/cycles/:id/collected', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return { cycle: serializeCycle(await collectCycle(ctx, customerId, id)) };
  });

  app.post('/public/cycles/:id/cancel', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await cancelCycle(ctx, customerId, id);
    return { ok: true };
  });

  // ---- problem reports ----
  app.post('/public/reports', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const body = z
      .object({
        id: uuid,
        qrToken: z.string().max(40).optional(),
        shopSlug: z.string().max(80).optional(),
        category: z.enum(TICKET_CATEGORIES),
        details: z.string().max(2000).optional().nullable(),
        amountClaimedSen: z.number().int().min(0).max(100_000).optional().nullable(),
        contactPhone: z
          .string()
          .regex(/^\+?[0-9 -]{8,16}$/, 'Enter a valid phone number')
          .optional()
          .nullable(),
        attachmentIds: z.array(uuid).max(3).optional(),
      })
      .parse(req.body);
    if (!body.qrToken && !body.shopSlug) throw badRequest('qrToken or shopSlug required');
    const t = await createCustomerReport(ctx, { ...body, customerId });
    return { ticket: { id: t.id, ref: t.ref, status: t.status, title: t.title, createdAt: t.created_at.toISOString() } };
  });

  app.get('/public/me/reports', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const rows = await ctx.db
      .selectFrom('tickets as t')
      .innerJoin('shops as s', 's.id', 't.shop_id')
      .select(['t.id', 't.ref', 't.title', 't.status', 't.category', 't.created_at', 't.resolved_at', 's.name as shop_name'])
      .where('t.customer_id', '=', customerId)
      .where('t.source', '=', 'customer')
      .orderBy('t.created_at', 'desc')
      .limit(20)
      .execute();
    return {
      reports: rows.map((r) => ({
        id: r.id,
        ref: r.ref,
        title: r.title,
        status: r.status,
        category: r.category,
        shopName: r.shop_name,
        createdAt: r.created_at.toISOString(),
        resolvedAt: r.resolved_at?.toISOString() ?? null,
      })),
    };
  });

  // ---- push ----
  app.get('/public/push/vapid-key', async () => ({ publicKey: ctx.vapidPublicKey }));

  app.post('/public/push/subscribe', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const body = z
      .object({
        endpoint: z.string().url().max(1000),
        keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
        locale: z.string().max(5).optional(),
      })
      .parse(req.body);
    await ctx.db
      .insertInto('push_subscriptions')
      .values({ customer_id: customerId, endpoint: body.endpoint, keys: json(body.keys), locale: body.locale ?? 'en' })
      .onConflict((oc) => oc.column('endpoint').doUpdateSet({ customer_id: customerId, user_id: null, keys: json(body.keys), locale: body.locale ?? 'en', failed_count: 0 }))
      .execute();
    if (body.locale) await ctx.db.updateTable('customers').set({ locale: body.locale }).where('id', '=', customerId).execute();
    return { ok: true };
  });

  // ---- payments (controllable machines only) ----
  app.post('/public/payments', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw badRequest('Idempotency-Key header required');
    const body = z.object({ qrToken: z.string().max(40), programId: z.string().max(40).optional() }).parse(req.body);
    const res = await createPayment(ctx, { customerId, qrToken: body.qrToken, programId: body.programId, idempotencyKey: key });
    return { payment: serializePayment(res.payment), redirectUrl: res.redirectUrl };
  });

  app.get('/public/payments/:id', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', id).where('customer_id', '=', customerId).executeTakeFirst();
    if (!p) throw notFound('Payment');
    const m = await ctx.db.selectFrom('machines').select(['code', 'qr_token', 'type']).where('id', '=', p.machine_id).executeTakeFirstOrThrow();
    const s = await ctx.db.selectFrom('shops').select(['name']).where('id', '=', p.shop_id).executeTakeFirstOrThrow();
    const cycle = p.cycle_id ? await ctx.db.selectFrom('cycles').selectAll().where('id', '=', p.cycle_id).executeTakeFirst() : undefined;
    return {
      payment: serializePayment(p),
      machine: { code: m.code, qrToken: m.qr_token, type: m.type },
      shopName: s.name,
      cycle: cycle ? serializeCycle(cycle) : null,
    };
  });

  app.get('/public/me/payments', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const rows = await ctx.db
      .selectFrom('payments as p')
      .innerJoin('machines as m', 'm.id', 'p.machine_id')
      .innerJoin('shops as s', 's.id', 'p.shop_id')
      .selectAll('p')
      .select(['m.code as machine_code', 's.name as shop_name'])
      .where('p.customer_id', '=', customerId)
      .orderBy('p.created_at', 'desc')
      .limit(30)
      .execute();
    return { payments: rows.map((r) => ({ ...serializePayment(r), machineCode: r.machine_code, shopName: r.shop_name })) };
  });

  /** Mock gateway only: the fake hosted payment page reports the customer's choice. */
  app.post('/public/payments/:id/mock-complete', async (req, reply) => {
    if (!(ctx.gateway instanceof MockGateway)) throw notFound();
    const customerId = await customerFromRequest(ctx, req, true);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { outcome } = z.object({ outcome: z.enum(['succeeded', 'failed']) }).parse(req.body);
    const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', id).where('customer_id', '=', customerId).executeTakeFirst();
    if (!p || !p.provider_ref) throw notFound('Payment');
    const hook = ctx.gateway.buildWebhook(p.id, p.provider_ref, outcome);
    await handleGatewayWebhook(ctx, { 'x-mock-signature': hook.signature }, hook.body);
    return reply.send({ ok: true });
  });
}

export async function webhookRoutes(app: FastifyInstance, ctx: Ctx) {
  // Raw body is needed to verify gateway signatures.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.post('/webhooks/payments/:provider', async (req) => {
    const { provider } = z.object({ provider: z.string().max(20) }).parse(req.params);
    if (provider !== ctx.gateway.name) throw notFound();
    const res = await handleGatewayWebhook(ctx, req.headers, String(req.body ?? ''));
    return { ok: true, ...res };
  });
}
