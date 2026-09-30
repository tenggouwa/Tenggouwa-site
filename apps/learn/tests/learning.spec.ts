import { test, expect } from '@playwright/test';
import { lessons, sources, stages } from '../src/data/course';
import {
  amdahl,
  kvGiB,
  roofline,
  schedule,
  softmax,
  speculate,
} from '../src/lib/math';
import {
  blankProgress,
  complete,
  mergeProgress,
  validateProgress,
} from '../src/lib/progress';
import { resolve } from 'node:path';

test('curriculum structure and numerical examples', () => {
  expect(lessons).toHaveLength(18);
  expect(new Set(lessons.map((l) => l.id)).size).toBe(18);
  stages.forEach((_, i) =>
    expect(lessons.filter((l) => l.stage === i)).toHaveLength(3),
  );
  for (const l of lessons) {
    expect(l.body.length).toBeGreaterThan(1800);
    expect(l.experiment.length).toBeGreaterThanOrEqual(3);
    l.sources.forEach((s) => expect(sources[s]).toBeDefined());
    expect(l.quiz.options[l.quiz.answer]).toBeTruthy();
  }
  expect(kvGiB(32, 8192, 8, 128, 2, 1)).toBe(1);
  expect(roofline(200, 4, 100, 2).boundMs).toBe(2);
  expect(amdahl(0.1, 2)).toBeCloseTo(1.05263158);
  expect(softmax([1000, 1000, 1000])[0]).toBeCloseTo(1 / 3);
  expect(softmax([1, 2, 3], true)[2]).toBe(0);
  expect(speculate(4, 0, 10, 3, 12).speedup).toBeCloseTo(2 / 3);
  expect(schedule(128).maxGap).toBeLessThan(schedule(2048).maxGap);
  expect(schedule(128).promptEnd).toBeGreaterThan(schedule(2048).promptEnd);
});

test('progress validation, merge and completion semantics', () => {
  const current = blankProgress();
  current.records.tensor = {
    read: true,
    quiz: false,
    checks: [true, false],
    notes: 'local',
    updated: '2026-01-01',
  };
  const incoming = blankProgress();
  incoming.records.tensor = {
    read: false,
    quiz: true,
    checks: [false, true],
    notes: 'imported',
    updated: '2026-02-01',
  };
  expect(complete('tensor', current)).toBe(false);
  const merged = mergeProgress(current, validateProgress(incoming));
  expect(complete('tensor', merged)).toBe(true);
  expect(merged.records.tensor.notes).toContain('local');
  expect(merged.records.tensor.notes).toContain('imported');
  expect(() => validateProgress({ version: 2, records: {} })).toThrow();
  expect(() =>
    validateProgress({ version: 1, records: { tensor: { read: 'yes' } } }),
  ).toThrow();
});

test('home, all lessons and resources render without runtime errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '从部署模型，到优化引擎。' }),
  ).toBeVisible();
  await expect(page.locator('.stage-card')).toHaveCount(6);
  for (const lesson of lessons) {
    await page.goto(`/#/lesson/${lesson.id}`);
    await expect(
      page.getByRole('heading', { name: lesson.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator('.prose')).not.toBeEmpty();
  }
  await page.goto('/#/resources');
  await page.getByRole('textbox', { name: '搜索术语' }).fill('TTFT');
  await expect(page.locator('.glossary>div')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('read, fail then pass quiz, acceptance and notes persist', async ({
  page,
}) => {
  await page.goto('/#/lesson/tensor');
  await page.getByLabel('我已阅读并理解本课讲解').check();
  await page.getByRole('tab', { name: '自测与验收' }).click();
  await page.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: '检查答案' }).click();
  await expect(page.getByText('再想一想', { exact: true })).toBeVisible();
  await page.getByRole('radio').nth(0).check();
  await page.getByRole('button', { name: '检查答案' }).click();
  await expect(page.getByText('回答正确', { exact: true })).toBeVisible();
  for (const check of await page.locator('.acceptance-item input').all())
    await check.check();
  await expect(page.locator('.completion')).toContainText('本课已完成');
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await page
    .getByLabel('本课学习笔记')
    .fill('证据：2×4×8 @ 8×24 → 2×4×24。<script>alert(1)</script>');
  await page.reload();
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await expect(page.getByLabel('本课学习笔记')).toHaveValue(/证据/);
  await page.goto('/#/notebook');
  await expect(page.locator('.note-preview')).toContainText(
    '<script>alert(1)</script>',
  );
  await page.goto('/');
  await expect(page.locator('.sidebar-bottom')).toContainText('1 / 18');
});

test('search and stage filtering', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '搜索课程' }).fill('KV Cache');
  await page
    .locator('.search-results')
    .getByRole('link', { name: /实现增量推理/ })
    .click();
  await expect(page).toHaveURL(/kv-cache/);
  await page.goto('/');
  await page.getByLabel('阶段筛选').selectOption('已完成');
  await expect(
    page.getByText('还没有完成的阶段。', { exact: false }),
  ).toBeVisible();
});

