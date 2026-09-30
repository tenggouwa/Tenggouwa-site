import { test, expect } from '@playwright/test';
import { lessons } from '../src/data/course';

test('every expanded chapter renders its complete section sequence', async ({
  page,
}) => {
  for (const lesson of lessons) {
    await page.goto(`/#/lesson/${lesson.id}`);
    const headings = [...lesson.body.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(headings.length).toBeGreaterThanOrEqual(8);
    await expect(page.locator('.prose h3')).toHaveText(headings);
    await expect(page.locator('.prose')).toContainText(headings.at(-1)!);
  }
});

test('reading navigation scrolls to the section without changing the lesson route', async ({
  page,
}) => {
  await page.goto('/#/lesson/patch');
  await page.locator('.reading-outline summary').click();
  await page
    .getByRole('button', { name: '把测试写成能抓到错误的条件', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/lesson\/patch$/);
  await expect(page.locator('#section-patch-3')).toBeFocused();
  await expect(page.locator('.prose')).toContainText('504');
  const event = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '下载 prefill_budget.py', exact: true })
    .click();
  expect((await event).suggestedFilename()).toBe('prefill_budget.py');
});

test('long chapter tables and code remain within mobile page width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const id of ['tensor', 'metrics', 'patch', 'capstone']) {
    await page.goto(`/#/lesson/${id}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test('prerequisites are earlier lessons and every quiz has a specific reading anchor', () => {
  lessons.forEach((lesson, index) => {
    expect(new Set(lesson.prerequisites).size).toBe(
      lesson.prerequisites.length,
    );
    for (const id of lesson.prerequisites) {
      const position = lessons.findIndex((l) => l.id === id);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(index);
    }
    expect(lesson.body.split('\n')).toContain(`### ${lesson.quiz.section}`);
  });
});

test('all quiz feedback links return to the matching reading section', async ({
  page,
}) => {
  for (const lesson of lessons) {
    await page.goto(`/#/lesson/${lesson.id}`);
    await page.getByRole('tab', { name: '自测与验收' }).click();
    await page
      .getByRole('radio')
      .nth((lesson.quiz.answer + 1) % lesson.quiz.options.length)
      .check();
    await page.getByRole('button', { name: '检查答案', exact: true }).click();
    await expect(page.getByText('再想一想', { exact: true })).toBeVisible();
    await page
      .getByRole('button', {
        name: `回看讲解：${lesson.quiz.section}`,
        exact: true,
      })
      .click();
    await expect(page.getByRole('tab', { name: '讲解与实验' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('heading', { name: lesson.quiz.section, exact: true }),
    ).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`#/lesson/${lesson.id}$`));
  }
});
