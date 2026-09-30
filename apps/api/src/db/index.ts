import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { Database } from './types.js';

// Return DATE columns as 'YYYY-MM-DD' strings and int8 (bigserial) as strings (default), numerics as strings.
pg.types.setTypeParser(1082, (v) => v);

export function createPool(url = config.databaseUrl) {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export function createDb(pool: pg.Pool) {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export type DB = Kysely<Database>;

/** Serialise a value for a jsonb column (pg would turn JS arrays into Postgres arrays). */
export function json<T>(value: T): string {
  return JSON.stringify(value);
}

export { sql };
