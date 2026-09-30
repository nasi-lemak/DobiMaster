import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { customerFromRequest } from '../auth/guest.js';
import { assertShopAccess, requireOwner } from '../auth/owner.js';
import { badRequest, notFound } from '../lib/errors.js';
import { MAX_UPLOAD_BYTES, attachmentShop, attachmentUrl, storeUpload } from '../modules/attachments/service.js';

export async function attachmentRoutes(app: FastifyInstance, ctx: Ctx) {
  // Photos are posted as the raw request body (the client already resized and re-encoded them).
  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));

  app.post('/public/uploads', { bodyLimit: MAX_UPLOAD_BYTES, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const customerId = await customerFromRequest(ctx, req, true);
    if (!Buffer.isBuffer(req.body)) throw badRequest('Send the photo as image/jpeg, image/png or image/webp');
    const a = await storeUpload(ctx, req.body, { customerId });
    return { attachment: { id: a.id, contentType: a.content_type, sizeBytes: a.size_bytes } };
  });

  app.post('/owner/uploads', { bodyLimit: MAX_UPLOAD_BYTES }, async (req) => {
    const o = requireOwner(req);
    if (!Buffer.isBuffer(req.body)) throw badRequest('Send the photo as image/jpeg, image/png or image/webp');
    const a = await storeUpload(ctx, req.body, { userId: o.userId, tenantId: o.tenantId });
    return { attachment: { id: a.id, contentType: a.content_type, sizeBytes: a.size_bytes, url: attachmentUrl(a.id) } };
  });

  /** Owner-side viewing (cookie auth works in <img src>). */
  app.get('/owner/attachments/:id', async (req, reply) => {
    const o = requireOwner(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const a = await ctx.db.selectFrom('attachments').selectAll().where('id', '=', id).where('tenant_id', '=', o.tenantId).executeTakeFirst();
    if (!a) throw notFound('Photo');
    const shopId = await attachmentShop(ctx, a);
    if (shopId) await assertShopAccess(ctx, o, shopId);
    else if (a.uploader_user_id !== o.userId) throw notFound('Photo');
    const data = await ctx.blobs.get(a.storage_key);
    if (!data) throw notFound('Photo');
    return reply
      .header('cache-control', 'private, max-age=86400, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .type(a.content_type)
      .send(data);
  });
}
