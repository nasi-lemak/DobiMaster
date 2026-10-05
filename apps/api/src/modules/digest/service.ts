import { ROLE_PERMISSIONS, type Role } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { config } from '../../config.js';
import { localDateToUtc, localParts } from '../../lib/time.js';
import { lowUsage, utilisation } from '../analytics/service.js';
import { reconciliation } from '../collections/service.js';
import { maintenanceDue } from '../maintenance/service.js';

/**
 * The weekly summary that keeps owners engaged without opening the dashboard:
 * what happened last week, how it compares, and the few things that need them.
 */

const HOUR = 3600_000;
const UNUSABLE = ['fault', 'maintenance', 'disabled'] as const;

export interface DigestAction {
  severity: 'high' | 'medium' | 'low';
  text: string;
  link: string;
}

export interface Digest {
  tenantName: string;
  weekStart: string;
  weekEnd: string;
  partial: boolean;
  includesRevenue: boolean;
  totals: {
    cycles: number;
    cyclesPrev: number;
    estRevenueSen: number | null;
    estRevenuePrevSen: number | null;
    cashSen: number | null;
    appSen: number | null;
    utilisation: number;
    utilisationPrev: number;
    downtimeHours: number;
    sensorOfflineHours: number;
    ticketsOpened: number;
    ticketsResolved: number;
    openTickets: number;
    medianResolveHours: number | null;
    refundsPending: number;
    checklistDone: number;
    checklistExpected: number;
  };
  shops: Array<{ id: string; name: string; cycles: number; cyclesPrev: number; utilisation: number; downtimeHours: number; openTickets: number; checklistDone: number; checklistExpected: number; estRevenueSen: number | null }>;
  actions: DigestAction[];
}

function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Local date (YYYY-MM-DD) of the Monday starting the week that contains `d`. */
export function mondayOf(d: Date, tz: string) {
  const p = localParts(d, tz);
  return addDays(p.date, -(p.isoDow - 1));
}

async function tenantTimezone(ctx: Ctx, tenantId: string) {
  const s = await ctx.db.selectFrom('shops').select('timezone').where('tenant_id', '=', tenantId).orderBy('created_at').executeTakeFirst();
  return s?.timezone ?? 'Asia/Kuala_Lumpur';
}

