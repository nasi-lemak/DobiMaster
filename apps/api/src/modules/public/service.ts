import { DEFAULT_SHOP_SETTINGS, FAULT_CATEGORIES, type MachineState, type OpeningHours } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import type { Machine, Shop } from '../../db/types.js';
import { isOpenAt, localParts, openIntervalsForDow } from '../../lib/time.js';
import { peakHours } from '../analytics/service.js';
import { payBlocker } from '../payments/service.js';

/** Public machine view — no customer data, ever. */
export function publicMachine(m: Machine, extra: { expectedEndAt: Date | null; openIssues: number; payable: boolean }) {
  return {
    id: m.id,
    code: m.code,
    qrToken: m.qr_token,
    type: m.type,
    capacityKg: Number(m.capacity_kg),
    brand: m.brand,
    programs: m.programs,
    instructions: m.instructions,
    recommendedLoad: m.recommended_load,
    detergentAuto: m.detergent_auto,
    softenerAuto: m.softener_auto,
    state: m.state,
    stateSource: m.state_source,
    stateSince: m.state_since.toISOString(),
    stateReason: m.state === 'maintenance' || m.state === 'disabled' || m.state === 'fault' ? m.admin_reason : null,
    observed: m.observation !== 'none',
    expectedEndAt: extra.expectedEndAt?.toISOString() ?? null,
    openIssues: extra.openIssues,
    payable: extra.payable,
  };
}

async function machineExtras(ctx: Ctx, machines: Machine[]) {
  const ids = machines.map((m) => m.id);
  const cycleIds = machines.map((m) => m.current_cycle_id).filter((x): x is string => !!x);
  const cycles = cycleIds.length
    ? await ctx.db.selectFrom('cycles').select(['id', 'expected_end_at', 'status']).where('id', 'in', cycleIds).execute()
    : [];
  const issues = ids.length
    ? await ctx.db
        .selectFrom('tickets')
        .select(['machine_id', (eb) => eb.fn.countAll<string>().as('n')])
        .where('machine_id', 'in', ids)
        .where('status', 'in', ['open', 'in_progress'])
        .where('category', 'in', [...FAULT_CATEGORIES])
        .where('created_at', '>=', new Date(ctx.now().getTime() - 24 * 3600_000))
        .groupBy('machine_id')
        .execute()
    : [];
  const out = new Map<string, { expectedEndAt: Date | null; openIssues: number; payable: boolean }>();
  for (const m of machines) {
    const c = cycles.find((x) => x.id === m.current_cycle_id);
    out.set(m.id, {
      expectedEndAt: c && c.status === 'running' ? c.expected_end_at : null,
      openIssues: Number(issues.find((i) => i.machine_id === m.id)?.n ?? 0),
      payable: m.control !== 'none' ? (await payBlocker(ctx, m.id)) === null : false,
    });
  }
  return out;
}

/** Truly unusable. 'offline' only means the *sensor* is silent — the machine itself usually still takes coins. */
const UNAVAILABLE: MachineState[] = ['fault', 'maintenance', 'disabled'];

function availability(machines: Machine[], extras: Map<string, { expectedEndAt: Date | null }>) {
  const byType = (type: 'washer' | 'dryer') => {
    const ms = machines.filter((m) => m.type === type);
    const observed = ms.filter((m) => m.observation !== 'none').length;
    const nextFree = ms
      .map((m) => extras.get(m.id)?.expectedEndAt)
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      total: ms.length,
      available: ms.filter((m) => m.state === 'available').length,
      running: ms.filter((m) => m.state === 'running').length,
      finished: ms.filter((m) => m.state === 'finished').length,
      outOfOrder: ms.filter((m) => UNAVAILABLE.includes(m.state)).length,
      unknown: ms.filter((m) => m.state === 'offline').length,
      /** live = every machine has a sensor; mixed = some; checkins = none (status from customer check-ins/staff only). */
      confidence: ms.length === 0 ? 'none' : observed === ms.length ? 'live' : observed > 0 ? 'mixed' : 'checkins',
      nextFreeAt: nextFree?.toISOString() ?? null,
    };
  };
  return { washers: byType('washer'), dryers: byType('dryer') };
}

// "Usually busy" profile — cached per shop for 10 minutes.
const busyCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof computeBusyness>> }>();

async function computeBusyness(ctx: Ctx, shop: Shop) {
  const to = ctx.now();
  const from = new Date(to.getTime() - 28 * 86_400_000);
  const { matrix, cycles } = await peakHours(ctx, shop.tenant_id, [shop.id], from, to);
  const enough = cycles >= 40;
  const p = localParts(to, shop.timezone);
  const label = (v: number | null | undefined) => (v == null ? null : v < 0.3 ? 'quiet' : v < 0.6 ? 'moderate' : 'busy');
  const today = matrix[p.isoDow - 1] ?? [];
  return {
    enoughData: enough,
    nowLabel: enough ? label(today[p.hour]) : null,
    today: enough ? today.map((v) => (v == null ? null : Math.round(v * 100) / 100)) : null,
    currentHour: p.hour,
  };
}

