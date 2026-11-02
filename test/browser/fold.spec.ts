import { expect, test } from '@playwright/test';

// Every screen's main buttons are in view without scrolling, on a desktop,
// a phone and a small phone.
const screens: [string, string, string[]][] = [
  ['home', '/', ['.solo', '.create', '.join button', '.to-board', '.to-stable']],
  ['draw', '/?demo=draw', ['.btn.done']],
  ['results', '/?demo=results', ['.again', '.redraw', '.share', '.save-card', '.post']],
  ['lobby', '/?demo=lobby', ['.start']],
  ['leaderboard', '/?demo=board', ['.draw-one']],
];

for (const [width, height] of [[1280, 800], [390, 844], [375, 667]]) {
  test(`buttons in view without scrolling at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const [name, path, selectors] of screens) {
      await page.goto(path);
      for (const sel of selectors) {
        const box = await page.locator(sel).first().boundingBox();
        expect(box, `${name} ${sel} exists`).not.toBeNull();
        expect(box!.y + box!.height, `${name} ${sel} is above the fold`).toBeLessThanOrEqual(height);
      }
    }
  });
}
