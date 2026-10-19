import { test, expect } from './fixtures';

test('全部27个Skill均可下拉选择，竖卡缩窄且预览保留放大尺寸', async ({ page }, info) => {
  const skills = Array.from({ length: 27 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    versionId: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
    name: `竖版展示 Skill ${index + 1}`, kind: 'full', duration: 12.281905,
    ownerId: 'owner', tags: [], visibility: 'private', version: 1, source: '', text: '测试脚本', missing: [], files: [],
  }));
  await page.route('**/api/skills', route => route.fulfill({ json: skills }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  const region = page.getByRole('region', { name: '全部 Skill', exact: true });
  await expect(region.getByRole('article')).toHaveCount(27);
  const first = region.getByRole('article').first();
  const card = (await first.boundingBox())!;
  const preview = (await first.locator('.skill-preview-thumb').boundingBox())!;
  expect(card.width).toBeLessThanOrEqual(200);
  expect(card.height).toBeGreaterThan(card.width);
  expect(preview.width).toBeGreaterThanOrEqual(140);
  expect(preview.width / card.width).toBeGreaterThan(.82);
  expect(preview.height).toBeGreaterThanOrEqual(180);
  await expect(first.getByText('全片', { exact: true })).toHaveCount(0);
  await expect(first.getByText(/v1.*私人/)).toHaveCount(0);
  const row = await region.getByRole('article').evaluateAll(elements => {
    const firstY = elements[0].getBoundingClientRect().top;
    return elements.filter(element => Math.abs(element.getBoundingClientRect().top - firstY) < 1).length;
  });
  expect(row).toBeGreaterThanOrEqual(5);
  await region.getByRole('button', { name: '选择脚本：竖版展示 Skill 27', exact: true }).click();
  await expect(region.getByRole('button', { name: '选择脚本：竖版展示 Skill 27', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('region', { name: '创作操作' }).getByRole('button', { name: '下一步', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('compact-all-skills.png'), fullPage: true });
});
