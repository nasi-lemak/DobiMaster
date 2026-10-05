import webpush from 'web-push';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../../db/index.js';
import { json } from '../../db/index.js';
import { config } from '../../config.js';
import { renderPush, type PushTemplate } from './messages.js';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Transport abstraction so tests can capture notifications. */
export interface PushTransport {
  send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload): Promise<{ gone: boolean }>;
}

export class WebPushTransport implements PushTransport {
  async send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      return { gone: false };
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) return { gone: true };
      throw err;
    }
  }
}

export class MemoryPushTransport implements PushTransport {
  sent: Array<{ endpoint: string; payload: PushPayload }> = [];
  async send(sub: { endpoint: string }, payload: PushPayload) {
    this.sent.push({ endpoint: sub.endpoint, payload });
    return { gone: false };
  }
}

/** Load VAPID keys from env, or generate once and persist in app_settings. */
export async function ensureVapidKeys(db: DB): Promise<{ publicKey: string; privateKey: string }> {
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  }
  const row = await db.selectFrom('app_settings').select('value').where('key', '=', 'vapid').executeTakeFirst();
  if (row) return row.value as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  await db
    .insertInto('app_settings')
    .values({ key: 'vapid', value: json(keys) })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
  const saved = await db.selectFrom('app_settings').select('value').where('key', '=', 'vapid').executeTakeFirstOrThrow();
  return saved.value as { publicKey: string; privateKey: string };
}

export class PushService {
  constructor(
    private db: DB,
    private transport: PushTransport,
    private log: FastifyBaseLogger,
  ) {}

  static configure(keys: { publicKey: string; privateKey: string }) {
    webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);
  }

  async toCustomer(customerId: string, template: PushTemplate, vars: Record<string, string | number>, extra: Omit<PushPayload, 'title' | 'body'> = {}) {
    const subs = await this.db.selectFrom('push_subscriptions').selectAll().where('customer_id', '=', customerId).execute();
    await Promise.all(subs.map((s) => this.deliver(s, { ...renderPush(template, s.locale, vars), ...extra })));
    return subs.length;
  }

  /**
   * Notify every member of a tenant (optionally only those with access to a shop), on devices where they
   * are still signed in: a logged-out, revoked or expired session gets nothing.
   */
  async toTenant(tenantId: string, payload: PushPayload, shopId?: string) {
    const rows = await this.db
      .selectFrom('push_subscriptions as p')
      .innerJoin('memberships as m', 'm.user_id', 'p.user_id')
      .innerJoin('owner_sessions as s', 's.id', 'p.owner_session_id')
      .select(['p.id', 'p.endpoint', 'p.keys', 'p.failed_count', 'm.shop_ids', 'm.role'])
      .where('m.tenant_id', '=', tenantId)
      .whereRef('s.user_id', '=', 'p.user_id')
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', new Date())
      .execute();
    const targets = rows.filter((r) => !shopId || r.shop_ids === null || r.shop_ids.includes(shopId));
    await Promise.all(targets.map((s) => this.deliver(s, payload)));
  }

  private async deliver(sub: { id: string; endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload) {
    try {
      const { gone } = await this.transport.send({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      if (gone) await this.db.deleteFrom('push_subscriptions').where('id', '=', sub.id).execute();
    } catch (err) {
      this.log.warn({ err, endpoint: sub.endpoint.slice(0, 60) }, 'push failed');
      await this.db
        .updateTable('push_subscriptions')
        .set((eb) => ({ failed_count: eb('failed_count', '+', 1) }))
        .where('id', '=', sub.id)
        .execute();
    }
  }
}

/**
 * Push endpoints must be real browser push services over HTTPS. Anything else would let a client make the
 * server send requests to arbitrary (including internal) addresses. PUSH_EXTRA_HOSTS adds hosts for tests.
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com', 'push.apple.com'];
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443')) return false;
  const extra = (process.env.PUSH_EXTRA_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return [...PUSH_HOSTS, ...extra].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

/** Most phones/browsers a customer could reasonably use; older subscriptions beyond this are dropped. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_CUSTOMER = 5;

