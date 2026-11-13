import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

export type Row = Record<string, any>;
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}
export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}
export interface Db extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  /** Exécute un script SQL de plusieurs instructions, sans paramètres. */
  exec(sql: string): Promise<void>;
  /** Exécute `fn` dans une transaction : validée si elle aboutit, annulée si elle lève. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** PostgreSQL via un pool de connexions (production). */
export function openPostgres(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on('error', (err) => console.error('[db] connexion inactive en erreur :', err.message));
  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
  });
  return {
    kind: 'postgres',
    ...wrap(pool),
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** PostgreSQL embarqué (PGlite) : même SQL, sans serveur à installer. `dir` absent = en mémoire (tests). */
export async function openPglite(dir?: string): Promise<Db> {
  if (dir) await mkdir(dir, { recursive: true });
  const db = await PGlite.create(dir);
  const wrap = (c: { query: PGlite['query'] }): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    kind: 'pglite',
    ...wrap(db),
    async exec(sql) {
      await db.exec(sql);
    },
    tx: (fn) => db.transaction((t) => fn(wrap(t as any))) as Promise<any>,
    close: () => db.close(),
  };
}

export async function openDb(opts: { databaseUrl?: string; dataDir?: string }): Promise<Db> {
  return opts.databaseUrl ? openPostgres(opts.databaseUrl) : openPglite(opts.dataDir);
}

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Applique, dans l'ordre, les fichiers `migrations/*.sql` qui ne l'ont pas encore été. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => /^[\w.-]+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(dir, f), 'utf8');
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${f}');\nCOMMIT;`);
    applied.push(f);
  }
  return applied;
}
