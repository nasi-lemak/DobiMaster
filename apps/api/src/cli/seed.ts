/**
 * Demo data: one operator with three shops that represent the three realities of Phase 1/2:
 *   SS2        — every machine has a (simulated) power sensor; W1/W2 support pay-in-app
 *   Damansara  — no sensors at all: status only from customer check-ins and staff
 *   Kepong     — mixed: a few off-the-shelf energy monitors, one of them offline
 * plus ~5 weeks of history so analytics, reconciliation and alerts have something to show.
 *
 *   pnpm --filter @dobi/api seed           (wipes and re-creates demo data)
 */
import { randomUUID } from 'node:crypto';
import { DRYER_INSTRUCTIONS, HOURS_24, dryerPrograms, recommendedLoad, sameHoursEveryDay, washerInstructions, washerPrograms, type OpeningHours, type Program } from '@dobi/shared';
import { buildApp } from '../app.js';
import { createPool, json } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { hashPassword } from '../auth/owner.js';
import { sha256, shortToken } from '../lib/ids.js';
import { localParts } from '../lib/time.js';
import { recomputeMachineState } from '../modules/machines/state.js';
import { initialDetectorState } from '../modules/telemetry/detector.js';
import { MemoryPushTransport } from '../modules/push/service.js';
import { checkDryerHeating, sweepDevices } from '../modules/telemetry/service.js';
import { sweepLowUsage } from '../modules/analytics/service.js';
import { sweepMaintenance } from '../modules/maintenance/service.js';

// Deterministic PRNG so demo numbers are stable between runs.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

const H24 = HOURS_24;
const DAYTIME = sameHoursEveryDay('07:00', '24:00');
const loadText = recommendedLoad;

interface MachineSpec {
  code: string;
  type: 'washer' | 'dryer';
  kg: number;
  programs: Program[];
  sensor?: 'simulator' | 'shelly' | 'shelly_offline';
  control?: 'simulated';
  popularity?: number;
  /** Simulated real-world problem */
  quirk?: 'jammed_2d' | 'skim';
}

interface ShopSpec {
  slug: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  hours: OpeningHours;
  whatsapp: string;
  /** Share of real cycles that end up recorded (sensors see all; check-ins only a fraction). */
  checkinRate: number;
  traffic: number;
  machines: MachineSpec[];
  facilities: Record<string, boolean>;
}

