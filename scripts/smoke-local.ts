import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = 'E:/Codex工作盘/artifacts/latest/video-skill-workbench/verification';
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('http://127.0.0.1:4178');
  await page.getByLabel('登录账号').waitFor();
  const status = await page.evaluate(async () => (await fetch('/api/auth/state')).json());
  if (response?.status() !== 200 || errors.length) throw new Error('正式本机页面未通过检查');
  await page.screenshot({ path: path.join(root, 'local-first-open.png') });
  await writeFile(path.join(root, 'smoke.json'), JSON.stringify({ testedAt: new Date().toISOString(), url: page.url(), status: response.status(), needsSetup: status.needsSetup, pageErrors: errors, note: '真实本机服务，只读打开首次设置／登录页面；未创建用户、未调用生成 API' }, null, 2));
  console.log('正式本机页面已通过只读检查，截图与检查记录已保存。');
} finally { await browser.close(); }
