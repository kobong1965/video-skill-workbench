import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDatabase } from '../packages/storage/database';
import { createBackup, workPath } from '../packages/storage/backup';
import path from 'node:path';

const data = 'E:/Codex工作盘/projects/video-skill-workbench-data';
const index = process.argv.indexOf('--backup-root');
const backupRoot = index >= 0 ? workPath(process.argv[index + 1]) : undefined;
const settings = JSON.parse(await readFile(path.join(data, 'postgres/postgres-local.json'), 'utf8'));
const url = `postgresql://postgres:${encodeURIComponent(settings.password)}@127.0.0.1:${settings.port}/workbench`;
const db = createDatabase(url);
try {
  const result = await db.query(`SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM tasks) AS tasks,(SELECT count(*)::int FROM media) AS media,(SELECT count(*)::int FROM skills) AS skills,(SELECT count(*)::int FROM jobs WHERE status IN ('queued','running')) AS active_jobs`);
  const counts = result.rows[0];
  if (counts.active_jobs !== 0) throw new Error('尚有待执行或进行中的任务，不能交接后台，请先完成任务');
  const backup = backupRoot ? await createBackup(url, data, backupRoot) : undefined;
  const secretsHash = createHash('sha256').update(await readFile(path.join(data, 'local-secrets.json'))).digest('hex');
  const report = { checkedAt: new Date().toISOString(), dataRoot: data, counts, secretsHash, backup: backup?.directory, noDataReset: true };
  const reportRoot = 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/windows-verification';
  await mkdir(reportRoot, { recursive: true });
  await writeFile(path.join(reportRoot, backup ? 'continuity-before.json' : 'continuity-after.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await db.end(); }
