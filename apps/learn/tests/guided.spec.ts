import { test, expect } from '@playwright/test';
import { lessons } from '../src/data/course';
import { guides } from '../src/data/guides';

test('all 18 lessons have short guides without removing textbook content', () => {
  expect(Object.keys(guides).sort()).toEqual(lessons.map((l) => l.id).sort());
  for (const lesson of lessons) {
    const guide = guides[lesson.id];
    expect(guide.scene.length).toBeLessThan(100);
    expect(guide.why.length).toBeLessThan(130);
    expect(lesson.body.length).toBeGreaterThan(1800);
  }
});

test('every guide reveals examples, explains wrong answers and preserves reference access', async ({
  page,
}) => {
  for (const lesson of lessons) {
    const guide = guides[lesson.id];
    await page.goto(`/#/lesson/${lesson.id}`);
    await expect(page.locator('.guided-lesson')).toBeVisible();
    await expect(page.locator('.prose')).not.toBeVisible();
    await expect(page.locator('.teaching-reader')).toBeVisible();
    await expect(page.locator('.concept-visual')).toHaveCount(0);
    await page.locator('.guided-steps button').nth(1).click();
    await expect(page.locator('.concept-visual')).toBeVisible();
    expect(
      await page
        .locator('.concept-visual input, .concept-visual button')
        .count(),
    ).toBeGreaterThan(0);
    await expect(page.locator('.visual-explanation')).not.toHaveAttribute(
      'open',
    );
    await page
      .getByRole('button', { name: '用例子想一遍 →', exact: true })
      .click();
    await expect(page.locator('.guided-comparison')).not.toContainText(
      guide.after,
    );
    await page
      .getByRole('button', { name: '我想好了，看结果', exact: true })
      .click();
    await expect(page.locator('.guided-comparison')).toContainText(guide.after);
    await page.getByRole('button', { name: '试着判断 →', exact: true }).click();
    await page
      .locator('.guided-options input')
      .nth((lesson.quiz.answer + 1) % 3)
      .check();
    await page
      .getByRole('button', { name: '看看我的判断', exact: true })
      .click();
    await expect(page.locator('.guided-answer')).toContainText(
      '看看是哪一步想偏了',
    );
    await page.locator('.guided-options input').nth(lesson.quiz.answer).check();
    await expect(page.locator('.guided-answer')).toHaveCount(0);
    await page
      .getByRole('button', { name: '看看我的判断', exact: true })
      .click();
    await expect(page.locator('.guided-answer')).toContainText(
      '这一步理解对了',
    );
    await expect(page.getByLabel('我已阅读并理解本课讲解')).not.toBeChecked();
    await page
      .getByRole('button', { name: '回到对应原理', exact: true })
      .click();
    await expect(page.locator('.prose')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: lesson.quiz.section, exact: true }),
    ).toBeFocused();
  }
});

test('guided controls work on mobile and keyboard without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/lesson/gpu-memory');
  await page.locator('.guided-steps button').nth(1).click();
  const control = page.getByRole('button', {
    name: '打开边界 mask',
    exact: true,
  });
  await control.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: '关闭边界 mask', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.visual-memory-grid .masked')).toHaveCount(24);
  for (const name of ['用例子想一遍 →', '我想好了，看结果', '试着判断 →']) {
    await page.getByRole('button', { name, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole('button', { name: '去自测与验收 →', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: '自测与验收' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('visual experiments update quantities and boundary cases', async ({
  page,
}) => {
  const range = page.locator('.concept-visual input[type="range"]');
  for (const id of ['kv-cache', 'paged-kv']) {
    await page.goto(`/#/lesson/${id}`);
    await page.locator('.guided-steps button').nth(1).click();
    await range.fill('16');
    await expect(page.locator('.visual-blocks > div')).toHaveCount(1);
    await range.fill('17');
    await expect(page.locator('.visual-blocks > div')).toHaveCount(2);
    await expect(page.locator('.visual-tiles .filled')).toHaveCount(17);
    await expect(page.locator('.visual-result')).toContainText(
      '17 已用 / 32 槽位',
    );
  }
  await page.goto('/#/lesson/tensor');
  await page.locator('.guided-steps button').nth(1).click();
  await range.fill('8');
  await expect(page.locator('.visual-result')).toContainText('96 FLOPs');
  await expect(
    page.locator('.visual-equation > div').nth(1).locator('.filled'),
  ).toHaveCount(6);
  await page.goto('/#/lesson/softmax');
  await page.locator('.guided-steps button').nth(1).click();
  await expect(page.locator('.visual-result')).toContainText('0.213');
  await page
    .getByRole('button', { name: '把补齐值从 0 改为 −∞', exact: true })
    .click();
  await expect(page.locator('.visual-result')).toContainText('1.000');
  await expect(page.locator('.visual-bar-row').nth(2)).toContainText('0 %');
  await page.goto('/#/lesson/attention');
  await page.locator('.guided-steps button').nth(1).click();
  await range.fill('0');
  await page.getByRole('button', { name: '屏蔽未来位置', exact: true }).click();
  await expect(page.locator('.visual-bar-row').nth(0)).toContainText('50 %');
  await expect(page.locator('.visual-bar-row').nth(2)).toContainText('0 %');
  await page.goto('/#/lesson/parallel');
  await page.locator('.guided-steps button').nth(1).click();
  await expect(page.locator('.visual-merge')).toContainText('对应元素相加');
  await page.locator('.concept-visual button').click();
  await expect(page.locator('.visual-merge')).toContainText('拼接输出列');
  await expect(page.locator('.visual-result')).toContainText('[5,11]');
  await page.goto('/#/lesson/patch');
  await page.locator('.guided-steps button').nth(1).click();
  await range.fill('0');
  await expect(page.locator('.visual-result')).toContainText(
    '8 + 504 + 0 = 512',
  );
  await range.fill('1');
  await expect(page.locator('.visual-result')).toContainText(
    '8 + 64 + 440 = 512',
  );
});

test('all concept visuals fit narrow screens at both control extremes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const lesson of lessons) {
    await page.goto(`/#/lesson/${lesson.id}`);
    await page.locator('.guided-steps button').nth(1).click();
    const input = page.locator('.concept-visual input');
    if (await input.count()) {
      for (const edge of ['min', 'max']) {
        await input.fill((await input.getAttribute(edge))!);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
    } else {
      await page.locator('.concept-visual button').first().click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});
