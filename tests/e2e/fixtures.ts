import { test as base, expect } from '@playwright/test';
import { setTimeout as wait } from 'node:timers/promises';
export type { Page, Browser, BrowserContext, BrowserContextOptions, Locator, TestInfo } from '@playwright/test';

// All suites share an isolated local IP. Respect the real rate protection.
export const test = base.extend<{ rateWindow: void }>({
  rateWindow: [async ({ request }, use, info) => {
    const response = await request.get('/api/health');
    const header = response.headers()['x-ratelimit-remaining'];
    const budget = info.title.includes('完整流程') || info.title.includes('超长批次') ? 230 : 90;
    if (header !== undefined && Number(header) < budget) {
      const reset = Number(response.headers()['x-ratelimit-reset']);
      expect(Number.isFinite(reset) && reset >= 0 && reset <= 60).toBe(true);
      info.setTimeout(Math.max(info.timeout, 125000));
      await wait((reset + 1) * 1000);
    }
    await use();
  }, { auto: true }],
});
export { expect };
