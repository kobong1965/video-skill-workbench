import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
const root = 'E:/Codex工作盘/projects/video-skill-workbench-data';
const output = process.argv[2];
if (!output || !path.resolve(output).startsWith(path.resolve('E:/Codex工作盘/artifacts/test-builds/video-skill-workbench') + path.sep)) throw new Error('核验输出必须在项目测试目录内');
const settings = JSON.parse(await readFile(path.join(root, 'postgres/postgres-local.json'), 'utf8'));
const db = new pg.Client({ host: '127.0.0.1', port: settings.port, user: 'postgres', password: settings.password, database: 'workbench' });
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
try {
  await db.connect(); await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables: Record<string, { count: number; hash: string }> = {};
  const names = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
  for (const { table_name } of names.rows) {
    const rows = await db.query(`SELECT to_jsonb(t) AS value FROM "${table_name.replaceAll('"', '""')}" t`);
    tables[table_name] = { count: rows.rowCount!, hash: hash(rows.rows.map(row => JSON.stringify(row.value)).sort().join('\n')) };
  }
  const jobs = (await db.query('SELECT status,count(*)::int AS count FROM jobs GROUP BY status')).rows;
  await db.query('COMMIT');
  const media: { name: string; hash: string }[] = [];
  for (const name of (await readdir(path.join(root, 'media'))).sort()) media.push({ name, hash: hash(await readFile(path.join(root, 'media', name))) });
  const snapshot = { tables, jobs, mediaFiles: media.length, mediaHash: hash(JSON.stringify(media)), secretsHash: hash(await readFile(path.join(root, 'local-secrets.json'))) };
  await writeFile(output, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
  const previous = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : null;
  const changed = previous ? Object.keys(tables).filter(table => !['sessions', 'audit'].includes(table) && JSON.stringify(tables[table]) !== JSON.stringify(previous.tables[table])) : [];
  if (previous && (snapshot.mediaHash !== previous.mediaHash || snapshot.secretsHash !== previous.secretsHash)) changed.push('media-or-secrets');
  console.log(JSON.stringify({ counts: Object.fromEntries(Object.entries(tables).map(([name, item]) => [name, item.count])), jobs, mediaFiles: media.length, changed }));
  if (changed.length) process.exitCode = 1;
} finally { await db.end(); }
