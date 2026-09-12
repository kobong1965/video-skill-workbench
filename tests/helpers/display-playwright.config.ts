import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
import { fileURLToPath } from 'node:url';

// Keep the existing isolated server / database harness. All artifacts for this
// focused display regression stay separate from production and other test runs.
const root = `E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/display-0.1.6/${process.env.VSW_DISPLAY_BASELINE === '1' ? 'baseline' : 'current'}`;
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error('Display tests require the existing single isolated test server');
export default defineConfig({
  ...base,
  testDir: '../e2e',
  testMatch: 'display-layout.spec.ts',
  timeout: 120000,
  webServer: { ...server, cwd: fileURLToPath(new URL('../../', import.meta.url)) },
  outputDir: `${root}/results`,
  reporter: [['list'], ['json', { outputFile: `${root}/results.json` }],
    ['html', { outputFolder: `${root}/report`, open: 'never' }]],
});
