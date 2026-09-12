import { test, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page, type TestInfo } from '@playwright/test';

const skillName = '显示适配测试｜深灰阔腿裤与完整对标视频确认版';
const draftName = '显示适配草稿｜较长的商品名称与版本说明也应该清晰完整地阅读';
const sampleScript = '# 显示适配验证脚本\n\n只作为本地界面尺寸测试，不调用真实 AI 服务。\n\n' +
  '请同时上传商品图片与原始完整对标视频，并连接到同一个视频生成节点。'.repeat(8);
let session: Awaited<ReturnType<BrowserContext['storageState']>>;

async function displayContext(browser: Browser, options: BrowserContextOptions) {
  const context = await browser.newContext({ storageState: session, ...options });
  if (process.env.VSW_DISPLAY_BASELINE === '1') {
    // RED-only evidence: serve the exact preserved pre-change stylesheet in the
    // isolated browser. Application files and the running installed app are untouched.
    await context.route('**/*.css', route => route.fulfill({
      path: 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/display-0.1.6/theme-before.css',
      contentType: 'text/css',
    }));
  }
  return context;
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('登录账号').fill('preview-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
}

async function fixtureRequest(page: Page, url: string, data: Record<string, unknown>) {
  const profile = await (await page.request.get('/api/me')).json();
  const response = await page.request.post(url, {
    data, headers: { 'X-CSRF-Token': profile.csrf, origin: new URL(page.url()).origin },
  });
  expect(response.ok(), `${url}: ${response.status()}`).toBe(true);
  return response.json();
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page);
  // Real local API, isolated harness database; no providers or paid jobs are run.
  // A failed test restarts Playwright's worker, not the harness database.
  const existingSkills = await (await page.request.get('/api/skills')).json() as { name: string }[];
  if (!existingSkills.some(skill => skill.name === skillName)) await fixtureRequest(page, '/api/skills', {
    name: skillName, kind: 'full', duration: 14, text: sampleScript,
    tags: ['中文长标签展示', '必须同步上传原始完整对标视频'], visibility: 'private',
    source: '界面显示测试专用。保留商品图、完整对标视频与版本说明，不触发生成请求。',
  });
  if (!existingSkills.some(skill => skill.name === '儿童帽子｜商场场景开头')) await fixtureRequest(page, '/api/skills', {
    name: '儿童帽子｜商场场景开头', kind: 'opening', duration: 5,
    text: '# 独立开头脚本\n仅界面显示验证。', visibility: 'private',
  });
  if (!existingSkills.some(skill => skill.name === '日常穿搭｜自然光面料细节展示')) await fixtureRequest(page, '/api/skills', {
    name: '日常穿搭｜自然光面料细节展示', kind: 'detail', duration: 7,
    text: '# 面料细节\n仅界面显示验证。', visibility: 'private',
  });
  const existingDrafts = await (await page.request.get('/api/drafts')).json() as { name: string }[];
  if (!existingDrafts.some(draft => draft.name === draftName)) await fixtureRequest(page, '/api/drafts', { name: draftName, input: { name: draftName, media: [] } });
  session = await page.context().storageState();
  await page.close();
});

async function measurements(scope: Locator) {
  return scope.evaluate(root => {
    const visible = (element: Element) => Boolean(element.getClientRects().length) &&
      getComputedStyle(element).visibility !== 'hidden';
    const entries = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector))
      .filter(visible).map(element => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.className,
          text: (element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 70),
          font: parseFloat(style.fontSize), weight: parseInt(style.fontWeight, 10),
          height: box.height, width: box.width, lineHeight: parseFloat(style.lineHeight) };
      });
    return {
      text: entries('p, small, label, .tag, .eyebrow, .save-state, .skill-card-tags, .skill-preview-caption, .skill-preview-empty, .source-text, td, th'),
      controls: entries('button, input:not([type="checkbox"]):not([type="file"]), select, textarea'),
      headings: entries('h1, h2, h3'),
    };
  });
}

