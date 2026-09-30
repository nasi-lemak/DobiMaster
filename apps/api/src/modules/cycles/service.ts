import { randomUUID } from 'node:crypto';
import { pickText, type Program } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import type { Cycle, Machine } from '../../db/types.js';
import { channels } from '../../events/bus.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { recomputeMachineState, shopSettings } from '../machines/state.js';
import { addMinutes } from '../../lib/time.js';

/** Window in which a customer check-in and a sensor-detected start are considered the same cycle. */
export const MERGE_WINDOW_MIN = 5;

const jobKeys = {
  remind: (id: string) => `cycle.remind:${id}`,
  finish: (id: string) => `cycle.finish:${id}`,
  uncollected: (id: string) => `cycle.uncollected:${id}`,
};

export function pickProgram(machine: Pick<Machine, 'programs'>, programId?: string | null): Program {
  const programs = machine.programs ?? [];
  const p = (programId && programs.find((x) => x.id === programId)) || programs[0];
  if (!p) throw new AppError(422, 'no_programs', 'Machine has no programs configured');
  return p;
}

async function scheduleTimers(ctx: Ctx, cycle: Pick<Cycle, 'id' | 'expected_end_at' | 'shop_id'>) {
  const shop = await ctx.db.selectFrom('shops').select('settings').where('id', '=', cycle.shop_id).executeTakeFirstOrThrow();
  const s = shopSettings(shop);
  const remindAt = addMinutes(cycle.expected_end_at, -s.remindBeforeMin);
  if (remindAt > ctx.now()) {
    await ctx.jobs.reschedule('cycle.remind', remindAt, { cycleId: cycle.id }, jobKeys.remind(cycle.id));
  }
  await ctx.jobs.reschedule('cycle.finish', cycle.expected_end_at, { cycleId: cycle.id }, jobKeys.finish(cycle.id));
}

async function cancelTimers(ctx: Ctx, cycleId: string, includeUncollected = false) {
  await ctx.jobs.cancel(jobKeys.remind(cycleId));
  await ctx.jobs.cancel(jobKeys.finish(cycleId));
  if (includeUncollected) await ctx.jobs.cancel(jobKeys.uncollected(cycleId));
}

async function publishCycle(ctx: Ctx, cycleId: string) {
  const c = await ctx.db.selectFrom('cycles').selectAll().where('id', '=', cycleId).executeTakeFirst();
  if (!c) return;
  const chans = [channels.tenant(c.tenant_id)];
  if (c.customer_id) chans.push(channels.customer(c.customer_id));
  await ctx.bus.publish(chans, 'cycle.updated', serializeCycle(c));
}

export function serializeCycle(c: Cycle) {
  return {
    id: c.id,
    machineId: c.machine_id,
    shopId: c.shop_id,
    source: c.source,
    status: c.status,
    programId: c.program_id,
    programName: c.program_name,
    durationMin: c.duration_min,
    priceSen: c.price_sen,
    startedAt: c.started_at.toISOString(),
    expectedEndAt: c.expected_end_at.toISOString(),
    endedAt: c.ended_at?.toISOString() ?? null,
    collectedAt: c.collected_at?.toISOString() ?? null,
    sensorConfirmed: c.sensor_confirmed,
    paymentId: c.payment_id,
  };
}

function isUniqueViolation(err: unknown) {
  return (err as { code?: string })?.code === '23505';
}

export interface StartCustomerCycleInput {
  id: string;
  customerId: string;
  qrToken: string;
  programId?: string | null;
  /** The customer confirms the machine is actually free although a previous check-in says otherwise. */
  force?: boolean;
}

/**
 * Customer taps "I've started it — notify me". Idempotent by client-generated id.
 * If a sensor already detected the start, the check-in is merged into that cycle.
 */
