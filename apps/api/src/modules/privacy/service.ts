import { sql } from 'kysely';
import type { Ctx } from '../../context.js';
import { PRIVACY_RETENTION } from '@dobi/shared';
import { deleteAttachments } from '../attachments/service.js';

/**
 * Personal-data retention (Malaysian PDPA: keep personal data no longer than the purpose needs).
 * Documented to customers on the report form ("deleted after the case is closed").
 */
// Shared with the web app so the privacy notice always states the real numbers.
export const RETENTION = PRIVACY_RETENTION;

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
  // Settled refunds (paid, rejected, or failed and left), and any refund on a report closed long ago.
  const refunds = await ctx.db
    .updateTable('refunds')
    .set({ payout_phone: null })
    .where('payout_phone', 'is not', null)
    .where((eb) =>
      eb.or([
        eb.and([eb('status', 'in', ['paid', 'rejected', 'failed']), eb(sql<Date>`coalesce(paid_at, decided_at, created_at)`, '<', phoneCutoff)]),
        eb.exists(eb.selectFrom('tickets as t').select('t.id').whereRef('t.id', '=', 'refunds.ticket_id').where('t.status', 'in', ['resolved', 'rejected']).where('t.resolved_at', '<', phoneCutoff)),
      ]),
    )
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

/**
 * "Delete my data" for a guest. Business records (cycles, payments, problem reports) stay for the shop
 * but are unlinked from the person. Phone numbers on closed reports go now; open reports keep theirs
 * until resolved, because the shop needs it to refund you (then the normal sweep removes it).
 */
export async function eraseCustomer(ctx: Ctx, customerId: string) {
  return ctx.db.transaction().execute(async (trx) => {
    const c = await trx.selectFrom('customers').select('id').where('id', '=', customerId).forUpdate().executeTakeFirst();
    if (!c) return null;
    // A phone/browser can also belong to an owner account: keep their WhatsApp link and push alerts, just unlink the guest.
    await trx.updateTable('wa_contacts').set({ customer_id: null }).where('customer_id', '=', customerId).where('user_id', 'is not', null).execute();
    await trx.updateTable('push_subscriptions').set({ customer_id: null }).where('customer_id', '=', customerId).where('user_id', 'is not', null).execute();
    const wa = await trx.selectFrom('wa_contacts').select('wa_id').where('customer_id', '=', customerId).execute();
    if (wa.length) await trx.deleteFrom('wa_messages').where('wa_id', 'in', wa.map((w) => w.wa_id)).execute();

    const tickets = await trx.selectFrom('tickets').select(['id', 'status', 'contact_phone']).where('customer_id', '=', customerId).execute();
    const closed = tickets.filter((t) => t.status === 'resolved' || t.status === 'rejected').map((t) => t.id);
    if (closed.length) await trx.updateTable('tickets').set({ contact_phone: null }).where('id', 'in', closed).execute();
    // Refund phone numbers: drop all except those still needed to pay a refund that is open.
    const payments = await trx.selectFrom('payments').select('id').where('customer_id', '=', customerId).execute();
    const refundScope = [...tickets.map((t) => ['ticket_id', t.id] as const), ...payments.map((p) => ['payment_id', p.id] as const)];
    for (const [col, id] of refundScope) {
      await trx.updateTable('refunds').set({ payout_phone: null }).where(col, '=', id).where('status', 'in', ['paid', 'rejected', 'failed']).execute();
    }
    const openWithPhone = tickets.filter((t) => !closed.includes(t.id) && t.contact_phone).length;

    // Cascades: push subscriptions, WhatsApp link + codes, "notify me when free" watches.
    // Set NULL: cycles, payments, tickets, photo uploader.
    await trx.deleteFrom('customers').where('id', '=', customerId).execute();
    return { openReportsKeepingPhone: openWithPhone };
  });
}
