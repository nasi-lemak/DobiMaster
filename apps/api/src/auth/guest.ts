import type { FastifyRequest } from 'fastify';
import type { Ctx } from '../context.js';
import { unauthorized } from '../lib/errors.js';
import { signToken, verifyToken } from './tokens.js';

/** Guests are anonymous customers identified by a signed token kept in the browser. No sign-up. */
export async function createGuest(ctx: Ctx, locale: string) {
  const c = await ctx.db
    .insertInto('customers')
    .values({ locale: ['en', 'ms', 'zh', 'ta'].includes(locale) ? locale : 'en' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const token = await signToken({ sub: c.id, typ: 'guest' }, '365d');
  return { customerId: c.id, token };
}

export async function customerFromRequest(ctx: Ctx, req: FastifyRequest, required: true): Promise<string>;
export async function customerFromRequest(ctx: Ctx, req: FastifyRequest, required?: false): Promise<string | null>;
export async function customerFromRequest(ctx: Ctx, req: FastifyRequest, required = false): Promise<string | null> {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  const claims = token ? await verifyToken<{ sub: string; typ: string }>(token) : null;
  if (!claims || claims.typ !== 'guest') {
    if (required) throw unauthorized('Guest token required');
    return null;
  }
  // Refresh last_seen; cheap enough per request at MVP scale. No row = the guest erased their data.
  const seen = await ctx.db.updateTable('customers').set({ last_seen_at: ctx.now() }).where('id', '=', claims.sub).executeTakeFirst();
  if (!Number(seen.numUpdatedRows)) {
    if (required) throw unauthorized('Guest no longer exists');
    return null;
  }
  return claims.sub;
}

export async function customerIdFromToken(token: string | undefined) {
  if (!token) return null;
  const claims = await verifyToken<{ sub: string; typ: string }>(token);
  return claims?.typ === 'guest' ? claims.sub : null;
}
