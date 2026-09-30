import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { config } from '../config.js';
import { customerFromRequest } from '../auth/guest.js';
import { requireOwner } from '../auth/owner.js';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { parseCloudWebhook, verifyWebhookSignature } from '../modules/whatsapp/service.js';

export async function whatsappRoutes(app: FastifyInstance, ctx: Ctx) {
  const wa = ctx.notify.whatsapp;

  const requireEnabled = () => {
    if (wa.mode === 'disabled') throw new AppError(404, 'whatsapp_disabled', 'WhatsApp notifications are not set up');
  };

  app.get('/public/whatsapp/config', async () => ({ mode: wa.mode, number: wa.mode === 'disabled' ? null : config.whatsapp.number }));

  /** Customer asks to be notified on WhatsApp: returns a wa.me link with a one-time code pre-filled. */
  app.post('/public/whatsapp/link', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    requireEnabled();
    const customerId = await customerFromRequest(ctx, req, true);
    const b = z.object({ cycleId: z.string().uuid().optional(), locale: z.string().max(5).default('en') }).parse(req.body ?? {});
    if (b.cycleId) {
      const c = await ctx.db.selectFrom('cycles').select('customer_id').where('id', '=', b.cycleId).executeTakeFirst();
      if (!c || c.customer_id !== customerId) throw notFound('Cycle');
    }
    return wa.createLink({ customerId, cycleId: b.cycleId ?? null, locale: b.locale });
  });

  app.get('/public/me/whatsapp', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    const c = await wa.contactFor({ customerId });
    return { linked: !!c && !c.opted_out, optedOut: c?.opted_out ?? false, windowOpen: c ? wa.windowOpen(c.last_inbound_at) : false, mode: wa.mode };
  });

  app.post('/public/me/whatsapp/unlink', async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    await ctx.db.deleteFrom('wa_contacts').where('customer_id', '=', customerId).where('user_id', 'is', null).execute();
    await ctx.db.updateTable('wa_contacts').set({ customer_id: null }).where('customer_id', '=', customerId).execute();
    return { ok: true };
  });

  // Owners link their own number for the weekly summary.
  app.post('/owner/whatsapp/link', async (req) => {
    requireEnabled();
    const o = requireOwner(req);
    return wa.createLink({ userId: o.userId, locale: 'en' });
  });

  app.post('/owner/whatsapp/unlink', async (req) => {
    const o = requireOwner(req);
    await ctx.db.deleteFrom('wa_contacts').where('user_id', '=', o.userId).where('customer_id', 'is', null).execute();
    await ctx.db.updateTable('wa_contacts').set({ user_id: null }).where('user_id', '=', o.userId).execute();
    return { ok: true };
  });

  /** Dev/test only: pretend a WhatsApp user sent us a message. */
  app.post('/dev/whatsapp/inbound', async (req) => {
    if (wa.mode !== 'mock') throw forbidden('Only available in development with the mock WhatsApp transport');
    const b = z.object({ from: z.string().regex(/^\d{8,15}$/), text: z.string().max(1000) }).parse(req.body);
    return wa.handleInbound(b);
  });

  // Meta webhook: verification handshake + signed deliveries (raw body needed for the HMAC).
  await app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hook.get('/webhooks/whatsapp', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      if (q['hub.mode'] === 'subscribe' && config.whatsapp.verifyToken && q['hub.verify_token'] === config.whatsapp.verifyToken) {
        return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      }
      throw forbidden('Verification failed');
    });
    hook.post('/webhooks/whatsapp', async (req) => {
      const raw = String(req.body ?? '');
      if (!verifyWebhookSignature(raw, req.headers['x-hub-signature-256'] as string | undefined)) throw unauthorized('Bad signature');
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return { ok: true };
      }
      for (const msg of parseCloudWebhook(payload)) {
        try {
          await wa.handleInbound(msg);
        } catch (err) {
          ctx.log.error({ err }, 'whatsapp inbound failed');
        }
      }
      return { ok: true }; // always 200 quickly, or Meta retries
    });
  });
}
