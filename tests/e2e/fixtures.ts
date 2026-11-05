import { test as base, expect, type Response } from '@playwright/test';
import { setTimeout as wait } from 'node:timers/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export type { Page, Browser, BrowserContext, BrowserContextOptions, Locator, TestInfo } from '@playwright/test';

type LoginWindow = { origin: string; remaining: number; resetAt: number };

function loginWindowFile() {
  const root = process.env.VSW_TEST_ROOT;
  if (!root) throw new Error('登录限流测试状态必须位于独立测试目录');
  const resolved = path.resolve(root);
  if (!resolved.toLowerCase().startsWith(path.resolve('E:/Codex工作盘').toLowerCase() + path.sep)) throw new Error('登录限流测试状态必须位于 E 盘');
  return path.join(resolved, 'e2e-login-rate-window.json');
}

function readLoginWindow(file: string, origin: string): LoginWindow | null {
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, 'utf8')) as LoginWindow;
  if (value.origin !== origin || !Number.isInteger(value.remaining) || value.remaining < 0 || !Number.isFinite(value.resetAt)) return null;
  return value;
}

// Every suite shares one isolated loopback IP. Do not disable production rate
// protection or replay login requests. Wait before the test body, so the real
// UI login still fits its normal assertion timeout. The small persisted window
// contains no credentials and survives Playwright's worker restart after a fail.
export const test = base.extend<{ rateWindow: void }>({
  rateWindow: [async ({ request, context, baseURL }, use, info) => {
    const origin = new URL(baseURL!).origin;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('浏览器回归只允许本地隔离服务器');
    const file = loginWindowFile();
    let loginWindow = readLoginWindow(file, origin);
    const response = await request.get('/api/health');
    const header = response.headers()['x-ratelimit-remaining'];
    // Multi-set restoration loads 18 images twice plus canonical group reads.
    // Its measured 119 requests exceed the ordinary 90-request entry budget.
    const complexFlow = info.title.includes('完整流程') || info.title.includes('超长批次') || /18[张图]/.test(info.title);
    const budget = complexFlow ? 230 : 90;
    if (header !== undefined && Number(header) < budget) {
      const reset = Number(response.headers()['x-ratelimit-reset']);
      expect(Number.isFinite(reset) && reset >= 0 && reset <= 60).toBe(true);
      info.setTimeout(Math.max(info.timeout, 125000));
      await wait((reset + 1) * 1000);
    }
    // Keep two attempts available for file-level setup or a test that logs in
    // again. The cooldown is taken from the actual /auth/login response, not
    // from /health's unrelated global 300/minute bucket.
    const cooldown = loginWindow && loginWindow.remaining <= 2 ? Math.max(0, loginWindow.resetAt - Date.now()) : 0;
    if (cooldown > 0) {
      expect(cooldown).toBeLessThanOrEqual(61000);
      info.setTimeout(info.timeout + cooldown);
      await wait(cooldown);
    }
    const observeLogin = (response: Response) => {
      const url = new URL(response.url());
      if (url.origin !== origin || url.pathname !== '/api/auth/login' || response.request().method() !== 'POST') return;
      const headers = response.headers();
      const remaining = Number(headers['x-ratelimit-remaining']);
      const reset = Number(headers['retry-after'] ?? headers['x-ratelimit-reset']);
      if (!Number.isInteger(remaining) || remaining < 0 || !Number.isFinite(reset) || reset < 0 || reset > 60) return;
      loginWindow = { origin, remaining, resetAt: Date.now() + (reset + 1) * 1000 };
    };
    context.on('response', observeLogin);
    try { await use(); }
    finally {
      context.off('response', observeLogin);
      if (loginWindow) writeFileSync(file, JSON.stringify(loginWindow), 'utf8');
    }
  }, { auto: true }],
});
export { expect };
