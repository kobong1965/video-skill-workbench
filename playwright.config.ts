import { defineConfig } from '@playwright/test';
import path from 'node:path';
const port = process.env.VSW_E2E_PORT ?? '4188';
const artifacts = path.resolve(process.env.VSW_E2E_ARTIFACTS ?? 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/e2e');
if (!artifacts.toLowerCase().startsWith(path.resolve('E:/Codex工作盘/artifacts/test-builds/video-skill-workbench').toLowerCase() + path.sep)) throw new Error('浏览器测试产物必须位于 E 盘项目测试目录');
export default defineConfig({
  testDir: './tests/e2e', workers: 1, fullyParallel: false, timeout: 60000,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 }, headless: true,
    launchOptions: { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: path.join(artifacts, 'results'),
  reporter: [['list'], ['html', { outputFolder: path.join(artifacts, 'report'), open: 'never' }]],
  webServer: { command: 'node --import tsx scripts/e2e-server.ts', url: `http://127.0.0.1:${port}/api/health`, timeout: 60000, reuseExistingServer: false },
});
