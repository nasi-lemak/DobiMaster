import type { Ctx } from '../../context.js';
import { raiseAlert, resolveAlert } from '../alerts/service.js';

export interface DueItem {
  planId: string;
  title: string;
  machineId: string;
  machineCode: string;
  shopId: string;
  lastDoneAt: string | null;
  daysSince: number;
  cyclesSince: number;
  runHoursSince: number;
  intervalDays: number | null;
  intervalCycles: number | null;
  intervalRunHours: number | null;
  /** max over configured triggers of (value / interval); ≥ 1 means due. */
  progress: number;
  status: 'ok' | 'due_soon' | 'due';
  cycleSource: 'cycles' | 'counter';
}

/**
 * Cycles since a date = max(recorded cycles, cycle-counter delta from cash collections).
 * In a shop without sensors, staff-entered counter readings are the most reliable cycle count.
 */
async function usageSince(ctx: Ctx, machineId: string, since: Date) {
  const cycles = await ctx.db
    .selectFrom('cycles')
    .select((eb) => [eb.fn.countAll<string>().as('n'), eb.fn.sum<string>('duration_min').as('mins')])
    .where('machine_id', '=', machineId)
    .where('status', 'in', ['running', 'finished', 'collected'])
    .where('started_at', '>=', since)
    .executeTakeFirst();
  const readings = await ctx.db
    .selectFrom('collection_lines as l')
    .innerJoin('collections as c', 'c.id', 'l.collection_id')
    .select(['l.counter_reading', 'c.collected_at'])
    .where('l.machine_id', '=', machineId)
    .where('l.counter_reading', 'is not', null)
    .orderBy('c.collected_at')
    .execute();
  const before = readings.filter((r) => r.collected_at <= since).at(-1) ?? readings.find((r) => r.collected_at > since);
  const latest = readings.at(-1);
  const counterDelta = before && latest && latest !== before ? latest.counter_reading! - before.counter_reading! : 0;
  const n = Number(cycles?.n ?? 0);
  const avgMin = n > 0 ? Number(cycles?.mins ?? 0) / n : 40;
  if (counterDelta > n) return { cycles: counterDelta, runHours: (counterDelta * avgMin) / 60, source: 'counter' as const };
  return { cycles: n, runHours: Number(cycles?.mins ?? 0) / 60, source: 'cycles' as const };
}

export async function maintenanceDue(ctx: Ctx, tenantId: string, shopIds: string[]): Promise<DueItem[]> {
  if (!shopIds.length) return [];
  const plans = await ctx.db.selectFrom('maintenance_plans').selectAll().where('tenant_id', '=', tenantId).where('shop_id', 'in', shopIds).where('active', '=', true).execute();
  const machines = await ctx.db
    .selectFrom('machines')
    .select(['id', 'code', 'shop_id', 'type', 'installed_at', 'created_at'])
    .where('tenant_id', '=', tenantId)
    .where('shop_id', 'in', shopIds)
    .where('deleted_at', 'is', null)
    .execute();
  const now = ctx.now();
  const out: DueItem[] = [];
  for (const plan of plans) {
    const scope = machines.filter((m) => (plan.machine_id ? m.id === plan.machine_id : m.shop_id === plan.shop_id && m.type === plan.machine_type));
    for (const m of scope) {
      const last = await ctx.db
        .selectFrom('maintenance_logs')
        .select('performed_at')
        .where('machine_id', '=', m.id)
        .where('plan_id', '=', plan.id)
        .orderBy('performed_at', 'desc')
        .executeTakeFirst();
      const baseline = last?.performed_at ?? (m.installed_at ? new Date(m.installed_at) : plan.created_at > m.created_at ? plan.created_at : m.created_at);
      const usage = await usageSince(ctx, m.id, baseline);
      const daysSince = (now.getTime() - baseline.getTime()) / 86_400_000;
      const ratios = [
        plan.interval_days ? daysSince / plan.interval_days : 0,
        plan.interval_cycles ? usage.cycles / plan.interval_cycles : 0,
        plan.interval_run_hours ? usage.runHours / plan.interval_run_hours : 0,
      ];
      const progress = Math.max(...ratios);
      out.push({
        planId: plan.id,
        title: plan.title,
        machineId: m.id,
        machineCode: m.code,
        shopId: m.shop_id,
        lastDoneAt: last?.performed_at.toISOString() ?? null,
        daysSince: Math.floor(daysSince),
        cyclesSince: usage.cycles,
        runHoursSince: Math.round(usage.runHours * 10) / 10,
        intervalDays: plan.interval_days,
        intervalCycles: plan.interval_cycles,
        intervalRunHours: plan.interval_run_hours,
        progress,
        status: progress >= 1 ? 'due' : progress >= 0.85 ? 'due_soon' : 'ok',
        cycleSource: usage.source,
      });
    }
  }
  return out.sort((a, b) => b.progress - a.progress);
}