export async function startCustomerCycle(ctx: Ctx, input: StartCustomerCycleInput): Promise<Cycle> {
  const existing = await ctx.db.selectFrom('cycles').selectAll().where('id', '=', input.id).executeTakeFirst();
  if (existing) {
    if (existing.customer_id !== input.customerId) throw conflict('id_taken', 'Cycle id already used');
    return existing;
  }

  const machine = await ctx.db
    .selectFrom('machines')
    .selectAll()
    .where('qr_token', '=', input.qrToken)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!machine) throw notFound('Machine');
  if (machine.admin_state !== 'active') {
    throw new AppError(409, 'machine_unavailable', `Machine is ${machine.admin_state === 'maintenance' ? 'under maintenance' : 'disabled'}`);
  }
  const program = pickProgram(machine, input.programId);
  const now = ctx.now();

  const running = await ctx.db
    .selectFrom('cycles')
    .selectAll()
    .where('machine_id', '=', machine.id)
    .where('status', '=', 'running')
    .executeTakeFirst();

  if (running) {
    if (running.customer_id === input.customerId) return running;
    const sensorOnly = running.source === 'sensor' && !running.customer_id;
    if (sensorOnly) {
      // The sensor saw the machine start; this customer is claiming it — attach them and their program.
      const merged = await ctx.db
        .updateTable('cycles')
        .set({
          customer_id: input.customerId,
          program_id: program.id,
          program_name: pickText(program.name, 'en'),
          duration_min: program.durationMin,
          price_sen: program.priceSen,
          expected_end_at: addMinutes(running.started_at, program.durationMin),
        })
        .where('id', '=', running.id)
        .where('customer_id', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!merged) return startCustomerCycle(ctx, input); // lost a race, retry once
      await scheduleTimers(ctx, merged);
      await recomputeMachineState(ctx, machine.id, 'customer check-in merged with sensor');
      await publishCycle(ctx, merged.id);
      return merged;
    }
    if (!input.force || running.sensor_confirmed) {
      throw new AppError(409, 'machine_in_use', 'Machine appears to be in use', {
        expectedEndAt: running.expected_end_at.toISOString(),
        sensorConfirmed: running.sensor_confirmed,
      });
    }
    // Previous check-in was stale (customer confirms the machine was free). Supersede it quietly.
    await ctx.db
      .updateTable('cycles')
      .set({ status: 'aborted', ended_at: now })
      .where('id', '=', running.id)
      .where('status', '=', 'running')
      .execute();
    await cancelTimers(ctx, running.id, true);
  }

  let cycle: Cycle;
  try {
    cycle = await ctx.db
      .insertInto('cycles')
      .values({
        id: input.id,
        tenant_id: machine.tenant_id,
        shop_id: machine.shop_id,
        machine_id: machine.id,
        source: 'customer',
        status: 'running',
        program_id: program.id,
        program_name: pickText(program.name, 'en'),
        duration_min: program.durationMin,
        price_sen: program.priceSen,
        started_at: now,
        expected_end_at: addMinutes(now, program.durationMin),
        customer_id: input.customerId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await ctx.db.selectFrom('cycles').selectAll().where('id', '=', input.id).executeTakeFirst();
      if (again?.customer_id === input.customerId) return again;
      throw conflict('machine_in_use', 'Machine appears to be in use');
    }
    throw err;
  }

  await scheduleTimers(ctx, cycle);
  await recomputeMachineState(ctx, machine.id, 'customer check-in');
  await publishCycle(ctx, cycle.id);
  return cycle;
}

