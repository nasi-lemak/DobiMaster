import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_CHECKLIST,
  DEFAULT_MAINTENANCE,
  DRYER_INSTRUCTIONS,
  HOURS_24,
  MACHINE_PRESETS,
  recommendedLoad,
  sameHoursEveryDay,
  washerInstructions,
} from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { json, type DB } from '../../db/index.js';
import { config } from '../../config.js';
import { actorOf, assertShopAccess, hashPassword, login, requireOwner, requirePerm, setSessionCookie } from '../../auth/owner.js';
import { checkStrength } from '../../auth/passwords.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { shortToken } from '../../lib/ids.js';
import { audit } from '../../modules/audit/service.js';
import { recomputeMachineState } from '../../modules/machines/state.js';
import { assignItemIds } from '../../modules/checklists/service.js';

const hhmm = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/);
const programSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.object({ en: z.string().max(60), ms: z.string().max(60).optional(), zh: z.string().max(60).optional() }),
  durationMin: z.number().int().min(1).max(240),
  priceSen: z.number().int().min(0).max(100_000),
});

/** URL-safe slug from a name; appends -2, -3… until it is free in `table`. */
export async function uniqueSlug(db: DB, table: 'tenants' | 'shops', name: string) {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || `shop-${shortToken(5)}`;
  for (let n = 1; n < 1000; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await db.selectFrom(table).select('id').where('slug', '=', slug).executeTakeFirst();
    if (!taken) return slug.length >= 3 ? slug : `${slug}-dobi`;
  }
  return `${base}-${shortToken(6)}`;
}

/** Next free machine codes in a shop, continuing the existing numbering: W1, W2… / D1, D2… */
async function nextCodes(db: DB, shopId: string, prefix: 'W' | 'D', count: number) {
  const rows = await db.selectFrom('machines').select('code').where('shop_id', '=', shopId).where('deleted_at', 'is', null).execute();
  const used = new Set(rows.map((r) => r.code.toUpperCase()));
  const codes: string[] = [];
  for (let n = 1; codes.length < count; n++) if (!used.has(`${prefix}${n}`)) codes.push(`${prefix}${n}`);
  return codes;
}

/** Whether a new business may sign up right now (SIGNUP_MODE). */
export async function signupAllowed(db: DB, mode = config.signupMode) {
  if (mode === 'open') return true;
  if (mode === 'closed') return false;
  return !(await db.selectFrom('tenants').select('id').limit(1).executeTakeFirst());
}

