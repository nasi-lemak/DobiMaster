import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from './db/index.js';
import type { EventBus } from './events/bus.js';
import type { JobQueue } from './jobs/queue.js';
import type { PushService } from './modules/push/service.js';
import type { PaymentGateway } from './modules/payments/gateway.js';
import type { ControllerRegistry } from './modules/control/controllers.js';

/** Everything a service needs. Passed explicitly — no hidden singletons, so tests can swap parts. */
export interface Ctx {
  db: DB;
  pool: pg.Pool;
  bus: EventBus;
  jobs: JobQueue;
  push: PushService;
  gateway: PaymentGateway;
  controllers: ControllerRegistry;
  now: () => Date;
  log: FastifyBaseLogger;
  vapidPublicKey: string;
}
