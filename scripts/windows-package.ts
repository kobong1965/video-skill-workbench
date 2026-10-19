import path from 'node:path';
import { workPath } from '../packages/storage/backup';

export const windowsPayload = ['apps/api', 'apps/worker', 'packages', 'database/migrations', 'scripts/postgres.ts', 'scripts/desktop-service.ts', 'scripts/service-shutdown.ts', 'scripts/service-child.ts', 'scripts/windows-package.ts', 'package.json', 'package-lock.json'] as const;
export const windowsNotices = ['THIRD-PARTY-NOTICES.md'] as const;

export const windowsWebInput = windowsOutput;

export function distributableFile(relative: string) {
  return !relative.split(/[/\\]/).some(part => /^(?:tests?|testing|__tests__|fixtures?|examples?|benchmarks?)(?:[.-].*)?$/i.test(part)
    || /^(?:coverage|\.git|\.cache|\.vite(?:-temp)?|desktop-profile|local-secrets\.json|postgres-local\.json|\.env(?:\..*)?)$/i.test(part)
    || /\.(?:test|spec)(?:[-.].*)?$/i.test(part));
}

export function windowsOutput(value: string) {
  const target = workPath(value);
  const valid = ['latest', 'test-builds'].some(area => target.toLowerCase().startsWith(path.resolve(`E:/Codex工作盘/artifacts/${area}/video-skill-workbench`).toLowerCase() + path.sep));
  if (!valid) throw new Error('Windows 构建必须使用项目专用产物子目录');
  return target;
}

export function windowsRuntimeEnvironment(packageRoot: string, dataRoot: string) {
  const root = workPath(packageRoot);
  const data = workPath(dataRoot);
  return {
    VSW_DATA_ROOT: data,
    VSW_PG_PACKAGE: path.join(root, 'runtime/embedded-postgres/dist/index.js'),
    VSW_PG_CLIENT_ROOT: path.join(root, 'runtime/pg-client/bin'),
    VSW_OUTPUT_ROOT: path.join(root, 'web'),
    LIBTV_CLI_PATH: path.join(root, 'runtime/libtv.exe'),
    VSW_SERVE_STATIC: '1',
    TEMP: 'E:/Codex工作盘/temp/video-skill-workbench/desktop',
    TMP: 'E:/Codex工作盘/temp/video-skill-workbench/desktop',
    TMPDIR: 'E:/Codex工作盘/temp/video-skill-workbench/desktop',
  };
}
