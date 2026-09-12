import { defineConfig } from '@playwright/test';
const port = process.env.VSW_E2E_PORT ?? '4188';
export default defineConfig({
  testDir: './tests/e2e', workers: 1, fullyParallel: false, timeout: 60000,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 }, headless: true,
    launchOptions: { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/e2e/results',
  reporter: [['list'], ['html', { outputFolder: 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/e2e/report', open: 'never' }]],
  webServer: { command: 'node --import tsx scripts/e2e-server.ts', url: `http://127.0.0.1:${port}/api/health`, timeout: 60000, reuseExistingServer: false },
});
