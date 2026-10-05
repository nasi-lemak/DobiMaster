import type { Ctx } from '../../context.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { pickProgram } from '../cycles/service.js';

export interface CollectionInput {
  /** Client-chosen id: re-sending the same collection returns the first one instead of a duplicate. */
  id?: string;
  tenantId: string;
  shopId: string;
  userId: string;
  collectedAt?: Date;
  note?: string | null;
  lines: Array<{ machineId: string; amountSen: number; counterReading?: number | null }>;
}

export async function recordCollection(ctx: Ctx, input: CollectionInput) {
  if (!input.lines.length) throw badRequest('Add at least one machine');
  if (input.id) {
    const existing = await ctx.db.selectFrom('collections').selectAll().where('id', '=', input.id).executeTakeFirst();
    if (existing) {
      if (existing.tenant_id !== input.tenantId || existing.collected_by !== input.userId) throw conflict('id_taken', 'Collection id already used');
      return existing;
    }
  }
  const machines = await ctx.db.selectFrom('machines').select('id').where('shop_id', '=', input.shopId).where('tenant_id', '=', input.tenantId).where('deleted_at', 'is', null).execute();
  const valid = new Set(machines.map((m) => m.id));
  for (const l of input.lines) if (!valid.has(l.machineId)) throw notFound('Machine');
  return ctx.db.transaction().execute(async (trx) => {
    const c = await trx
      .insertInto('collections')
      .values({ ...(input.id ? { id: input.id } : {}), tenant_id: input.tenantId, shop_id: input.shopId, collected_at: input.collectedAt ?? ctx.now(), collected_by: input.userId, note: input.note ?? null })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('collection_lines')
      .values(input.lines.map((l) => ({ collection_id: c.id, machine_id: l.machineId, amount_sen: l.amountSen, counter_reading: l.counterReading ?? null })))
      .execute();
    return c;
  });
}

/**
 * Cash reconciliation: for consecutive collections of the same machine, compare cash collected
 * with what the machine *should* have taken — counter delta (or sensor-counted cycles) × list price.
 * A persistent shortfall points to skimming, a jammed coin mechanism or free-running faults.
 */
/** Average price actually chosen on this machine (program mix), falling back to the base program. */
async function typicalPrice(ctx: Ctx, machineId: string, fallback: number) {
  const r = await ctx.db
    .selectFrom('cycles')
    .select((eb) => [eb.fn.avg<string>('price_sen').as('avg'), eb.fn.countAll<string>().as('n')])
    .where('machine_id', '=', machineId)
    .where('price_sen', 'is not', null)
    .where('started_at', '>=', new Date(ctx.now().getTime() - 90 * 86_400_000))
    .executeTakeFirst();
  return Number(r?.n ?? 0) >= 10 ? Math.round(Number(r!.avg)) : fallback;
}

export async function reconciliation(ctx: Ctx, tenantId: string, shopIds: string[], limit = 60) {
  if (!shopIds.length) return [];
  const lines = await ctx.db
    .selectFrom('collection_lines as l')
    .innerJoin('collections as c', 'c.id', 'l.collection_id')
    .innerJoin('machines as m', 'm.id', 'l.machine_id')
    .innerJoin('shops as s', 's.id', 'c.shop_id')
    .select(['l.machine_id', 'l.amount_sen', 'l.counter_reading', 'c.collected_at', 'c.id as collection_id', 'm.code', 'm.programs', 'm.observation', 's.name as shop_name', 'c.shop_id'])
    .where('c.tenant_id', '=', tenantId)
    .where('c.shop_id', 'in', shopIds)
    .orderBy('c.collected_at', 'asc')
    .execute();
  const prevByMachine = new Map<string, (typeof lines)[number]>();
  const out = [];
  for (const l of lines) {
    const prev = prevByMachine.get(l.machine_id);
    prevByMachine.set(l.machine_id, l);
    if (!prev) continue;
    const price = await typicalPrice(ctx, l.machine_id, pickProgram({ programs: l.programs }).priceSen);
    let expectedCycles: number | null = null;
    let basis: 'counter' | 'sensor' | null = null;
    if (l.counter_reading != null && prev.counter_reading != null && l.counter_reading >= prev.counter_reading) {
      expectedCycles = l.counter_reading - prev.counter_reading;
      basis = 'counter';
    } else if (l.observation !== 'none') {
      const r = await ctx.db
        .selectFrom('cycles')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('machine_id', '=', l.machine_id)
        .where('sensor_confirmed', '=', true)
        .where('source', '<>', 'payment') // app-paid cycles never put coins in the box
        .where('started_at', '>=', prev.collected_at)
        .where('started_at', '<', l.collected_at)
        .executeTakeFirst();
      expectedCycles = Number(r?.n ?? 0);
      basis = 'sensor';
    }
    const expectedSen = expectedCycles == null ? null : expectedCycles * price;
    out.push({
      collectionId: l.collection_id,
      shopId: l.shop_id,
      shopName: l.shop_name,
      machineId: l.machine_id,
      code: l.code,
      periodStart: prev.collected_at.toISOString(),
      periodEnd: l.collected_at.toISOString(),
      collectedSen: l.amount_sen,
      expectedCycles,
      expectedSen,
      basis,
      varianceSen: expectedSen == null ? null : l.amount_sen - expectedSen,
      // Expected uses the average program price, so allow some slack; flag only material shortfalls.
      flag: expectedSen != null && expectedSen > 0 && l.amount_sen < expectedSen * 0.88,
    });
  }
  return out.reverse().slice(0, limit);
}
