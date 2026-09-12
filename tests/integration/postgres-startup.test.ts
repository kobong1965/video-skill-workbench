import { it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import path from 'node:path';
import { localPostgres } from '../../scripts/postgres';

it('数据库初始化失败会停止本次启动实例，之后可以正常重试', async () => {
  const root = path.join(process.env.VSW_TEST_ROOT!, 'owned-startup-failure');
  const ctl = 'E:/Codex工作盘/runtimes/video-skill-workbench/node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe';
  const connect = vi.spyOn(pg.Client.prototype, 'connect').mockRejectedValue(new Error('injected-connect-failure'));
  try {
    await expect(localPostgres(root)).rejects.toThrow('injected-connect-failure');
    connect.mockRestore();
    await expect(promisify(execFile)(ctl, ['-D', path.join(root, 'cluster'), 'status'], { windowsHide: true })).rejects.toMatchObject({ code: 3 });
    const next = await localPostgres(root); await next.stop();
  } finally {
    connect.mockRestore();
    await promisify(execFile)(ctl, ['-D', path.join(root, 'cluster'), '-m', 'fast', '-w', 'stop'], { windowsHide: true }).catch(() => {});
  }
}, 60000);
