import { access, lstat, mkdir, cp, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { windowsOutput, windowsPayload, windowsNotices, windowsWebInput, distributableFile } from './windows-package';
import { buildNative } from './build-native';
import { validateSoftwareReleaseManifest } from './software-release-safety';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')) as { version: string }).version;
function argument(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`必须传入 ${name} 的绝对路径`);
  return process.argv[index + 1];
}
const output = windowsOutput(argument('--output-root'));
const web = windowsWebInput(argument('--web-root'));
const baseIndex = process.argv.indexOf('--runtime-package');
const runtimePackage = baseIndex >= 0 ? argument('--runtime-package') : undefined;
if (runtimePackage && (!path.isAbsolute(runtimePackage) || !/^E:[\\/]/i.test(runtimePackage))) throw new Error('运行时软件包必须是 E 盘绝对路径');
if (runtimePackage) {
  const baseline = JSON.parse(await readFile(path.join(runtimePackage, 'release.json'), 'utf8'));
  if (!/^[a-f0-9-]{36}$/.test(baseline.id) || !/^\d+\.\d+\.\d+$/.test(baseline.version)) throw new Error('运行时来源不是已识别的软件发行包');
}
const libtvCli = runtimePackage ? path.join(runtimePackage, 'runtime/libtv.exe') : argument('--libtv-cli');
if (!path.isAbsolute(libtvCli) || (!runtimePackage && !libtvCli.toLowerCase().startsWith(path.resolve('E:/Codex工作盘/runtimes').toLowerCase() + path.sep))) throw new Error('LibTV CLI 必须来自明确的 E 盘运行时目录');
const sdk = 'E:/Codex工作盘/caches/video-skill-workbench/webview2-1.0.4191.47';
const temp = 'E:/Codex工作盘/temp/video-skill-workbench/windows-package';
const nodeLicense = runtimePackage ? path.join(runtimePackage, 'runtime/Node-LICENSE.txt') : 'E:/Codex工作盘/downloads/source-packages/video-skill-workbench-display-0.1.6/node-v24.21.0-LICENSE.txt';
const webviewLicense = runtimePackage ? path.join(runtimePackage, 'WebView2-LICENSE.txt') : path.join(sdk, 'LICENSE.txt');
const brandIcon = path.join(project, 'desktop/branding/workbench.ico');
if (process.version !== 'v24.21.0') throw new Error('请使用已校验的 Node 24.21.0 LTS 及匹配许可打包');
for (const required of [nodeLicense, brandIcon, libtvCli, path.join(web, 'index.html'), webviewLicense]) await access(required);
async function safeCopy(source: string, destination: string) {
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false, filter: async current => {
    if ((await lstat(current)).isSymbolicLink()) throw new Error('不将链接打入发行包');
    const relative = path.relative(source, current);
    return !relative.split(path.sep).includes('node_modules') && distributableFile(relative);
  } });
}
await mkdir(temp, { recursive: true });
// Deliberately refuses to overwrite a running release or any existing package.
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
const server = path.join(output, 'server');
await mkdir(server);
for (const entry of windowsPayload) {
  await safeCopy(path.join(project, entry), path.join(server, entry));
}
const lock = JSON.parse(await readFile(path.join(project, 'package-lock.json'), 'utf8')) as { packages: Record<string, { dev?: boolean; optional?: boolean; link?: boolean }> };
for (const [relative, item] of Object.entries(lock.packages)) {
  if (!relative.startsWith('node_modules/') || item.dev) continue;
  if (item.link || relative.split('/').includes('..')) throw new Error('生产依赖不能指向包外链接');
  const source = path.join(project, relative);
  try { await access(source); } catch (error) { if (item.optional && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
  await safeCopy(source, path.join(server, relative));
}
// Vite output only: never recursively copy an arbitrary directory as the web app.
await mkdir(path.join(output, 'web'));
await safeCopy(path.join(web, 'index.html'), path.join(output, 'web/index.html'));
await safeCopy(path.join(web, 'assets'), path.join(output, 'web/assets'));
await mkdir(path.join(output, 'runtime'));
await copyFile(process.execPath, path.join(output, 'runtime/node.exe'));
await copyFile(libtvCli, path.join(output, 'runtime/libtv.exe'));
await copyFile(nodeLicense, path.join(output, 'runtime/Node-LICENSE.txt'));
await safeCopy(runtimePackage ? path.join(runtimePackage, 'runtime/embedded-postgres') : 'E:/Codex工作盘/runtimes/video-skill-workbench/node_modules/@embedded-postgres/windows-x64', path.join(output, 'runtime/embedded-postgres'));
await safeCopy(runtimePackage ? path.join(runtimePackage, 'runtime/pg-client') : 'E:/Codex工作盘/runtimes/video-skill-workbench/pg-client', path.join(output, 'runtime/pg-client'));
await copyFile(webviewLicense, path.join(output, 'WebView2-LICENSE.txt'));
await copyFile(path.join(project, 'desktop/start-service.ps1'), path.join(output, 'start-service.ps1'));
await copyFile(path.join(project, 'desktop/使用说明.txt'), path.join(output, '使用说明.txt'));
for (const notice of windowsNotices) await copyFile(path.join(project, notice), path.join(output, notice));
const executable = path.join(output, '视频Skill工作台.exe');
await copyFile(brandIcon, path.join(output, 'workbench.ico'));
await writeFile(path.join(output, 'release.json'), JSON.stringify({ id: randomUUID(), version }), { flag: 'wx' });
await buildNative(output);
await copyFile(runtimePackage ? path.join(runtimePackage, 'DotNet-LICENSE.txt') : 'E:/Codex工作盘/runtimes/dotnet-10.0.401/LICENSE.txt', path.join(output, 'DotNet-LICENSE.txt'));
await copyFile(runtimePackage ? path.join(runtimePackage, 'DotNet-ThirdPartyNotices.txt') : 'E:/Codex工作盘/runtimes/dotnet-10.0.401/ThirdPartyNotices.txt', path.join(output, 'DotNet-ThirdPartyNotices.txt'));
const files: { path: string; size: number; sha256: string }[] = [];
async function inventory(relative: string) {
  for (const item of await readdir(path.join(output, relative), { withFileTypes: true })) {
    const local = path.join(relative, item.name);
    if (!distributableFile(local)) throw new Error(`发行清单包含不应分发的条目：${local}`);
    if (item.isDirectory()) await inventory(local);
    else if (item.isFile()) { const bytes = await readFile(path.join(output, local)); files.push({ path: local.replaceAll('\\', '/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    else throw new Error('软件包不能包含链接或特殊文件');
  }
}
await inventory('');
const manifest = { formatVersion: 1, version, platform: 'win32-x64', sdkVersion: '1.0.4191.47', createdAt: new Date().toISOString(), includesUserData: false, includesSkills: false, files };
validateSoftwareReleaseManifest(manifest);
await writeFile(path.join(output, 'package-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, executable, files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) }));
