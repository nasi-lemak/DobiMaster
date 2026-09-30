import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { accessibleShopIds, can, requireOwner } from '../../auth/owner.js';
import { addDays, buildDigest, deliverDigest, mondayOf } from '../../modules/digest/service.js';

export async function ownerDigestRoutes(app: FastifyInstance, ctx: Ctx) {
  /** The weekly summary as data. weeksAgo=0 is the current week so far; 1 is last full week. */
  app.get('/owner/digest', async (req) => {
    const o = requireOwner(req);
    const q = z.object({ weeksAgo: z.coerce.number().int().min(0).max(26).default(1) }).parse(req.query);
    const shop = await ctx.db.selectFrom('shops').select('timezone').where('tenant_id', '=', o.tenantId).orderBy('created_at').executeTakeFirst();
    const weekStart = addDays(mondayOf(ctx.now(), shop?.timezone ?? 'Asia/Kuala_Lumpur'), -7 * q.weeksAgo);
    return buildDigest(ctx, o.tenantId, await accessibleShopIds(ctx, o), weekStart, can(o, 'revenue.view'));
  });

  /** Send last week's summary to me now (email + WhatsApp if linked). */
  app.post('/owner/digest/send-test', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const o = requireOwner(req);
    const shop = await ctx.db.selectFrom('shops').select('timezone').where('tenant_id', '=', o.tenantId).orderBy('created_at').executeTakeFirst();
    const weekStart = addDays(mondayOf(ctx.now(), shop?.timezone ?? 'Asia/Kuala_Lumpur'), -7);
    return deliverDigest(ctx, o.tenantId, weekStart, o.userId);
  });

  app.patch('/owner/me/preferences', async (req) => {
    const o = requireOwner(req);
    const b = z.object({ digestOptOut: z.boolean() }).parse(req.body);
    await ctx.db.updateTable('users').set({ digest_opt_out: b.digestOptOut }).where('id', '=', o.userId).execute();
    return { ok: true };
  });
}
