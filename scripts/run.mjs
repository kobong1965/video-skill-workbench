import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = 'E:/Codex工作盘';
const action = process.argv[2] ?? 'dev';
const args = process.argv.slice(3);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`缺少 ${name} 的绝对路径`);
  args.splice(index, 2);
  const absolute = path.resolve(value);
  if (!absolute.toLowerCase().startsWith(path.resolve(work).toLowerCase() + path.sep)) {
    throw new Error(`${name} 必须位于 E:/Codex工作盘 下`);
  }
  return absolute;
}
const temp = option('--temp-root', `${work}/temp/video-skill-workbench`);
const artifacts = option('--artifacts-root', `${work}/artifacts/test-builds/video-skill-workbench`);
const output = option('--output-root', `${artifacts}/app`);
const data = option('--data-root', `${work}/projects/video-skill-workbench-data`);
for (const directory of [temp, artifacts, output, data]) mkdirSync(directory, { recursive: true });
const env = {
  ...process.env,
  TEMP: temp, TMP: temp, TMPDIR: temp,
  XDG_CACHE_HOME: `${work}/caches/video-skill-workbench`,
  npm_config_cache: `${work}/caches/video-skill-workbench/npm`,
  PLAYWRIGHT_BROWSERS_PATH: `${work}/runtimes/video-skill-workbench/browsers`,
  VSW_DATA_ROOT: data, VSW_ARTIFACTS_ROOT: artifacts, VSW_OUTPUT_ROOT: output,
  VSW_TEMP_ROOT: temp,
};
const routes = {
  dev: ['--import', 'tsx', 'scripts/local.ts', 'dev'],
  start: ['--import', 'tsx', 'scripts/local.ts', 'start'],
  worker: ['--import', 'tsx', 'apps/worker/main.ts'],
  build: ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/web/vite.config.ts'],
  test: ['--import', 'tsx', 'scripts/test-runner.ts', 'unit'],
  e2e: ['--import', 'tsx', 'scripts/test-runner.ts', 'e2e'],
  backup: ['--import', 'tsx', 'scripts/backup.ts'],
  smoke: ['--import', 'tsx', 'scripts/smoke-local.ts'],
};
if (!routes[action]) throw new Error(`未知操作：${action}`);
const child = spawn(process.execPath, [...routes[action], ...args], { cwd: project, env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
