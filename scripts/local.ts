import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { shutdownServices, spawnManagedService } from './service-shutdown';
import { localPostgres } from './postgres';
import { runtimeContext } from '../apps/api/runtime';

const mode = process.argv[2] ?? 'start';
const database = process.env.VSW_DATABASE_URL ? null : await localPostgres(path.join(process.env.VSW_DATA_ROOT!, 'postgres'), 15479);
if (database) process.env.VSW_DATABASE_URL = database.url;
const context = await runtimeContext(); await context.db.end();
const children: ChildProcess[] = [];
const env = { ...process.env, VSW_PORT: mode === 'dev' ? '4179' : '4178', VSW_SERVE_STATIC: mode === 'dev' ? '0' : '1' };
function start(args: string[]) { const child = spawn(process.execPath, args, { windowsHide: true, stdio: 'inherit', env }); children.push(child); return child; }
const managed = [spawnManagedService('apps/api/main.ts', { env }), spawnManagedService('apps/worker/main.ts', { env })];
children.push(...managed);
if (mode === 'dev') start(['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts']);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try {
    await shutdownServices(managed, children.filter(child => !managed.includes(child)), async () => { await database?.stop(); });
    process.exit(0);
  } catch { console.error('后台仍在安全收尾，数据库未强制关闭；请保留窗口并检查日志。'); }
}
for (const child of children) child.on('exit', code => { if (!stopping && code !== 0) { console.error('一个工作台进程已停止。请检查日志后重新启动，数据不会重置。'); void stop(); } });
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
