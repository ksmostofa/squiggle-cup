import { expect, test } from '@playwright/test';

// Whole-app checks of the house lineup, the stable scale, and the newer
// features (leaderboard, 1v1, My creatures, pause), through real clicks.
const names = async (page: import('@playwright/test').Page) =>
  (await page.locator('.table li .who b').allTextContents()).filter((n) => !/Your Creature/.test(n)).sort().join(', ');

test('a new game and a rematch deal new house creatures; redraw keeps them', async ({ page }) => {
  await page.goto('/?demo=draw&family=dog');
  await page.click('.btn.done');
  await page.waitForSelector('.screen.results', { timeout: 60_000 });
  const first = await names(page);
  await page.click('.redraw');
  await expect(page.locator('.screen.draw'), 'redraw starts from a blank sheet').toContainText('Waiting for ink');
  await page.goto('/?demo=draw&family=dog');
  await page.click('.btn.done');
  await page.waitForSelector('.screen.results', { timeout: 60_000 });
  const before = await names(page);
  await page.click('.again');
  await page.waitForSelector('.screen.results', { timeout: 60_000 });
  const mine = page.locator('.table li.me .who b');
  await expect(mine, 'rematch keeps my drawing').toContainText('you');
  expect(await names(page), 'rematch deals a new lineup').not.toBe(before);
  await page.goto('/?demo=draw&family=dog');
  await page.click('.btn.done');
  await page.waitForSelector('.screen.results', { timeout: 60_000 });
  expect(await names(page), 'a new game deals a new lineup').not.toBe(first);
});

test('every racer is drawn at one scale for the whole race', async ({ page }) => {
  test.skip(!!process.env.PLAYTEST_URL, 'Uses the source renderer.');
  await page.goto('/?demo=race&t=0');
  const scales = await page.evaluate(async () => {
    const [{ Race }, { Renderer }, { analyze }, { canonical }, { template, FAMILIES }, { mulberry32 }] = await Promise.all(
      ['/src/race.ts', '/src/render.ts', '/src/analyze.ts', '/src/drawing.ts', '/src/templates.ts', '/src/rng.ts'].map((u) => import(u)));
    const canvas = document.querySelector<HTMLCanvasElement>('.race canvas.stage')!;
    const race = new Race(['bird', 'bat', 'horse', 'snake', 'blob'].map((f: string, i: number) => ({ anatomy: analyze(canonical(template(mulberry32(i), f, 0.6).strokes)), name: f, kind: i ? 'rival' : 'player' })));
    const view = new Renderer(canvas, race);
    const seen = new Set<number>();
    for (let tick = 0; tick < 1200 && !race.over; tick++) { race.step(); if (tick % 20 === 0) { view.draw(tick * 16, 1 / 60); seen.add(Math.round(view.scale * 1000)); } }
    return [...seen];
  });
  expect(scales.length, `one scale through flapping and camera moves: ${scales.join(', ')}`).toBe(1);
});

test('leaderboard post, 1v1 challenge, My creatures and pause', async ({ page }) => {
  await page.goto('/?demo=draw&family=cat');
  await page.click('.btn.done');
  await page.waitForSelector('.screen.results', { timeout: 60_000 });
  if (process.env.PLAYTEST_URL) {
    // A live board is public: never post test creatures to it; challenge one already there.
    await page.goto('/?demo=board');
  } else {
    await page.click('.post');
    await expect(page.locator('.toast')).toContainText('Verified', { timeout: 20_000 });
    await page.click('.see-board');
  }
  await page.waitForSelector('.board-rows .vs');
  await page.click('.board-rows .vs');
  await expect(page.locator('.masthead .right')).toContainText('1V1');
  await page.click('.btn.done');
  await page.waitForSelector('.screen.race');
  await expect(page.locator('.standings li')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-menu')).toBeVisible();
  const t = await page.textContent('.clock');
  await page.waitForTimeout(1200);
  expect(await page.textContent('.clock'), 'paused race holds still').toBe(t);
  await page.click('.pause-menu .quit');
  await page.click('.to-stable');
  await expect(page.locator('.stable .board-rows li').first()).toContainText('s');
  await page.click('.stable .use');
  await expect(page.locator('.screen.draw')).toBeVisible();
});