export async function logMaintenance(
  ctx: Ctx,
  input: { tenantId: string; machineId: string; planId?: string | null; performedAt?: Date; userId: string; notes?: string | null; costSen?: number | null },
) {
  const m = await ctx.db.selectFrom('machines').select(['shop_id', 'type']).where('id', '=', input.machineId).where('tenant_id', '=', input.tenantId).executeTakeFirst();
  if (!m) throw Object.assign(new Error('Machine not found'), { statusCode: 404 });
  if (input.planId) {
    // The plan must be this business's and cover this machine (its own plan, or its shop + type).
    const plan = await ctx.db.selectFrom('maintenance_plans').select(['shop_id', 'machine_id', 'machine_type']).where('id', '=', input.planId).where('tenant_id', '=', input.tenantId).executeTakeFirst();
    const covers = plan && (plan.machine_id ? plan.machine_id === input.machineId : plan.shop_id === m.shop_id && plan.machine_type === m.type);
    if (!covers) throw Object.assign(new Error('That plan does not cover this machine'), { statusCode: 400 });
  }
  const row = await ctx.db
    .insertInto('maintenance_logs')
    .values({
      tenant_id: input.tenantId,
      shop_id: m.shop_id,
      machine_id: input.machineId,
      plan_id: input.planId ?? null,
      performed_at: input.performedAt ?? ctx.now(),
      performed_by: input.userId,
      notes: input.notes ?? null,
      cost_sen: input.costSen ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row;
}

export async function sweepMaintenance(ctx: Ctx) {
  const tenants = await ctx.db.selectFrom('tenants').select('id').execute();
  for (const t of tenants) {
    const shops = await ctx.db.selectFrom('shops').select(['id', 'name']).where('tenant_id', '=', t.id).execute();
    const due = (await maintenanceDue(ctx, t.id, shops.map((s) => s.id))).filter((d) => d.status === 'due');
    // One alert per plan (a plan usually covers every dryer or washer in a shop).
    const byPlan = new Map<string, DueItem[]>();
    for (const d of due) byPlan.set(d.planId, [...(byPlan.get(d.planId) ?? []), d]);
    for (const [planId, items] of byPlan) {
      const codes = items.map((i) => i.machineCode).sort();
      await raiseAlert(ctx, {
        tenantId: t.id,
        shopId: items[0]!.shopId,
        machineId: items.length === 1 ? items[0]!.machineId : null,
        kind: 'maintenance_due',
        severity: 'low',
        message: `"${items[0]!.title}" is due on ${codes.length === 1 ? codes[0] : `${codes.length} machines (${codes.join(', ')})`}`,
        dedupeKey: `maintenance_due:${planId}`,
      });
    }
    // Resolve plan alerts that are no longer due on any machine.
    const open = await ctx.db.selectFrom('alerts').select('dedupe_key').where('tenant_id', '=', t.id).where('kind', '=', 'maintenance_due').where('status', '<>', 'resolved').execute();
    for (const a of open) if (!byPlan.has(a.dedupe_key.split(':')[1] ?? '')) await resolveAlert(ctx, t.id, a.dedupe_key);
  }
}
