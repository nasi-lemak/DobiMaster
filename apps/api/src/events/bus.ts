import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';

export interface BusEvent {
  channel: string;
  type: string;
  data: unknown;
  ts: string;
}

type RemoteListener = (evt: BusEvent) => void;
type LocalHandler = (evt: BusEvent) => void | Promise<void>;

const PG_CHANNEL = 'dobi_events';

/**
 * Real-time fan-out. publish() → pg_notify → every replica's LISTEN connection → WebSocket hub.
 * Events are hints for UIs; REST stays the source of truth. Publish only after the DB transaction commits.
 */
export class EventBus {
  private listenClient: pg.PoolClient | null = null;
  private remote = new Set<RemoteListener>();
  private local = new Map<string, Set<LocalHandler>>();

  constructor(
    private pool: pg.Pool,
    private log: FastifyBaseLogger,
  ) {}

  async start() {
    this.listenClient = await this.pool.connect();
    this.listenClient.on('notification', (msg) => {
      if (msg.channel !== PG_CHANNEL || !msg.payload) return;
      try {
        const evt = JSON.parse(msg.payload) as BusEvent;
        for (const l of this.remote) l(evt);
      } catch (err) {
        this.log.warn({ err }, 'bad bus payload');
      }
    });
    this.listenClient.on('error', (err) => this.log.error({ err }, 'bus listen connection error'));
    await this.listenClient.query(`LISTEN ${PG_CHANNEL}`);
  }

  async stop() {
    if (this.listenClient) {
      await this.listenClient.query(`UNLISTEN ${PG_CHANNEL}`).catch(() => {});
      this.listenClient.release();
      this.listenClient = null;
    }
  }

  /** Subscribe to events arriving from any replica (used by the WebSocket hub). */
  onRemote(listener: RemoteListener) {
    this.remote.add(listener);
    return () => this.remote.delete(listener);
  }

  /** In-process domain handlers; run only on the replica that published. */
  on(type: string, handler: LocalHandler) {
    let set = this.local.get(type);
    if (!set) this.local.set(type, (set = new Set()));
    set.add(handler);
  }

  async publish(channel: string | string[], type: string, data: unknown) {
    const ts = new Date().toISOString();
    for (const ch of Array.isArray(channel) ? channel : [channel]) {
      const evt: BusEvent = { channel: ch, type, data, ts };
      try {
        await this.pool.query('SELECT pg_notify($1, $2)', [PG_CHANNEL, JSON.stringify(evt)]);
      } catch (err) {
        this.log.error({ err, type }, 'bus publish failed');
      }
    }
    const handlers = this.local.get(type);
    if (handlers) {
      const evt: BusEvent = { channel: Array.isArray(channel) ? channel[0]! : channel, type, data, ts };
      for (const h of handlers) {
        try {
          await h(evt);
        } catch (err) {
          this.log.error({ err, type }, 'local event handler failed');
        }
      }
    }
  }
}

export const channels = {
  shop: (id: string) => `shop:${id}`,
  tenant: (id: string) => `tenant:${id}`,
  customer: (id: string) => `customer:${id}`,
};
