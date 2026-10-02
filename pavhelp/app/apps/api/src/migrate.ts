import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { config } from './config';
import { createPool } from './db';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Применяет SQL-файлы из migrations/ по порядку, каждый в своей транзакции. */
export async function migrate(pool: pg.Pool, log = console.log): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(await readFile(dir + name, 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await c.query('COMMIT');
      log(`применена миграция ${name}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.end();
}
