import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import type { BusEvent } from '../events/bus.js';
import { SESSION_COOKIE, loadOwnerSession } from '../auth/owner.js';
import { customerIdFromToken } from '../auth/guest.js';

function parseCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const subMsg = z.object({ op: z.literal('sub'), channels: z.array(z.string().max(80)).max(50), token: z.string().max(2000).optional() });

/**
 * WebSocket fan-out. Clients subscribe to channels; authorization is checked per channel:
 *  shop:*      public (no personal data is ever published there)
 *  tenant:*    members of that tenant (session cookie)
 *  customer:*  holder of that customer's guest token
 */
export async function wsRoutes(app: FastifyInstance, ctx: Ctx) {
  const sockets = new Map<WebSocket, Set<string>>();

  ctx.bus.onRemote((evt: BusEvent) => {
    const msg = JSON.stringify({ op: 'evt', channel: evt.channel, type: evt.type, data: evt.data, ts: evt.ts });
    for (const [ws, chans] of sockets) {
      if (chans.has(evt.channel) && ws.readyState === 1) ws.send(msg);
    }
  });

  const ping = setInterval(() => {
    for (const ws of sockets.keys()) if (ws.readyState === 1) ws.ping();
  }, 25_000);
  app.addHook('onClose', async () => clearInterval(ping));

  app.get('/ws', { websocket: true }, async (socket, req) => {
    sockets.set(socket, new Set());

    socket.on('message', async (raw) => {
      let parsed;
      try {
        parsed = subMsg.parse(JSON.parse(String(raw)));
      } catch {
        socket.send(JSON.stringify({ op: 'error', error: 'bad_message' }));
        return;
      }
      // Re-read the session per subscribe: a socket opened before login can still join tenant channels.
      const owner = await loadOwnerSession(ctx, parseCookie(req.headers.cookie)[SESSION_COOKIE]);
      const customerId = await customerIdFromToken(parsed.token);
      const allowed = new Set<string>();
      for (const ch of parsed.channels) {
        const [kind, id] = ch.split(':');
        if (kind === 'shop' && id) allowed.add(ch);
        else if (kind === 'tenant' && owner && id === owner.tenantId) allowed.add(ch);
        else if (kind === 'customer' && customerId && id === customerId) allowed.add(ch);
      }
      const set = sockets.get(socket);
      if (set) for (const ch of allowed) set.add(ch);
      socket.send(JSON.stringify({ op: 'subscribed', channels: [...allowed] }));
    });
    socket.on('close', () => sockets.delete(socket));
  });
}
