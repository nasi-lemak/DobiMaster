import type { MachineType, OpeningHours } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { localDateToUtc, localParts, tzOffsetMs } from '../../lib/time.js';
import { raiseAlert, resolveAlert } from '../alerts/service.js';

/**
 * Analytics are computed in TypeScript from raw cycles/collections/payments. That is fine for
 * hundreds of machines × a few months; beyond that add hourly rollup tables (docs/04-business.md).
 *
 * Revenue has two honest measures:
 *  - recorded:  cash collections + app payments (net of refunds) — real money, coarse in time for cash
 *  - estimated: Σ program price of recorded cycles — fine-grained, but only as complete as cycle data
 */

export interface ShopLite {
  id: string;
  name: string;
  timezone: string;
  opening_hours: OpeningHours;
}
export interface MachineLite {
  id: string;
  shop_id: string;
  code: string;
  type: MachineType;
  capacity_kg: string;
  purchase_cost_sen: number | null;
  observation: string;
  admin_state: string;
}
interface CycleLite {
  machine_id: string;
  shop_id: string;
  source: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  expected_end_at: Date;
  price_sen: number | null;
  duration_min: number;
}

const HOUR = 3600_000;

/**
 * Never measure utilisation over time before we had any data for the shops (e.g. "last 90 days" on a
 * shop onboarded 3 weeks ago would otherwise look ~4× emptier than it is).
 */
export async function dataStart(ctx: Ctx, shopIds: string[], from: Date): Promise<Date> {
  if (!shopIds.length) return from;
  const r = await ctx.db.selectFrom('cycles').select((eb) => eb.fn.min('started_at').as('first')).where('shop_id', 'in', shopIds).executeTakeFirst();
  const first = r?.first ? new Date(r.first as unknown as string) : null;
  return first && first > from ? first : from;
}

export async function loadScope(ctx: Ctx, tenantId: string, shopIds: string[]) {
  if (shopIds.length === 0) return { shops: [] as ShopLite[], machines: [] as MachineLite[] };
  const shops = await ctx.db
    .selectFrom('shops')
    .select(['id', 'name', 'timezone', 'opening_hours'])
    .where('tenant_id', '=', tenantId)
    .where('id', 'in', shopIds)
    .execute();
  const machines = await ctx.db
    .selectFrom('machines')
    .select(['id', 'shop_id', 'code', 'type', 'capacity_kg', 'purchase_cost_sen', 'observation', 'admin_state'])
    .where('tenant_id', '=', tenantId)
    .where('shop_id', 'in', shopIds)
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .orderBy('code')
    .execute();
  return { shops, machines };
}

async function loadCycles(ctx: Ctx, shopIds: string[], from: Date, to: Date): Promise<CycleLite[]> {
  if (!shopIds.length) return [];
  return ctx.db
    .selectFrom('cycles')
    .select(['machine_id', 'shop_id', 'source', 'status', 'started_at', 'ended_at', 'expected_end_at', 'price_sen', 'duration_min'])
    .where('shop_id', 'in', shopIds)
    .where('status', 'in', ['running', 'finished', 'collected'])
    .where('started_at', '<', to)
    .where('started_at', '>=', new Date(from.getTime() - 4 * HOUR))
    .execute();
}

function cycleInterval(c: CycleLite, now: Date): [number, number] {
  const end = c.ended_at ?? (c.status === 'running' ? new Date(Math.min(now.getTime(), c.expected_end_at.getTime())) : c.expected_end_at);
  return [c.started_at.getTime(), Math.max(c.started_at.getTime(), end.getTime())];
}

