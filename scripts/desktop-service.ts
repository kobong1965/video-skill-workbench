import type { ChildProcess } from 'node:child_process';
import { shutdownServices, spawnManagedService } from './service-shutdown';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localPostgres } from './postgres';
import { runtimeContext } from '../apps/api/runtime';
import { windowsRuntimeEnvironment } from './windows-package';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.dirname(serverRoot);
const dataRoot = process.env.VSW_DATA_ROOT ?? 'E:/Codex工作盘/projects/video-skill-workbench-data';
Object.assign(process.env, windowsRuntimeEnvironment(packageRoot, dataRoot));
const release = JSON.parse(await readFile(path.join(packageRoot, 'release.json'), 'utf8'));
if (!/^[a-f0-9-]{36}$/.test(release.id)) throw new Error('发行标识无效');
process.env.VSW_RELEASE_ID = release.id;
await mkdir(process.env.TEMP!, { recursive: true });
process.chdir(serverRoot);
const port = Number(process.env.VSW_PORT ?? 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('本机端口配置无效');
process.env.VSW_PORT = String(port);
process.env.VSW_ORIGIN = `http://127.0.0.1:${port}`;
const database = await localPostgres(path.join(dataRoot, 'postgres'), port === 4178 ? 15479 : undefined);
process.env.VSW_DATABASE_URL = database.url;
const context = await runtimeContext();
await context.db.end();
const children: ChildProcess[] = [];
let stopping = false;
function start(entry: 'apps/api/main.ts' | 'apps/worker/main.ts') {
  const child = spawnManagedService(entry, { cwd: serverRoot, env: process.env });
  children.push(child);
  child.once('exit', () => { if (!stopping) { console.error('本机后台进程已停止，重新打开软件可恢复，数据未重置。'); void stop(); } });
}
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await shutdownServices(children, [], () => database.stop());
    process.exit(0);
  } catch { console.error('后台仍在安全收尾，数据库未强制关闭；请保留程序并检查日志。'); }
}
start('apps/api/main.ts'); start('apps/worker/main.ts');
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