export async function buildDigest(ctx: Ctx, tenantId: string, shopIds: string[], weekStart: string, includeRevenue: boolean): Promise<Digest> {
  const tenant = await ctx.db.selectFrom('tenants').select('name').where('id', '=', tenantId).executeTakeFirstOrThrow();
  const tz = await tenantTimezone(ctx, tenantId);
  const from = localDateToUtc(weekStart, tz);
  const weekEndDate = addDays(weekStart, 7);
  const to = new Date(Math.min(localDateToUtc(weekEndDate, tz).getTime(), ctx.now().getTime()));
  const prevFrom = localDateToUtc(addDays(weekStart, -7), tz);
  const shops = shopIds.length ? await ctx.db.selectFrom('shops').select(['id', 'name']).where('id', 'in', shopIds).orderBy('name').execute() : [];
  const empty = shopIds.length === 0;

  const [u, uPrev] = await Promise.all([utilisation(ctx, tenantId, shopIds, from, to), utilisation(ctx, tenantId, shopIds, prevFrom, from)]);
  const cyclesByShop = (x: typeof u) => new Map(x.byShop.map((b) => [b.key, b]));
  const cur = cyclesByShop(u);
  const prev = cyclesByShop(uPrev);

  // Downtime from state intervals overlapping the week.
  const stateRows = empty
    ? []
    : await ctx.db
        .selectFrom('machine_state_log as l')
        .innerJoin('machines as m', 'm.id', 'l.machine_id')
        .select(['l.machine_id', 'l.shop_id', 'l.state', 'l.started_at', 'l.ended_at', 'l.reason', 'm.code'])
        .where('l.shop_id', 'in', shopIds)
        .where('l.state', 'in', [...UNUSABLE, 'offline' as const])
        .where('l.started_at', '<', to)
        .where((eb) => eb.or([eb('l.ended_at', 'is', null), eb('l.ended_at', '>', from)]))
        .execute();
  const downByMachine = new Map<string, { hours: number; shopId: string; code: string; reason: string | null; state: string }>();
  let sensorOfflineHours = 0;
  for (const r of stateRows) {
    const h = (Math.min((r.ended_at ?? to).getTime(), to.getTime()) - Math.max(r.started_at.getTime(), from.getTime())) / HOUR;
    if (h <= 0) continue;
    if (r.state === 'offline') {
      sensorOfflineHours += h;
      continue;
    }
    const d = downByMachine.get(r.machine_id) ?? { hours: 0, shopId: r.shop_id, code: r.code, reason: r.reason, state: r.state };
    d.hours += h;
    downByMachine.set(r.machine_id, d);
  }

  const tickets = empty
    ? []
    : await ctx.db
        .selectFrom('tickets')
        .select(['id', 'shop_id', 'status', 'severity', 'created_at', 'resolved_at', 'title'])
        .where('shop_id', 'in', shopIds)
        .where((eb) => eb.or([eb('created_at', '>=', from), eb('resolved_at', '>=', from), eb('status', 'in', ['open', 'in_progress'])]))
        .execute();
  const opened = tickets.filter((t) => t.created_at >= from && t.created_at < to);
  const resolved = tickets.filter((t) => t.resolved_at && t.resolved_at >= from && t.resolved_at < to);
  const openNow = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const resolveHours = resolved.map((t) => (t.resolved_at!.getTime() - t.created_at.getTime()) / HOUR).sort((a, b) => a - b);
  const median = resolveHours.length ? resolveHours[Math.floor(resolveHours.length / 2)]! : null;

  const refundsPending = empty
    ? 0
    : Number(
        (
          await ctx.db
            .selectFrom('refunds')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('shop_id', 'in', shopIds)
            .where('status', 'in', ['requested', 'failed'])
            .executeTakeFirst()
        )?.n ?? 0,
      );

  // Checklists: one run expected per active template per day of the week (so far).
  const templates = empty ? [] : await ctx.db.selectFrom('checklist_templates').select(['id', 'shop_id', 'created_at']).where('shop_id', 'in', shopIds).where('active', '=', true).execute();
  const runs = templates.length
    ? await ctx.db
        .selectFrom('checklist_runs')
        .select(['template_id', 'shop_id'])
        .where('template_id', 'in', templates.map((t) => t.id))
        .where('run_date', '>=', weekStart)
        .where('run_date', '<', weekEndDate)
        .where('completed_at', 'is not', null)
        .execute()
    : [];
  const daysInWeek = Math.max(1, Math.min(7, Math.ceil((to.getTime() - from.getTime()) / (24 * HOUR))));
  const checklistExpectedFor = (shopId?: string) =>
    templates.filter((t) => !shopId || t.shop_id === shopId).reduce((s, t) => s + Math.min(daysInWeek, Math.max(0, Math.ceil((to.getTime() - Math.max(from.getTime(), t.created_at.getTime())) / (24 * HOUR)))), 0);

  const est = async (a: Date, b: Date) => {
    if (!includeRevenue || empty) return null;
    const r = await ctx.db
      .selectFrom('cycles')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('price_sen'), eb.lit(0)).as('s'))
      .where('shop_id', 'in', shopIds)
      .where('status', 'in', ['running', 'finished', 'collected'])
      .where('started_at', '>=', a)
      .where('started_at', '<', b)
      .executeTakeFirst();
    return Number(r?.s ?? 0);
  };
  const cash = includeRevenue && !empty
    ? Number(
        (
          await ctx.db
            .selectFrom('collection_lines as l')
            .innerJoin('collections as c', 'c.id', 'l.collection_id')
            .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('l.amount_sen'), eb.lit(0)).as('s'))
            .where('c.shop_id', 'in', shopIds)
            .where('c.collected_at', '>=', from)
            .where('c.collected_at', '<', to)
            .executeTakeFirst()
        )?.s ?? 0,
      )
    : null;
  const app = includeRevenue && !empty
    ? Number(
        (
          await ctx.db
            .selectFrom('payments')
            .select((eb) => eb.fn.coalesce(eb.fn.sum<string>(eb('amount_sen', '-', eb.ref('refunded_sen'))), eb.lit(0)).as('s'))
            .where('shop_id', 'in', shopIds)
            .where('succeeded_at', '>=', from)
            .where('succeeded_at', '<', to)
            .executeTakeFirst()
        )?.s ?? 0,
      )
    : null;
  const [estCur, estPrev] = await Promise.all([est(from, to), est(prevFrom, from)]);
  const estByShop = new Map<string, number>();
  if (includeRevenue) for (const m of u.machines) estByShop.set(m.shopId, (estByShop.get(m.shopId) ?? 0) + m.estimatedRevenueSen);

  // ---- what needs the owner ----
  const shopName = new Map(shops.map((s) => [s.id, s.name]));
  const actions: DigestAction[] = [];
  const high = openNow.filter((t) => t.severity === 'high');
  if (high.length) actions.push({ severity: 'high', text: `${high.length} urgent report${high.length > 1 ? 's' : ''} still open (e.g. "${high[0]!.title}")`, link: '/owner/tickets' });
  for (const [id, d] of [...downByMachine.entries()].sort((a, b) => b[1].hours - a[1].hours).slice(0, 3)) {
    if (d.hours < 6) continue;
    actions.push({ severity: 'high', text: `${shopName.get(d.shopId)} · ${d.code} unusable for ${Math.round(d.hours)} h${d.reason ? ` ("${d.reason}")` : ''}`, link: `/owner/machines/${id}` });
  }
  if (!empty) {
    const low = await lowUsage(ctx, tenantId, shopIds, 7);
    for (const f of low.flagged.slice(0, 3)) {
      actions.push({
        severity: f.reason === 'silent_24h' ? 'high' : 'medium',
        text: f.reason === 'silent_24h' ? `${f.shopName} · ${f.code}: no cycles in 24 h — check coin mechanism / power` : `${f.shopName} · ${f.code}: ${f.cycles} cycles this week vs ${f.peerAvgCycles} on similar machines`,
        link: `/owner/machines/${f.machineId}`,
      });
    }
  }
  if (refundsPending) actions.push({ severity: 'medium', text: `${refundsPending} refund${refundsPending > 1 ? 's' : ''} waiting for your decision`, link: '/owner/refunds' });
  if (includeRevenue && !empty) {
    const shortfalls = (await reconciliation(ctx, tenantId, shopIds, 200)).filter((r) => r.flag && new Date(r.periodEnd) >= from && new Date(r.periodEnd) < to);
    for (const r of shortfalls.slice(0, 2)) {
      actions.push({ severity: 'medium', text: `${r.shopName} · ${r.code}: collected RM ${(r.collectedSen / 100).toFixed(0)} vs ~RM ${((r.expectedSen ?? 0) / 100).toFixed(0)} expected`, link: '/owner/collections' });
    }
  }
  const due = empty ? [] : (await maintenanceDue(ctx, tenantId, shopIds)).filter((d) => d.status === 'due');
  if (due.length) actions.push({ severity: 'low', text: `${due.length} maintenance task${due.length > 1 ? 's' : ''} due (e.g. ${due[0]!.machineCode}: ${due[0]!.title})`, link: '/owner/maintenance' });
  const expected = checklistExpectedFor();
  if (expected > 0 && runs.length / expected < 0.8) {
    actions.push({ severity: 'low', text: `Cleaning checklists done on ${runs.length} of ${expected} shop-days`, link: '/owner/checklists' });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const totalDown = [...downByMachine.values()].reduce((s, d) => s + d.hours, 0);
  const totOpen = (x: typeof u) => x.byShop.reduce((s, b) => s + b.openMin, 0);
  const totBusy = (x: typeof u) => x.byShop.reduce((s, b) => s + b.busyMin, 0);
  return {
    tenantName: tenant.name,
    weekStart,
    weekEnd: addDays(weekStart, 6),
    partial: to.getTime() < localDateToUtc(weekEndDate, tz).getTime(),
    includesRevenue: includeRevenue,
    totals: {
      cycles: u.byShop.reduce((s, b) => s + b.cycles, 0),
      cyclesPrev: uPrev.byShop.reduce((s, b) => s + b.cycles, 0),
      estRevenueSen: estCur,
      estRevenuePrevSen: estPrev,
      cashSen: cash,
      appSen: app,
      utilisation: totOpen(u) ? totBusy(u) / totOpen(u) : 0,
      utilisationPrev: totOpen(uPrev) ? totBusy(uPrev) / totOpen(uPrev) : 0,
      downtimeHours: Math.round(totalDown),
      sensorOfflineHours: Math.round(sensorOfflineHours),
      ticketsOpened: opened.length,
      ticketsResolved: resolved.length,
      openTickets: openNow.length,
      medianResolveHours: median == null ? null : Math.round(median * 10) / 10,
      refundsPending,
      checklistDone: runs.length,
      checklistExpected: expected,
    },
    shops: shops.map((s) => ({
      id: s.id,
      name: s.name,
      cycles: cur.get(s.id)?.cycles ?? 0,
      cyclesPrev: prev.get(s.id)?.cycles ?? 0,
      utilisation: cur.get(s.id)?.utilisation ?? 0,
      downtimeHours: Math.round([...downByMachine.values()].filter((d) => d.shopId === s.id).reduce((a, d) => a + d.hours, 0)),
      openTickets: openNow.filter((t) => t.shop_id === s.id).length,
      checklistDone: runs.filter((r) => r.shop_id === s.id).length,
      checklistExpected: checklistExpectedFor(s.id),
      estRevenueSen: includeRevenue ? (estByShop.get(s.id) ?? 0) : null,
    })),
    actions: actions.slice(0, 8),
  };
}