/** Open intervals (UTC ms) of a shop overlapping [from, to). */
export function openIntervals(shop: ShopLite, from: Date, to: Date): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let day = localParts(new Date(from.getTime() - 24 * HOUR), shop.timezone).date;
  for (let guard = 0; guard < 800; guard++) {
    const dayStart = localDateToUtc(day, shop.timezone).getTime();
    if (dayStart >= to.getTime()) break;
    const dow = localParts(new Date(dayStart + 12 * HOUR), shop.timezone).isoDow;
    const hours = shop.opening_hours;
    const today = hours[String(dow) as keyof OpeningHours];
    if (today) {
      // Only this day's own interval (overnight tail belongs to this day's start).
      const [o, c] = [toMin(today.open), toMin(today.close)];
      const s = dayStart + o * 60_000;
      const e = dayStart + (c > o ? c : c + 24 * 60) * 60_000;
      const cs = Math.max(s, from.getTime());
      const ce = Math.min(e, to.getTime());
      if (ce > cs) out.push([cs, ce]);
    }
    day = localParts(new Date(dayStart + 36 * HOUR), shop.timezone).date;
  }
  return mergeIntervals(out);
}

function toMin(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

function mergeIntervals(list: Array<[number, number]>) {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const iv of sorted) {
    const last = out.at(-1);
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([...iv]);
  }
  return out;
}

const totalMs = (ivs: Array<[number, number]>) => ivs.reduce((s, [a, b]) => s + (b - a), 0);