async function assertReadable(page: Page, label: string, info: TestInfo) {
  const values = await measurements(page.locator('body'));
  await info.attach(`${label}-measurements`, { body: JSON.stringify(values, null, 2), contentType: 'application/json' });
  expect.soft(values.text.filter(value => value.font < 14), `${label}: visible auxiliary text is at least 14 CSS px`).toEqual([]);
  expect.soft(values.text.filter(value => value.weight < 400), `${label}: text is at least normal weight`).toEqual([]);
  expect.soft(values.controls.filter(value => value.height < 43.5), `${label}: controls are at least 44 CSS px high`).toEqual([]);
  expect.soft(values.controls.filter(value => value.font < 15), `${label}: control text is at least 15 CSS px`).toEqual([]);
  expect.soft(values.headings.filter(value => value.tag === 'H1' && (value.font < 24 || value.font > 28)), `${label}: page title is 24–28 CSS px`).toEqual([]);
  expect.soft(values.headings.filter(value => value.tag !== 'H1' && (value.font < 18 || value.font > 22)), `${label}: section titles are 18–22 CSS px`).toEqual([]);
}

async function assertFits(page: Page, label: string, info: TestInfo) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter(element => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) return false;
      // Tables and media strips may scroll inside their own bounded container.
      if (element.closest('.table-wrap, .product-grid, .source-text, .prompt-block')) return false;
      return box.left < -1 || box.right > innerWidth + 1;
    }).map(element => ({ tag: element.tagName, className: element.className,
      text: element.innerText?.trim().slice(0, 55), right: element.getBoundingClientRect().right }));
    return { viewport: innerWidth, document: root.scrollWidth, offenders };
  });
  await info.attach(`${label}-layout`, { body: JSON.stringify(overflow, null, 2), contentType: 'application/json' });
  expect.soft(overflow.document, `${label}: no page-level horizontal scrolling`).toBeLessThanOrEqual(overflow.viewport + 1);
  expect.soft(overflow.offenders, `${label}: visible controls stay inside the window`).toEqual([]);
  const overlappingCards = await page.locator('.skill-selection-card').evaluateAll(cards => cards.flatMap(card => {
    if (!card.getClientRects().length) return [];
    const thumb = card.querySelector('.skill-preview-thumb')?.getBoundingClientRect();
    if (!thumb) return [];
    return Array.from(card.querySelectorAll<HTMLElement>('.skill-card-title, .skill-card-tags, .card-bottom')).flatMap(element => {
      const text = element.getBoundingClientRect();
      const overlaps = Math.min(text.right, thumb.right) - Math.max(text.left, thumb.left) > 1 &&
        Math.min(text.bottom, thumb.bottom) - Math.max(text.top, thumb.top) > 1;
      return overlaps ? [{ element: element.className, text: element.innerText }] : [];
    });
  }));
  expect.soft(overlappingCards, `${label}: long card text, preview, and actions do not overlap`).toEqual([]);
  const squeezedContent = await page.locator('.field-grid > label, .skill-card-title').evaluateAll(elements => elements
    .filter(element => element.getClientRects().length)
    .flatMap(element => {
      const width = element.getBoundingClientRect().width;
      const minimum = element.classList.contains('skill-card-title') ? 100 : 160;
      return width < minimum ? [{ text: (element as HTMLElement).innerText.slice(0, 55), width, minimum }] : [];
    }));
  expect.soft(squeezedContent, `${label}: fields and Chinese titles reflow instead of squeezing into tiny columns`).toEqual([]);
  await page.screenshot({ path: info.outputPath(`${label}.png`), fullPage: true });
}

async function openSettings(page: Page) {
  // Hash routes are the same application navigation targets at every breakpoint,
  // including compact icon-only sidebars whose text is deliberately hidden.
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: '文字／视觉接口', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
}