// ---- rendering ---------------------------------------------------------------------------------

const rm = (sen: number) => `RM ${Math.round(sen / 100).toLocaleString('en-MY')}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
function change(cur: number, prev: number) {
  if (!prev) return '';
  const d = (cur - prev) / prev;
  return ` (${d >= 0 ? '+' : ''}${Math.round(d * 100)}% vs last week)`;
}
function fmtRange(d: Digest) {
  const f = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f(d.weekStart)} – ${f(d.weekEnd)}`;
}

export function renderDigestText(d: Digest) {
  const t = d.totals;
  const lines = [
    `DobiMaster weekly summary — ${d.tenantName}`,
    `${fmtRange(d)}${d.partial ? ' (so far)' : ''}`,
    '',
    `Cycles: ${t.cycles.toLocaleString('en-MY')}${change(t.cycles, t.cyclesPrev)}`,
    ...(d.includesRevenue && t.estRevenueSen != null ? [`Est. revenue from recorded cycles: ${rm(t.estRevenueSen)}${change(t.estRevenueSen, t.estRevenuePrevSen ?? 0)}`] : []),
    ...(d.includesRevenue && (t.cashSen || t.appSen) ? [`Collected: cash ${rm(t.cashSen ?? 0)} · app ${rm(t.appSen ?? 0)}`] : []),
    `Utilisation: ${pct(t.utilisation)} (last week ${pct(t.utilisationPrev)})`,
    `Machines out of service: ${t.downtimeHours} h${t.sensorOfflineHours ? ` · sensors offline ${t.sensorOfflineHours} h` : ''}`,
    `Reports: ${t.ticketsOpened} new, ${t.ticketsResolved} resolved${t.medianResolveHours != null ? ` (median ${t.medianResolveHours} h)` : ''} · ${t.openTickets} open`,
    ...(t.checklistExpected ? [`Cleaning checklists: ${t.checklistDone}/${t.checklistExpected} done`] : []),
    '',
    d.actions.length ? 'Needs you:' : 'Nothing needs you this week. 🎉',
    ...d.actions.map((a) => `• ${a.text}`),
    '',
    `Open the dashboard: ${config.publicUrl.replace(/\/$/, '')}/owner/digest`,
  ];
  return lines.join('\n');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderDigestHtml(d: Digest) {
  const t = d.totals;
  const base = config.publicUrl.replace(/\/$/, '');
  const row = (label: string, value: string) => `<tr><td style="padding:6px 0;color:#52514e">${esc(label)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(value)}</td></tr>`;
  const sev = { high: '#d03b3b', medium: '#9a3b12', low: '#52514e' };
  return `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b0b0b">
<div style="max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 4px">Weekly summary · ${esc(d.tenantName)}</h1>
<p style="margin:0 0 16px;color:#6f6e69">${esc(fmtRange(d))}${d.partial ? ' (so far)' : ''}</p>
<div style="background:#fff;border:1px solid #e6e5e0;border-radius:14px;padding:16px;margin-bottom:16px">
<h2 style="font-size:15px;margin:0 0 8px">${d.actions.length ? 'Needs you' : 'Nothing needs you this week 🎉'}</h2>
${d.actions.map((a) => `<p style="margin:6px 0"><span style="color:${sev[a.severity]};font-weight:600">${a.severity === 'high' ? '● Urgent' : a.severity === 'medium' ? '▲ Soon' : '○ When you can'}</span> — <a href="${base}${a.link}" style="color:#0f6fb8">${esc(a.text)}</a></p>`).join('')}
</div>
<div style="background:#fff;border:1px solid #e6e5e0;border-radius:14px;padding:16px">
<table style="width:100%;border-collapse:collapse;font-size:14px">
${row('Cycles', `${t.cycles.toLocaleString('en-MY')}${change(t.cycles, t.cyclesPrev)}`)}
${d.includesRevenue && t.estRevenueSen != null ? row('Est. revenue (recorded cycles)', `${rm(t.estRevenueSen)}${change(t.estRevenueSen, t.estRevenuePrevSen ?? 0)}`) : ''}
${d.includesRevenue && (t.cashSen || t.appSen) ? row('Collected (cash · app)', `${rm(t.cashSen ?? 0)} · ${rm(t.appSen ?? 0)}`) : ''}
${row('Utilisation', `${pct(t.utilisation)} (last week ${pct(t.utilisationPrev)})`)}
${row('Machines out of service', `${t.downtimeHours} h`)}
${row('Reports', `${t.ticketsOpened} new · ${t.ticketsResolved} resolved · ${t.openTickets} open`)}
${t.checklistExpected ? row('Cleaning checklists', `${t.checklistDone}/${t.checklistExpected}`) : ''}
</table></div>
<p style="margin:20px 0"><a href="${base}/owner/digest" style="background:#0f6fb8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;display:inline-block">Open dashboard</a></p>
<p style="font-size:12px;color:#6f6e69">You get this every Monday. Turn it off in the dashboard under More → Weekly summary.</p>
</div></body></html>`;
}

// ---- delivery ----------------------------------------------------------------------------------

interface Recipient {
  userId: string;
  email: string;
  name: string;
  role: Role;
  shopIds: string[];
}

async function recipients(ctx: Ctx, tenantId: string, onlyUserId?: string): Promise<Recipient[]> {
  let q = ctx.db
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select(['u.id', 'u.email', 'u.name', 'u.digest_opt_out', 'm.role', 'm.shop_ids'])
    .where('m.tenant_id', '=', tenantId);
  if (onlyUserId) q = q.where('u.id', '=', onlyUserId);
  else q = q.where('m.role', 'in', ['owner', 'manager']).where('u.digest_opt_out', '=', false);
  const rows = await q.execute();
  const all = (await ctx.db.selectFrom('shops').select('id').where('tenant_id', '=', tenantId).execute()).map((s) => s.id);
  return rows.map((r) => ({ userId: r.id, email: r.email, name: r.name, role: r.role, shopIds: r.shop_ids === null ? all : all.filter((id) => r.shop_ids!.includes(id)) }));
}

export async function deliverDigest(ctx: Ctx, tenantId: string, weekStart: string, onlyUserId?: string) {
  const people = await recipients(ctx, tenantId, onlyUserId);
  const cache = new Map<string, Digest>();
  let delivered = 0;
  for (const p of people) {
    const includeRevenue = ROLE_PERMISSIONS[p.role].includes('revenue.view');
    const key = `${[...p.shopIds].sort().join(',')}|${includeRevenue}`;
    let digest = cache.get(key);
    if (!digest) cache.set(key, (digest = await buildDigest(ctx, tenantId, p.shopIds, weekStart, includeRevenue)));
    const text = renderDigestText(digest);
    try {
      await ctx.mail.send({ to: p.email, subject: `Weekly summary · ${digest.tenantName}: ${digest.actions.length ? `${digest.actions.length} thing${digest.actions.length > 1 ? 's' : ''} need you` : 'all good'}`, text, html: renderDigestHtml(digest) });
      delivered++;
    } catch (err) {
      ctx.log.warn({ err, userId: p.userId }, 'digest email failed');
    }
    // WhatsApp: free if the owner messaged us in the last 24 h, otherwise only via an approved template.
    const wa = await ctx.notify.whatsapp.sendInWindow({ userId: p.userId }, text);
    if (wa === 'skipped' && config.whatsapp.digestTemplate) {
      await ctx.notify.whatsapp.sendTemplate({ userId: p.userId }, config.whatsapp.digestTemplate, [
        digest.tenantName,
        String(digest.totals.cycles),
        String(digest.actions.length),
        `${config.publicUrl.replace(/\/$/, '')}/owner/digest`,
      ]);
    }
  }
  return { recipients: people.length, delivered };
}

/** Hourly: on Monday from 08:00 local, send last week's digest once per tenant. */
export async function sweepDigest(ctx: Ctx) {
  const tenants = await ctx.db.selectFrom('tenants').select('id').execute();
  for (const t of tenants) {
    const tz = await tenantTimezone(ctx, t.id);
    const p = localParts(ctx.now(), tz);
    if (p.isoDow !== 1 || p.hour < 8) continue;
    const weekStart = addDays(mondayOf(ctx.now(), tz), -7);
    const claimed = await ctx.db
      .insertInto('digest_log')
      .values({ tenant_id: t.id, week_start: weekStart, sent_at: ctx.now() })
      .onConflict((oc) => oc.columns(['tenant_id', 'week_start']).doNothing())
      .returning('tenant_id')
      .executeTakeFirst();
    if (!claimed) continue;
    try {
      const res = await deliverDigest(ctx, t.id, weekStart);
      await ctx.db.updateTable('digest_log').set({ recipients: res.delivered }).where('tenant_id', '=', t.id).where('week_start', '=', weekStart).execute();
    } catch (err) {
      // Release the claim so the next hourly sweep retries this business, and carry on with the others.
      ctx.log.error({ err, tenantId: t.id }, 'weekly summary failed');
      await ctx.db.deleteFrom('digest_log').where('tenant_id', '=', t.id).where('week_start', '=', weekStart).execute();
    }
  }
}

export { addDays };
