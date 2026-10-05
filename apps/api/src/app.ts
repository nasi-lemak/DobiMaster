import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type pg from 'pg';
import { ZodError } from 'zod';
import { config } from './config.js';
import type { Ctx } from './context.js';
import { createDb } from './db/index.js';
import { EventBus } from './events/bus.js';
import { JobQueue } from './jobs/queue.js';
import { registerJobs } from './jobs/register.js';
import { AppError } from './lib/errors.js';
import { SESSION_COOKIE, loadOwnerSession } from './auth/owner.js';
import { PushService, WebPushTransport, ensureVapidKeys, type PushTransport } from './modules/push/service.js';
import { Notifier } from './modules/notify/service.js';
import { WhatsAppService, createWhatsAppTransport, type WhatsAppTransport } from './modules/whatsapp/service.js';
import { createMailTransport, type MailTransport } from './modules/mail/service.js';
import { LocalBlobStore, type BlobStore } from './modules/attachments/storage.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { registerWatchHandlers } from './modules/watches/service.js';
import { attachmentRoutes } from './routes/attachments.js';
import { ownerDigestRoutes } from './routes/owner/digest.js';
import { onboardingRoutes } from './routes/owner/onboarding.js';
import { createGateway, type PaymentGateway } from './modules/payments/gateway.js';
import { defaultControllers, type ControllerRegistry } from './modules/control/controllers.js';
import { publicRoutes, webhookRoutes } from './routes/public.js';
import { deviceRoutes } from './routes/device.js';
import { ownerCoreRoutes } from './routes/owner/core.js';
import { ownerShopRoutes } from './routes/owner/shops.js';
import { ownerOpsRoutes } from './routes/owner/ops.js';
import { wsRoutes } from './ws/hub.js';

export interface BuildOptions {
  pool: pg.Pool;
  now?: () => Date;
  pushTransport?: PushTransport;
  whatsappTransport?: WhatsAppTransport;
  mail?: MailTransport;
  blobs?: BlobStore;
  gateway?: PaymentGateway;
  controllers?: ControllerRegistry;
  /** Overrides SIGNUP_MODE (tests). */
  signupMode?: 'open' | 'first' | 'closed';
  /** Start the background job loop and periodic sweeps (off in tests — they call jobs.runDue()). */
  runJobs?: boolean;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const app = Fastify({
    logger: opts.logger === false ? false : config.isProd ? true : { transport: { target: 'pino-pretty', options: { singleLine: true } } },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
  });
  const db = createDb(opts.pool);
  const now = opts.now ?? (() => new Date());
  const bus = new EventBus(opts.pool, app.log);
  await bus.start();
  const vapid = await ensureVapidKeys(db);
  PushService.configure(vapid);

  const whatsapp = new WhatsAppService(db, opts.whatsappTransport ?? createWhatsAppTransport(), app.log, now);
  const ctx: Ctx = {
    db,
    pool: opts.pool,
    bus,
    jobs: new JobQueue(db, app.log, now, config.jobPollMs),
    notify: new Notifier(new PushService(db, opts.pushTransport ?? new WebPushTransport(), app.log), whatsapp),
    mail: opts.mail ?? createMailTransport(app.log),
    blobs: opts.blobs ?? new LocalBlobStore(config.uploadDir),
    gateway: opts.gateway ?? createGateway(),
    controllers: opts.controllers ?? defaultControllers(),
    now,
    log: app.log,
    vapidPublicKey: vapid.publicKey,
  };
  registerJobs(ctx, { periodic: opts.runJobs ?? false });
  registerWatchHandlers(ctx);

  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', global: true, enableDraftSpec: true });
  await app.register(websocket);

  app.decorateRequest('owner', undefined);
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/v1/owner') || req.url.startsWith('/ws')) {
      req.owner = (await loadOwnerSession(ctx, req.cookies?.[SESSION_COOKIE])) ?? undefined;
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation', message: err.issues[0]?.message ?? 'Invalid input', issues: err.issues });
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.status(status).send({ error: status === 429 ? 'rate_limited' : 'error', message: status >= 500 ? 'Something went wrong' : (err as Error).message });
  });

  app.get('/health', async () => {
    await opts.pool.query('SELECT 1');
    return { ok: true };
  });

  await app.register(
    async (api) => {
      await publicRoutes(api, ctx);
      await deviceRoutes(api, ctx);
      await ownerCoreRoutes(api, ctx);
      await ownerShopRoutes(api, ctx);
      await ownerOpsRoutes(api, ctx);
      await ownerDigestRoutes(api, ctx);
      await onboardingRoutes(api, ctx, { signupMode: opts.signupMode });
      await api.register(async (scoped) => attachmentRoutes(scoped, ctx));
      await api.register(async (scoped) => whatsappRoutes(scoped, ctx));
      await api.register(async (hooks) => webhookRoutes(hooks, ctx));
    },
    { prefix: '/api/v1' },
  );
  await app.register(async (w) => wsRoutes(w, ctx));

  // Production: serve the built web app (SPA fallback) from the same origin.
  const webDist = config.webDist ?? resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'not_found', message: 'Not found' });
    });
  }

  app.addHook('onClose', async () => {
    await ctx.jobs.stop();
    await bus.stop();
  });
  if (opts.runJobs) ctx.jobs.start();
  return { app, ctx };
}