/** Called by telemetry when the sensor detects a cycle start. */
export async function sensorCycleStart(ctx: Ctx, machine: Machine, at: Date): Promise<Cycle> {
  const running = await ctx.db
    .selectFrom('cycles')
    .selectAll()
    .where('machine_id', '=', machine.id)
    .where('status', '=', 'running')
    .executeTakeFirst();

  if (running) {
    if (running.sensor_confirmed) return running;
    const withinWindow = Math.abs(running.started_at.getTime() - at.getTime()) <= MERGE_WINDOW_MIN * 60_000 || running.source === 'payment';
    if (withinWindow) {
      const confirmed = await ctx.db
        .updateTable('cycles')
        .set({ sensor_confirmed: true, started_at: at, expected_end_at: addMinutes(at, running.duration_min) })
        .where('id', '=', running.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (confirmed.payment_id) {
        await ctx.db
          .updateTable('machine_commands')
          .set({ status: 'confirmed', updated_at: ctx.now() })
          .where('payment_id', '=', confirmed.payment_id)
          .execute();
      }
      await scheduleTimers(ctx, confirmed);
      await recomputeMachineState(ctx, machine.id, 'sensor confirmed start');
      await publishCycle(ctx, confirmed.id);
      return confirmed;
    }
    // A stale check-in (customer forgot / never started). The sensor is authoritative: close it.
    await ctx.db.updateTable('cycles').set({ status: 'aborted', ended_at: at }).where('id', '=', running.id).execute();
    await cancelTimers(ctx, running.id, true);
  }

  const program = pickProgram(machine);
  const cycle = await ctx.db
    .insertInto('cycles')
    .values({
      id: randomUUID(),
      tenant_id: machine.tenant_id,
      shop_id: machine.shop_id,
      machine_id: machine.id,
      source: 'sensor',
      status: 'running',
      program_id: program.id,
      program_name: pickText(program.name, 'en'),
      duration_min: program.durationMin,
      price_sen: program.priceSen,
      started_at: at,
      expected_end_at: addMinutes(at, program.durationMin),
      sensor_confirmed: true,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await scheduleTimers(ctx, cycle);
  await recomputeMachineState(ctx, machine.id, 'sensor detected start');
  await publishCycle(ctx, cycle.id);
  return cycle;
}

/** Called by telemetry when the sensor detects the end of a cycle. */
export async function sensorCycleEnd(ctx: Ctx, machine: Machine, at: Date) {
  const running = await ctx.db
    .selectFrom('cycles')
    .selectAll()
    .where('machine_id', '=', machine.id)
    .where('status', '=', 'running')
    .executeTakeFirst();
  if (!running) return null;
  if (!running.sensor_confirmed) {
    await ctx.db.updateTable('cycles').set({ sensor_confirmed: true }).where('id', '=', running.id).execute();
  }
  return finishCycle(ctx, running.id, at);
}

/** Sensor saw a too-short power blip after already reporting a start: undo a sensor-only cycle. */
export async function sensorCycleDiscarded(ctx: Ctx, machine: Machine) {
  const running = await ctx.db
    .selectFrom('cycles')
    .selectAll()
    .where('machine_id', '=', machine.id)
    .where('status', '=', 'running')
    .executeTakeFirst();
  if (!running) return;
  if (running.source === 'sensor' && !running.customer_id) {
    await ctx.db.updateTable('cycles').set({ status: 'aborted', ended_at: ctx.now() }).where('id', '=', running.id).execute();
    await cancelTimers(ctx, running.id, true);
    await recomputeMachineState(ctx, machine.id, 'sensor blip discarded');
  }
}

export async function finishCycle(ctx: Ctx, cycleId: string, endedAt: Date) {
  const cycle = await ctx.db
    .updateTable('cycles')
    .set({ status: 'finished', ended_at: endedAt })
    .where('id', '=', cycleId)
    .where('status', '=', 'running')
    .returningAll()
    .executeTakeFirst();
  if (!cycle) return null;
  await cancelTimers(ctx, cycleId);

  if (cycle.customer_id) {
    const { shop, machine } = await cycleContext(ctx, cycle);
    const s = shopSettings(shop);
    await ctx.push.toCustomer(
      cycle.customer_id,
      'cycle_finished',
      { machine: machine.code, shop: shop.name },
      { url: `/me`, tag: `cycle-${cycle.id}` },
    );
    await ctx.jobs.schedule(
      'cycle.uncollected',
      addMinutes(endedAt, s.uncollectedReminderMin),
      { cycleId: cycle.id, n: 1 },
      jobKeys.uncollected(cycle.id),
    );
  }
  await recomputeMachineState(ctx, cycle.machine_id, 'cycle finished');
  await publishCycle(ctx, cycle.id);
  return cycle;
}

async function cycleContext(ctx: Ctx, cycle: Cycle) {
  const shop = await ctx.db.selectFrom('shops').selectAll().where('id', '=', cycle.shop_id).executeTakeFirstOrThrow();
  const machine = await ctx.db.selectFrom('machines').selectAll().where('id', '=', cycle.machine_id).executeTakeFirstOrThrow();
  return { shop, machine };
}

async function ownCycle(ctx: Ctx, customerId: string, cycleId: string) {
  const c = await ctx.db.selectFrom('cycles').selectAll().where('id', '=', cycleId).executeTakeFirst();
  if (!c || c.customer_id !== customerId) throw notFound('Cycle');
  return c;
}

/** Customer tapped "I've collected my laundry". Frees the machine immediately. */
export async function collectCycle(ctx: Ctx, customerId: string, cycleId: string) {
  const c = await ownCycle(ctx, customerId, cycleId);
  if (c.status === 'collected') return c;
  if (c.status !== 'running' && c.status !== 'finished') throw conflict('invalid_state', `Cycle is ${c.status}`);
  if (c.status === 'running' && c.sensor_confirmed) throw conflict('still_running', 'The sensor shows this machine is still running');
  const now = ctx.now();
  const updated = await ctx.db
    .updateTable('cycles')
    .set({ status: 'collected', collected_at: now, ended_at: c.ended_at ?? now })
    .where('id', '=', cycleId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await cancelTimers(ctx, cycleId, true);
  await recomputeMachineState(ctx, c.machine_id, 'customer collected');
  await publishCycle(ctx, cycleId);
  return updated;
}

/** Customer cancels a mistaken check-in. If a sensor confirms the machine runs, only detach the customer. */
export async function cancelCycle(ctx: Ctx, customerId: string, cycleId: string) {
  const c = await ownCycle(ctx, customerId, cycleId);
  if (c.status !== 'running') throw conflict('invalid_state', `Cycle is ${c.status}`);
  if (c.sensor_confirmed || c.source === 'payment') {
    await ctx.db.updateTable('cycles').set({ customer_id: null }).where('id', '=', cycleId).execute();
    await cancelTimers(ctx, cycleId, true);
    await ctx.bus.publish(channels.customer(customerId), 'cycle.updated', { ...serializeCycle(c), status: 'cancelled' });
    return;
  }
  await ctx.db.updateTable('cycles').set({ status: 'cancelled', ended_at: ctx.now() }).where('id', '=', cycleId).execute();
  await cancelTimers(ctx, cycleId, true);
  await recomputeMachineState(ctx, c.machine_id, 'customer cancelled');
  await publishCycle(ctx, cycleId);
}

/** Staff clears a stale check-in or a "finished" machine they have emptied. */
export async function staffClearMachine(ctx: Ctx, machineId: string) {
  const now = ctx.now();
  const open = await ctx.db
    .selectFrom('cycles')
    .select(['id', 'status', 'sensor_confirmed'])
    .where('machine_id', '=', machineId)
    .where('status', 'in', ['running', 'finished'])
    .execute();
  for (const c of open) {
    if (c.status === 'running' && c.sensor_confirmed) continue; // the machine really is running
    await ctx.db
      .updateTable('cycles')
      .set(c.status === 'running' ? { status: 'aborted', ended_at: now } : { status: 'collected', collected_at: now })
      .where('id', '=', c.id)
      .execute();
    await cancelTimers(ctx, c.id, true);
  }
  await recomputeMachineState(ctx, machineId, 'staff cleared');
}

// ---- job handlers -------------------------------------------------------------------------

export function registerCycleJobs(ctx: Ctx) {
  ctx.jobs.register('cycle.remind', async ({ cycleId }) => {
    const c = await ctx.db.selectFrom('cycles').selectAll().where('id', '=', cycleId).executeTakeFirst();
    if (!c || c.status !== 'running' || !c.customer_id) return;
    const { shop, machine } = await cycleContext(ctx, c);
    const min = Math.max(1, Math.round((c.expected_end_at.getTime() - ctx.now().getTime()) / 60_000));
    await ctx.push.toCustomer(c.customer_id, 'cycle_almost_done', { machine: machine.code, shop: shop.name, min }, { url: '/me', tag: `cycle-${c.id}` });
  });

  ctx.jobs.register('cycle.finish', async ({ cycleId }) => {
    const c = await ctx.db.selectFrom('cycles').selectAll().where('id', '=', cycleId).executeTakeFirst();
    if (!c || c.status !== 'running') return;
    if (c.sensor_confirmed) {
      // The sensor decides when it ends — unless the device went offline mid-cycle.
      const m = await ctx.db.selectFrom('machines').select(['state']).where('id', '=', c.machine_id).executeTakeFirst();
      if (m?.state !== 'offline') return;
    }
    await finishCycle(ctx, c.id, c.expected_end_at);
  });

  ctx.jobs.register('cycle.uncollected', async ({ cycleId, n }) => {
    const c = await ctx.db.selectFrom('cycles').selectAll().where('id', '=', cycleId).executeTakeFirst();
    if (!c || c.status !== 'finished' || !c.customer_id || !c.ended_at) return;
    const { shop, machine } = await cycleContext(ctx, c);
    const min = Math.round((ctx.now().getTime() - c.ended_at.getTime()) / 60_000);
    const sub = await ctx.db.selectFrom('push_subscriptions').select('locale').where('customer_id', '=', c.customer_id).executeTakeFirst();
    const policy = pickText(shop.policy, (sub?.locale as 'en') ?? 'en');
    await ctx.push.toCustomer(c.customer_id, 'cycle_uncollected', { machine: machine.code, shop: shop.name, min, policy }, { url: '/me' });
    if (Number(n) < 2) {
      await ctx.jobs.schedule('cycle.uncollected', addMinutes(ctx.now(), 10), { cycleId, n: Number(n) + 1 }, `${jobKeys.uncollected(cycleId)}:${Number(n) + 1}`);
    }
  });

  ctx.jobs.register('machine.recompute', async ({ machineId }) => {
    await recomputeMachineState(ctx, machineId, 'timer');
  });
}
