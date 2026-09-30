import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';
import { authenticateDevice, ingestPayload, recordHeartbeat } from '../modules/telemetry/service.js';

/** Endpoints for sensors / shop gateways (Phase 2). The MQTT bridge calls the same functions. */
export async function deviceRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/device/telemetry', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req) => {
    const device = await authenticateDevice(ctx, req.headers.authorization);
    const { events } = await ingestPayload(ctx, device, req.body);
    return { ok: true, events: events.map((e) => e.type) };
  });

  app.post('/device/heartbeat', async (req) => {
    const device = await authenticateDevice(ctx, req.headers.authorization);
    await recordHeartbeat(ctx, device);
    return { ok: true };
  });
}
