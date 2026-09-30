import { sql } from 'kysely';
import type { Ctx } from '../../context.js';
import { deleteAttachments } from '../attachments/service.js';

/**
 * Personal-data retention (Malaysian PDPA: keep personal data no longer than the purpose needs).
 * Documented to customers on the report form ("deleted after the case is closed").
 */
export const RETENTION = {
  /** Refund phone numbers on closed tickets / settled refunds. */
  contactPhoneDays: 90,
  /** Photos attached to closed tickets. */
  ticketPhotoDays: 180,
  /** WhatsApp numbers that haven't messaged us. */
  waContactDays: 180,
  /** WhatsApp message log. */
  waMessageDays: 30,
};

const daysAgo = (ctx: Ctx, d: number) => new Date(ctx.now().getTime() - d * 86_400_000);

export async function sweepPrivacy(ctx: Ctx) {
  const phoneCutoff = daysAgo(ctx, RETENTION.contactPhoneDays);
  const tickets = await ctx.db
    .updateTable('tickets')
    .set({ contact_phone: null })
    .where('contact_phone', 'is not', null)
    .where('status', 'in', ['resolved', 'rejected'])
    .where('resolved_at', '<', phoneCutoff)
    .executeTakeFirst();
  const refunds = await ctx.db
    .updateTable('refunds')
    .set({ payout_phone: null })
    .where('payout_phone', 'is not', null)
    .where('status', 'in', ['paid', 'rejected'])
    .where(sql<Date>`coalesce(paid_at, decided_at)`, '<', phoneCutoff)
    .executeTakeFirst();

  const photos = await ctx.db
    .selectFrom('attachments as a')
    .innerJoin('tickets as t', 't.id', 'a.ticket_id')
    .select(['a.id', 'a.storage_key'])
    .where('t.status', 'in', ['resolved', 'rejected'])
    .where('t.resolved_at', '<', daysAgo(ctx, RETENTION.ticketPhotoDays))
    .limit(1000)
    .execute();
  const photosDeleted = await deleteAttachments(ctx, photos);

  const wa = await ctx.db.deleteFrom('wa_contacts').where('last_inbound_at', '<', daysAgo(ctx, RETENTION.waContactDays)).executeTakeFirst();
  await ctx.db.deleteFrom('wa_messages').where('created_at', '<', daysAgo(ctx, RETENTION.waMessageDays)).execute();
  await ctx.db.deleteFrom('wa_link_codes').where('expires_at', '<', daysAgo(ctx, 1)).execute();

  const result = {
    ticketPhones: Number(tickets.numUpdatedRows),
    refundPhones: Number(refunds.numUpdatedRows),
    photosDeleted,
    waContacts: Number(wa.numDeletedRows),
  };
  ctx.log.info(result, 'privacy sweep');
  return result;
}
