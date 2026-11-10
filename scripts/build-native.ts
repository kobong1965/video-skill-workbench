import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { windowsOutput } from './windows-package';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dotnetRoot = process.env.VSW_DOTNET_ROOT ?? 'E:/Codex工作盘/runtimes/dotnet-10.0.401';
export async function buildNative(outputRoot: string, test = false) {
  const output = windowsOutput(outputRoot);
  const temp = 'E:/Codex工作盘/temp/video-skill-workbench/dotnet';
  const cache = 'E:/Codex工作盘/caches/video-skill-workbench';
  for (const folder of [output, temp, `${cache}/dotnet`, `${cache}/nuget/packages`, `${cache}/nuget/http`]) await mkdir(folder, { recursive: true });
  const env = {
    ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, DOTNET_ROOT: dotnetRoot,
    DOTNET_CLI_HOME: `${cache}/dotnet`, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: 'true', NUGET_PACKAGES: `${cache}/nuget/packages`,
    NUGET_HTTP_CACHE_PATH: `${cache}/nuget/http`, NUGET_SCRATCH: `${temp}/nuget`,
  };
  const result = await promisify(execFile)(`${dotnetRoot}/dotnet.exe`, [
    'publish', path.join(project, 'desktop/Workbench.csproj'), '--configuration', 'Release', '--runtime', 'win-x64',
    '--self-contained', 'true', '--output', output, '--nologo',
    `-p:NativeTests=${test}`, `-p:NativeBuildKey=${test ? 'tests' : 'release'}`, '-p:DebugType=None', '-p:DebugSymbols=false',
  ], { cwd: path.join(project, 'desktop'), windowsHide: true, env, timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
  if (result.stdout) console.log(result.stdout);
  if (test) {
    const checked = await promisify(execFile)(path.join(output, 'native-tests.exe'), [], { cwd: output, windowsHide: true, env, timeout: 60000 });
    console.log(checked.stdout);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--output-root');
  if (index < 0 || !process.argv[index + 1]) throw new Error('必须显式指定 --output-root');
  await buildNative(process.argv[index + 1], process.argv.includes('--test'));
}
