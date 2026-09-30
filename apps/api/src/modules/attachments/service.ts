import { createHash, randomUUID } from 'node:crypto';
import type { Ctx } from '../../context.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';

/**
 * Photos for problem reports (leaks, dirt, damage) and checklist items (proof of cleaning).
 * The client re-encodes images to ≤1600 px JPEG before upload, which also strips EXIF (GPS!);
 * the server only trusts the magic bytes, never the declared content type.
 */

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_REPORT_PHOTOS = 3;
const UNLINKED_TTL_MS = 24 * 3600_000;

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function sniffImage(buf: Buffer): keyof typeof EXT | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function storeUpload(ctx: Ctx, data: Buffer, uploader: { customerId: string } | { userId: string; tenantId: string }) {
  if (data.length === 0) throw badRequest('Empty upload');
  if (data.length > MAX_UPLOAD_BYTES) throw new AppError(413, 'too_large', 'Photo is too large (max 3 MB)');
  const type = sniffImage(data);
  if (!type) throw new AppError(415, 'unsupported_type', 'Only JPEG, PNG or WebP photos are accepted');
  const now = ctx.now();
  const id = randomUUID();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${EXT[type]}`;
  await ctx.blobs.put(key, data);
  const row = await ctx.db
    .insertInto('attachments')
    .values({
      id,
      tenant_id: 'tenantId' in uploader ? uploader.tenantId : null,
      uploader_customer_id: 'customerId' in uploader ? uploader.customerId : null,
      uploader_user_id: 'userId' in uploader ? uploader.userId : null,
      content_type: type,
      size_bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      storage_key: key,
      created_at: now,
    })
    .returning(['id', 'content_type', 'size_bytes'])
    .executeTakeFirstOrThrow();
  return row;
}

/** Attach a customer's fresh uploads to their report. Silently ignores ids that aren't theirs. */
export async function linkToTicket(ctx: Ctx, ids: string[], ticket: { id: string; tenant_id: string }, customerId: string) {
  if (!ids.length) return 0;
  if (ids.length > MAX_REPORT_PHOTOS) throw badRequest(`At most ${MAX_REPORT_PHOTOS} photos`);
  const res = await ctx.db
    .updateTable('attachments')
    .set({ ticket_id: ticket.id, tenant_id: ticket.tenant_id, linked_at: ctx.now() })
    .where('id', 'in', ids)
    .where('uploader_customer_id', '=', customerId)
    .where('linked_at', 'is', null)
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export async function linkToChecklist(ctx: Ctx, id: string, run: { id: string; tenantId: string }, itemId: string, userId: string) {
  const res = await ctx.db
    .updateTable('attachments')
    .set({ checklist_run_id: run.id, checklist_item_id: itemId, linked_at: ctx.now() })
    .where('id', '=', id)
    .where('uploader_user_id', '=', userId)
    .where('tenant_id', '=', run.tenantId)
    .where((eb) => eb.or([eb('linked_at', 'is', null), eb.and([eb('checklist_run_id', '=', run.id), eb('checklist_item_id', '=', itemId)])]))
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) !== 1) throw notFound('Photo');
}

/** Shop the attachment belongs to (for owner access checks), or null while unlinked. */
export async function attachmentShop(ctx: Ctx, att: { ticket_id: string | null; checklist_run_id: string | null }) {
  if (att.ticket_id) return (await ctx.db.selectFrom('tickets').select('shop_id').where('id', '=', att.ticket_id).executeTakeFirst())?.shop_id ?? null;
  if (att.checklist_run_id) return (await ctx.db.selectFrom('checklist_runs').select('shop_id').where('id', '=', att.checklist_run_id).executeTakeFirst())?.shop_id ?? null;
  return null;
}

export const attachmentUrl = (id: string) => `/api/v1/owner/attachments/${id}`;

async function deleteRows(ctx: Ctx, rows: Array<{ id: string; storage_key: string }>) {
  for (const r of rows) {
    await ctx.blobs.delete(r.storage_key);
    await ctx.db.deleteFrom('attachments').where('id', '=', r.id).execute();
  }
  return rows.length;
}

/** Uploads never attached to anything (abandoned report form) are removed after a day. */
export async function sweepUnlinkedAttachments(ctx: Ctx) {
  const rows = await ctx.db
    .selectFrom('attachments')
    .select(['id', 'storage_key'])
    .where('linked_at', 'is', null)
    .where('created_at', '<', new Date(ctx.now().getTime() - UNLINKED_TTL_MS))
    .limit(500)
    .execute();
  return deleteRows(ctx, rows);
}

export { deleteRows as deleteAttachments };
