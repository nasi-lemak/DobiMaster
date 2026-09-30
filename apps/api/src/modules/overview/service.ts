import type { Ctx } from '../../context.js';
import { localParts, startOfLocalDay } from '../../lib/time.js';
import { utilisation } from '../analytics/service.js';

/**
 * The owner's first screen: what is happening right now across branches, and what needs action.
 * No vanity metrics — every number is either "state now" or "needs you".
 */
export async function ownerOverview(ctx: Ctx, tenantId: string, shopIds: string[], canSeeRevenue: boolean) {
  const now = ctx.now();
  if (!shopIds.length) return { branches: [], totals: null, attention: [] };
  const shops = await ctx.db.selectFrom('shops').select(['id', 'name', 'slug', 'timezone']).where('tenant_id', '=', tenantId).where('id', 'in', shopIds).orderBy('name').execute();
  const machines = await ctx.db
    .selectFrom('machines')
    .select(['id', 'shop_id', 'code', 'type', 'state', 'state_source', 'state_since', 'observation'])
    .where('tenant_id', '=', tenantId)
    .where('shop_id', 'in', shopIds)
    .where('deleted_at', 'is', null)
    .execute();
  const tz = shops[0]?.timezone ?? 'Asia/Kuala_Lumpur';
  const dayStart = startOfLocalDay(now, tz);
  const util = await utilisation(ctx, tenantId, shopIds, dayStart, now);

  const todayCycles = await ctx.db
    .selectFrom('cycles')
    .select(['shop_id', 'price_sen', 'source'])
    .where('tenant_id', '=', tenantId)
    .where('shop_id', 'in', shopIds)
    .where('started_at', '>=', dayStart)
    .where('status', 'in', ['running', 'finished', 'collected'])
    .execute();
  const appToday = await ctx.db
    .selectFrom('payments')
    .select(['shop_id', 'amount_sen', 'refunded_sen'])
    .where('tenant_id', '=', tenantId)
    .where('shop_id', 'in', shopIds)
    .where('succeeded_at', '>=', dayStart)
    .execute();

  const openTickets = await ctx.db
    .selectFrom('tickets')
    .select(['id', 'ref', 'shop_id', 'machine_id', 'title', 'severity', 'created_at', 'status'])
    .where('tenant_id', '=', tenantId)
    .where('shop_id', 'in', shopIds)
    .where('status', 'in', ['open', 'in_progress'])
    .orderBy('created_at', 'desc')
    .execute();
  const pendingRefunds = await ctx.db
    .selectFrom('refunds')
    .select(['id', 'shop_id', 'amount_sen', 'created_at', 'ticket_id'])
    .where('tenant_id', '=', tenantId)
    .where('shop_id', 'in', shopIds)
    .where('status', 'in', ['requested', 'failed'])
    .execute();
  const alerts = await ctx.db
    .selectFrom('alerts')
    .select(['id', 'shop_id', 'machine_id', 'kind', 'severity', 'message', 'created_at', 'status'])
    .where('tenant_id', '=', tenantId)
    .where((eb) => eb.or([eb('shop_id', 'in', shopIds), eb('shop_id', 'is', null)]))
    .where('status', '=', 'open')
    .orderBy('created_at', 'desc')
    .execute();
  const checklists = await ctx.db
    .selectFrom('checklist_templates as t')
    .leftJoin('checklist_runs as r', (j) => j.onRef('r.template_id', '=', 't.id').on('r.run_date', '=', localParts(now, tz).date))
    .select(['t.id', 't.shop_id', 't.name', 'r.completed_at'])
    .where('t.tenant_id', '=', tenantId)
    .where('t.shop_id', 'in', shopIds)
    .where('t.active', '=', true)
    .execute();

  const shopName = new Map(shops.map((s) => [s.id, s.name]));
  const branches = shops.map((s) => {
    const ms = machines.filter((m) => m.shop_id === s.id);
    const count = (st: string) => ms.filter((m) => m.state === st).length;
    const u = util.byShop.find((b) => b.key === s.id);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      machines: ms.length,
      sensorCoverage: ms.length ? ms.filter((m) => m.observation !== 'none').length / ms.length : 0,
      running: count('running'),
      finished: count('finished'),
      available: count('available'),
      offline: count('offline'),
      fault: count('fault'),
      maintenance: count('maintenance') + count('disabled'),
      openTickets: openTickets.filter((t) => t.shop_id === s.id).length,
      utilisationToday: u?.utilisation ?? 0,
      cyclesToday: todayCycles.filter((c) => c.shop_id === s.id).length,
      ...(canSeeRevenue
        ? {
            estRevenueTodaySen: todayCycles.filter((c) => c.shop_id === s.id).reduce((a, c) => a + (c.price_sen ?? 0), 0),
            appRevenueTodaySen: appToday.filter((p) => p.shop_id === s.id).reduce((a, p) => a + p.amount_sen - p.refunded_sen, 0),
          }
        : {}),
    };
  });

  type Attention = { kind: string; severity: 'high' | 'medium' | 'low'; title: string; shopId: string | null; shopName: string | null; link: string; at: string };
  const attention: Attention[] = [];
  const faultMachines = machines.filter((m) => m.state === 'fault' || m.state === 'offline');
  for (const m of faultMachines) {
    attention.push({
      kind: `machine_${m.state}`,
      severity: m.state === 'fault' ? 'high' : 'medium',
      title: m.state === 'fault' ? `${m.code} is reported faulty` : `${m.code}: sensor offline — check power / Wi-Fi (machine may still work on coins)`,
      shopId: m.shop_id,
      shopName: shopName.get(m.shop_id) ?? null,
      link: `/owner/machines/${m.id}`,
      at: m.state_since.toISOString(),
    });
  }
  for (const t of openTickets.filter((x) => x.status === 'open')) {
    attention.push({ kind: 'ticket', severity: t.severity, title: `#${t.ref} ${t.title}`, shopId: t.shop_id, shopName: shopName.get(t.shop_id) ?? null, link: `/owner/tickets/${t.id}`, at: t.created_at.toISOString() });
  }
  for (const r of pendingRefunds) {
    attention.push({ kind: 'refund', severity: 'medium', title: `Refund RM ${(r.amount_sen / 100).toFixed(2)} awaiting decision`, shopId: r.shop_id, shopName: shopName.get(r.shop_id) ?? null, link: `/owner/refunds`, at: r.created_at.toISOString() });
  }
  for (const a of alerts) {
    if (a.kind === 'device_offline' && faultMachines.some((m) => m.id === a.machine_id)) continue; // already listed
    attention.push({ kind: `alert_${a.kind}`, severity: a.severity, title: a.message, shopId: a.shop_id, shopName: a.shop_id ? (shopName.get(a.shop_id) ?? null) : null, link: `/owner/alerts`, at: a.created_at.toISOString() });
  }
  if (localParts(now, tz).hour >= 12) {
    for (const c of checklists.filter((x) => !x.completed_at)) {
      attention.push({ kind: 'checklist', severity: 'low', title: `Checklist "${c.name}" not completed today`, shopId: c.shop_id, shopName: shopName.get(c.shop_id) ?? null, link: `/owner/checklists`, at: dayStart.toISOString() });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  attention.sort((a, b) => rank[a.severity] - rank[b.severity] || b.at.localeCompare(a.at));

  const sum = (k: keyof (typeof branches)[number]) => branches.reduce((s, b) => s + (Number(b[k]) || 0), 0);
  const totalOpenMin = util.byShop.reduce((s, b) => s + b.openMin, 0);
  return {
    branches,
    totals: {
      machines: machines.length,
      running: sum('running'),
      offline: sum('offline'),
      fault: sum('fault'),
      openTickets: openTickets.length,
      pendingRefunds: pendingRefunds.length,
      cyclesToday: sum('cyclesToday'),
      utilisationToday: totalOpenMin > 0 ? util.byShop.reduce((s, b) => s + b.busyMin, 0) / totalOpenMin : 0,
      ...(canSeeRevenue ? { estRevenueTodaySen: sum('estRevenueTodaySen'), appRevenueTodaySen: sum('appRevenueTodaySen') } : {}),
    },
    attention,
  };
}