export async function busyness(ctx: Ctx, shop: Shop) {
  const hit = busyCache.get(shop.id);
  if (hit && ctx.now().getTime() - hit.at < 10 * 60_000) return hit.value;
  const value = await computeBusyness(ctx, shop);
  busyCache.set(shop.id, { at: ctx.now().getTime(), value });
  return value;
}

export function clearBusynessCache() {
  busyCache.clear();
}

function hoursInfo(shop: Shop, now: Date) {
  const openNow = isOpenAt(shop.opening_hours, now, shop.timezone);
  const p = localParts(now, shop.timezone);
  const mins = p.hour * 60 + p.minute;
  const iv = openIntervalsForDow(shop.opening_hours as OpeningHours, p.isoDow).find(([o, c]) => mins >= o && mins < c);
  const is24 = !!iv && iv[0] === 0 && iv[1] === 1440 && Object.values(shop.opening_hours).every((h) => h && h.open === '00:00' && (h.close === '24:00' || h.close === '00:00'));
  const closesAt = iv && !is24 ? `${String(Math.floor((iv[1] % 1440) / 60)).padStart(2, '0')}:${String(iv[1] % 60).padStart(2, '0')}` : null;
  return { openNow, open24h: is24, closesAt };
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function activeAnnouncements(ctx: Ctx, shopIds: string[]) {
  if (!shopIds.length) return [];
  const now = ctx.now();
  return ctx.db
    .selectFrom('announcements')
    .select(['id', 'shop_id', 'message', 'level', 'starts_at', 'ends_at'])
    .where('shop_id', 'in', shopIds)
    .where('starts_at', '<=', now)
    .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', now)]))
    .orderBy('starts_at', 'desc')
    .execute();
}

export async function listShops(ctx: Ctx, near?: { lat: number; lng: number }) {
  const shops = await ctx.db.selectFrom('shops').selectAll().where('is_published', '=', true).execute();
  const ids = shops.map((s) => s.id);
  const machines = ids.length ? await ctx.db.selectFrom('machines').selectAll().where('shop_id', 'in', ids).where('deleted_at', 'is', null).execute() : [];
  const extras = await machineExtras(ctx, machines);
  const anns = await activeAnnouncements(ctx, ids);
  const now = ctx.now();
  const out = [];
  for (const s of shops) {
    const ms = machines.filter((m) => m.shop_id === s.id);
    out.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      distanceKm: near && s.lat != null && s.lng != null ? Math.round(distanceKm(near.lat, near.lng, s.lat, s.lng) * 10) / 10 : null,
      ...hoursInfo(s, now),
      availability: availability(ms, extras),
      busyness: await busyness(ctx, s),
      announcementCount: anns.filter((a) => a.shop_id === s.id).length,
      warning: anns.find((a) => a.shop_id === s.id && a.level === 'warning')?.message ?? null,
    });
  }
  out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.name.localeCompare(b.name));
  return out;
}

export async function shopDetail(ctx: Ctx, slug: string) {
  const s = await ctx.db.selectFrom('shops').selectAll().where('slug', '=', slug).where('is_published', '=', true).executeTakeFirst();
  if (!s) return null;
  const machines = await ctx.db
    .selectFrom('machines')
    .selectAll()
    .where('shop_id', '=', s.id)
    .where('deleted_at', 'is', null)
    .orderBy('type', 'desc')
    .orderBy('sort_order')
    .orderBy('code')
    .execute();
  const extras = await machineExtras(ctx, machines);
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    phone: s.phone,
    whatsapp: s.whatsapp,
    openingHours: s.opening_hours,
    facilities: s.facilities,
    policy: s.policy,
    settings: { ...DEFAULT_SHOP_SETTINGS, ...s.settings },
    ...hoursInfo(s, ctx.now()),
    availability: availability(machines, extras),
    busyness: await busyness(ctx, s),
    announcements: (await activeAnnouncements(ctx, [s.id])).map((a) => ({ id: a.id, message: a.message, level: a.level, endsAt: a.ends_at?.toISOString() ?? null })),
    machines: machines.map((m) => publicMachine(m, extras.get(m.id)!)),
  };
}

export async function machineByQr(ctx: Ctx, qrToken: string) {
  const m = await ctx.db.selectFrom('machines').selectAll().where('qr_token', '=', qrToken).where('deleted_at', 'is', null).executeTakeFirst();
  if (!m) return null;
  const s = await ctx.db.selectFrom('shops').selectAll().where('id', '=', m.shop_id).executeTakeFirstOrThrow();
  const extras = await machineExtras(ctx, [m]);
  return {
    machine: publicMachine(m, extras.get(m.id)!),
    shop: {
      id: s.id,
      slug: s.slug,
      name: s.name,
      whatsapp: s.whatsapp,
      policy: s.policy,
      ...hoursInfo(s, ctx.now()),
      settings: { ...DEFAULT_SHOP_SETTINGS, ...s.settings },
    },
  };
}
