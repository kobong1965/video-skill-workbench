import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function spawnManagedService(entry: 'apps/api/main.ts' | 'apps/worker/main.ts', options: SpawnOptions = {}) {
  // Windows kill('SIGTERM') terminates Node; IPC invokes its in-process handlers.
  return spawn(process.execPath, ['--import', 'tsx', path.join(project, 'scripts/service-child.ts'), entry], {
    cwd: project, ...options, windowsHide: true, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
}
function exited(child: ChildProcess) { return child.exitCode !== null || child.signalCode !== null; }
function waitForExit(child: ChildProcess): Promise<void> {
  if (exited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { child.off('exit', complete); child.off('error', failed); };
    const complete = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('后台子进程退出未确认；保留数据库以便检查')); };
    child.once('exit', complete); child.once('error', failed);
  });
}
async function requestStop(child: ChildProcess) {
  if (exited(child)) return;
  if (!child.connected || !child.send) throw new Error('后台IPC不可用；拒绝强制终止正在执行的任务');
  await new Promise<void>((resolve, reject) => {
    child.send({ type: 'vsw:shutdown' }, error => {
      if (!error || exited(child)) resolve();
      else reject(new Error('后台IPC关闭请求失败；保留进程和数据库'));
    });
  });
}
export async function shutdownServices(managed: readonly ChildProcess[], auxiliary: readonly ChildProcess[], stopDatabase: () => Promise<void>) {
  // API first stops accepting HTTP and drains its accepted canvas queue. Worker
  // stops claiming, finishes only its in-flight job, and leaves queued rows intact.
  await Promise.all(managed.map(async child => {
    const completion = waitForExit(child);
    await Promise.all([requestStop(child), completion]);
  }));
  await Promise.all(auxiliary.map(async child => {
    const completion = waitForExit(child);
    if (!exited(child)) child.kill('SIGTERM'); // Vite only; never a task worker.
    await completion;
  }));
  await stopDatabase();
}
