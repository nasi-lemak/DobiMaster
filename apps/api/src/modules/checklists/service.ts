import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { ChecklistCompletion } from '../../db/types.js';
import { channels } from '../../events/bus.js';
import { notFound } from '../../lib/errors.js';
import { badRequest } from '../../lib/errors.js';
import { shortToken } from '../../lib/ids.js';
import { localParts } from '../../lib/time.js';
import { attachmentUrl, linkToChecklist } from '../attachments/service.js';

/** Keep ids the client sent (existing items), assign fresh unique ids to new ones. */
export function assignItemIds(items: Array<{ id?: string; label: string; photoRequired?: boolean }>) {
  const seen = new Set<string>();
  return items.map((i) => {
    let id = i.id && !seen.has(i.id) ? i.id : shortToken(8);
    while (seen.has(id)) id = shortToken(8);
    seen.add(id);
    return { id, label: i.label.trim(), ...(i.photoRequired ? { photoRequired: true } : {}) };
  });
}

/** Today's checklist runs (shop-local date), created lazily from active templates. */
export async function todaysChecklists(ctx: Ctx, tenantId: string, shopIds: string[]) {
  if (!shopIds.length) return [];
  const templates = await ctx.db
    .selectFrom('checklist_templates as t')
    .innerJoin('shops as s', 's.id', 't.shop_id')
    .select(['t.id', 't.shop_id', 't.name', 't.items', 's.timezone', 's.name as shop_name'])
    .where('t.tenant_id', '=', tenantId)
    .where('t.shop_id', 'in', shopIds)
    .where('t.active', '=', true)
    .execute();
  const out = [];
  for (const t of templates) {
    const date = localParts(ctx.now(), t.timezone).date;
    await ctx.db
      .insertInto('checklist_runs')
      .values({ tenant_id: tenantId, shop_id: t.shop_id, template_id: t.id, run_date: date })
      .onConflict((oc) => oc.columns(['template_id', 'run_date']).doNothing())
      .execute();
    const run = await ctx.db.selectFrom('checklist_runs').selectAll().where('template_id', '=', t.id).where('run_date', '=', date).executeTakeFirstOrThrow();
    const done = Object.keys(run.completed ?? {}).filter((k) => t.items.some((i) => i.id === k)).length;
    out.push({
      runId: run.id,
      templateId: t.id,
      shopId: t.shop_id,
      shopName: t.shop_name,
      name: t.name,
      date,
      items: t.items.map((i) => {
        const done = run.completed?.[i.id] ?? null;
        return { ...i, done: done ? { ...done, photoUrl: done.photoId ? attachmentUrl(done.photoId) : null } : null };
      }),
      done,
      total: t.items.length,
      completedAt: run.completed_at?.toISOString() ?? null,
    });
  }
  return out;
}

export async function toggleChecklistItem(ctx: Ctx, tenantId: string, runId: string, itemId: string, user: { id: string; name: string }, done: boolean, photoId?: string) {
  return ctx.db.transaction().execute(async (trx) => {
    const run = await trx.selectFrom('checklist_runs').selectAll().where('id', '=', runId).where('tenant_id', '=', tenantId).forUpdate().executeTakeFirst();
    if (!run) throw notFound('Checklist');
    const tpl = await trx.selectFrom('checklist_templates').select('items').where('id', '=', run.template_id).executeTakeFirstOrThrow();
    const item = tpl.items.find((i) => i.id === itemId);
    if (!item) throw notFound('Checklist item');
    if (done && item.photoRequired && !photoId) throw badRequest('This item needs a photo');
    if (done && photoId) await linkToChecklist({ ...ctx, db: trx }, photoId, { id: runId, tenantId }, itemId, user.id);
    const completed: Record<string, ChecklistCompletion> = { ...(run.completed ?? {}) };
    if (done) completed[itemId] = { by: user.id, byName: user.name, at: ctx.now().toISOString(), ...(photoId ? { photoId } : {}) };
    else delete completed[itemId];
    const allDone = tpl.items.every((i) => completed[i.id]);
    const updated = await trx
      .updateTable('checklist_runs')
      .set({ completed: json(completed), completed_at: allDone ? (run.completed_at ?? ctx.now()) : null })
      .where('id', '=', runId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.bus.publish(channels.tenant(tenantId), 'checklist.updated', { runId, done: Object.keys(completed).length, total: tpl.items.length });
    return updated;
  });
}
