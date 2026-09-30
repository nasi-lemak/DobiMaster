import { sql } from 'kysely';
import type { MachineStateEvent, MachineType } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import { AppError, notFound } from '../../lib/errors.js';
import { addMinutes } from '../../lib/time.js';

/**
 * "Notify me when a washer is free". Only offered where every machine of the class has a sensor —
 * with check-ins alone we can't know when a machine really frees up. Served first-come,
 * first-served: each machine that becomes free notifies exactly one waiting customer.
 */

export const WATCH_TTL_MIN = 120;

export async function createWatch(ctx: Ctx, input: { customerId: string; shopSlug: string; type: MachineType; capacityKg: number }) {
  const shop = await ctx.db.selectFrom('shops').select(['id']).where('slug', '=', input.shopSlug).where('is_published', '=', true).executeTakeFirst();
  if (!shop) throw notFound('Shop');
  const machines = await ctx.db
    .selectFrom('machines')
    .select(['state', 'observation'])
    .where('shop_id', '=', shop.id)
    .where('type', '=', input.type)
    .where('capacity_kg', '=', String(input.capacityKg))
    .where('deleted_at', 'is', null)
    .execute();
  if (!machines.length) throw notFound('Machine type');
  if (machines.some((m) => m.observation === 'none')) throw new AppError(409, 'not_live', 'Live status is not available for these machines');
  if (machines.some((m) => m.state === 'available')) throw new AppError(409, 'already_free', 'A machine is free right now');
  const now = ctx.now();
  const existing = await ctx.db
    .selectFrom('machine_watches')
    .selectAll()
    .where('customer_id', '=', input.customerId)
    .where('shop_id', '=', shop.id)
    .where('machine_type', '=', input.type)
    .where('capacity_kg', '=', String(input.capacityKg))
    .where('notified_at', 'is', null)
    .where('cancelled_at', 'is', null)
    .executeTakeFirst();
  if (existing && existing.expires_at > now) return existing;
  if (existing) await ctx.db.updateTable('machine_watches').set({ cancelled_at: now }).where('id', '=', existing.id).execute();
  return ctx.db
    .insertInto('machine_watches')
    .values({ customer_id: input.customerId, shop_id: shop.id, machine_type: input.type, capacity_kg: input.capacityKg, created_at: now, expires_at: addMinutes(now, WATCH_TTL_MIN) })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function cancelWatch(ctx: Ctx, customerId: string, id: string) {
  const r = await ctx.db
    .updateTable('machine_watches')
    .set({ cancelled_at: ctx.now() })
    .where('id', '=', id)
    .where('customer_id', '=', customerId)
    .where('notified_at', 'is', null)
    .where('cancelled_at', 'is', null)
    .executeTakeFirst();
  if (!Number(r.numUpdatedRows)) throw notFound('Watch');
}

export async function activeWatches(ctx: Ctx, customerId: string) {
  return ctx.db
    .selectFrom('machine_watches as w')
    .innerJoin('shops as s', 's.id', 'w.shop_id')
    .select(['w.id', 'w.machine_type', 'w.capacity_kg', 'w.created_at', 'w.expires_at', 's.slug as shop_slug', 's.name as shop_name'])
    .where('w.customer_id', '=', customerId)
    .where('w.notified_at', 'is', null)
    .where('w.cancelled_at', 'is', null)
    .where('w.expires_at', '>', ctx.now())
    .orderBy('w.created_at')
    .execute();
}

/** A sensor says a machine became free: tell the longest-waiting customer for that class. */
export async function onMachineFreed(ctx: Ctx, evt: MachineStateEvent) {
  if (evt.state !== 'available' || evt.source !== 'sensor') return null;
  const m = await ctx.db.selectFrom('machines').select(['id', 'code', 'type', 'capacity_kg', 'shop_id']).where('id', '=', evt.machineId).executeTakeFirst();
  if (!m) return null;
  const now = ctx.now();
  // Claim exactly one watcher, safely across replicas.
  const claimed = await sql<{ id: string; customer_id: string }>`
    UPDATE machine_watches SET notified_at = ${now}, notified_machine_id = ${m.id}
    WHERE id = (
      SELECT id FROM machine_watches
      WHERE shop_id = ${m.shop_id} AND machine_type = ${m.type} AND capacity_kg = ${m.capacity_kg}
        AND notified_at IS NULL AND cancelled_at IS NULL AND expires_at > ${now}
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, customer_id
  `.execute(ctx.db);
  const w = claimed.rows[0];
  if (!w) return null;
  const shop = await ctx.db.selectFrom('shops').select(['name', 'slug']).where('id', '=', m.shop_id).executeTakeFirstOrThrow();
  const sub = await ctx.db.selectFrom('customers').select('locale').where('id', '=', w.customer_id).executeTakeFirst();
  const typeName = { washer: { en: 'washer', ms: 'mesin basuh', zh: '洗衣机' }, dryer: { en: 'dryer', ms: 'pengering', zh: '烘干机' } }[m.type][(sub?.locale as 'en' | 'ms' | 'zh') ?? 'en'] ?? m.type;
  await ctx.notify.toCustomer(w.customer_id, 'machine_available', { type: typeName, machine: m.code, shop: shop.name }, { url: `/s/${shop.slug}`, tag: `watch-${w.id}` });
  return w.id;
}

export function registerWatchHandlers(ctx: Ctx) {
  ctx.bus.on('machine.state_changed', async (evt) => {
    await onMachineFreed(ctx, evt.data as MachineStateEvent);
  });
}
