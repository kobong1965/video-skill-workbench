import { describe, expect, it, vi } from 'vitest';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { shutdownServices } from '../../scripts/service-shutdown';

class Child extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  connected = true;
  send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => { callback(null); return true; });
  kill = vi.fn();
  asProcess() { return this as unknown as ChildProcess; }
  finish() { this.exitCode = 0; this.emit('exit', 0, null); }
}

describe('等待真实子进程排空后才停止数据库', () => {
  it('同时请求API和worker停止，但任一个仍在收尾时不关闭数据库', async () => {
    const api = new Child(); const worker = new Child(); const databaseStop = vi.fn(async () => {});
    const done = shutdownServices([api.asProcess(), worker.asProcess()], [], databaseStop);
    expect(api.send).toHaveBeenCalledWith({ type: 'vsw:shutdown' }, expect.any(Function));
    expect(worker.send).toHaveBeenCalledWith({ type: 'vsw:shutdown' }, expect.any(Function));
    await Promise.resolve(); expect(databaseStop).not.toHaveBeenCalled();
    api.finish(); await Promise.resolve(); await Promise.resolve(); expect(databaseStop).not.toHaveBeenCalled();
    worker.finish(); await done; expect(databaseStop).toHaveBeenCalledTimes(1);
    expect(worker.kill).not.toHaveBeenCalled();
  });
  it('IPC不可用时拒绝强制杀死仍在运行的服务，保留数据库', async () => {
    const worker = new Child(); worker.connected = false;
    const databaseStop = vi.fn(async () => {});
    await expect(shutdownServices([worker.asProcess()], [], databaseStop)).rejects.toThrow('IPC');
    expect(worker.kill).not.toHaveBeenCalled(); expect(databaseStop).not.toHaveBeenCalled();
  });
  it('进程已退出时无需发送信号，仍等待其他子进程退出', async () => {
    const prior = new Child(); prior.finish(); const worker = new Child(); const databaseStop = vi.fn(async () => {});
    const done = shutdownServices([prior.asProcess(), worker.asProcess()], [], databaseStop);
    expect(prior.send).not.toHaveBeenCalled(); expect(databaseStop).not.toHaveBeenCalled();
    worker.finish(); await done; expect(databaseStop).toHaveBeenCalledOnce();
  });
});


describe('真实Windows兼容IPC停机握手', () => {
  it('SIGTERM在子进程内触发：等待超过1.5秒的在途工作，不领取下一项', async () => {
    const root = path.join(process.env.VSW_TEST_ROOT!, 'shutdown-child', randomUUID());
    const project = process.cwd();
    await mkdir(path.join(root, 'apps/worker'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(path.join(root, 'apps/worker/main.ts'), `
      import { writeFile } from 'node:fs/promises';
      let stopping = false;
      process.on('SIGTERM', () => { stopping = true; });
      const events = ['first-started'];
      process.send?.({ type: 'fixture-ready' });
      await new Promise(resolve => setTimeout(resolve, 2100));
      events.push('first-finished');
      if (!stopping) events.push('second-started');
      await writeFile('events.json', JSON.stringify(events));
    `);
    const child = spawn(process.execPath, [
      '--import', pathToFileURL(path.join(project, 'node_modules/tsx/dist/loader.mjs')).href,
      path.join(project, 'scripts/service-child.ts'), 'apps/worker/main.ts',
    ], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, TSX_DISABLE_CACHE: '1', TEMP: root, TMP: root } });
    let errorText = ''; child.stderr!.on('data', bytes => { errorText += bytes.toString(); });
    const ready = once(child, 'message');
    const unexpectedExit = new Promise<never>((_, reject) => { child.once('exit', () => reject(new Error('测试子进程尚未就绪即退出：' + errorText))); });
    try {
      await Promise.race([ready, unexpectedExit]);
      const databaseStop = vi.fn(async () => {});
      const done = shutdownServices([child], [], databaseStop);
      await new Promise(resolve => setTimeout(resolve, 1600));
      expect(databaseStop).not.toHaveBeenCalled();
      await done;
      expect(child.exitCode).toBe(0);
      expect(JSON.parse(await readFile(path.join(root, 'events.json'), 'utf8'))).toEqual(['first-started', 'first-finished']);
      expect(databaseStop).toHaveBeenCalledOnce();
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
  }, 10000);
});
