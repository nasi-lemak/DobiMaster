import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';
import type { Device, Machine } from '../../db/types.js';
import { channels } from '../../events/bus.js';
import { sha256 } from '../../lib/ids.js';
import { unauthorized } from '../../lib/errors.js';
import { raiseAlert, resolveAlert } from '../alerts/service.js';
import { sensorCycleDiscarded, sensorCycleEnd, sensorCycleStart } from '../cycles/service.js';
import { recomputeMachineState } from '../machines/state.js';
import { adapters, sanitizeSamples } from './adapters.js';
import {
  DRYER_DEFAULTS,
  WASHER_DEFAULTS,
  initialDetectorState,
  runDetector,
  type DetectorConfig,
  type DetectorEvent,
  type DetectorState,
  type Sample,
} from './detector.js';

export function detectorConfig(machine: Pick<Machine, 'type'> | null, device: Pick<Device, 'config'>): DetectorConfig {
  const base = machine?.type === 'dryer' ? DRYER_DEFAULTS : WASHER_DEFAULTS;
  const c = device.config ?? {};
  const pick = (k: keyof DetectorConfig) => (typeof c[k] === 'number' ? (c[k] as number) : base[k]);
  return {
    startW: pick('startW'),
    endW: pick('endW'),
    startSec: pick('startSec'),
    endSec: pick('endSec'),
    minCycleSec: pick('minCycleSec'),
    maxCycleMin: pick('maxCycleMin'),
  };
}

export async function authenticateDevice(ctx: Ctx, bearer: string | undefined) {
  const token = bearer?.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw unauthorized('Device token required');
  const device = await ctx.db.selectFrom('devices').selectAll().where('token_hash', '=', sha256(token)).executeTakeFirst();
  if (!device) throw unauthorized('Unknown device');
  return device;
}

/** Parse a vendor payload with the device's adapter and feed the detector. */
export async function ingestPayload(ctx: Ctx, device: Device, payload: unknown) {
  const adapter = adapters[device.kind];
  if (!adapter) throw new Error(`no adapter for ${device.kind}`);
  return ingestSamples(ctx, device.id, sanitizeSamples(adapter.parse(payload, ctx.now()), ctx.now()));
}

/**
 * Runs the detector under a row lock on the device (concurrent posts can't corrupt detector state),
 * then applies resulting cycle events after commit.
 */
export async function ingestSamples(ctx: Ctx, deviceId: string, samples: Sample[]) {
  const now = ctx.now();
  const result = await ctx.db.transaction().execute(async (trx) => {
    const device = await trx.selectFrom('devices').selectAll().where('id', '=', deviceId).forUpdate().executeTakeFirstOrThrow();
    const machine = await trx.selectFrom('machines').selectAll().where('device_id', '=', deviceId).where('deleted_at', 'is', null).executeTakeFirst();
    const cfg = detectorConfig(machine ?? null, device);
    const prev = (device.detector && 'phase' in device.detector ? device.detector : initialDetectorState()) as DetectorState;
    const { state, events } = runDetector(prev, samples, cfg);
    const last = [...samples].sort((a, b) => a.ts - b.ts).at(-1);
    await trx
      .updateTable('devices')
      .set({
        detector: json(state),
        last_seen_at: now,
        last_power_w: last?.powerW ?? device.last_power_w,
        online: true,
      })
      .where('id', '=', deviceId)
      .execute();
    return { device, machine, events, wasOnline: device.online, cfg };
  });

  const { device, machine, events, wasOnline } = result;
  if (!wasOnline) {
    await resolveAlert(ctx, device.tenant_id, `device_offline:${device.id}`);
    await resolveAlert(ctx, device.tenant_id, `shop_offline:${device.shop_id}`);
    // Power is back at the shop. Sensors come back seconds apart; give them a few minutes, then any still
    // silent needs its own alert (the shop-wide alert that covered it is now resolved).
    await ctx.jobs.schedule('devices.after_restore', new Date(ctx.now().getTime() + 3 * 60_000), { shopId: device.shop_id }, `devices.after_restore:${device.shop_id}`);
    await ctx.bus.publish(channels.tenant(device.tenant_id), 'device.status', { deviceId: device.id, online: true });
  }
  // Also when the device row never went offline but a recompute in the "stale" window stored the machine as offline.
  if (machine && (!wasOnline || machine.state === 'offline')) await recomputeMachineState(ctx, machine.id, 'device back online');
  if (machine) {
    for (const evt of events) await applyDetectorEvent(ctx, machine, evt);
  }
  return { events };
}