const shops: ShopSpec[] = [
  {
    slug: 'dobi-ceria-ss2',
    name: 'Dobi Ceria SS2',
    address: '23, Jalan SS 2/24, SS 2, 47300 Petaling Jaya, Selangor',
    lat: 3.1186,
    lng: 101.6211,
    hours: H24,
    whatsapp: '+60123456701',
    checkinRate: 1,
    traffic: 1.15,
    facilities: { wifi: true, aircon: true, cctv: true, changeMachine: true, qrPayment: true, seating: true, foldingTable: true },
    machines: [
      { code: 'W1', type: 'washer', kg: 10, programs: washerPrograms(500), sensor: 'simulator', control: 'simulated' },
      { code: 'W2', type: 'washer', kg: 10, programs: washerPrograms(500), sensor: 'simulator', control: 'simulated' },
      { code: 'W3', type: 'washer', kg: 10, programs: washerPrograms(500), sensor: 'simulator' },
      { code: 'W4', type: 'washer', kg: 10, programs: washerPrograms(500), sensor: 'simulator' },
      { code: 'W5', type: 'washer', kg: 15, programs: washerPrograms(700), sensor: 'simulator' },
      { code: 'W6', type: 'washer', kg: 15, programs: washerPrograms(700), sensor: 'simulator' },
      { code: 'W7', type: 'washer', kg: 20, programs: washerPrograms(1000, 200, [40, 45, 50]), sensor: 'simulator', popularity: 2.6 },
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ code: `D${n}`, type: 'dryer' as const, kg: 15, programs: dryerPrograms(), sensor: 'simulator' as const, popularity: n === 3 ? 0.5 : 1.1 })),
    ],
  },
  {
    slug: 'dobi-ceria-damansara-uptown',
    name: 'Dobi Ceria Damansara Uptown',
    address: '8, Jalan SS 21/39, Damansara Utama, 47400 Petaling Jaya',
    lat: 3.136,
    lng: 101.623,
    hours: DAYTIME,
    whatsapp: '+60123456702',
    checkinRate: 0.3,
    traffic: 1,
    facilities: { changeMachine: true, parking: true, detergentVending: true, seating: true },
    machines: [
      { code: 'W1', type: 'washer', kg: 10, programs: washerPrograms(500) },
      { code: 'W2', type: 'washer', kg: 10, programs: washerPrograms(500), quirk: 'skim' },
      { code: 'W3', type: 'washer', kg: 10, programs: washerPrograms(500) },
      { code: 'W4', type: 'washer', kg: 10, programs: washerPrograms(500) },
      { code: 'W5', type: 'washer', kg: 18, programs: washerPrograms(1000, 200, [40, 45, 50]), popularity: 1.4 },
      ...[1, 2, 3, 4].map((n) => ({ code: `D${n}`, type: 'dryer' as const, kg: 15, programs: dryerPrograms() })),
    ],
  },
  {
    slug: 'dobi-ceria-kepong',
    name: 'Dobi Ceria Kepong',
    address: '15, Jalan Metro Perdana Barat 1, Kepong, 52100 Kuala Lumpur',
    lat: 3.2107,
    lng: 101.636,
    hours: H24,
    whatsapp: '+60123456703',
    checkinRate: 0.35,
    traffic: 0.8,
    facilities: { changeMachine: true, cctv: true, parking: true },
    machines: [
      { code: 'W1', type: 'washer', kg: 12, programs: washerPrograms(600), sensor: 'shelly' },
      { code: 'W2', type: 'washer', kg: 12, programs: washerPrograms(600), sensor: 'shelly' },
      { code: 'W3', type: 'washer', kg: 12, programs: washerPrograms(600) },
      { code: 'W4', type: 'washer', kg: 12, programs: washerPrograms(600), quirk: 'jammed_2d' },
      { code: 'W5', type: 'washer', kg: 25, programs: washerPrograms(1400, 200, [45, 50, 55]) },
      { code: 'D1', type: 'dryer', kg: 15, programs: dryerPrograms(), sensor: 'shelly' },
      { code: 'D2', type: 'dryer', kg: 15, programs: dryerPrograms(), sensor: 'shelly_offline' },
      { code: 'D3', type: 'dryer', kg: 15, programs: dryerPrograms() },
      { code: 'D4', type: 'dryer', kg: 15, programs: dryerPrograms() },
    ],
  },
];

/**
 * Plausible sensor readings: washers heat water electrically for warm/hot programs; electric dryers
 * run a ~4.5 kW heater. SS2 D3's heater weakens over the last few hours (matches its "not drying" reports).
 */
function energyFor(ms: MachineSpec, programId: string, durMin: number, t: number) {
  let watts: number;
  if (ms.type === 'dryer') {
    const weak = ms.code === 'D3' && ms.popularity === 0.5 && t > Date.now() - 6 * 3600_000;
    watts = (weak ? 1900 : 4500) * (0.92 + rand() * 0.16);
  } else {
    const base = { cold: 350, warm: 1300, hot: 2100 }[programId] ?? 600;
    watts = base * (ms.kg / 10) ** 0.6 * (0.9 + rand() * 0.2);
  }
  return { avg_power_w: Math.round(watts), energy_wh: Math.round((watts * durMin) / 60) };
}

