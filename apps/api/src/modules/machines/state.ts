import { DEFAULT_SHOP_SETTINGS, FAULT_CATEGORIES, type MachineStateEvent, type ShopSettings } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import type { Shop } from '../../db/types.js';
import { channels } from '../../events/bus.js';
import { deriveMachineState, type Derived } from './derive.js';

export function shopSettings(shop: Pick<Shop, 'settings'>): ShopSettings {
  return { ...DEFAULT_SHOP_SETTINGS, ...(shop.settings ?? {}) };
}

/** Customer fault reports count towards an automatic "faulty" state for this long. */
export const FAULT_REPORT_WINDOW_MS = 24 * 3600_000;

export async function countFaultReporters(ctx: Ctx, machineId: string): Promise<{ n: number; oldest: Date | null }> {
  const since = new Date(ctx.now().getTime() - FAULT_REPORT_WINDOW_MS);
  const row = await ctx.db
    .selectFrom('tickets')
    .select((eb) => [eb.fn.count<string>(eb.fn.coalesce('customer_id', 'id')).distinct().as('n'), eb.fn.min('created_at').as('oldest')])
    .where('machine_id', '=', machineId)
    .where('counts_as_fault', '=', true)
    .where('status', 'in', ['open', 'in_progress'])
    .where('source', '=', 'customer')
    .where('created_at', '>=', since)
    .where('category', 'in', [...FAULT_CATEGORIES])
    .executeTakeFirst();
  return { n: Number(row?.n ?? 0), oldest: (row?.oldest as Date | null) ?? null };
}

/**
 * Recompute and persist a machine's derived state. Emits machine.state_changed only on change.
 * Every writer (sensor, check-in, staff, payment, jobs) calls this after its own write commits.
 */
export async function recomputeMachineState(ctx: Ctx, machineId: string, reason?: string): Promise<Derived | null> {
  const m = await ctx.db.selectFrom('machines').selectAll().where('id', '=', machineId).executeTakeFirst();
  if (!m || m.deleted_at) return null;
  const shop = await ctx.db.selectFrom('shops').select(['settings', 'tenant_id']).where('id', '=', m.shop_id).executeTakeFirstOrThrow();
  const settings = shopSettings(shop);
  const device = m.device_id
    ? await ctx.db.selectFrom('devices').select(['last_seen_at', 'heartbeat_sec']).where('id', '=', m.device_id).executeTakeFirst()
    : undefined;
  const running = await ctx.db
    .selectFrom('cycles')
    .select(['id', 'source', 'sensor_confirmed', 'expected_end_at'])
    .where('machine_id', '=', machineId)
    .where('status', '=', 'running')
    .executeTakeFirst();
  const lastFinished = running
    ? undefined
    : await ctx.db
        .selectFrom('cycles')
        .select(['id', 'ended_at', 'collected_at', 'status'])
        .where('machine_id', '=', machineId)
        .where('status', 'in', ['finished', 'collected'])
        .orderBy('ended_at', 'desc')
        .limit(1)
        .executeTakeFirst();

  const now = ctx.now();
  const reports = await countFaultReporters(ctx, machineId);
  const derived = deriveMachineState({
    now,
    adminState: m.admin_state,
    staffFault: m.staff_fault,
    faultReporters: reports.n,
    faultReportThreshold: settings.faultReportThreshold,
    observed: m.observation !== 'none',
    device: device ? { lastSeenAt: device.last_seen_at, heartbeatSec: device.heartbeat_sec } : null,
    runningCycle: running
      ? { id: running.id, source: running.source, sensorConfirmed: running.sensor_confirmed, expectedEndAt: running.expected_end_at }
      : null,
    lastFinishedCycle:
      lastFinished && lastFinished.ended_at
        ? { id: lastFinished.id, endedAt: lastFinished.ended_at, collectedAt: lastFinished.status === 'collected' ? (lastFinished.collected_at ?? now) : null }
        : null,
    finishedHoldMin: settings.finishedHoldMin,
  });

  // A customer-reported fault lapses when its oldest report leaves the window; make sure someone recomputes then.
  if (derived.state === 'fault' && derived.source === 'customer' && reports.oldest) {
    const at = new Date(reports.oldest.getTime() + FAULT_REPORT_WINDOW_MS + 1000);
    await ctx.jobs.schedule('machine.recompute', at, { machineId }, `machine.recompute:${machineId}:fault:${at.getTime()}`);
  }

  const changed = derived.state !== m.state || derived.source !== m.state_source || derived.cycleId !== m.current_cycle_id;
  if (!changed) return derived;

  const stateChanged = derived.state !== m.state;
  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .updateTable('machines')
      .set({
        state: derived.state,
        state_source: derived.source,
        current_cycle_id: derived.cycleId,
        ...(stateChanged ? { state_since: now } : {}),
      })
      .where('id', '=', machineId)
      .execute();
    if (stateChanged) {
      await trx.updateTable('machine_state_log').set({ ended_at: now }).where('machine_id', '=', machineId).where('ended_at', 'is', null).execute();
      await trx
        .insertInto('machine_state_log')
        .values({
          tenant_id: m.tenant_id,
          shop_id: m.shop_id,
          machine_id: machineId,
          state: derived.state,
          source: derived.source,
          reason: reason ?? null,
          started_at: now,
        })
        .execute();
    }
  });

  const evt: MachineStateEvent = {
    machineId,
    shopId: m.shop_id,
    state: derived.state,
    source: derived.source,
    since: (stateChanged ? now : m.state_since).toISOString(),
    expectedEndAt: derived.expectedEndAt?.toISOString() ?? null,
  };
  await ctx.bus.publish([channels.shop(m.shop_id), channels.tenant(m.tenant_id)], 'machine.state_changed', evt);

  // A "finished" state expires on its own; make sure someone recomputes it.
  if (derived.state === 'finished') {
    const f = lastFinished!;
    await ctx.jobs.schedule(
      'machine.recompute',
      new Date(f.ended_at!.getTime() + settings.finishedHoldMin * 60_000 + 1000),
      { machineId },
      `machine.recompute:${machineId}:${f.id}`,
    );
  }
  return derived;
}
