import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@dobi/shared';
import type { Ctx } from '../context.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { signToken, verifyToken } from './tokens.js';
import type { Actor } from '../modules/audit/service.js';

export const SESSION_COOKIE = 'dm_session';

export interface OwnerSession {
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

export async function login(ctx: Ctx, email: string, password: string) {
  const user = await ctx.db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase().trim()).executeTakeFirst();
  // Compare against a dummy hash when the user doesn't exist to keep timing uniform.
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  const m = await ctx.db.selectFrom('memberships').selectAll().where('user_id', '=', user.id).orderBy('created_at').executeTakeFirst();
  if (!m) throw forbidden('No workspace access');
  const token = await signToken({ sub: user.id, tid: m.tenant_id }, '14d');
  return { token, user };
}

export async function loadOwnerSession(ctx: Ctx, token: string | undefined): Promise<OwnerSession | null> {
  if (!token) return null;
  const claims = await verifyToken<{ sub: string; tid: string }>(token);
  if (!claims) return null;
  const row = await ctx.db
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select(['u.id', 'u.name', 'u.email', 'm.role', 'm.shop_ids', 'm.tenant_id'])
    .where('m.user_id', '=', claims.sub)
    .where('m.tenant_id', '=', claims.tid)
    .executeTakeFirst();
  if (!row) return null;
  return {
    userId: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    role: row.role,
    shopIds: row.shop_ids,
    permissions: ROLE_PERMISSIONS[row.role],
  };
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
