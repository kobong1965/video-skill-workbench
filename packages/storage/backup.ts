import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function workPath(value: string) {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || !resolved.toLowerCase().startsWith(path.resolve('E:/Codex工作盘').toLowerCase() + path.sep)) throw new Error('备份与恢复目录必须明确位于 E:/Codex工作盘 下');
  return resolved;
}
async function pgTool(name: 'pg_dump' | 'pg_restore', databaseUrl: string, args: string[]) {
  const connection = new URL(databaseUrl);
  const executable = path.join(process.env.VSW_PG_CLIENT_ROOT ?? 'E:/Codex工作盘/runtimes/video-skill-workbench/pg-client/bin', `${name}.exe`);
  // Credentials never appear in command arguments or printed process errors.
  try { await promisify(execFile)(executable, ['--host', connection.hostname, '--port', connection.port, '--username', decodeURIComponent(connection.username), '--dbname', connection.pathname.slice(1), '--no-password', ...args], { windowsHide: true, timeout: 120000, env: { ...process.env, PGPASSWORD: decodeURIComponent(connection.password) }, maxBuffer: 2 * 1024 * 1024 }); }
  catch (error) { const code = (error as { code?: string | number }).code; throw new Error(`数据库${name === 'pg_dump' ? '备份' : '恢复'}失败（${String(code ?? 'unknown')}），源数据库未被清空`); }
}
async function ensureNewDirectory(value: string) {
  const target = workPath(value);
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(target); // Existing directories are never overwritten.
  return target;
}
export async function createBackup(databaseUrl: string, dataRoot: string, target: string) {
  workPath(dataRoot); const output = await ensureNewDirectory(target);
  await pgTool('pg_dump', databaseUrl, ['--format=custom', '--no-owner', '--no-privileges', '--file', path.join(output, 'database.dump')]);
  const files: { path: string; sha256: string; size: number }[] = [];
  async function copy(relative: string) {
    const bytes = await readFile(path.join(dataRoot, relative));
    const destination = path.join(output, relative); await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(dataRoot, relative), destination);
    files.push({ path: relative.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
  }
  await copy('local-secrets.json');
  // Media is append-only. A database snapshot followed by file copy retains all
  // referenced content; extra files from newer uploads do not affect restoration.
  const mediaRoot = path.join(dataRoot, 'media');
  try { await access(mediaRoot); for (const file of await readdir(mediaRoot, { withFileTypes: true })) { if (!file.isFile()) throw new Error('媒体目录包含非预期条目，已暂停备份'); await copy(path.join('media', file.name)); } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const dump = await readFile(path.join(output, 'database.dump'));
  files.push({ path: 'database.dump', sha256: createHash('sha256').update(dump).digest('hex'), size: dump.length });
  await writeFile(path.join(output, 'backup-manifest.json'), JSON.stringify({ formatVersion: 1, createdAt: new Date().toISOString(), complete: true, files }, null, 2), { flag: 'wx' });
  return { directory: output, files: files.length };
}
export async function restoreBackup(backupDirectory: string, newDatabaseUrl: string, newDataRoot: string) {
  const source = workPath(backupDirectory);
  const manifest = JSON.parse(await readFile(path.join(source, 'backup-manifest.json'), 'utf8'));
  if (manifest.formatVersion !== 1 || manifest.complete !== true || !Array.isArray(manifest.files)) throw new Error('备份未完成或格式不支持');
  const files: string[] = [];
  for (const item of manifest.files) {
    if (!/^(database\.dump|local-secrets\.json|media\/[a-f0-9-]+)$/.test(item.path)) throw new Error('备份清单包含非法路径');
    const bytes = await readFile(path.join(source, item.path));
    if (bytes.length !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('备份文件摘要不符');
    files.push(item.path);
  }
  if (!files.includes('database.dump') || !files.includes('local-secrets.json')) throw new Error('备份缺少数据库或密钥');
  const output = await ensureNewDirectory(newDataRoot);
  // Caller must provision an empty isolated database. No --clean / destructive
  // restore is supported. An existing schema makes pg_restore fail atomically.
  await pgTool('pg_restore', newDatabaseUrl, ['--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges', path.join(source, 'database.dump')]);
  for (const relative of files.filter(x => x !== 'database.dump')) { await mkdir(path.dirname(path.join(output, relative)), { recursive: true }); await copyFile(path.join(source, relative), path.join(output, relative)); }
  return output;
}
