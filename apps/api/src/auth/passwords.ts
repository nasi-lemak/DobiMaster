import bcrypt from 'bcryptjs';
import type { Ctx } from '../context.js';
import { config } from '../config.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { secretToken, sha256 } from '../lib/ids.js';
import { hashPassword, revokeSessions } from './owner.js';

const RESET_TTL_MS = 30 * 60_000;
export const MIN_PASSWORD = 8;

function checkStrength(pw: string, email: string) {
  if (pw.length < MIN_PASSWORD) throw badRequest(`Use at least ${MIN_PASSWORD} characters`);
  if (pw.toLowerCase() === email.toLowerCase() || /^(password|12345678|dobimaster)/i.test(pw)) throw badRequest('Choose a less guessable password');
}

/** Change my password; every other device is signed out (this one stays). */
export async function changePassword(ctx: Ctx, user: { userId: string; sessionId: string }, current: string, next: string) {
  const u = await ctx.db.selectFrom('users').select(['password_hash', 'email']).where('id', '=', user.userId).executeTakeFirstOrThrow();
  if (!(await bcrypt.compare(current, u.password_hash))) throw unauthorized('Current password is wrong');
  checkStrength(next, u.email);
  await ctx.db.updateTable('users').set({ password_hash: await hashPassword(next), password_changed_at: ctx.now() }).where('id', '=', user.userId).execute();
  return revokeSessions(ctx, user.userId, { except: user.sessionId });
}

/**
 * Email a one-time reset link. Always "succeeds" so the endpoint can't be used to discover which
 * emails have accounts. Only the token's hash is stored.
 */
export async function requestPasswordReset(ctx: Ctx, email: string) {
  const u = await ctx.db.selectFrom('users').select(['id', 'name', 'email']).where('email', '=', email.toLowerCase().trim()).executeTakeFirst();
  if (!u) return;
  const token = secretToken();
  await ctx.db
    .insertInto('password_resets')
    .values({ token_hash: sha256(token), user_id: u.id, expires_at: new Date(ctx.now().getTime() + RESET_TTL_MS), created_at: ctx.now() })
    .execute();
  const link = `${config.publicUrl.replace(/\/$/, '')}/owner/reset?token=${encodeURIComponent(token)}`;
  await ctx.mail.send({
    to: u.email,
    subject: 'Reset your DobiMaster password',
    text: `Hi ${u.name},\n\nSomeone (hopefully you) asked to reset your DobiMaster password. This link works for 30 minutes, once:\n\n${link}\n\nIf it wasn't you, ignore this email — your password stays the same.`,
  });
}

/** Set a new password from a reset link; signs out every device. */
export async function resetPassword(ctx: Ctx, token: string, next: string) {
  const now = ctx.now();
  const row = await ctx.db
    .updateTable('password_resets')
    .set({ used_at: now })
    .where('token_hash', '=', sha256(token))
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .returning('user_id')
    .executeTakeFirst();
  if (!row) throw badRequest('This reset link has expired or was already used. Ask for a new one.');
  const u = await ctx.db.selectFrom('users').select('email').where('id', '=', row.user_id).executeTakeFirstOrThrow();
  checkStrength(next, u.email);
  await ctx.db.updateTable('users').set({ password_hash: await hashPassword(next), password_changed_at: now }).where('id', '=', row.user_id).execute();
  // Any other outstanding reset links for this user die too.
  await ctx.db.updateTable('password_resets').set({ used_at: now }).where('user_id', '=', row.user_id).where('used_at', 'is', null).execute();
  await revokeSessions(ctx, row.user_id, 'all');
}
