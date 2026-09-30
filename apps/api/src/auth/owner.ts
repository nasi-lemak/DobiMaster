import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@dobi/shared';
import type { Ctx } from '../context.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { signToken, verifyToken } from './tokens.js';
import type { Actor } from '../modules/audit/service.js';

export const SESSION_COOKIE = 'dm_session';

/** How long a sign-in lasts on one device. */
export const SESSION_TTL_DAYS = 14;
/** Don't write last_seen_at on every request. */
const TOUCH_EVERY_MS = 5 * 60_000;

export interface OwnerSession {
  /** This device's session (owner_sessions.id). */
  sessionId: string;
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  /** null = all shops of the tenant */
  shopIds: string[] | null;
  permissions: readonly Permission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    owner?: OwnerSession;
  }
}

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function login(ctx: Ctx, email: string, password: string, device: { userAgent?: string; ip?: string } = {}) {
  const user = await ctx.db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase().trim()).executeTakeFirst();
  // Compare against a dummy hash when the user doesn't exist to keep timing uniform.
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  const m = await ctx.db.selectFrom('memberships').selectAll().where('user_id', '=', user.id).orderBy('created_at').executeTakeFirst();
  if (!m) throw forbidden('No workspace access');
  const now = ctx.now();
  const session = await ctx.db
    .insertInto('owner_sessions')
    .values({
      user_id: user.id,
      tenant_id: m.tenant_id,
      user_agent: device.userAgent?.slice(0, 300) ?? null,
      ip: device.ip ?? null,
      created_at: now,
      last_seen_at: now,
      expires_at: new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const token = await signToken({ sub: user.id, tid: m.tenant_id, sid: session.id }, `${SESSION_TTL_DAYS}d`);
  return { token, user, sessionId: session.id };
}

/**
 * Resolve the cookie to a live session. The signed token alone is not enough: its session row must
 * exist, be unrevoked and unexpired, and the membership must still exist (removed staff lose access
 * on their next request).
 */
export async function loadOwnerSession(ctx: Ctx, token: string | undefined): Promise<OwnerSession | null> {
  if (!token) return null;
  const claims = await verifyToken<{ sub: string; tid: string; sid?: string }>(token);
  if (!claims?.sid) return null;
  const now = ctx.now();
  const row = await ctx.db
    .selectFrom('owner_sessions as s')
    .innerJoin('memberships as m', (j) => j.onRef('m.user_id', '=', 's.user_id').onRef('m.tenant_id', '=', 's.tenant_id'))
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.id as session_id', 's.last_seen_at', 'u.id', 'u.name', 'u.email', 'm.role', 'm.shop_ids', 'm.tenant_id'])
    .where('s.id', '=', claims.sid)
    .where('s.user_id', '=', claims.sub)
    .where('s.tenant_id', '=', claims.tid)
    .where('s.revoked_at', 'is', null)
    .where('s.expires_at', '>', now)
    .executeTakeFirst();
  if (!row) return null;
  if (now.getTime() - row.last_seen_at.getTime() > TOUCH_EVERY_MS) {
    await ctx.db.updateTable('owner_sessions').set({ last_seen_at: now }).where('id', '=', row.session_id).execute();
  }
  return {
    sessionId: row.session_id,
    userId: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    role: row.role,
    shopIds: row.shop_ids,
    permissions: ROLE_PERMISSIONS[row.role],
  };
}

/** Revoke sessions of a user: one device, all other devices, or all (e.g. after a password change). */
export async function revokeSessions(ctx: Ctx, userId: string, scope: { only: string } | { except: string } | 'all') {
  let q = ctx.db.updateTable('owner_sessions').set({ revoked_at: ctx.now() }).where('user_id', '=', userId).where('revoked_at', 'is', null);
  if (scope !== 'all') q = 'only' in scope ? q.where('id', '=', scope.only) : q.where('id', '<>', scope.except);
  const r = await q.executeTakeFirst();
  return Number(r.numUpdatedRows);
}

export function requireOwner(req: FastifyRequest): OwnerSession {
  if (!req.owner) throw unauthorized();
  return req.owner;
}

export function requirePerm(req: FastifyRequest, perm: Permission): OwnerSession {
  const o = requireOwner(req);
  if (!o.permissions.includes(perm)) throw forbidden(`Missing permission ${perm}`);
  return o;
}

export function can(o: OwnerSession, perm: Permission) {
  return o.permissions.includes(perm);
}

/** Shop ids this member may access (resolves "all shops"). */
export async function accessibleShopIds(ctx: Ctx, o: OwnerSession): Promise<string[]> {
  const all = await ctx.db.selectFrom('shops').select('id').where('tenant_id', '=', o.tenantId).execute();
  const ids = all.map((s) => s.id);
  return o.shopIds === null ? ids : ids.filter((id) => o.shopIds!.includes(id));
}

export async function assertShopAccess(ctx: Ctx, o: OwnerSession, shopId: string) {
  const shop = await ctx.db.selectFrom('shops').select('id').where('id', '=', shopId).where('tenant_id', '=', o.tenantId).executeTakeFirst();
  if (!shop || (o.shopIds !== null && !o.shopIds.includes(shopId))) throw forbidden('No access to this shop');
}

/** Narrow an optional ?shopId= filter to what the member can see. */
export async function scopeShops(ctx: Ctx, o: OwnerSession, shopId?: string | null) {
  if (shopId) {
    await assertShopAccess(ctx, o, shopId);
    return [shopId];
  }
  return accessibleShopIds(ctx, o);
}

export function actorOf(req: FastifyRequest): Actor {
  const o = requireOwner(req);
  return { userId: o.userId, name: o.name, tenantId: o.tenantId, ip: req.ip };
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 14 * 86_400 });
}
