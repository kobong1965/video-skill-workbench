import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import pg from 'pg';

function control(binary: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    // pg_ctl descendants retain pipe handles on Windows; wait for exit, not
    // pipe-close, and direct backend logging to its explicitly supplied file.
    const child = spawn(binary, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`数据库控制程序退出码 ${code}`)));
  });
}

export async function freePort() {
  // Elevated Node can bind Windows excluded ephemeral ports that the restricted
  // PostgreSQL child cannot. Choose a non-excluded explicit port instead.
  let excluded: [number, number][] = [];
  if (process.platform === 'win32') {
    const report = await promisify(execFile)('netsh.exe', ['interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'], { windowsHide: true });
    excluded = [...report.stdout.matchAll(/^\s+(\d+)\s+(\d+)/gm)].map(match => [Number(match[1]), Number(match[2])]);
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const port = randomInt(10000, 30000);
    if (excluded.some(([start, end]) => port >= start && port <= end)) continue;
    const server = createServer();
    const bound = await new Promise<boolean>(resolve => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
    if (!bound) continue;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
  }
  throw new Error('找不到可用的本机测试端口');
}

export async function localPostgres(root: string, requestedPort?: number) {
  if (!path.resolve(root).toLowerCase().startsWith(path.resolve('E:/Codex工作盘').toLowerCase() + path.sep)) throw new Error('数据库必须位于工作盘');
  const disposable = process.env.VSW_TEST_INIT_NOSYNC === '1' && path.resolve(root).toLowerCase().startsWith(path.resolve('E:/Codex工作盘/temp/video-skill-workbench').toLowerCase() + path.sep);
  await mkdir(root, { recursive: true });
  const settingsFile = path.join(root, 'postgres-local.json');
  let settings: { password: string; port: number };
  try { settings = JSON.parse(await readFile(settingsFile, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    settings = { password: randomBytes(32).toString('hex'), port: requestedPort ?? await freePort() };
    await writeFile(settingsFile, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
  }
  const adminUrl = `postgresql://postgres:${settings.password}@127.0.0.1:${settings.port}/postgres`;
  const url = `postgresql://postgres:${settings.password}@127.0.0.1:${settings.port}/workbench`;
  const probe = new pg.Client({ connectionString: url, connectionTimeoutMillis: 500 });
  try { await probe.connect(); await probe.end(); return { url, stop: async () => {}, owned: false }; }
  catch { await probe.end().catch(() => {}); }
  const binaryEntry = process.env.VSW_PG_PACKAGE ?? 'E:/Codex工作盘/runtimes/video-skill-workbench/node_modules/@embedded-postgres/windows-x64/dist/index.js';
  const binaries = await import(pathToFileURL(binaryEntry).href) as { initdb: string; postgres: string };
  const dataDir = path.join(root, 'cluster');
  try { await access(path.join(dataDir, 'PG_VERSION')); }
  catch {
    const passwordFile = path.join(root, 'init-password.tmp');
    await writeFile(passwordFile, settings.password, { flag: 'wx', mode: 0o600 });
    try {
      // Windows builds embed ANSI library paths during bootstrap. Use ASCII only
      // for the empty system template; the application database below is UTF-8.
      await promisify(execFile)(binaries.initdb, ['-D', dataDir, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=SQL_ASCII', '--locale=C', ...(disposable ? ['--no-sync'] : [])], { windowsHide: true, timeout: 60000, env: { ...process.env, TEMP: root, TMP: root } });
    } finally { await unlink(passwordFile); }
  }
  const ctl = path.join(path.dirname(binaries.postgres), 'pg_ctl.exe');
  // pg_ctl uses a restricted token on Windows; do not start postgres directly
  // from an elevated desktop agent or create a machine-wide service/account.
  await control(ctl, ['-D', dataDir, '-l', path.join(root, 'postgres.log'), '-o', `-p ${settings.port} -h 127.0.0.1${disposable ? ' -F' : ''}`, '-w', 'start']);
  const stop = () => control(ctl, ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
  try {
    for (let retry = 0; retry < 120; retry++) {
      const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 500 });
      try {
        await client.connect();
        if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='workbench'")).rowCount) {
          await client.query("CREATE DATABASE workbench TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'");
        }
        await client.end(); break;
      }
      catch (error) { await client.end().catch(() => {}); if (retry === 119) throw error; await new Promise(resolve => setTimeout(resolve, 200)); }
    }
  } catch (error) {
    // Only reached after this invocation successfully started its own instance.
    // Do not leave a half-initialized process that blocks the next safe retry.
    await stop();
    throw error;
  }
  return { url, owned: true, stop };
}
