// PostgreSQL connection pool + small query helpers.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Config } from '../config.js';

export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

// numeric/bigint come back as strings by default; the API wants numbers.
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric
pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // int8
pg.types.setTypeParser(1082, (v) => v); // date -> keep ISO yyyy-mm-dd string

export function createPool(cfg: Config): pg.Pool {
  const ssl = cfg.db.sslCaPath
    ? { ca: readFileSync(cfg.db.sslCaPath, 'utf8'), rejectUnauthorized: true }
    : cfg.isProd
      ? { rejectUnauthorized: false }
      : undefined;
  return new pg.Pool({
    connectionString: cfg.db.connectionString,
    host: cfg.db.host,
    port: cfg.db.port,
    database: cfg.db.database,
    user: cfg.db.user,
    password: cfg.db.password,
    max: cfg.db.max,
    ssl,
    application_name: 'tendrai-api',
    statement_timeout: 30_000,
    idleTimeoutMillis: 30_000,
  });
}

/** Runs fn inside a transaction, committing on success and rolling back on error. */
export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow>(q: Queryable, text: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await q.query<T>(text, params);
  return r.rows[0];
}

export async function many<T extends pg.QueryResultRow>(q: Queryable, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await q.query<T>(text, params);
  return r.rows;
}

/** Builds "SET a = $1, b = $2" from a patch object, skipping undefined values. */
export function setClause(patch: Record<string, unknown>, columnOf: Record<string, string>, startAt = 1) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = startAt;
  for (const [key, col] of Object.entries(columnOf)) {
    if (patch[key] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[key]);
  }
  return { sets, params, next: i };
}
