import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import type { BusEvent } from '../events/bus.js';
import { SESSION_COOKIE, loadOwnerSession } from '../auth/owner.js';
import { customerIdFromToken } from '../auth/guest.js';

const subMsg = z.object({ op: z.literal('sub'), channels: z.array(z.string().max(80)).max(50), token: z.string().max(2000).optional() });

interface SocketState {
  channels: Set<string>;
  /** Owner session cookie seen at connect; re-validated periodically while tenant channels are held. */
  sessionToken?: string;
}

/**
 * WebSocket fan-out. Clients subscribe to channels; authorization is checked per channel:
 *  shop:*      public (only machine state is ever published there)
 *  tenant:*    members of that tenant (session cookie). Delivered as type-only "refetch" hints, with
 *              no payload: the dashboard reloads through the REST API, which applies shop scoping and
 *              revenue permissions. Sessions are re-checked every `revalidateMs`; revoked ones are cut off.
 *  customer:*  holder of that customer's guest token
 */
export async function wsRoutes(app: FastifyInstance, ctx: Ctx, opts: { revalidateMs?: number } = {}) {
  const sockets = new Map<WebSocket, SocketState>();

  ctx.bus.onRemote((evt: BusEvent) => {
    const full = JSON.stringify({ op: 'evt', channel: evt.channel, type: evt.type, data: evt.data, ts: evt.ts });
    const hint = JSON.stringify({ op: 'evt', channel: evt.channel, type: evt.type, ts: evt.ts });
    const msg = evt.channel.startsWith('tenant:') ? hint : full;
    for (const [ws, st] of sockets) {
      if (st.channels.has(evt.channel) && ws.readyState === 1) ws.send(msg);
    }
  });

  // Keep-alive pings, and drop tenant access for sessions that were revoked (logout, staff removed, password reset).
  let checking = false;
  const revalidate = async () => {
    if (checking) return;
    checking = true;
    try {
      for (const [ws, st] of sockets) {
        if (ws.readyState === 1) ws.ping();
        if (![...st.channels].some((c) => c.startsWith('tenant:'))) continue;
        const owner = await loadOwnerSession(ctx, st.sessionToken).catch(() => null);
        if (!owner) {
          for (const c of [...st.channels]) if (c.startsWith('tenant:')) st.channels.delete(c);
          if (ws.readyState === 1) ws.close(4001, 'session ended');
        }
      }
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void revalidate(), opts.revalidateMs ?? 25_000);
  app.addHook('onClose', async () => clearInterval(timer));

  app.get('/ws', { websocket: true }, async (socket, req) => {
    // @fastify/cookie has already parsed (and safely decoded) the upgrade request's cookies.
    const state: SocketState = { channels: new Set(), sessionToken: req.cookies?.[SESSION_COOKIE] };
    sockets.set(socket, state);

    socket.on('message', async (raw) => {
      try {
        let parsed;
        try {
          parsed = subMsg.parse(JSON.parse(String(raw)));
        } catch {
          socket.send(JSON.stringify({ op: 'error', error: 'bad_message' }));
          return;
        }
        const owner = await loadOwnerSession(ctx, state.sessionToken);
        const customerId = await customerIdFromToken(parsed.token);
        const allowed = new Set<string>();
        for (const ch of parsed.channels) {
          const [kind, id] = ch.split(':');
          if (kind === 'shop' && id) allowed.add(ch);
          else if (kind === 'tenant' && owner && id === owner.tenantId) allowed.add(ch);
          else if (kind === 'customer' && customerId && id === customerId) allowed.add(ch);
        }
        for (const ch of allowed) state.channels.add(ch);
        socket.send(JSON.stringify({ op: 'subscribed', channels: [...allowed] }));
      } catch (err) {
        // Never let one socket's bad input or a transient DB error take the process down.
        req.log.warn({ err }, 'ws message failed');
        if (socket.readyState === 1) socket.send(JSON.stringify({ op: 'error', error: 'server_error' }));
      }
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });
}