test('正文、辅助文字、控件、标题及表格使用统一可读尺寸', async ({ browser }, info) => {
  const context = await displayContext(browser, { viewport: { width: 2560, height: 1440 } });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: `选择脚本：${skillName}`, exact: true })).toBeVisible();
    const body = await page.locator('body').evaluate(element => {
      const style = getComputedStyle(element);
      return { font: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) / parseFloat(style.fontSize) };
    });
    expect.soft(body.font, 'body defaults to a readable 16px').toBeGreaterThanOrEqual(16);
    expect.soft(body.font).toBeLessThanOrEqual(18);
    expect.soft(body.lineHeight).toBeGreaterThanOrEqual(1.5);
    expect.soft(body.lineHeight).toBeLessThanOrEqual(1.7);
    await page.locator('summary').filter({ hasText: '更多设置' }).click();
    await page.getByLabel('上传商品图', { exact: true }).setInputFiles(`${process.env.VSW_TEST_ROOT}/sample-product.png`);
    await expect(page.getByLabel('图片 1 用途')).toBeVisible();
    await assertReadable(page, 'creation', info);
    const content = await page.locator('.workspace-main').evaluate(element => {
      const box = element.getBoundingClientRect();
      const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect();
      return { width: box.width, leftSpace: box.left - sidebar.right,
        rightSpace: document.documentElement.clientWidth - box.right };
    });
    expect.soft(content.width, '2K content is bounded rather than stretching across the whole monitor').toBeLessThanOrEqual(1800);
    expect.soft(Math.abs(content.leftSpace - content.rightSpace), 'main area is centered in the available space').toBeLessThanOrEqual(2);
    await assertFits(page, 'creation-2560', info);
    await openSettings(page);
    await assertReadable(page, 'settings-table', info);
    const input = page.getByLabel('preview-admin文字总额度');
    const row = input.locator('xpath=ancestor::tr');
    expect.soft((await row.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await assertFits(page, 'settings-2560', info);
    await page.goto('/#history');
    await expect(page.getByRole('heading', { name: draftName, exact: true })).toBeVisible();
    await assertReadable(page, 'history-list', info);
    await page.goto('/#library');
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: skillName, exact: true }) });
    await card.getByRole('button', { name: '查看脚本', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertReadable(page, 'script-dialog', info);
    await assertFits(page, 'script-dialog-2560', info);
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

const displays = [
  { name: '1920-100', width: 1920, height: 1080, dpr: 1 },
  { name: '1920-125', width: 1536, height: 864, dpr: 1.25 },
  { name: '1920-150', width: 1280, height: 720, dpr: 1.5 },
  { name: '2560-100', width: 2560, height: 1440, dpr: 1 },
  { name: '2560-125', width: 2048, height: 1152, dpr: 1.25 },
  { name: '2560-150', width: 1707, height: 960, dpr: 1.5 },
  { name: 'compact-768', width: 768, height: 800, dpr: 1 },
  { name: 'compact-320', width: 320, height: 720, dpr: 1 },
];

for (const display of displays) {
  test(`${display.name}：创建、脚本库、弹窗、设置表格、列表无窗口级溢出`, async ({ browser }, info) => {
    const context = await displayContext(browser, {
      viewport: { width: display.width, height: display.height }, deviceScaleFactor: display.dpr });
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('/');
      await expect(page.getByRole('button', { name: `选择脚本：${skillName}`, exact: true })).toBeVisible();
      expect(await page.evaluate(() => devicePixelRatio)).toBe(display.dpr);
      await page.locator('summary').filter({ hasText: '更多设置' }).click();
      await expect(page.getByLabel('发布平台')).toBeVisible();
      await assertFits(page, `${display.name}-creation`, info);
      await page.goto('/#library');
      const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: skillName, exact: true }) });
      await expect(card).toBeVisible();
      await assertFits(page, `${display.name}-library`, info);
      await card.getByRole('button', { name: '查看脚本', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect.soft(box.x).toBeGreaterThanOrEqual(0);
      expect.soft(box.y).toBeGreaterThanOrEqual(0);
      expect.soft(box.x + box.width).toBeLessThanOrEqual(display.width + 1);
      expect.soft(box.y + box.height).toBeLessThanOrEqual(display.height + 1);
      await assertFits(page, `${display.name}-dialog`, info);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await openSettings(page);
      await assertFits(page, `${display.name}-settings`, info);
      await page.goto('/#history');
      await expect(page.getByRole('heading', { name: draftName, exact: true })).toBeVisible();
      await assertFits(page, `${display.name}-history`, info);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