/** Relative demand by local hour; weekends busier. */
function demand(hour: number, isoDow: number) {
  const curve = [0.15, 0.1, 0.05, 0.03, 0.03, 0.05, 0.15, 0.35, 0.5, 0.55, 0.55, 0.5, 0.45, 0.4, 0.4, 0.45, 0.55, 0.7, 0.85, 0.95, 0.95, 0.85, 0.6, 0.3];
  const weekend = isoDow >= 6 ? 1.35 : isoDow === 5 ? 1.1 : 1;
  const morningWeekend = isoDow >= 6 && hour >= 8 && hour <= 12 ? 1.4 : 1;
  return curve[hour]! * weekend * morningWeekend;
}

async function main() {
  const pool = createPool();
  await migrate(pool, () => {});
  const { app, ctx } = await buildApp({ pool, logger: false, pushTransport: new MemoryPushTransport() });
  const db = ctx.db;

  console.log('Wiping existing data…');
  await pool.query(`TRUNCATE tenants, users, customers, jobs, app_settings RESTART IDENTITY CASCADE`);
  // Re-create VAPID keys lazily on next start (they were wiped with app_settings).

  const now = new Date();
  const tz = 'Asia/Kuala_Lumpur';
  const tenant = await db.insertInto('tenants').values({ name: 'Dobi Ceria Sdn Bhd', slug: 'dobi-ceria', plan: 'growth' }).returning('id').executeTakeFirstOrThrow();
  const users = [
    { email: 'owner@dobiceria.my', name: 'Aisyah (Owner)', role: 'owner' as const, shops: null as string[] | null },
    { email: 'manager@dobiceria.my', name: 'Kumar (Manager)', role: 'manager' as const, shops: null },
    { email: 'staff@dobiceria.my', name: 'Mei Ling (Staff, SS2)', role: 'staff' as const, shops: [] as string[] },
  ];
  const pw = await hashPassword('demo1234');
  const userIds: Record<string, string> = {};
  for (const u of users) {
    const row = await db.insertInto('users').values({ email: u.email, name: u.name, password_hash: pw }).returning('id').executeTakeFirstOrThrow();
    userIds[u.role] = row.id;
  }

  const customers: string[] = [];
  for (let i = 0; i < 60; i++) {
    const c = await db.insertInto('customers').values({ locale: pick(['en', 'ms', 'ms', 'zh']) }).returning('id').executeTakeFirstOrThrow();
    customers.push(c.id);
  }

  const shopIds: Record<string, string> = {};
  const DAYS = 35;
  const historyStart = new Date(now.getTime() - DAYS * 86_400_000);

  for (const spec of shops) {
    const shop = await db
      .insertInto('shops')
      .values({
        tenant_id: tenant.id,
        slug: spec.slug,
        name: spec.name,
        address: spec.address,
        lat: spec.lat,
        lng: spec.lng,
        whatsapp: spec.whatsapp,
        phone: spec.whatsapp,
        opening_hours: json(spec.hours),
        facilities: json(spec.facilities),
        policy: json({
          en: 'Laundry left more than 15 minutes after finishing may be moved to the blue basket.',
          ms: 'Pakaian yang ditinggalkan lebih 15 minit selepas siap boleh dipindahkan ke bakul biru.',
          zh: '洗好后超过 15 分钟未取的衣物，可能会被移到蓝色篮子里。',
        }),
        settings: json({}),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    shopIds[spec.slug] = shop.id;

    for (const [idx, ms] of spec.machines.entries()) {
      let deviceId: string | null = null;
      if (ms.sensor) {
        const kind = ms.sensor === 'simulator' ? 'simulator' : 'shelly';
        const offline = ms.sensor === 'shelly_offline';
        const d = await db
          .insertInto('devices')
          .values({
            tenant_id: tenant.id,
            shop_id: shop.id,
            kind,
            label: `${ms.code} ${kind === 'simulator' ? 'simulated sensor' : 'Shelly EM + 50A clamp'}`,
            token_hash: sha256(`demo-${spec.slug}-${ms.code}`),
            config: json(kind === 'simulator' ? { startW: 30, endW: 10, startSec: 5, endSec: 20, minCycleSec: 20, maxCycleMin: 180 } : offline ? {} : { simHeartbeat: 1 }),
            detector: json(initialDetectorState()),
            heartbeat_sec: 60,
            last_seen_at: offline ? new Date(now.getTime() - 3 * 3600_000) : now,
            last_power_w: offline ? 0 : 2,
            online: true, // the device sweep will notice the stale heartbeat and raise the alert
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        deviceId = d.id;
      }
      const machine = await db
        .insertInto('machines')
        .values({
          tenant_id: tenant.id,
          shop_id: shop.id,
          code: ms.code,
          qr_token: spec.slug === 'dobi-ceria-ss2' && ms.code === 'W3' ? 'demo-ss2-w3' : spec.slug === 'dobi-ceria-ss2' && ms.code === 'W1' ? 'demo-ss2-w1' : shortToken(10),
          type: ms.type,
          capacity_kg: ms.kg,
          brand: ms.type === 'washer' ? pick(['Speed Queen', 'Electrolux', 'Primus']) : pick(['Speed Queen', 'Electrolux']),
          programs: json(ms.programs),
          instructions: json(ms.type === 'washer' ? washerInstructions(true) : DRYER_INSTRUCTIONS),
          recommended_load: json(loadText(ms.kg, ms.type)),
          detergent_auto: ms.type === 'washer',
          softener_auto: ms.type === 'washer' && spec.slug !== 'dobi-ceria-kepong',
          observation: ms.sensor ? 'power_monitor' : 'none',
          control: ms.control ?? 'none',
          device_id: deviceId,
          purchase_cost_sen: ms.type === 'washer' ? (ms.kg >= 18 ? 2_600_000 : 1_800_000) : 1_400_000,
          installed_at: '2024-03-01',
          sort_order: idx,
          state_since: historyStart,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      // ---- history ----
      let t = historyStart.getTime() + rand() * 3600_000;
      let realCycles = 0;
      let cashSinceCollection = 0;
      let lastCollectionDate = '';
      const pop = (ms.popularity ?? 1) * spec.traffic * (ms.type === 'dryer' ? 1.05 : 1);
      const cycleRows: Array<Record<string, unknown>> = [];
      const collections: Array<{ at: Date; amount: number; counter: number }> = [];
      while (t < now.getTime() - 50 * 60_000) {
        const at = new Date(t);
        const p = localParts(at, tz);
        // Weekly cash collection on Monday mornings.
        if (p.isoDow === 1 && p.hour >= 10 && p.date !== lastCollectionDate && t - historyStart.getTime() > 86_400_000) {
          lastCollectionDate = p.date;
          const skimmed = ms.quirk === 'skim' ? Math.round(cashSinceCollection * 0.72) : cashSinceCollection;
          collections.push({ at, amount: skimmed, counter: 4000 + realCycles });
          cashSinceCollection = 0;
        }
        const openNow = spec.hours === H24 || (p.hour >= 7);
        const jammed = ms.quirk === 'jammed_2d' && t > now.getTime() - 2 * 86_400_000;
        if (!openNow || jammed || rand() > demand(p.hour, p.isoDow) * 0.55 * pop) {
          t += 12 * 60_000;
          continue;
        }
        const program = rand() < 0.55 ? ms.programs[0]! : rand() < 0.7 ? ms.programs[1]! : ms.programs[2]!;
        const dur = program.durationMin + (ms.type === 'washer' ? Math.round(rand() * 3) : 0);
        const end = new Date(t + dur * 60_000);
        realCycles++;
        const paidInApp = ms.control && rand() < 0.3;
        if (!paidInApp) cashSinceCollection += program.priceSen;
        const recorded = !!ms.sensor && ms.sensor !== 'shelly_offline' ? true : rand() < spec.checkinRate;
        if (recorded || paidInApp) {
          const customer = ms.sensor ? (rand() < 0.35 ? pick(customers) : null) : pick(customers);
          const id = randomUUID();
          let paymentId: string | null = null;
          if (paidInApp) {
            const pay = await db
              .insertInto('payments')
              .values({
                tenant_id: tenant.id,
                shop_id: shop.id,
                machine_id: machine.id,
                customer_id: customer ?? pick(customers),
                program_id: program.id,
                amount_sen: program.priceSen,
                provider: 'mock',
                provider_ref: `mock_hist_${id.slice(0, 8)}`,
                status: 'succeeded',
                idempotency_key: `hist-${id}`,
                created_at: at,
                updated_at: at,
                succeeded_at: at,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            paymentId = pay.id;
          }
          cycleRows.push({
            id,
            tenant_id: tenant.id,
            shop_id: shop.id,
            machine_id: machine.id,
            source: paidInApp ? 'payment' : ms.sensor ? 'sensor' : 'customer',
            status: customer || paidInApp ? 'collected' : 'finished',
            program_id: program.id,
            program_name: program.name.en,
            duration_min: program.durationMin,
            price_sen: program.priceSen,
            started_at: at,
            expected_end_at: new Date(t + program.durationMin * 60_000),
            ended_at: end,
            collected_at: customer || paidInApp ? new Date(end.getTime() + rand() * 20 * 60_000) : null,
            customer_id: paidInApp ? null : customer,
            payment_id: paymentId,
            sensor_confirmed: !!ms.sensor,
            ...(ms.sensor && ms.sensor !== 'shelly_offline' ? energyFor(ms, program.id, dur, t) : {}),
            created_at: at,
          });
        }
        t = end.getTime() + (3 + rand() * 20) * 60_000;
      }
      for (let i = 0; i < cycleRows.length; i += 500) {
        await db.insertInto('cycles').values(cycleRows.slice(i, i + 500) as never).execute();
      }
      await pool.query(`UPDATE payments p SET cycle_id = c.id FROM cycles c WHERE c.payment_id = p.id AND p.machine_id = $1`, [machine.id]);
      (ms as MachineSpec & { _id?: string; _collections?: typeof collections })._id = machine.id;
      (ms as MachineSpec & { _collections?: typeof collections })._collections = collections;
    }

    // Group per-machine cash into shop-level collection events.
    const byDate = new Map<string, Array<{ machineId: string; amount: number; counter: number; at: Date }>>();
    for (const ms of spec.machines as Array<MachineSpec & { _id: string; _collections: Array<{ at: Date; amount: number; counter: number }> }>) {
      for (const c of ms._collections) {
        const k = localParts(c.at, tz).date;
        byDate.set(k, [...(byDate.get(k) ?? []), { machineId: ms._id, amount: c.amount, counter: c.counter, at: c.at }]);
      }
    }
    for (const [, lines] of byDate) {
      const col = await db
        .insertInto('collections')
        .values({ tenant_id: tenant.id, shop_id: shop.id, collected_at: lines[0]!.at, collected_by: userIds.manager!, note: 'Weekly coin collection' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('collection_lines')
        .values(lines.map((l) => ({ collection_id: col.id, machine_id: l.machineId, amount_sen: l.amount, counter_reading: spec.slug === 'dobi-ceria-ss2' ? null : l.counter })))
        .execute();
    }

    // Maintenance plans + a few past logs.
    await db
      .insertInto('maintenance_plans')
      .values([
        { tenant_id: tenant.id, shop_id: shop.id, machine_type: 'dryer', title: 'Clean lint duct & check burner', interval_days: 30, interval_run_hours: 200 },
        { tenant_id: tenant.id, shop_id: shop.id, machine_type: 'washer', title: 'Descale & check door gasket', interval_cycles: 500, interval_days: 90 },
      ])
      .execute();
    await db
      .insertInto('checklist_templates')
      .values({
        tenant_id: tenant.id,
        shop_id: shop.id,
        name: 'Daily opening check',
        items: json([
          { id: 'lint', label: 'Empty all dryer lint filters' },
          { id: 'floor', label: 'Sweep & mop floor' },
          { id: 'bins', label: 'Empty rubbish bins' },
          { id: 'gaskets', label: 'Wipe washer doors & gaskets' },
          { id: 'detergent', label: 'Check detergent / softener tanks' },
          { id: 'change', label: 'Check change machine has coins' },
        ]),
      })
      .execute();
  }

  // Staff membership limited to SS2.
  await db
    .insertInto('memberships')
    .values([
      { tenant_id: tenant.id, user_id: userIds.owner!, role: 'owner', shop_ids: null },
      { tenant_id: tenant.id, user_id: userIds.manager!, role: 'manager', shop_ids: null },
      { tenant_id: tenant.id, user_id: userIds.staff!, role: 'staff', shop_ids: [shopIds['dobi-ceria-ss2']!] },
    ])
    .execute();

  const machineId = async (slug: string, code: string) =>
    (await db.selectFrom('machines').select('id').where('shop_id', '=', shopIds[slug]!).where('code', '=', code).executeTakeFirstOrThrow()).id;

  // Maintenance logs: most done recently, SS2 dryers overdue.
  const plans = await db.selectFrom('maintenance_plans').selectAll().execute();
  for (const p of plans) {
    const scope = await db.selectFrom('machines').select(['id', 'code']).where('shop_id', '=', p.shop_id).where('type', '=', p.machine_type!).execute();
    const overdue = p.shop_id === shopIds['dobi-ceria-ss2'] && p.machine_type === 'dryer';
    for (const m of scope) {
      await db
        .insertInto('maintenance_logs')
        .values({ tenant_id: tenant.id, shop_id: p.shop_id, machine_id: m.id, plan_id: p.id, performed_at: new Date(now.getTime() - (overdue ? 38 : 8 + rand() * 10) * 86_400_000), performed_by: userIds.manager!, notes: 'Routine service' })
        .execute();
    }
  }

  // ---- live state right now ----
  const ss2 = 'dobi-ceria-ss2';
  const startRunning = async (slug: string, code: string, minsAgo: number, opts: { customer?: string | null; source: 'sensor' | 'customer' }) => {
    const mid = await machineId(slug, code);
    const m = await db.selectFrom('machines').selectAll().where('id', '=', mid).executeTakeFirstOrThrow();
    const program = m.programs[0]!;
    const started = new Date(now.getTime() - minsAgo * 60_000);
    const id = randomUUID();
    await db
      .insertInto('cycles')
      .values({
        id,
        tenant_id: tenant.id,
        shop_id: m.shop_id,
        machine_id: mid,
        source: opts.source,
        status: 'running',
        program_id: program.id,
        program_name: program.name.en,
        duration_min: program.durationMin,
        price_sen: program.priceSen,
        started_at: started,
        expected_end_at: new Date(started.getTime() + program.durationMin * 60_000),
        customer_id: opts.customer ?? null,
        sensor_confirmed: opts.source === 'sensor',
      })
      .execute();
    const endAt = new Date(started.getTime() + program.durationMin * 60_000);
    await ctx.jobs.schedule('cycle.finish', endAt, { cycleId: id }, `cycle.finish:${id}`);
    if (opts.customer) await ctx.jobs.schedule('cycle.remind', new Date(endAt.getTime() - 5 * 60_000), { cycleId: id }, `cycle.remind:${id}`);
    if (m.device_id && opts.source === 'sensor') {
      await db
        .updateTable('devices')
        .set({ detector: json({ ...initialDetectorState(), phase: 'running', cycleStart: started.getTime(), lastTs: now.getTime() - 1000, lastPowerW: 1500 }), last_power_w: 1500 })
        .where('id', '=', m.device_id)
        .execute();
      await ctx.jobs.schedule('sim.power', endAt, { deviceId: m.device_id, powerW: 2, holdSec: 25 }, `sim.power:seed:${id}`);
    }
  };
  await startRunning(ss2, 'W3', 22, { source: 'sensor', customer: customers[0] });
  await startRunning(ss2, 'W5', 8, { source: 'sensor' });
  await startRunning(ss2, 'W7', 30, { source: 'sensor' });
  await startRunning(ss2, 'D1', 12, { source: 'sensor', customer: customers[1] });
  await startRunning(ss2, 'D2', 20, { source: 'sensor' });
  await startRunning('dobi-ceria-damansara-uptown', 'W5', 15, { source: 'customer', customer: customers[2] });
  await startRunning('dobi-ceria-damansara-uptown', 'D2', 5, { source: 'customer', customer: customers[3] });
  await startRunning('dobi-ceria-kepong', 'W1', 18, { source: 'sensor' });

  // A finished-but-not-collected machine at SS2.
  {
    const mid = await machineId(ss2, 'W6');
    const ended = new Date(now.getTime() - 9 * 60_000);
    await db
      .insertInto('cycles')
      .values({ id: randomUUID(), tenant_id: tenant.id, shop_id: shopIds[ss2]!, machine_id: mid, source: 'sensor', status: 'finished', program_id: 'cold', program_name: 'Cold', duration_min: 30, price_sen: 700, started_at: new Date(ended.getTime() - 31 * 60_000), expected_end_at: new Date(ended.getTime() - 60_000), ended_at: ended, sensor_confirmed: true })
      .execute();
  }

  // Out of service + tickets + refund request.
  await db.updateTable('machines').set({ admin_state: 'maintenance', admin_reason: 'Waiting for replacement drain pump (ETA Fri)' }).where('id', '=', await machineId('dobi-ceria-damansara-uptown', 'W4')).execute();

  const ticket = async (slug: string, code: string | null, category: string, title: string, details: string, hoursAgo: number, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    const mid = code ? await machineId(slug, code) : null;
    await db
      .insertInto('tickets')
      .values({
        id,
        tenant_id: tenant.id,
        shop_id: shopIds[slug]!,
        machine_id: mid,
        category,
        severity: ['payment_no_start', 'coin_jammed', 'water_leak', 'not_starting'].includes(category) ? 'high' : category === 'not_drying' ? 'medium' : 'low',
        source: 'customer',
        title,
        details,
        customer_id: pick(customers),
        counts_as_fault: ['not_starting', 'payment_no_start', 'coin_jammed', 'water_leak', 'not_drying', 'damaged'].includes(category),
        created_at: new Date(now.getTime() - hoursAgo * 3600_000),
        updated_at: new Date(now.getTime() - hoursAgo * 3600_000),
        ...extra,
      } as never)
      .execute();
    await db.insertInto('ticket_events').values({ ticket_id: id, kind: 'created', body: details, created_at: new Date(now.getTime() - hoursAgo * 3600_000) }).execute();
    return id;
  };
  await ticket(ss2, 'D3', 'not_drying', 'D3 · Dryer not drying', 'Paid for 32 minutes, clothes still damp. Second time this week.', 30);
  await ticket(ss2, 'D3', 'not_drying', 'D3 · Dryer not drying', 'Baju masih lembap lepas 40 minit', 70);
  await ticket(ss2, 'D3', 'not_drying', 'D3 · Dryer not drying', 'Not hot at all', 120, { status: 'resolved', resolved_at: new Date(now.getTime() - 100 * 3600_000) });
  const refundTicket = await ticket('dobi-ceria-damansara-uptown', 'W2', 'coin_jammed', 'W2 · Coin jammed / money swallowed', 'Put in RM5 in coins, display still shows 0.', 3, {
    amount_claimed_sen: 500,
    contact_phone: '+60123334444',
  });
  await ticket('dobi-ceria-kepong', null, 'cleanliness', 'Shop cleanliness', 'Rubbish bin overflowing near the folding table', 5);
  await db
    .insertInto('refunds')
    .values({ tenant_id: tenant.id, shop_id: shopIds['dobi-ceria-damansara-uptown']!, ticket_id: refundTicket, amount_sen: 500, method: 'duitnow', payout_phone: '+60123334444', note: 'Customer request via report' })
    .execute();

  await db
    .insertInto('announcements')
    .values([
      {
        tenant_id: tenant.id,
        shop_id: shopIds['dobi-ceria-damansara-uptown']!,
        level: 'warning',
        message: json({ en: 'Washer W4 is under repair until Friday. Sorry for the inconvenience!', ms: 'Mesin basuh W4 dalam pembaikan sehingga Jumaat. Maaf atas kesulitan!', zh: '洗衣机 W4 维修中，预计周五恢复。不便之处敬请见谅！' }),
        created_by: userIds.owner!,
      },
      {
        tenant_id: tenant.id,
        shop_id: shopIds[ss2]!,
        level: 'info',
        message: json({ en: 'New: pay in the app on W1 & W2 — no coins needed.', ms: 'Baharu: bayar dalam aplikasi untuk W1 & W2 — tak perlu syiling.', zh: '新功能：W1 和 W2 可在网页直接付款，无需硬币。' }),
        created_by: userIds.owner!,
      },
    ])
    .execute();

  // Derive current state for every machine, then run the sweeps that raise alerts.
  // History was inserted directly, so "state since" should reflect each machine's last recorded activity.
  await pool.query(`UPDATE machines m SET state_since = COALESCE((SELECT max(COALESCE(ended_at, started_at)) FROM cycles c WHERE c.machine_id = m.id), state_since)`);
  const all = await db.selectFrom('machines').select('id').execute();
  for (const m of all) await recomputeMachineState(ctx, m.id, 'seed');
  await sweepDevices(ctx);
  await sweepLowUsage(ctx);
  await sweepMaintenance(ctx);
  // Heater check on SS2 D3's latest cycle (normally runs live when the sensor reports a cycle end).
  {
    const d3 = await db.selectFrom('machines').selectAll().where('shop_id', '=', shopIds['dobi-ceria-ss2']!).where('code', '=', 'D3').executeTakeFirstOrThrow();
    const last = await db.selectFrom('cycles').select('avg_power_w').where('machine_id', '=', d3.id).where('avg_power_w', 'is not', null).orderBy('started_at', 'desc').executeTakeFirst();
    if (last?.avg_power_w) await checkDryerHeating(ctx, d3, last.avg_power_w, 30);
  }
  // Repeat-fault alert for D3 (normally raised when the 3rd report arrives).
  await db
    .insertInto('alerts')
    .values({ tenant_id: tenant.id, shop_id: shopIds[ss2]!, machine_id: await machineId(ss2, 'D3'), kind: 'repeat_fault', severity: 'high', message: 'D3 has 3 fault reports in the last 7 days — consider a technician visit', dedupe_key: `repeat_fault:${await machineId(ss2, 'D3')}` })
    .onConflict((oc) => oc.doNothing())
    .execute();

  const counts = await pool.query(`SELECT (SELECT count(*) FROM cycles) AS cycles, (SELECT count(*) FROM machines) AS machines, (SELECT count(*) FROM alerts WHERE status='open') AS alerts`);
  console.log('Seeded:', counts.rows[0]);
  console.log('\nOwner login:   owner@dobiceria.my / demo1234');
  console.log('Manager login: manager@dobiceria.my / demo1234');
  console.log('Staff login:   staff@dobiceria.my / demo1234 (SS2 only, no revenue)');
  console.log('Try a machine QR page: /m/demo-ss2-w3   (pay-in-app: /m/demo-ss2-w1)');
  console.log('Simulated sensor tokens: demo-dobi-ceria-ss2-<CODE>, e.g. `pnpm --filter @dobi/api simulate -- --token demo-dobi-ceria-ss2-W4`');
  await app.close();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