export async function onboardingRoutes(app: FastifyInstance, ctx: Ctx, opts: { signupMode?: typeof config.signupMode } = {}) {
  const mode = () => opts.signupMode ?? config.signupMode;

  /** Lets the sign-in page decide whether to offer "Create an account". */
  app.get('/owner/auth/signup', async () => ({ allowed: await signupAllowed(ctx.db, mode()) }));

  /** Self-serve sign-up: a new business with you as its owner, signed in straight away. */
  app.post('/owner/auth/signup', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z
      .object({
        businessName: z.string().trim().min(2).max(120),
        name: z.string().trim().min(1).max(100),
        email: z.string().trim().email().max(200),
        password: z.string().max(200),
      })
      .parse(req.body);
    if (!(await signupAllowed(ctx.db, mode()))) throw new AppError(403, 'signup_closed', 'New sign-ups are closed on this server. Ask the operator for an account.');
    const email = b.email.toLowerCase();
    checkStrength(b.password, email);
    const exists = await ctx.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (exists) throw conflict('email_taken', 'An account with this email already exists — sign in instead (or reset your password).');
    const tenantId = await ctx.db.transaction().execute(async (trx) => {
      const t = await trx.insertInto('tenants').values({ name: b.businessName, slug: await uniqueSlug(trx, 'tenants', b.businessName), plan: 'starter' }).returning('id').executeTakeFirstOrThrow();
      const u = await trx.insertInto('users').values({ email, name: b.name, password_hash: await hashPassword(b.password) }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('memberships').values({ tenant_id: t.id, user_id: u.id, role: 'owner', shop_ids: null }).execute();
      return t.id;
    });
    const { token, user } = await login(ctx, email, b.password, { userAgent: req.headers['user-agent'], ip: req.ip });
    await audit(ctx, { userId: user.id, name: user.name, tenantId, ip: req.ip }, 'tenant.signup', 'tenant', tenantId, undefined, { businessName: b.businessName });
    setSessionCookie(reply, token, config.isProd);
    return { ok: true };
  });

  /** Where am I in setting up? Steps are derived from real data, so they can't drift. */
  app.get('/owner/onboarding', async (req) => {
    const o = requireOwner(req);
    const tenant = await ctx.db.selectFrom('tenants').select(['onboarding']).where('id', '=', o.tenantId).executeTakeFirstOrThrow();
    const shops = await ctx.db.selectFrom('shops').select(['id', 'name', 'slug', 'is_published']).where('tenant_id', '=', o.tenantId).orderBy('created_at').execute();
    const shop = shops[0] ?? null;
    const machines = shop
      ? await ctx.db.selectFrom('machines').select(['id', 'code', 'type', 'capacity_kg']).where('shop_id', '=', shop.id).where('deleted_at', 'is', null).orderBy('type', 'desc').orderBy('code').execute()
      : [];
    const steps = {
      shop: !!shop,
      machines: machines.length > 0,
      stickers: !!tenant.onboarding?.stickersPrintedAt,
      live: shops.some((s) => s.is_published),
    };
    return {
      steps,
      complete: steps.shop && steps.machines && steps.live,
      shop: shop ? { id: shop.id, name: shop.name, slug: shop.slug, published: shop.is_published, publicUrl: `${config.publicUrl.replace(/\/$/, '')}/s/${shop.slug}` } : null,
      machines: machines.map((m) => ({ id: m.id, code: m.code, type: m.type, capacityKg: Number(m.capacity_kg) })),
      presets: MACHINE_PRESETS,
    };
  });

  /** Step 1: the shop, plus a starter cleaning checklist and maintenance plans. Not public yet. */
  app.post('/owner/onboarding/shop', async (req) => {
    const o = requirePerm(req, 'shops.manage');
    const b = z
      .object({
        name: z.string().trim().min(2).max(120),
        address: z.string().trim().max(300).default(''),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
        whatsapp: z.string().trim().max(30).nullable().optional(),
        hours: z.union([z.object({ mode: z.literal('24h') }), z.object({ mode: z.literal('daily'), open: hhmm, close: hhmm })]),
        facilities: z.record(z.string(), z.boolean()).default({}),
      })
      .parse(req.body);
    const shopId = await ctx.db.transaction().execute(async (trx) => {
      const shop = await trx
        .insertInto('shops')
        .values({
          tenant_id: o.tenantId,
          name: b.name,
          slug: await uniqueSlug(trx, 'shops', b.name),
          address: b.address,
          lat: b.lat ?? null,
          lng: b.lng ?? null,
          whatsapp: b.whatsapp || null,
          phone: b.whatsapp || null,
          opening_hours: json(b.hours.mode === '24h' ? HOURS_24 : sameHoursEveryDay(b.hours.open, b.hours.close)),
          facilities: json(b.facilities),
          policy: json({
            en: 'Laundry left more than 15 minutes after finishing may be moved to the basket.',
            ms: 'Pakaian yang ditinggalkan lebih 15 minit selepas siap boleh dipindahkan ke bakul.',
            zh: '洗好后超过 15 分钟未取的衣物，可能会被移到篮子里。',
          }),
          settings: json({}),
          is_published: false, // goes live in the last step, once machines and stickers are ready
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('checklist_templates').values({ tenant_id: o.tenantId, shop_id: shop.id, name: 'Daily opening check', items: json(assignItemIds(DEFAULT_CHECKLIST)) }).execute();
      await trx
        .insertInto('maintenance_plans')
        .values(
          DEFAULT_MAINTENANCE.map((p) => ({
            tenant_id: o.tenantId,
            shop_id: shop.id,
            machine_type: p.machineType,
            title: p.title,
            interval_days: p.intervalDays,
            interval_cycles: 'intervalCycles' in p ? p.intervalCycles : null,
            interval_run_hours: 'intervalRunHours' in p ? p.intervalRunHours : null,
          })),
        )
        .execute();
      return shop.id;
    });
    await audit(ctx, actorOf(req), 'onboarding.shop', 'shop', shopId, undefined, { name: b.name });
    return { shopId };
  });

  /** Step 2: machines from presets ("4 × Washer 10 kg"), numbered W1…/D1… after any existing ones. */
  app.post('/owner/onboarding/machines', async (req) => {
    const o = requirePerm(req, 'machines.manage');
    const b = z
      .object({
        shopId: z.string().uuid(),
        detergentAuto: z.boolean().default(false),
        softenerAuto: z.boolean().default(false),
        groups: z
          .array(z.object({ presetId: z.string().max(40), quantity: z.number().int().min(1).max(30), programs: z.array(programSchema).min(1).max(12).optional() }))
          .min(1)
          .max(10),
      })
      .parse(req.body);
    await assertShopAccess(ctx, o, b.shopId);
    const total = b.groups.reduce((s, g) => s + g.quantity, 0);
    if (total > 60) throw badRequest('Add at most 60 machines at once');
    const created: Array<{ id: string; code: string }> = [];
    for (const g of b.groups) {
      const preset = MACHINE_PRESETS.find((p) => p.id === g.presetId);
      if (!preset) throw notFound('Machine type');
      const codes = await nextCodes(ctx.db, b.shopId, preset.type === 'washer' ? 'W' : 'D', g.quantity);
      for (const code of codes) {
        const m = await ctx.db
          .insertInto('machines')
          .values({
            tenant_id: o.tenantId,
            shop_id: b.shopId,
            code,
            qr_token: shortToken(10),
            type: preset.type,
            capacity_kg: preset.capacityKg,
            programs: json(g.programs ?? preset.programs),
            instructions: json(preset.type === 'washer' ? washerInstructions(b.detergentAuto) : DRYER_INSTRUCTIONS),
            recommended_load: json(recommendedLoad(preset.capacityKg, preset.type)),
            detergent_auto: preset.type === 'washer' && b.detergentAuto,
            softener_auto: preset.type === 'washer' && b.softenerAuto,
            sort_order: Number(code.slice(1)) || 0,
          })
          .returning(['id', 'code'])
          .executeTakeFirstOrThrow();
        await recomputeMachineState(ctx, m.id, 'created');
        created.push(m);
      }
    }
    await audit(ctx, actorOf(req), 'onboarding.machines', 'shop', b.shopId, undefined, { codes: created.map((c) => c.code) });
    return { machines: created };
  });

  /** Step 3 is printing the sticker sheet; the wizard records when it was opened for printing. */
  app.post('/owner/onboarding/stickers-printed', async (req) => {
    const o = requireOwner(req);
    const t = await ctx.db.selectFrom('tenants').select('onboarding').where('id', '=', o.tenantId).executeTakeFirstOrThrow();
    await ctx.db
      .updateTable('tenants')
      .set({ onboarding: json({ ...(t.onboarding ?? {}), stickersPrintedAt: ctx.now().toISOString() }) })
      .where('id', '=', o.tenantId)
      .execute();
    return { ok: true };
  });

  /** Step 4: publish — the shop appears in the customer app and its QR codes work for everyone. */
  app.post('/owner/onboarding/go-live', async (req) => {
    const o = requirePerm(req, 'shops.manage');
    const { shopId } = z.object({ shopId: z.string().uuid() }).parse(req.body);
    await assertShopAccess(ctx, o, shopId);
    const n = await ctx.db.selectFrom('machines').select('id').where('shop_id', '=', shopId).where('deleted_at', 'is', null).execute();
    if (!n.length) throw badRequest('Add your machines before going live');
    await ctx.db.updateTable('shops').set({ is_published: true }).where('id', '=', shopId).execute();
    await audit(ctx, actorOf(req), 'onboarding.go_live', 'shop', shopId);
    return { ok: true };
  });
}
