import { expect, it } from 'vitest';
import { windowsOutput, windowsPayload, windowsNotices, windowsRuntimeEnvironment, windowsWebInput, distributableFile, distributableCopyEntry } from '../../scripts/windows-package';

it('Windows 包只写明确的独立产物子目录，不写源码或数据根', () => {
  expect(windowsOutput('E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/windows-0.1.1')).toContain('windows-0.1.1');
  for (const location of ['C:/Downloads/app', 'E:/Codex工作盘', 'E:/Codex工作盘/artifacts/latest', 'E:/Codex工作盘/projects/video-skill-workbench-data', 'relative/path', 'E:/Codex工作盘/artifacts/latest/video-skill-workbench/../other']) {
    expect(() => windowsOutput(location)).toThrow();
  }
});

it('网页输入不能把用户目录、项目源码或整个产物根误当成网页打包', () => {
  expect(windowsWebInput('E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/windows-web')).toContain('windows-web');
  for (const folder of ['E:/Codex工作盘/projects/video-skill-workbench-data', 'E:/Codex工作盘/projects/video-skill-workbench', 'E:/Codex工作盘/artifacts/latest/video-skill-workbench']) expect(() => windowsWebInput(folder)).toThrow();
});

it('实际发行文件过滤已识别的测试示例、用户秘密和缓存，不仅检查顶层目录', () => {
  for (const file of ['node_modules/fastify/test/helper.js', 'node_modules/foo/.env.local', 'local-secrets.json', 'runtime/postgres-local.json', 'desktop-profile/Cookies', 'apps/api/foo.test.ts', 'node_modules/pg-protocol/dist/inbound-parser.test.d.ts', 'node_modules/pg-protocol/dist/inbound-parser.test.js.map']) expect(distributableFile(file)).toBe(false);
  for (const file of ['node_modules/fastify/lib/route.js', 'runtime/embedded-postgres/LICENSE.md', 'apps/api/auth.ts']) expect(distributableFile(file)).toBe(true);
  for (const file of ['node_modules/abstract-logging/test.js', 'node_modules/pg-protocol/src/testing/test-buffers.ts', 'node_modules/fastq/example.js', 'node_modules/quick-format-unescaped/benchmark.js', 'node_modules/foo/index.test-d.ts']) expect(distributableFile(file)).toBe(false);
});

it('分发只取程序白名单，既有数据、会话、密钥和测试产物不进入安装包', () => {
  expect(windowsPayload).toContain('apps/api');
  expect(windowsPayload).toContain('database/migrations');
  expect(windowsPayload).not.toContain('tests');
  expect(windowsPayload.some(name => /secrets|dataRoot|media|\.env|profile/.test(name))).toBe(false);
  expect(windowsPayload).toContain('scripts/software-release-safety.ts');
  for (const name of ['skills', 'skill-library', 'materials', 'catalog.json', 'ui-source', 'ui-customizations', 'backend-import']) expect(windowsPayload).not.toContain(name);
});

it('复制过滤与最终发行清单都拒绝脚本库、原视频和脚本合集，保留合法依赖', () => {
  for (const file of ['skills/example/workbench.json', 'skill-library/private.txt', 'materials/cover.png', 'catalog.json', 'server/SKILL.md', 'server/ui-source/original.mp4', 'ui-customizations/backend-import/data.json', 'assets/reference.mp4', 'exports/skills.zip', 'private.sqlite']) expect(distributableFile(file)).toBe(false);
  for (const file of ['', 'server/node_modules/@example/skills/index.js', 'server/node_modules/skill-library/index.js', 'apps/api/skills.ts', 'scripts/software-release-safety.ts']) expect(distributableFile(file)).toBe(true);
});

it('逐个复制生产依赖时保留依赖根与目录类型，避免跳过必需运行实现', () => {
  for (const [root, relative, kind] of [
    ['server/node_modules/undici', '', 'directory'],
    ['server/node_modules/undici', 'lib/web/cookies', 'directory'],
    ['server/node_modules/undici', 'lib/web/cookies/index.js', 'file'],
    ['server/node_modules/undici', 'lib/data', 'directory'],
    ['server/node_modules/skill-library', '', 'directory'],
    ['server/node_modules/fastify', 'types/schema.d.ts', 'file'],
    ['server/node_modules/sharp', 'dist/index.d.mts', 'file'],
    ['server/node_modules/tsx', 'dist/esm/api/index.d.mts', 'file'],
  ] as const) expect(distributableCopyEntry(root, relative, kind), `${root}/${relative} (${kind})`).toBe(true);
  for (const relative of ['.env', 'local-secrets.json', 'private.db', 'SKILL.md', 'reference.mts', 'Cookies', 'Login Data', 'test/helper.js', 'node_modules/private/index.js']) {
    expect(distributableCopyEntry('server/node_modules/undici', relative, 'file')).toBe(false);
  }
  expect(distributableCopyEntry('server/skills', '', 'directory')).toBe(false);
  expect(distributableCopyEntry('server/materials', 'private.png', 'file')).toBe(false);
});

it('发行包保留使用到的第三方界面代码许可说明', () => {
  expect(windowsNotices).toContain('THIRD-PARTY-NOTICES.md');
});

it('包内运行环境绑定包内工具，沿用指定的 E 盘资料且不指向开发源码', () => {
  const env = windowsRuntimeEnvironment('E:/Codex工作盘/artifacts/latest/video-skill-workbench/windows', 'E:/Codex工作盘/projects/video-skill-workbench-data');
  expect(env.VSW_PG_PACKAGE).toContain('windows');
  expect(env.VSW_DATA_ROOT).toContain('video-skill-workbench-data');
  expect(env.TEMP).toContain('Codex工作盘');
  expect(env.LIBTV_CLI_PATH).toBe('E:\\Codex工作盘\\artifacts\\latest\\video-skill-workbench\\windows\\runtime\\libtv.exe');
  expect(() => windowsRuntimeEnvironment('C:/app', 'C:/data')).toThrow();
});