async function applyDetectorEvent(ctx: Ctx, machine: Machine, evt: DetectorEvent) {
  switch (evt.type) {
    case 'cycle_started':
      await sensorCycleStart(ctx, machine, new Date(evt.at));
      return;
    case 'cycle_ended': {
      const cycle = await sensorCycleEnd(ctx, machine, new Date(evt.at));
      if (cycle) {
        const hours = (evt.at - evt.startedAt) / 3600_000;
        await ctx.db
          .updateTable('cycles')
          .set({ avg_power_w: evt.avgPowerW, energy_wh: evt.avgPowerW * hours })
          .where('id', '=', cycle.id)
          .execute();
        if (machine.type === 'dryer') await checkDryerHeating(ctx, machine, evt.avgPowerW, hours * 60);
      }
      // "Paid for 40 minutes, it ran 26": flag cycles far shorter than the program the customer chose.
      if (cycle && (cycle.source === 'payment' || cycle.customer_id)) {
        const ranMin = (evt.at - evt.startedAt) / 60_000;
        if (ranMin < cycle.duration_min * 0.7) {
          await raiseAlert(ctx, {
            tenantId: machine.tenant_id,
            shopId: machine.shop_id,
            machineId: machine.id,
            kind: 'short_cycle',
            severity: 'medium',
            message: `${machine.code} ran ${Math.round(ranMin)} min of a ${cycle.duration_min} min program`,
            dedupeKey: `short_cycle:${machine.id}`,
          });
        }
      }
      return;
    }
    case 'cycle_discarded':
      await sensorCycleDiscarded(ctx, machine);
      return;
    case 'cycle_stuck': {
      await raiseAlert(ctx, {
        tenantId: machine.tenant_id,
        shopId: machine.shop_id,
        machineId: machine.id,
        kind: 'stuck_cycle',
        severity: 'high',
        message: `${machine.code} has been drawing power for an unusually long time — possibly stuck`,
        dedupeKey: `stuck_cycle:${machine.id}`,
      });
      await sensorCycleEnd(ctx, machine, new Date(evt.at));
      return;
    }
  }
}

/** Periodic: mark devices offline when their heartbeat is overdue. */
/** Silent sensors in one shop at the same moment point at the shop (power cut / internet), not the machines. */
export const SHOP_OUTAGE_MIN_DEVICES = 2;
export const SHOP_OUTAGE_SHARE = 0.8;
/** Sensors that went quiet within this long of each other count as one shop-wide event. */
export const OUTAGE_GROUP_MS = 5 * 60_000;

