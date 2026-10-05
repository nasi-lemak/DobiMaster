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
  private stopped = false;
  private retryMs = 1000;
  private retryTimer: NodeJS.Timeout | null = null;
  private remote = new Set<RemoteListener>();
  private local = new Map<string, Set<LocalHandler>>();

  constructor(
    private pool: pg.Pool,
    private log: FastifyBaseLogger,
  ) {}

  async start() {
    this.stopped = false;
    await this.listen();
  }

  /**
   * One dedicated LISTEN connection. If it drops (Postgres restart, failover, network blip) it is replaced
   * with back-off; otherwise live updates on this replica would stop until the process restarted.
   */
  private async listen() {
    const client = await this.pool.connect();
    client.on('notification', (msg) => {
      if (msg.channel !== PG_CHANNEL || !msg.payload) return;
      try {
        const evt = JSON.parse(msg.payload) as BusEvent;
        for (const l of this.remote) l(evt);
      } catch (err) {
        this.log.warn({ err }, 'bad bus payload');
      }
    });
    const lost = (err?: Error) => {
      if (this.listenClient !== client) return; // already replaced
      this.listenClient = null;
      this.log.error({ err }, 'bus listen connection lost; reconnecting');
      client.release(err ?? true); // destroy, don't return a broken connection to the pool
      this.scheduleReconnect();
    };
    client.on('error', lost);
    client.on('end', () => lost());
    await client.query(`LISTEN ${PG_CHANNEL}`);
    this.listenClient = client;
    this.retryMs = 1000;
  }

  private scheduleReconnect() {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      try {
        await this.listen();
        this.log.info('bus listen connection restored');
      } catch (err) {
        this.log.error({ err }, 'bus reconnect failed');
        this.retryMs = Math.min(this.retryMs * 2, 30_000);
        this.scheduleReconnect();
      }
    }, this.retryMs);
  }

  async stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
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