function overlapMs(a: [number, number], b: [number, number]) {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

/** Split [a,b) into pieces at local-hour boundaries, calling fn(hourStartMs, ms). */
function forEachLocalHour(a: number, b: number, tz: string, fn: (hourStart: number, ms: number) => void) {
  let t = a;
  while (t < b) {
    const off = tzOffsetMs(new Date(t), tz);
    const hourStart = Math.floor((t + off) / HOUR) * HOUR - off;
    const next = Math.min(b, hourStart + HOUR);
    fn(hourStart, next - t);
    t = next;
  }
}

export const classKey = (m: Pick<MachineLite, 'type' | 'capacity_kg'>) => `${m.type}:${Number(m.capacity_kg)}`;

// ---------------------------------------------------------------------------------------------

export async function utilisation(ctx: Ctx, tenantId: string, shopIds: string[], requestedFrom: Date, to: Date) {
  const now = ctx.now();
  const from = await dataStart(ctx, shopIds, requestedFrom);
  const end = new Date(Math.min(to.getTime(), now.getTime()));
  const { shops, machines } = await loadScope(ctx, tenantId, shopIds);
  const cycles = await loadCycles(ctx, shopIds, from, end);
  const shopById = new Map(shops.map((s) => [s.id, s]));
  const openByShop = new Map(shops.map((s) => [s.id, openIntervals(s, from, end)]));

  const perMachine = machines.map((m) => {
    const open = openByShop.get(m.shop_id) ?? [];
    const openMin = totalMs(open) / 60_000;
    const mine = cycles.filter((c) => c.machine_id === m.id);
    let busyMs = 0;
    let started = 0;
    let estSen = 0;
    for (const c of mine) {
      const iv = cycleInterval(c, now);
      busyMs += overlapMs(iv, [from.getTime(), end.getTime()]);
      if (c.started_at >= from && c.started_at < end) {
        started++;
        estSen += c.price_sen ?? 0;
      }
    }
    return {
      machineId: m.id,
      shopId: m.shop_id,
      shopName: shopById.get(m.shop_id)?.name ?? '',
      code: m.code,
      type: m.type,
      capacityKg: Number(m.capacity_kg),
      observed: m.observation !== 'none',
      cycles: started,
      busyMin: Math.round(busyMs / 60_000),
      openMin: Math.round(openMin),
      utilisation: openMin > 0 ? Math.min(1, busyMs / 60_000 / openMin) : 0,
      estimatedRevenueSen: estSen,
    };
  });

  const group = (key: (r: (typeof perMachine)[number]) => string) => {
    const map = new Map<string, { key: string; machines: number; cycles: number; busyMin: number; openMin: number; estimatedRevenueSen: number }>();
    for (const r of perMachine) {
      const k = key(r);
      const g = map.get(k) ?? { key: k, machines: 0, cycles: 0, busyMin: 0, openMin: 0, estimatedRevenueSen: 0 };
      g.machines++;
      g.cycles += r.cycles;
      g.busyMin += r.busyMin;
      g.openMin += r.openMin;
      g.estimatedRevenueSen += r.estimatedRevenueSen;
      map.set(k, g);
    }
    return [...map.values()].map((g) => ({ ...g, utilisation: g.openMin > 0 ? g.busyMin / g.openMin : 0 }));
  };

  return {
    from: from.toISOString(),
    to: end.toISOString(),
    machines: perMachine,
    byType: group((r) => r.type),
    byCapacity: group((r) => `${r.type}:${r.capacityKg}`),
    byShop: group((r) => r.shopId),
    sources: sourcesSummary(cycles),
  };
}

function sourcesSummary(cycles: CycleLite[]) {
  const counts: Record<string, number> = {};
  for (const c of cycles) counts[c.source] = (counts[c.source] ?? 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------------------------

/** Day-of-week × hour matrix of average fraction of machines busy (only hours the shop was open). */
export async function peakHours(ctx: Ctx, tenantId: string, shopIds: string[], requestedFrom: Date, to: Date, type?: MachineType) {
  const now = ctx.now();
  const from = await dataStart(ctx, shopIds, requestedFrom);
  const end = new Date(Math.min(to.getTime(), now.getTime()));
  const { shops, machines: allMachines } = await loadScope(ctx, tenantId, shopIds);
  const machines = type ? allMachines.filter((m) => m.type === type) : allMachines;
  const ids = new Set(machines.map((m) => m.id));
  const cycles = (await loadCycles(ctx, shopIds, from, end)).filter((c) => ids.has(c.machine_id));
  const busy = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const capacity = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

  for (const shop of shops) {
    const nMachines = machines.filter((m) => m.shop_id === shop.id).length;
    if (!nMachines) continue;
    for (const iv of openIntervals(shop, from, end)) {
      forEachLocalHour(iv[0], iv[1], shop.timezone, (hs, ms) => {
        const p = localParts(new Date(hs), shop.timezone);
        capacity[p.isoDow - 1]![p.hour]! += (nMachines * ms) / 60_000;
      });
    }
    for (const c of cycles.filter((x) => x.shop_id === shop.id)) {
      const [a, b] = cycleInterval(c, now);
      const s = Math.max(a, from.getTime());
      const e = Math.min(b, end.getTime());
      if (e <= s) continue;
      forEachLocalHour(s, e, shop.timezone, (hs, ms) => {
        const p = localParts(new Date(hs), shop.timezone);
        busy[p.isoDow - 1]![p.hour]! += ms / 60_000;
      });
    }
  }
  const matrix = busy.map((row, d) => row.map((v, h) => (capacity[d]![h]! > 0 ? Math.min(1, v / capacity[d]![h]!) : null)));
  return { matrix, cycles: cycles.length };
}

// ---------------------------------------------------------------------------------------------

export type RevenueGroup = 'day' | 'week' | 'month' | 'hour' | 'shop' | 'machine' | 'type' | 'capacity';

export async function revenue(ctx: Ctx, tenantId: string, shopIds: string[], from: Date, to: Date, groupBy: RevenueGroup) {
  const { shops, machines } = await loadScope(ctx, tenantId, shopIds);
  const shopById = new Map(shops.map((s) => [s.id, s]));
  const machineById = new Map(machines.map((m) => [m.id, m]));
  const tz = shops[0]?.timezone ?? 'Asia/Kuala_Lumpur';

  const cash = shopIds.length
    ? await ctx.db
        .selectFrom('collection_lines as l')
        .innerJoin('collections as c', 'c.id', 'l.collection_id')
        .select(['c.collected_at as at', 'c.shop_id', 'l.machine_id', 'l.amount_sen'])
        .where('c.tenant_id', '=', tenantId)
        .where('c.shop_id', 'in', shopIds)
        .where('c.collected_at', '>=', from)
        .where('c.collected_at', '<', to)
        .execute()
    : [];
  const app = shopIds.length
    ? await ctx.db
        .selectFrom('payments')
        .select(['succeeded_at as at', 'shop_id', 'machine_id', 'amount_sen', 'refunded_sen'])
        .where('tenant_id', '=', tenantId)
        .where('shop_id', 'in', shopIds)
        .where('succeeded_at', 'is not', null)
        .where('succeeded_at', '>=', from)
        .where('succeeded_at', '<', to)
        .execute()
    : [];
  const cycles = (await loadCycles(ctx, shopIds, from, to)).filter((c) => c.started_at >= from);

  const keyOf = (at: Date, shopId: string, machineId: string): { key: string; label: string } => {
    const m = machineById.get(machineId);
    const p = localParts(at, shopById.get(shopId)?.timezone ?? tz);
    switch (groupBy) {
      case 'day':
        return { key: p.date, label: p.date };
      case 'week': {
        const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - (p.isoDow - 1)));
        const k = monday.toISOString().slice(0, 10);
        return { key: k, label: `Week of ${k}` };
      }
      case 'month':
        return { key: p.date.slice(0, 7), label: p.date.slice(0, 7) };
      case 'hour':
        return { key: String(p.hour).padStart(2, '0'), label: `${String(p.hour).padStart(2, '0')}:00` };
      case 'shop':
        return { key: shopId, label: shopById.get(shopId)?.name ?? shopId };
      case 'machine':
        return { key: machineId, label: `${shopById.get(shopId)?.name ?? ''} · ${m?.code ?? '?'}` };
      case 'type':
        return { key: m?.type ?? 'unknown', label: m?.type ?? 'unknown' };
      case 'capacity':
        return { key: m ? classKey(m) : 'unknown', label: m ? `${m.type} ${Number(m.capacity_kg)} kg` : 'unknown' };
    }
  };

  const rows = new Map<string, { key: string; label: string; code?: string; shopName?: string; cashSen: number; appSen: number; estimatedSen: number; cycles: number }>();
  const row = (k: { key: string; label: string }) => {
    let r = rows.get(k.key);
    if (!r) {
      const m = groupBy === 'machine' ? machineById.get(k.key) : undefined;
      const extra = m ? { code: m.code, shopName: shopById.get(m.shop_id)?.name ?? '' } : {};
      rows.set(k.key, (r = { ...k, ...extra, cashSen: 0, appSen: 0, estimatedSen: 0, cycles: 0 }));
    }
    return r;
  };
  // Cash is collected in bulk; bucketing it by hour would be fiction.
  if (groupBy !== 'hour') for (const c of cash) row(keyOf(c.at, c.shop_id, c.machine_id)).cashSen += c.amount_sen;
  for (const p of app) row(keyOf(p.at!, p.shop_id, p.machine_id)).appSen += p.amount_sen - p.refunded_sen;
  for (const c of cycles) {
    const r = row(keyOf(c.started_at, c.shop_id, c.machine_id));
    r.estimatedSen += c.price_sen ?? 0;
    r.cycles++;
  }
  const out = [...rows.values()]
    .map((r) => ({ ...r, recordedSen: r.cashSen + r.appSen }))
    .sort((a, b) => (['day', 'week', 'month', 'hour'].includes(groupBy) ? a.key.localeCompare(b.key) : b.recordedSen + b.estimatedSen - (a.recordedSen + a.estimatedSen)));
  return {
    groupBy,
    rows: out,
    totals: {
      cashSen: out.reduce((s, r) => s + r.cashSen, 0),
      appSen: out.reduce((s, r) => s + r.appSen, 0),
      recordedSen: out.reduce((s, r) => s + r.recordedSen, 0),
      estimatedSen: out.reduce((s, r) => s + r.estimatedSen, 0),
      cycles: out.reduce((s, r) => s + r.cycles, 0),
    },
    note:
      groupBy === 'hour'
        ? 'Hourly figures are estimated from recorded cycles × list price (cash is collected in bulk).'
        : 'Recorded = cash collections + app payments (net of refunds). Estimated = recorded cycles × list price.',
  };
}

// ---------------------------------------------------------------------------------------------

const DEFAULT_MACHINE_COST_SEN: Record<MachineType, number> = { washer: 1_800_000, dryer: 1_400_000 };
const SATURATION_THRESHOLD = 0.8;
const CAPTURE_RATE = 0.6;
/** Saturated hours per week above which an extra machine is worth considering. */
const SATURATED_HOURS_PER_WEEK = 4;

/**
 * "Should I buy another washer/dryer?" per capacity class. Saturated hour = an open hour in which the class
 * was ≥ 80% busy (customers likely waited or left). Extra revenue from one more machine ≈ saturated hours ×
 * cycles/hour × price × 60% capture. Deliberately simple and shown to the owner with its formula.
 */
export async function capacityInsight(ctx: Ctx, tenantId: string, shopId: string, requestedFrom: Date, to: Date) {
  const now = ctx.now();
  const from = await dataStart(ctx, [shopId], requestedFrom);
  const end = new Date(Math.min(to.getTime(), now.getTime()));
  const { shops, machines } = await loadScope(ctx, tenantId, [shopId]);
  const shop = shops[0];
  if (!shop) return { classes: [] };
  const cycles = await loadCycles(ctx, [shopId], from, end);
  const open = openIntervals(shop, from, end);
  const openHours = totalMs(open) / HOUR;
  const windowDays = Math.max(1, (end.getTime() - from.getTime()) / (24 * HOUR));

  const classes = new Map<string, MachineLite[]>();
  for (const m of machines.filter((x) => x.admin_state !== 'disabled')) {
    const k = classKey(m);
    classes.set(k, [...(classes.get(k) ?? []), m]);
  }

  const out = [];
  for (const [key, ms] of classes) {
    const ids = new Set(ms.map((m) => m.id));
    const cs = cycles.filter((c) => ids.has(c.machine_id));
    const hourBusy = new Map<number, number>();
    let busyMin = 0;
    for (const c of cs) {
      const [a, b] = cycleInterval(c, now);
      for (const iv of open) {
        const s = Math.max(a, iv[0]);
        const e = Math.min(b, iv[1]);
        if (e <= s) continue;
        busyMin += (e - s) / 60_000;
        forEachLocalHour(s, e, shop.timezone, (hs, msv) => hourBusy.set(hs, (hourBusy.get(hs) ?? 0) + msv / 60_000));
      }
    }
    const perHour = [...hourBusy.values()].map((v) => Math.min(1, v / (ms.length * 60)));
    const saturatedHours = perHour.filter((f) => f >= SATURATION_THRESHOLD).length;
    const util = openHours > 0 ? busyMin / (ms.length * openHours * 60) : 0;
    const started = cs.filter((c) => c.started_at >= from);
    const avgPrice = started.length ? started.reduce((s, c) => s + (c.price_sen ?? 0), 0) / started.length : 0;
    const avgDur = started.length ? started.reduce((s, c) => s + c.duration_min, 0) / started.length : 40;
    const estRevenuePerMachineMonth = (started.reduce((s, c) => s + (c.price_sen ?? 0), 0) / ms.length) * (30 / windowDays);
    const saturatedPerMonth = saturatedHours * (30 / windowDays);
    const extraMonthly = saturatedPerMonth * (60 / Math.max(10, avgDur)) * avgPrice * CAPTURE_RATE;
    const costs = ms.map((m) => m.purchase_cost_sen).filter((x): x is number => !!x);
    const machineCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : DEFAULT_MACHINE_COST_SEN[ms[0]!.type];
    const saturationShare = openHours > 0 ? saturatedHours / openHours : 0;
    const saturatedPerWeek = saturatedHours * (7 / windowDays);
    const recommendation =
      cs.length < 20 ? 'insufficient_data' : saturatedPerWeek >= SATURATED_HOURS_PER_WEEK && util >= 0.4 ? 'consider_adding' : util < 0.2 ? 'over_capacity' : 'balanced';
    out.push({
      key,
      type: ms[0]!.type,
      capacityKg: Number(ms[0]!.capacity_kg),
      machines: ms.length,
      cycles: started.length,
      utilisation: util,
      peakHourUtilisation: perHour.length ? Math.max(...perHour) : 0,
      saturatedHours,
      saturationShare,
      saturatedHoursPerWeek: Math.round(saturatedPerWeek * 10) / 10,
      estRevenuePerMachineMonthSen: Math.round(estRevenuePerMachineMonth),
      estExtraRevenuePerMonthSen: Math.round(extraMonthly),
      assumedMachineCostSen: Math.round(machineCost),
      paybackMonths: extraMonthly > 0 ? Math.round((machineCost / extraMonthly) * 10) / 10 : null,
      recommendation,
    });
  }
  out.sort((a, b) => a.type.localeCompare(b.type) || a.capacityKg - b.capacityKg);
  return {
    from: from.toISOString(),
    classes: out,
    openHours: Math.round(openHours),
    assumptions: { saturationThreshold: SATURATION_THRESHOLD, captureRate: CAPTURE_RATE, saturatedHoursPerWeek: SATURATED_HOURS_PER_WEEK },
  };
}

// ---------------------------------------------------------------------------------------------

/**
 * Flags machines used far less than their peers (same shop + type): a jammed coin mechanism,
 * tripped breaker or broken burner often shows up only as "nobody used it".
 */
export async function lowUsage(ctx: Ctx, tenantId: string, shopIds: string[], days = 7) {
  const to = ctx.now();
  const from = new Date(to.getTime() - days * 24 * HOUR);
  const u = await utilisation(ctx, tenantId, shopIds, from, to);
  const last24 = new Date(to.getTime() - 24 * HOUR);
  const recent = await loadCycles(ctx, shopIds, last24, to);
  const flagged = [];
  for (const m of u.machines) {
    const peers = u.machines.filter((p) => p.shopId === m.shopId && p.type === m.type && p.machineId !== m.machineId);
    if (peers.length === 0) continue;
    const peerAvg = peers.reduce((s, p) => s + p.cycles, 0) / peers.length;
    const recentMine = recent.filter((c) => c.machine_id === m.machineId && c.started_at >= last24).length;
    const recentPeerAvg = peers.reduce((s, p) => s + recent.filter((c) => c.machine_id === p.machineId && c.started_at >= last24).length, 0) / peers.length;
    if (peerAvg >= 5 && m.cycles < 0.35 * peerAvg) {
      flagged.push({ ...m, peerAvgCycles: Math.round(peerAvg * 10) / 10, reason: 'far_below_peers' as const });
    } else if (recentPeerAvg >= 3 && recentMine === 0) {
      flagged.push({ ...m, peerAvgCycles: Math.round(recentPeerAvg * 10) / 10, reason: 'silent_24h' as const });
    }
  }
  return { days, flagged };
}

export async function sweepLowUsage(ctx: Ctx) {
  const tenants = await ctx.db.selectFrom('tenants').select('id').execute();
  for (const t of tenants) {
    const shops = await ctx.db.selectFrom('shops').select('id').where('tenant_id', '=', t.id).execute();
    const res = await lowUsage(ctx, t.id, shops.map((s) => s.id));
    const flaggedIds = new Set(res.flagged.map((f) => f.machineId));
    for (const f of res.flagged) {
      await raiseAlert(ctx, {
        tenantId: t.id,
        shopId: f.shopId,
        machineId: f.machineId,
        kind: 'low_usage',
        severity: f.reason === 'silent_24h' ? 'medium' : 'low',
        message:
          f.reason === 'silent_24h'
            ? `${f.shopName} · ${f.code}: no cycles in 24 h while similar machines averaged ${f.peerAvgCycles} — check coin mechanism / power`
            : `${f.shopName} · ${f.code}: ${f.cycles} cycles in ${res.days} days vs peer average ${f.peerAvgCycles}`,
        dedupeKey: `low_usage:${f.machineId}`,
      });
    }
    const open = await ctx.db.selectFrom('alerts').select(['dedupe_key', 'machine_id']).where('tenant_id', '=', t.id).where('kind', '=', 'low_usage').where('status', '<>', 'resolved').execute();
    for (const a of open) if (a.machine_id && !flaggedIds.has(a.machine_id)) await resolveAlert(ctx, t.id, a.dedupe_key);
  }
}