export async function sweepDevices(ctx: Ctx) {
  const now = ctx.now();
  const devices = await ctx.db.selectFrom('devices').selectAll().where('online', '=', true).execute();
  const stale = devices.filter((d) => !d.last_seen_at || now.getTime() - d.last_seen_at.getTime() > 3 * d.heartbeat_sec * 1000);
  const byShop = new Map<string, typeof stale>();
  for (const d of stale) byShop.set(d.shop_id, [...(byShop.get(d.shop_id) ?? []), d]);

  for (const [shopId, silent] of byShop) {
    const shopDevices = await ctx.db.selectFrom('devices').select(['id', 'online', 'last_seen_at']).where('shop_id', '=', shopId).execute();
    // Sensors in one power cut drop out at slightly different moments, so a previous sweep may already have
    // marked some offline. Count those that went quiet around the same time as part of the same event.
    const latest = Math.max(...silent.map((d) => d.last_seen_at?.getTime() ?? 0));
    const recentlyOffline = shopDevices.filter((d) => !d.online && d.last_seen_at && latest - d.last_seen_at.getTime() <= OUTAGE_GROUP_MS);
    const affected = silent.length + recentlyOffline.length;
    const outage = affected >= SHOP_OUTAGE_MIN_DEVICES && affected / shopDevices.length >= SHOP_OUTAGE_SHARE;
    if (outage) {
      // One shop alert replaces the per-sensor alerts raised a minute earlier.
      for (const d of recentlyOffline) await resolveAlert(ctx, silent[0]!.tenant_id, `device_offline:${d.id}`);
      const shop = await ctx.db.selectFrom('shops').select('name').where('id', '=', shopId).executeTakeFirstOrThrow();
      const lastSeen = silent.map((d) => d.last_seen_at?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
      await raiseAlert(ctx, {
        tenantId: silent[0]!.tenant_id,
        shopId,
        kind: 'shop_offline',
        severity: 'high',
        message: `${shop.name}: all ${affected} sensors went silent${lastSeen ? ` around ${new Date(lastSeen).toISOString()}` : ''} — likely a power cut or internet outage at the shop`,
        dedupeKey: `shop_offline:${shopId}`,
      });
    }
    for (const d of silent) {
      await ctx.db.updateTable('devices').set({ online: false }).where('id', '=', d.id).execute();
      const machine = await ctx.db.selectFrom('machines').selectAll().where('device_id', '=', d.id).where('deleted_at', 'is', null).executeTakeFirst();
      await ctx.bus.publish(channels.tenant(d.tenant_id), 'device.status', { deviceId: d.id, online: false });
      if (!outage) await raiseDeviceOffline(ctx, d, machine);
      if (machine) await recomputeMachineState(ctx, machine.id, outage ? 'shop outage' : 'device offline');
    }
  }
}

/** After a shop's sensors start reporting again: alert for each one that is still silent. */
export async function alertStillOffline(ctx: Ctx, shopId: string) {
  const stillDown = await ctx.db.selectFrom('devices').selectAll().where('shop_id', '=', shopId).where('online', '=', false).execute();
  for (const d of stillDown) await raiseDeviceOffline(ctx, d);
}

async function raiseDeviceOffline(ctx: Ctx, d: Device, machine?: Pick<Machine, 'id' | 'code'> | null) {
  machine ??= await ctx.db.selectFrom('machines').select(['id', 'code']).where('device_id', '=', d.id).where('deleted_at', 'is', null).executeTakeFirst();
  await raiseAlert(ctx, {
    tenantId: d.tenant_id,
    shopId: d.shop_id,
    machineId: machine?.id ?? null,
    kind: 'device_offline',
    severity: 'medium',
    message: `${machine ? machine.code : d.label || 'Sensor'} stopped reporting (last seen ${d.last_seen_at?.toISOString() ?? 'never'}) — tripped breaker, unplugged sensor or weak Wi-Fi?`,
    dedupeKey: `device_offline:${d.id}`,
  });
}

/**
 * Electric dryers whose heater is failing still turn (motor current) but draw far less power, and
 * customers get damp clothes. Compare each cycle with the machine's own recent median.
 */
export const WEAK_HEAT_RATIO = 0.6;
export async function checkDryerHeating(ctx: Ctx, machine: Machine, avgPowerW: number, minutes: number) {
  if (minutes < 10) return;
  const recent = await ctx.db
    .selectFrom('cycles')
    .select('avg_power_w')
    .where('machine_id', '=', machine.id)
    .where('avg_power_w', 'is not', null)
    .where('sensor_confirmed', '=', true)
    .orderBy('started_at', 'desc')
    .limit(21)
    .execute();
  const history = recent.slice(1).map((r) => r.avg_power_w!).sort((a, b) => a - b); // excludes this cycle
  if (history.length < 8) return;
  const median = history[Math.floor(history.length / 2)]!;
  if (median <= 0 || avgPowerW >= median * WEAK_HEAT_RATIO) return;
  await raiseAlert(ctx, {
    tenantId: machine.tenant_id,
    shopId: machine.shop_id,
    machineId: machine.id,
    kind: 'weak_heating',
    severity: 'medium',
    message: `${machine.code} drew ${Math.round((1 - avgPowerW / median) * 100)}% less power than usual — the heater may be failing (expect "not drying" complaints)`,
    dedupeKey: `weak_heating:${machine.id}`,
  });
}

export async function recordHeartbeat(ctx: Ctx, device: Device) {
  if (device.online) {
    await ctx.db.updateTable('devices').set({ last_seen_at: ctx.now() }).where('id', '=', device.id).execute();
    const m = await ctx.db.selectFrom('machines').select(['id', 'state']).where('device_id', '=', device.id).where('deleted_at', 'is', null).executeTakeFirst();
    if (m?.state === 'offline') await recomputeMachineState(ctx, m.id, 'device heartbeat');
    return;
  }
  await ingestSamples(ctx, device.id, []);
}

/** Evidence for a dispute: what did the sensor see around a time? */
export async function machineEvidence(ctx: Ctx, machineId: string, around: Date) {
  const m = await ctx.db.selectFrom('machines').select(['observation', 'device_id']).where('id', '=', machineId).executeTakeFirst();
  if (!m || m.observation === 'none') return { observed: false as const };
  const from = new Date(around.getTime() - 60 * 60_000);
  const cycles = await ctx.db
    .selectFrom('cycles')
    .select(['started_at', 'ended_at', 'status', 'source', 'sensor_confirmed'])
    .where('machine_id', '=', machineId)
    .where('sensor_confirmed', '=', true)
    .where('started_at', '>=', from)
    .orderBy('started_at', 'desc')
    .limit(5)
    .execute();
  const device = m.device_id
    ? await ctx.db.selectFrom('devices').select(['last_seen_at', 'last_power_w', 'online']).where('id', '=', m.device_id).executeTakeFirst()
    : null;
  return {
    observed: true as const,
    deviceOnline: device?.online ?? false,
    lastSeenAt: device?.last_seen_at?.toISOString() ?? null,
    lastPowerW: device?.last_power_w ?? null,
    sensorCyclesLastHour: cycles.map((c) => ({
      startedAt: c.started_at.toISOString(),
      endedAt: c.ended_at?.toISOString() ?? null,
      status: c.status,
    })),
  };
}
