import { test, expect } from '@playwright/test';

test('skip-to-content preserves the lesson route', async ({ page }) => {
  await page.goto('/#/lesson/tensor');
  await page.getByRole('link', { name: '跳到正文' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/lesson\/tensor$/);
  await expect(page.locator('main')).toBeFocused();
});

test('two open lessons never overwrite each other’s notes', async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  await page.goto('/#/lesson/tensor');
  await second.goto('/#/lesson/kv-cache');
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await second.getByRole('tab', { name: '本课笔记' }).click();
  await page.getByLabel('本课学习笔记').fill('第一课的重要笔记');
  await second.getByLabel('本课学习笔记').fill('第三课的重要笔记');
  await page.reload();
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await expect(page.getByLabel('本课学习笔记')).toHaveValue('第一课的重要笔记');
  await second.reload();
  await second.getByRole('tab', { name: '本课笔记' }).click();
  await expect(second.getByLabel('本课学习笔记')).toHaveValue(
    '第三课的重要笔记',
  );
});

test('checking the second acceptance item first survives reload', async ({
  page,
}) => {
  await page.goto('/#/lesson/tensor');
  await page.getByRole('tab', { name: '自测与验收' }).click();
  await page.locator('.acceptance-item input').nth(1).check();
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('tab', { name: '自测与验收' }).click();
  await expect(page.locator('.acceptance-item input').nth(1)).toBeChecked();
  await expect(page.locator('.acceptance-item input').nth(0)).not.toBeChecked();
});

// Field-level reconciliation must preserve unrelated remote data and local intent.
import {
  blankEntry,
  blankProgress,
  reconcileProgress,
  validateProgress,
} from '../src/lib/progress';

test('legacy sparse acceptance records are recoverable', () => {
  const old = blankProgress();
  old.records.tensor = {
    ...blankEntry(),
    notes: '已有笔记',
    checks: JSON.parse('[null,true]'),
  };
  const recovered = validateProgress(old);
  expect(recovered.records.tensor.checks).toEqual([false, true]);
  expect(recovered.records.tensor.notes).toBe('已有笔记');
});

test('conflicting notes keep both versions while explicit uncheck stays unchecked', () => {
  const base = blankProgress();
  base.records.tensor = {
    ...blankEntry(),
    notes: '共同版本',
    read: true,
    checks: [true, true],
  };
  const ours = structuredClone(base),
    theirs = structuredClone(base);
  ours.records.tensor.notes = '我的新版本';
  ours.records.tensor.read = false;
  ours.records.tensor.checks[0] = false;
  theirs.records.tensor.notes = '另一页面的新版本';
  theirs.records.tensor.quiz = true;
  theirs.records['kv-cache'] = { ...blankEntry(), notes: '另一课的笔记' };
  const result = reconcileProgress(base, ours, theirs);
  expect(result.records.tensor.notes).toContain('我的新版本');
  expect(result.records.tensor.notes).toContain('另一页面的新版本');
  expect(result.records.tensor.read).toBe(false);
  expect(result.records.tensor.checks[0]).toBe(false);
  expect(result.records.tensor.quiz).toBe(true);
  expect(result.records['kv-cache'].notes).toBe('另一课的笔记');
});

test('storage failure retains unsaved notes when saving recovers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { denySave: boolean }).denySave = false;
    Storage.prototype.setItem = function (key, value) {
      if ((window as unknown as { denySave: boolean }).denySave)
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/#/lesson/tensor');
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await page.evaluate(() => {
    (window as unknown as { denySave: boolean }).denySave = true;
  });
  await page.getByLabel('本课学习笔记').fill('存储失败时也不能丢失的笔记');
  await expect(page.getByRole('alert')).toContainText('保存或合并失败');
  await page.evaluate(() => {
    (window as unknown as { denySave: boolean }).denySave = false;
  });
  await page.getByRole('tab', { name: '讲解与实验' }).click();
  await page.getByLabel('我已阅读并理解本课讲解').check();
  await page.reload();
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await expect(page.getByLabel('本课学习笔记')).toHaveValue(
    '存储失败时也不能丢失的笔记',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('same-origin tabs synchronize notes and respect an explicit uncheck', async ({
  page,
  context,
}) => {
  await page.goto('/#/lesson/tensor');
  await page.getByLabel('我已阅读并理解本课讲解').check();
  const other = await context.newPage();
  await other.goto('/#/lesson/tensor');
  await other.getByLabel('我已阅读并理解本课讲解').uncheck();
  await expect(page.getByLabel('我已阅读并理解本课讲解')).not.toBeChecked();
  await page.getByRole('tab', { name: '本课笔记' }).click();
  await other.getByRole('tab', { name: '本课笔记' }).click();
  await page.getByLabel('本课学习笔记').fill('同步笔记');
  await expect(other.getByLabel('本课学习笔记')).toHaveValue('同步笔记');
});
