import { sql } from 'kysely';
import type { Ctx } from '../context.js';
import { registerCycleJobs } from '../modules/cycles/service.js';
import { registerPaymentJobs } from '../modules/payments/service.js';
import { ingestSamples, sweepDevices } from '../modules/telemetry/service.js';
import { sweepMaintenance } from '../modules/maintenance/service.js';
import { sweepLowUsage } from '../modules/analytics/service.js';

export function registerJobs(ctx: Ctx, opts: { periodic: boolean }) {
  registerCycleJobs(ctx);
  registerPaymentJobs(ctx);

  ctx.jobs.register('sweep.devices', () => sweepDevices(ctx));
  ctx.jobs.register('sweep.maintenance', () => sweepMaintenance(ctx));
  ctx.jobs.register('sweep.low_usage', () => sweepLowUsage(ctx));
  ctx.jobs.register('sweep.cleanup', async () => {
    const cutoff = new Date(ctx.now().getTime() - 14 * 86_400_000);
    await ctx.db.deleteFrom('jobs').where('status', 'in', ['done', 'cancelled']).where('updated_at', '<', cutoff).execute();
  });

  // Simulator plumbing (demo devices): emit power readings and keep simulated sensors "online".
  // `holdSec`: report the reading as held for that long (two samples), so detectors with start/end debounce trigger.
  ctx.jobs.register('sim.power', async ({ deviceId, powerW, holdSec }) => {
    const now = ctx.now().getTime();
    const w = Number(powerW);
    const samples = holdSec ? [{ ts: now - Number(holdSec) * 1000, powerW: w }, { ts: now, powerW: w }] : [{ ts: now, powerW: w }];
    await ingestSamples(ctx, deviceId, samples);
  });
  ctx.jobs.register('sim.heartbeat', async () => {
    // Simulator devices, plus demo devices flagged with config.simHeartbeat, never go silent.
    const sims = await ctx.db
      .selectFrom('devices')
      .select('id')
      .where((eb) => eb.or([eb('kind', '=', 'simulator'), sql<boolean>`(config->>'simHeartbeat')::int = 1`]))
      .execute();
    for (const d of sims) await ingestSamples(ctx, d.id, []);
  });

  if (opts.periodic) {
    ctx.jobs.every('sweep.devices', 60_000);
    ctx.jobs.every('sweep.maintenance', 3600_000);
    ctx.jobs.every('sweep.low_usage', 6 * 3600_000);
    ctx.jobs.every('sweep.cleanup', 24 * 3600_000);
    ctx.jobs.every('sim.heartbeat', 30_000);
  }
}
