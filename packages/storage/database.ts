import pg, { type PoolClient } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Database = pg.Pool;
export function createDatabase(url: string) { return new pg.Pool({ connectionString: url, max: 8 }); }
export async function transaction<T>(db: Database, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function migrate(db: Database) {
  const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
  await transaction(db, async client => {
    await client.query("SELECT pg_advisory_xact_lock(719340011)");
    await client.query('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(folder)).filter(x => x.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM migrations WHERE name=$1', [name])).rowCount) continue;
      await client.query(await readFile(path.join(folder, name), 'utf8'));
      await client.query('INSERT INTO migrations(name) VALUES($1)', [name]);
    }
  });
}
