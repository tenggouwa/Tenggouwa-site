import { test, expect } from '@playwright/test';
import { lessons } from '../src/data/course';
import { teachingPaths, quizStep } from '../src/data/teaching';
import { mathHelp } from '../src/data/teaching/types';

test('all lessons have authored foundations, exercises and an exact quiz return target', () => {
  expect(Object.keys(teachingPaths).sort()).toEqual(
    lessons.map((l) => l.id).sort(),
  );
  for (const lesson of lessons) {
    const path = teachingPaths[lesson.id];
    expect(path.mapping).toHaveLength(3);
    expect(path.steps.length).toBeGreaterThanOrEqual(5);
    expect(path.steps[quizStep[lesson.id]]).toBeDefined();
    expect(new Set(path.steps.map((s) => s.title)).size).toBe(
      path.steps.length,
    );
    for (const s of path.steps) {
      expect(s.lines.length).toBeGreaterThanOrEqual(2);
      expect(s.text.length).toBeLessThan(160);
      expect(s.options).toHaveLength(2);
      expect([0, 1]).toContain(s.answer);
      if (s.math) expect(mathHelp[s.math]).toBeDefined();
    }
  }
});

for (const lesson of lessons) {
  test(`${lesson.id}: analogy → every worked step → feedback → visual`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 375, height: 812 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const path = teachingPaths[lesson.id];
    await page.goto(`/#/lesson/${lesson.id}`);
    await expect(page.locator('.teaching-analogy')).toHaveText(path.analogy);
    await expect(page.locator('.concept-visual')).toHaveCount(0);
    await page
      .getByRole('button', { name: '开始拆开理解 →', exact: true })
      .click();
    for (let i = 0; i < path.steps.length; i++) {
      const item = path.steps[i];
      await expect(page.locator('.teaching-reader h3')).toHaveText(item.title);
      await expect(page.locator('.teaching-reader h3')).toBeFocused();
      await expect(page.locator('.worked-example li')).toHaveCount(1);
      for (let n = 1; n < item.lines.length; n++)
        await page
          .getByRole('button', { name: '下一行怎么算？', exact: true })
          .click();
      await expect(page.locator('.worked-example li p')).toHaveText(item.lines);
      if (item.math) {
        await page.locator('.math-help summary').click();
        await expect(page.locator('.math-help p')).toHaveText(
          mathHelp[item.math].lines,
        );
      }
      await expect(
        page.getByRole('button', { name: '核对这一步', exact: true }),
      ).toBeDisabled();
      await page
        .locator('.micro-check input')
        .nth(1 - item.answer)
        .check();
      await page
        .getByRole('button', { name: '核对这一步', exact: true })
        .click();
      await expect(page.locator('.micro-feedback')).toContainText(
        '这里再看一下',
      );
      await expect(page.locator('.micro-feedback')).toContainText(
        item.explanation,
      );
      await page.locator('.micro-check input').nth(item.answer).check();
      await expect(page.locator('.micro-feedback')).toHaveCount(0);
      await page
        .getByRole('button', { name: '核对这一步', exact: true })
        .click();
      await expect(page.locator('.micro-feedback')).toContainText('对，接上了');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.getByLabel('我已阅读并理解本课讲解')).not.toBeChecked();
      await page
        .getByRole('button', {
          name: i === path.steps.length - 1 ? '带着理解去操作 →' : '再拆一步 →',
          exact: true,
        })
        .click();
    }
    await expect(page.locator('.concept-visual')).toBeVisible();
    await expect(page.locator('.visual-task')).toHaveText(path.tryThis);
    await page.locator('.guided-steps button').nth(3).click();
    await page.locator('.guided-options input').nth(lesson.quiz.answer).check();
    await page
      .getByRole('button', { name: '看看我的判断', exact: true })
      .click();
    await page
      .getByRole('button', { name: '回到这道题的推导', exact: true })
      .click();
    await expect(page.locator('.teaching-reader h3')).toHaveText(
      path.steps[quizStep[lesson.id]].title,
    );
    expect(errors).toEqual([]);
  });
}

test('small-step navigation is reversible, keyboard usable and resets for a different lesson', async ({
  page,
}) => {
  await page.goto('/#/lesson/tensor');
  const begin = page.getByRole('button', {
    name: '开始拆开理解 →',
    exact: true,
  });
  await begin.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '再拆一步 →', exact: true }).click();
  await page.getByRole('button', { name: '上一小步', exact: true }).click();
  await expect(page.locator('.teaching-reader h3')).toHaveText(
    teachingPaths.tensor.steps[0].title,
  );
  await page.locator('.step-directory summary').click();
  await page.locator('.step-directory button').nth(4).click();
  await expect(page.locator('.step-directory')).not.toHaveAttribute('open');
  await expect(page.locator('.teaching-reader h3')).toHaveText(
    teachingPaths.tensor.steps[3].title,
  );
  await page.locator('.guided-steps button').nth(1).click();
  await page.locator('.guided-steps button').nth(0).click();
  await expect(page.locator('.teaching-reader h3')).toHaveText(
    teachingPaths.tensor.steps[3].title,
  );
  await page.goto('/#/lesson/attention');
  await expect(page.locator('.teaching-analogy')).toBeVisible();
});
