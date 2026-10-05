import type { AlertKind, TicketSeverity } from '@dobi/shared';
import { sql } from 'kysely';
import type { Ctx } from '../../context.js';
import { channels } from '../../events/bus.js';

export interface RaiseAlert {
  tenantId: string;
  shopId?: string | null;
  machineId?: string | null;
  kind: AlertKind;
  severity?: TicketSeverity;
  message: string;
  /**
   * Only one unresolved alert per key. Raising it again keeps that alert but refreshes its message
   * and machine (e.g. "due on 2 machines" → "due on D2" after one is serviced) without notifying again.
   */
  dedupeKey: string;
}

export async function raiseAlert(ctx: Ctx, a: RaiseAlert) {
  const res = await sql<{ id: string; inserted: boolean; changed: boolean }>`
    INSERT INTO alerts (tenant_id, shop_id, machine_id, kind, severity, message, dedupe_key, created_at)
    VALUES (${a.tenantId}, ${a.shopId ?? null}, ${a.machineId ?? null}, ${a.kind}, ${a.severity ?? 'medium'}, ${a.message}, ${a.dedupeKey}, ${ctx.now()})
    ON CONFLICT (tenant_id, dedupe_key) WHERE status <> 'resolved'
    DO UPDATE SET message = EXCLUDED.message, machine_id = EXCLUDED.machine_id
      WHERE alerts.message IS DISTINCT FROM EXCLUDED.message OR alerts.machine_id IS DISTINCT FROM EXCLUDED.machine_id
    RETURNING id, (xmax = 0) AS inserted, true AS changed
  `.execute(ctx.db);
  const row = res.rows[0];
  if (!row) return null; // already open with the same details
  if (!row.inserted) {
    await ctx.bus.publish(channels.tenant(a.tenantId), 'alert.updated', { id: row.id, message: a.message, machineId: a.machineId ?? null });
    return null;
  }
  const id = row.id;
  const alert = { id, ...a, severity: a.severity ?? 'medium', status: 'open' };
  await ctx.bus.publish(channels.tenant(a.tenantId), 'alert.created', alert);
  if ((a.severity ?? 'medium') !== 'low') {
    await ctx.notify.toTenant(a.tenantId, { title: 'DobiMaster alert', body: a.message, url: '/owner', tag: a.dedupeKey }, a.shopId ?? undefined);
  }
  return id;
}

export async function resolveAlert(ctx: Ctx, tenantId: string, dedupeKey: string) {
  const rows = await ctx.db
    .updateTable('alerts')
    .set({ status: 'resolved', resolved_at: ctx.now() })
    .where('tenant_id', '=', tenantId)
    .where('dedupe_key', '=', dedupeKey)
    .where('status', '<>', 'resolved')
    .returning('id')
    .execute();
  if (rows.length) await ctx.bus.publish(channels.tenant(tenantId), 'alert.resolved', { dedupeKey });
}
