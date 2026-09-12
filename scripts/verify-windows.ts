import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { freePort } from './postgres';
import { windowsOutput, distributableFile } from './windows-package';
import sharp from 'sharp';

const packageRoot = windowsOutput(process.argv[2]);
const testRoot = `E:/Codex工作盘/temp/video-skill-workbench/package-qa/${randomUUID()}`;
const reportRoot = 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/windows-verification';
await mkdir(testRoot, { recursive: true }); await mkdir(reportRoot, { recursive: true });
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const log = createWriteStream(path.join(testRoot, 'service.log'), { flags: 'a' });
let service: ChildProcess | undefined;
async function start() {
  service = spawn(path.join(packageRoot, 'runtime/node.exe'), ['--import', 'tsx', 'scripts/desktop-service.ts'], {
    cwd: path.join(packageRoot, 'server'), windowsHide: true,
    env: { ...process.env, VSW_DATA_ROOT: testRoot, VSW_PORT: String(port), TEMP: testRoot, TMP: testRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  service.stdout!.pipe(log, { end: false }); service.stderr!.pipe(log, { end: false });
  for (let i = 0; i < 150; i++) {
    if (service.exitCode !== null) throw new Error(`独立包后台提前退出，日志：${testRoot}`);
    try { const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }); if ((await response.json()).application === 'video-skill-workbench') return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`独立包启动超时，日志：${testRoot}`);
}
async function stop() {
  // Only this test-created, still-running parent PID and its children. The
  // production 4178 service and its existing PostgreSQL are never targeted.
  if (service?.pid && service.exitCode === null) await promisify(execFile)('taskkill.exe', ['/PID', String(service.pid), '/T', '/F'], { windowsHide: true });
  const ctl = path.join(packageRoot, 'runtime/embedded-postgres/native/bin/pg_ctl.exe');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ctl, ['-D', path.join(testRoot, 'postgres/cluster'), '-m', 'fast', '-w', 'stop'], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('测试数据库停止失败')));
  });
  service = undefined;
}
const credentials = { username: 'windows_check', displayName: '独立发行包测试', password: randomUUID() };
let cookie = ''; let csrf = '';
async function signIn(route: string, body: unknown) {
  const response = await fetch(origin + route, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie')!.split(';')[0];
  csrf = (await response.json()).csrf;
}
try {
  await start();
  assert.equal((await fetch(origin + '/')).status, 200);
  assert.equal((await (await fetch(origin + '/api/auth/state')).json()).needsSetup, true);
  const secretBefore = await readFile(path.join(testRoot, 'local-secrets.json'));
  await signIn('/api/auth/setup', { ...credentials, setupKey: JSON.parse(secretBefore.toString()).setupKey });
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#909090' } }).png().toBuffer();
  const form = new FormData(); form.set('file', new Blob([png], { type: 'image/png' }), '测试商品.png');
  const uploaded = await fetch(origin + '/api/media', { method: 'POST', headers: { origin, cookie, 'x-csrf-token': csrf }, body: form });
  assert.equal(uploaded.status, 200, uploaded.status === 200 ? '上传成功' : await uploaded.text());
  const media = await uploaded.json();
  assert.ok(media.id);
  const before = Buffer.from(await (await fetch(origin + `/api/media/${media.id}`, { headers: { cookie } })).arrayBuffer());
  assert.equal(before.length, png.length);
  await stop();
  await start();
  assert.equal((await (await fetch(origin + '/api/auth/state')).json()).needsSetup, false);
  assert.deepEqual(await readFile(path.join(testRoot, 'local-secrets.json')), secretBefore);
  await signIn('/api/auth/login', credentials);
  const persisted = await fetch(origin + `/api/media/${media.id}`, { headers: { cookie } });
  assert.equal(persisted.status, 200);
  assert.deepEqual(Buffer.from(await persisted.arrayBuffer()), before);
  assert.equal((await fetch(origin + `/api/media/${media.id}`)).status, 401);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package-manifest.json'), 'utf8'));
  const actual: string[] = [];
  async function collect(relative: string) {
    for (const item of await readdir(path.join(packageRoot, relative), { withFileTypes: true })) {
      const entry = path.join(relative, item.name).replaceAll('\\', '/');
      if (item.isDirectory()) await collect(entry);
      else { assert.equal(item.isFile(), true); actual.push(entry); }
    }
  }
  await collect('');
  assert.deepEqual(actual.filter(name => name !== 'package-manifest.json').sort(), manifest.files.map((file: { path: string }) => file.path).sort());
  for (const file of manifest.files) {
    assert.equal(distributableFile(file.path), true, file.path);
    const bytes = await readFile(path.join(packageRoot, file.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
  const report = { ok: true, packageRoot, isolatedDataRoot: testRoot, sourceIndependent: true, restartPreservedAccountAndMedia: true, secretsUnchanged: true, unauthenticatedMediaDenied: true, verifiedManifestFiles: manifest.files.length, realApiCalls: 0 };
  await writeFile(path.join(reportRoot, 'standalone-package.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { if (service) await stop(); log.end(); }
