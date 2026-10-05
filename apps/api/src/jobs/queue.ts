import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'kysely';
import type { DB } from '../db/index.js';
import { json } from '../db/index.js';

export type JobHandler = (payload: Record<string, any>, job: { id: string; attempts: number; runAt: Date }) => Promise<void>;

interface Periodic {
  kind: string;
  everyMs: number;
}

/**
 * Durable scheduled work in Postgres. Safe with several replicas (FOR UPDATE SKIP LOCKED);
 * a restart loses nothing. `dedupeKey` makes scheduling idempotent.
 */
export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private periodic: Periodic[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private db: DB,
    private log: FastifyBaseLogger,
    private now: () => Date,
    private pollMs = 1000,
  ) {}

  register(kind: string, handler: JobHandler) {
    this.handlers.set(kind, handler);
  }

  every(kind: string, everyMs: number) {
    this.periodic.push({ kind, everyMs });
  }

  async schedule(kind: string, runAt: Date, payload: Record<string, unknown> = {}, dedupeKey?: string, db: DB = this.db) {
    await sql`
      INSERT INTO jobs (kind, run_at, payload, dedupe_key)
      VALUES (${kind}, ${runAt}, ${json(payload)}::jsonb, ${dedupeKey ?? null})
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running') DO NOTHING
    `.execute(db);
  }

  /** Replace a queued job's run time (or create it). */
  async reschedule(kind: string, runAt: Date, payload: Record<string, unknown>, dedupeKey: string, db: DB = this.db) {
    await this.cancel(dedupeKey, db);
    await this.schedule(kind, runAt, payload, dedupeKey, db);
  }

  async cancel(dedupeKey: string, db: DB = this.db) {
    await db
      .updateTable('jobs')
      .set({ status: 'cancelled', updated_at: this.now() })
      .where('dedupe_key', '=', dedupeKey)
      .where('status', '=', 'queued')
      .execute();
  }

  private lastBucket = new Map<string, number>();

  /** Periodic sweeps: one job per time bucket across all replicas (a rare duplicate is harmless — sweeps are idempotent). */
  private async enqueuePeriodic() {
    const t = this.now().getTime();
    for (const p of this.periodic) {
      const bucket = Math.floor(t / p.everyMs);
      if (this.lastBucket.get(p.kind) === bucket) continue;
      const key = `${p.kind}:${bucket}`;
      await sql`
        INSERT INTO jobs (kind, run_at, payload, dedupe_key)
        SELECT ${p.kind}, ${new Date(bucket * p.everyMs)}, '{}'::jsonb, ${key}
        WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE dedupe_key = ${key})
        ON CONFLICT DO NOTHING
      `.execute(this.db);
      this.lastBucket.set(p.kind, bucket);
    }
  }

  /** Claim and run all due jobs once. Returns the number of jobs processed. */
  async runDue(limit = 20): Promise<number> {
    await this.enqueuePeriodic();
    const now = this.now();
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    // A job whose worker died mid-run is retried, but one that keeps killing workers must not loop forever.
    await this.db
      .updateTable('jobs')
      .set({ status: 'failed', last_error: 'abandoned: the worker stopped while running it, 5 times', updated_at: now })
      .where('status', '=', 'running')
      .where('updated_at', '<', staleBefore)
      .where('attempts', '>=', 5)
      .execute();
    const claimed = await sql<{ id: string; kind: string; payload: Record<string, any>; attempts: number; run_at: Date }>`
      UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ${now}
      WHERE id IN (
        SELECT id FROM jobs
        WHERE (status = 'queued' AND run_at <= ${now})
           OR (status = 'running' AND updated_at < ${staleBefore})
        ORDER BY run_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, kind, payload, attempts, run_at
    `.execute(this.db);

    for (const job of claimed.rows) {
      const handler = this.handlers.get(job.kind);
      try {
        if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
        await handler(job.payload, { id: job.id, attempts: job.attempts, runAt: job.run_at });
        await this.db.updateTable('jobs').set({ status: 'done', updated_at: this.now() }).where('id', '=', job.id).execute();
      } catch (err) {
        const retry = job.attempts < 5;
        this.log.error({ err, kind: job.kind, jobId: job.id, retry }, 'job failed');
        await this.db
          .updateTable('jobs')
          .set({
            status: retry ? 'queued' : 'failed',
            run_at: new Date(this.now().getTime() + 2 ** job.attempts * 5000),
            last_error: String((err as Error)?.message ?? err).slice(0, 1000),
            updated_at: this.now(),
          })
          .where('id', '=', job.id)
          .execute();
      }
    }
    return claimed.rows.length;
  }

  start() {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        while ((await this.runDue()) > 0) {
          /* drain */
        }
      } catch (err) {
        this.log.error({ err }, 'job loop error');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(tick, this.pollMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((r) => setTimeout(r, 20));
  }
}
