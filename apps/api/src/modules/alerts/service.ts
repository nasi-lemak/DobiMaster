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
  /** Only one unresolved alert per key — raising again is a no-op. */
  dedupeKey: string;
}

export async function raiseAlert(ctx: Ctx, a: RaiseAlert) {
  const res = await sql<{ id: string }>`
    INSERT INTO alerts (tenant_id, shop_id, machine_id, kind, severity, message, dedupe_key, created_at)
    VALUES (${a.tenantId}, ${a.shopId ?? null}, ${a.machineId ?? null}, ${a.kind}, ${a.severity ?? 'medium'}, ${a.message}, ${a.dedupeKey}, ${ctx.now()})
    ON CONFLICT (tenant_id, dedupe_key) WHERE status <> 'resolved' DO NOTHING
    RETURNING id
  `.execute(ctx.db);
  const id = res.rows[0]?.id;
  if (!id) return null;
  const alert = { id, ...a, severity: a.severity ?? 'medium', status: 'open' };
  await ctx.bus.publish(channels.tenant(a.tenantId), 'alert.created', alert);
  if ((a.severity ?? 'medium') !== 'low') {
    await ctx.push.toTenant(a.tenantId, { title: 'DobiMaster alert', body: a.message, url: '/owner', tag: a.dedupeKey }, a.shopId ?? undefined);
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
