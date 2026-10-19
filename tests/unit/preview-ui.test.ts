import { describe, expect, it } from 'vitest';
import { previewOptions, blockedPreviewRequest } from '../../scripts/preview-ui';

const args = ['--root', 'E:/Codex工作盘/temp/video-skill-workbench/soft-preview-20261019', '--web-root', 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/soft-ui-0.1.11/web', '--port', '4196'];
describe('隔离 UI 预览入口', () => {
  it('强制显式指定独立 E 盘临时根、测试构建和有效端口', () => {
    expect(previewOptions(args).port).toBe(4196);
    expect(() => previewOptions([])).toThrow();
    expect(() => previewOptions(args.slice(0, 4))).toThrow();
    for (const root of ['C:/preview', 'D:/preview', 'E:/Codex工作盘/projects/video-skill-workbench-data', 'E:/Codex工作盘/temp/video-skill-workbench/../production']) {
      expect(() => previewOptions(['--root', root, ...args.slice(2)])).toThrow();
    }
    expect(() => previewOptions([...args.slice(0, 3), 'E:/Codex工作盘/artifacts/latest/video-skill-workbench/web', ...args.slice(4)])).toThrow();
    expect(() => previewOptions([...args.slice(0, 5), '0'])).toThrow();
  });
  it('阻断所有真实画布、Provider 配置及生成重试入口', () => {
    for (const [method, url] of [
      ['GET', '/api/canvas/connection'], ['GET', '/api/canvas/projects?workspace=1'],
      ['GET', '/api/libtv/account'], ['POST', '/api/canvas/imports/id/retry'],
      ['GET', '/api/tasks/id/canvas-imports'], ['POST', '/api/tasks/id/canvas-imports'],
      ['POST', '/api/tasks/id/generate'], ['POST', '/api/tasks/id/images'], ['POST', '/api/jobs/id/retry'],
      ['PUT', '/api/admin/providers/text'], ['POST', '/api/admin/providers/text/test'],
    ]) expect(blockedPreviewRequest(method, url), `${method} ${url}`).toBe(true);
  });
  it('保留样例库、图片读取、草稿与提示词版本编辑', () => {
    for (const [method, url] of [['GET', '/api/config'], ['GET', '/api/skills'], ['GET', '/api/media/id'], ['POST', '/api/tasks/id/results'], ['PUT', '/api/drafts']]) {
      expect(blockedPreviewRequest(method, url)).toBe(false);
    }
  });
});
