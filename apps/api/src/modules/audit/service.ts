import type { Ctx } from '../../context.js';
import { json } from '../../db/index.js';

export interface Actor {
  userId: string;
  name: string;
  tenantId: string;
  ip?: string;
}

/** Append-only record of every owner-side mutation. */
export async function audit(
  ctx: Ctx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
) {
  await ctx.db
    .insertInto('audit_log')
    .values({
      tenant_id: actor.tenantId,
      actor_id: actor.userId,
      actor_name: actor.name,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before: before === undefined ? null : json(before),
      after: after === undefined ? null : json(after),
      ip: actor.ip ?? null,
      created_at: ctx.now(),
    })
    .execute();
}
