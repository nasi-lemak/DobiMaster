import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Ctx } from '../src/context.js';
import { createPool, json } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword } from '../src/auth/owner.js';
import { sha256, shortToken } from '../src/lib/ids.js';
import { MemoryPushTransport } from '../src/modules/push/service.js';
import { MockGateway } from '../src/modules/payments/gateway.js';
import { recomputeMachineState } from '../src/modules/machines/state.js';
import { initialDetectorState } from '../src/modules/telemetry/detector.js';
import { clearBusynessCache } from '../src/modules/public/service.js';
import { MockWhatsAppTransport } from '../src/modules/whatsapp/service.js';
import { MemoryMailTransport } from '../src/modules/mail/service.js';
import { MemoryBlobStore } from '../src/modules/attachments/storage.js';

const H24 = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, { open: '00:00', close: '24:00' }]));

export interface Harness {
  app: FastifyInstance;
  ctx: Ctx;
  push: MemoryPushTransport;
  gateway: MockGateway;
  whatsapp: MockWhatsAppTransport;
  mail: MemoryMailTransport;
  blobs: MemoryBlobStore;
  clock: { now: Date; advance(min: number): void };
  /** Advance the clock and run every job that became due. */
  tick(min: number): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(opts: { signupMode?: 'open' | 'first' | 'closed'; gateway?: import('../src/modules/payments/gateway.js').PaymentGateway } = {}): Promise<Harness> {
  const pool = createPool(process.env.DATABASE_URL);
  await migrate(pool, () => {});
  await pool.query(`TRUNCATE tenants, users, customers, jobs, app_settings, audit_log, wa_contacts, wa_link_codes, wa_messages, attachments RESTART IDENTITY CASCADE`);
  clearBusynessCache();
  const clock = {
    now: new Date('2026-09-30T02:00:00Z'), // 10:00 in Kuala Lumpur
    advance(min: number) {
      this.now = new Date(this.now.getTime() + min * 60_000);
    },
  };
  const push = new MemoryPushTransport();
  const gateway = (opts.gateway ?? new MockGateway()) as MockGateway;
  const whatsapp = new MockWhatsAppTransport();
  const mail = new MemoryMailTransport();
  const blobs = new MemoryBlobStore();
  const { app, ctx } = await buildApp({ pool, now: () => clock.now, pushTransport: push, gateway, whatsappTransport: whatsapp, mail, blobs, logger: false, signupMode: opts.signupMode });
  return {
    app,
    ctx,
    push,
    gateway,
    whatsapp,
    mail,
    blobs,
    clock,
    async tick(min: number) {
      clock.advance(min);
      while ((await ctx.jobs.runDue()) > 0) {
        /* drain */
      }
    },
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

export interface Fixture {
  tenantId: string;
  shopId: string;
  shopSlug: string;
  otherShopId: string;
  washer: { id: string; qr: string };
  sensored: { id: string; qr: string; deviceId: string; token: string };
  paid: { id: string; qr: string; deviceId: string; token: string };
  users: { owner: string; staff: string; ownerId: string; staffId: string };
}

const programs = [
  { id: 'cold', name: { en: 'Cold' }, durationMin: 30, priceSen: 500 },
  { id: 'hot', name: { en: 'Hot' }, durationMin: 40, priceSen: 700 },
];

export async function seedFixture(h: Harness): Promise<Fixture> {
  const db = h.ctx.db;
  const t = await db.insertInto('tenants').values({ name: 'Test Dobi', slug: `t-${shortToken(6)}` }).returning('id').executeTakeFirstOrThrow();
  const mkShop = (slug: string) =>
    db
      .insertInto('shops')
      .values({ tenant_id: t.id, slug, name: slug.toUpperCase(), opening_hours: json(H24), settings: json({}), policy: json({ en: 'Collect within 15 min.' }) })
      .returning('id')
      .executeTakeFirstOrThrow();
  const shop = await mkShop(`shop-${shortToken(6)}`);
  const other = await mkShop(`other-${shortToken(6)}`);
  const shopRow = await db.selectFrom('shops').select('slug').where('id', '=', shop.id).executeTakeFirstOrThrow();

  const mkDevice = async (label: string, config: Record<string, number>) => {
    const token = `tok-${randomUUID()}`;
    const d = await db
      .insertInto('devices')
      .values({ tenant_id: t.id, shop_id: shop.id, kind: 'simulator', label, token_hash: sha256(token), config: json(config), detector: json(initialDetectorState()), last_seen_at: h.clock.now, online: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: d.id, token };
  };
  const mkMachine = async (code: string, extra: Record<string, unknown> = {}) => {
    const qr = `qr-${code.toLowerCase()}-${shortToken(6)}`;
    const m = await db
      .insertInto('machines')
      .values({ tenant_id: t.id, shop_id: shop.id, code, qr_token: qr, type: 'washer', capacity_kg: 10, programs: json(programs), ...extra })
      .returning('id')
      .executeTakeFirstOrThrow();
    await recomputeMachineState(h.ctx, m.id);
    return { id: m.id, qr };
  };
  const washer = await mkMachine('W1');
  const d1 = await mkDevice('W2 sensor', { startW: 30, endW: 10, startSec: 20, endSec: 60, minCycleSec: 60, maxCycleMin: 120 });
  const sensored = await mkMachine('W2', { observation: 'power_monitor', device_id: d1.id });
  const d2 = await mkDevice('W3 sensor', { startW: 30, endW: 10, startSec: 0, endSec: 0, minCycleSec: 0, maxCycleMin: 180 });
  const paid = await mkMachine('W3', { observation: 'power_monitor', control: 'simulated', device_id: d2.id });

  const pw = await hashPassword('password123');
  const owner = await db.insertInto('users').values({ email: `owner-${shortToken(5)}@test.my`, name: 'Owner', password_hash: pw }).returning(['id', 'email']).executeTakeFirstOrThrow();
  const staff = await db.insertInto('users').values({ email: `staff-${shortToken(5)}@test.my`, name: 'Staff', password_hash: pw }).returning(['id', 'email']).executeTakeFirstOrThrow();
  await db
    .insertInto('memberships')
    .values([
      { tenant_id: t.id, user_id: owner.id, role: 'owner', shop_ids: null },
      { tenant_id: t.id, user_id: staff.id, role: 'staff', shop_ids: [shop.id] },
    ])
    .execute();

  return {
    tenantId: t.id,
    shopId: shop.id,
    shopSlug: shopRow.slug,
    otherShopId: other.id,
    washer,
    sensored: { ...sensored, deviceId: d1.id, token: d1.token },
    paid: { ...paid, deviceId: d2.id, token: d2.token },
    users: { owner: owner.email, staff: staff.email, ownerId: owner.id, staffId: staff.id },
  };
}

export async function guest(h: Harness, withPush = true) {
  const res = await h.app.inject({ method: 'POST', url: '/api/v1/public/guest', payload: { locale: 'en' } });
  const { token, customerId } = res.json() as { token: string; customerId: string };
  if (withPush) {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/public/push/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: { endpoint: `https://push.example/${customerId}`, keys: { p256dh: 'x', auth: 'y' } },
    });
  }
  return { token, customerId, auth: { authorization: `Bearer ${token}` }, endpoint: `https://push.example/${customerId}` };
}

/**
 * A real server-side session via the login service (same code path as the route), minus the HTTP
 * endpoint's rate limit, which would otherwise trip when a test file signs in many times.
 */
export async function loginAs(h: Harness, email: string) {
  const { login } = await import('../src/auth/owner.js');
  const { token } = await login(h.ctx, email, 'password123', { userAgent: 'vitest' });
  return { cookie: `dm_session=${token}` };
}

export async function machineState(h: Harness, id: string) {
  return h.ctx.db.selectFrom('machines').select(['state', 'state_source', 'current_cycle_id', 'staff_fault']).where('id', '=', id).executeTakeFirstOrThrow();
}

export function pushesTo(h: Harness, endpoint: string) {
  return h.push.sent.filter((s) => s.endpoint === endpoint).map((s) => s.payload.title);
}