test('six simulations respond and reset', async ({ page }) => {
  await page.goto('/#/labs');
  await expect(page.locator('.lab-stat').first()).toContainText('1.00 GiB');
  await page.getByRole('slider', { name: '同时驻留请求' }).fill('4');
  await expect(page.locator('.lab-stat').first()).toContainText('4.00 GiB');
  await page.getByRole('button', { name: '重置实验参数' }).click();
  await expect(page.locator('.lab-stat').first()).toContainText('1.00 GiB');
  for (const name of [
    'Attention 权重实验',
    'Roofline 性能下界',
    'Prefill 分块实验',
    '推测解码收益实验',
    '端到端收益实验',
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.lab-heading')).toContainText(name);
    const slider = page.getByRole('slider').first();
    await slider.focus();
    await page.keyboard.press('ArrowRight');
  }
  await page
    .getByRole('button', { name: 'Attention 权重实验', exact: true })
    .click();
  await page.getByLabel('屏蔽未来位置 Key 3').check();
  await expect(page.locator('.weight-bars>div').nth(2)).toContainText('0.0%');
});

test('export backup and additive import preserve notes; invalid import has feedback', async ({
  page,
}) => {
  await page.goto('/#/lesson/tensor');
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await page.getByLabel('本课学习笔记').fill('原始笔记');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('inference-lab-backup.json');
  const input = page.getByLabel('导入学习备份');
  await input.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(page.getByRole('status')).toContainText('导入失败');
  const backup = blankProgress();
  backup.records.tensor = {
    read: true,
    quiz: true,
    checks: [true, true],
    notes: '备份笔记',
    updated: new Date().toISOString(),
  };
  await input.setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByLabel('本课学习笔记')).toHaveValue(
    /原始笔记[\s\S]*备份笔记/,
  );
  await expect(page.getByRole('status')).toContainText('已合并');
});

test('lesson files download with actual content', async ({ page }) => {
  await page.goto('/#/labs');
  for (const file of [
    'attention_reference.py',
    'scheduler_reference.py',
    'analyze_benchmark.py',
    'torch_profile.py',
    'triton_softmax.py',
    'prefill_budget.py',
    'optimization-report.md',
  ]) {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: file, exact: true }).click();
    const download = await event;
    expect(download.suggestedFilename()).toBe(file);
    const stream = await download.createReadStream();
    let content = '';
    for await (const chunk of stream!) content += chunk.toString();
    expect(content.length).toBeGreaterThan(500);
  }
});

for (const width of [375, 768, 1024, 1440])
  test(`responsive navigation and no overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      '/',
      '/#/lesson/kv-cache',
      '/#/labs',
      '/#/notebook',
      '/#/resources',
    ]) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, route).toBe(false);
    }
    if (width < 761) {
      await page.getByRole('button', { name: '打开导航' }).click();
      await expect(
        page.getByRole('navigation', { name: '主导航' }),
      ).toBeInViewport();
      await page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('link', { name: '学习路径' })
        .click();
      await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);
    }
  });

test('single HTML works offline without any external resources', async ({
  browser,
}) => {
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`file://${resolve('dist/index.html')}`);
  await expect(
    page.getByRole('heading', { name: '从部署模型，到优化引擎。' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '开始第一课', exact: true }).click();
  await expect(page.locator('.prose')).toContainText('一个 token');
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await page.getByLabel('本课学习笔记').fill('离线学习');
  await page.reload();
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await expect(page.getByLabel('本课学习笔记')).toHaveValue('离线学习');
  expect(errors).toEqual([]);
  await context.close();
});

test('corrupt local storage is reported and never overwritten silently', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('inference-lab-progress-v1', 'not-json'),
  );
  await page.goto('/#/lesson/tensor');
  await expect(page.getByRole('alert')).toContainText('历史记录无法读取');
  await page.getByLabel('我已阅读并理解本课讲解').check();
  expect(
    await page.evaluate(() =>
      localStorage.getItem('inference-lab-progress-v1'),
    ),
  ).toBe('not-json');
});

test('reader tabs support arrow-key navigation', async ({ page }) => {
  await page.goto('/#/lesson/tensor');
  await page.getByRole('tab', { name: '讲解与实验' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '自测与验收' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: '自测与验收' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByLabel('本课学习笔记')).toBeVisible();
});
