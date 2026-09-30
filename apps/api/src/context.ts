import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from './db/index.js';
import type { EventBus } from './events/bus.js';
import type { JobQueue } from './jobs/queue.js';
import type { Notifier } from './modules/notify/service.js';
import type { MailTransport } from './modules/mail/service.js';
import type { BlobStore } from './modules/attachments/storage.js';
import type { PaymentGateway } from './modules/payments/gateway.js';
import type { ControllerRegistry } from './modules/control/controllers.js';

/** Everything a service needs. Passed explicitly — no hidden singletons, so tests can swap parts. */
export interface Ctx {
  db: DB;
  pool: pg.Pool;
  bus: EventBus;
  jobs: JobQueue;
  /** Customer + owner notifications (web push, WhatsApp). */
  notify: Notifier;
  mail: MailTransport;
  blobs: BlobStore;
  gateway: PaymentGateway;
  controllers: ControllerRegistry;
  now: () => Date;
  log: FastifyBaseLogger;
  vapidPublicKey: string;
}
