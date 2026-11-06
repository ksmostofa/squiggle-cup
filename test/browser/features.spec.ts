import { expect, test, type Page } from '@playwright/test';
import { NOT_WINGS, strokes } from '../fixtures';

// The eraser, the kind chip, friends-only rooms, and a host coming back to
// their room after leaving the site to send the invite.

async function draw(page: Page, paths: number[][][]) {
  const pad = page.locator('canvas.pad');
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  for (const path of paths) {
    for (let i = 0; i < path.length; i++) {
      await page.mouse.move(box.x + path[i][0] / 600 * box.width, box.y + path[i][1] / 600 * box.height);
      if (i === 0) await page.mouse.down();
    }
    await page.mouse.up();
  }
}

// Is there ink on the sheet at this pad point? (Ink is dark; the sheet and its grid are light.)
const inkAt = (page: Page, x: number, y: number) => page.locator('canvas.pad').evaluate((c: HTMLCanvasElement, [x, y]) => {
  const k = c.width / 600, d = c.getContext('2d')!.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
  return d[0] + d[1] + d[2] < 450;
}, [x, y]);

const line = (x0: number, y0: number, x1: number, y1: number, n = 30) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

test('the eraser rubs out only what it passes over, and undo brings it back', async ({ page }) => {
  await page.goto('/?demo=draw&empty');
  await draw(page, [line(100, 300, 500, 300)]);
  await page.waitForTimeout(800); // the ink dries
  expect(await inkAt(page, 300, 300)).toBe(true);
  await page.getByRole('button', { name: 'Eraser' }).click();
  await expect(page.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true');
  await draw(page, [line(300, 260, 300, 340, 10)]);
  expect(await inkAt(page, 300, 300)).toBe(false);
  expect(await inkAt(page, 150, 300)).toBe(true);
  expect(await inkAt(page, 450, 300)).toBe(true);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await inkAt(page, 300, 300)).toBe(true);
  // Picking an ink puts the pen back in your hand.
  await page.locator('.ink').nth(1).click();
  await expect(page.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'false');
});

test('the kind chip cycles through what a drawing can move as', async ({ page }) => {
  await page.goto('/?demo=draw&empty');
  await draw(page, strokes(NOT_WINGS['snake, long wavy line'].draw, 7).map((s) => s.pts));
  const chip = page.locator('.readout .kind.pick');
  const first = await chip.innerText();
  const seen = [first];
  for (let i = 0; i < 4; i++) {
    await chip.click();
    const now = await chip.innerText();
    if (now === first) break;
    seen.push(now);
  }
  expect(seen.length).toBeGreaterThan(1);
  expect(await chip.innerText()).toBe(first); // round the loop, back to how it reads
});

test('friends only: two players race each other with no bots', async ({ browser, baseURL }) => {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL, viewport: { width: 800, height: 600 } })));
  const [host, friend] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    for (const [p, n] of [[host, 'Hosty'], [friend, 'Pal']] as const) { await p.goto('/'); await p.locator('.pname').fill(n); }
    await host.getByRole('button', { name: 'New room', exact: true }).click();
    const code = (await host.locator('.letters').innerText()).replace(/\s/g, '');
    await friend.getByRole('textbox', { name: 'Room code' }).fill(code);
    await host.getByRole('radio', { name: /Friends only/ }).click();
    await expect(host.getByRole('button', { name: 'Start', exact: false }), 'friends only waits for a friend').toBeDisabled();
    await friend.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(friend.locator('.lanes')).toContainText('Hosty');
    await expect(friend.locator('.bots-note')).toHaveText('Friends only: no bots.');
    await expect(friend.locator('.lanes li.empty .who').first()).toHaveText('—');
    await host.getByRole('radio', { name: 'Quick 20s' }).click();
    // Picking a time doesn't clear the bots choice, and vice versa.
    await expect(host.getByRole('radio', { name: 'Quick 20s' })).toHaveAttribute('aria-checked', 'true');
    await expect(host.getByRole('radio', { name: /Friends only/ })).toHaveAttribute('aria-checked', 'true');
    await host.getByRole('button', { name: 'Start', exact: false }).click();
    const drawings = [NOT_WINGS['dog with ears'].draw, NOT_WINGS['snake, long wavy line'].draw];
    await Promise.all([host, friend].map(async (p, i) => { await expect(p.locator('canvas.pad')).toBeVisible(); await draw(p, strokes(drawings[i], 3).map((s) => s.pts)); await p.locator('.btn.done').click(); }));
    for (const p of [host, friend]) {
      await expect(p.locator('.screen.results')).toBeVisible({ timeout: 60_000 });
      await expect(p.locator('.table li')).toHaveCount(2);
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test('a host who leaves the site to send the invite comes back to the same room', async ({ browser, baseURL }) => {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL, viewport: { width: 800, height: 600 } })));
  const [host, friend] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    for (const [p, n] of [[host, 'Hosty'], [friend, 'Pal']] as const) { await p.goto('/'); await p.locator('.pname').fill(n); }
    await host.getByRole('button', { name: 'New room', exact: true }).click();
    const code = (await host.locator('.letters').innerText()).replace(/\s/g, '');
    // Off to another site: the host's connection goes with the page.
    await host.goto('about:blank');
    // The friend follows the link meanwhile and finds the room waiting.
    await friend.getByRole('textbox', { name: 'Room code' }).fill(code);
    await friend.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(friend.locator('.lanes')).toContainText('Hosty');
    await expect(friend.locator('.lanes li').first().locator('.tag')).toHaveText('HOST · AWAY');
    // Back to the game: same room, still the host.
    await host.goto(`/#room=${code}`);
    await expect(host.locator('.letters')).toBeVisible();
    expect((await host.locator('.letters').innerText()).replace(/\s/g, '')).toBe(code);
    await expect(host.getByRole('button', { name: 'Start', exact: false })).toBeVisible();
    await expect(friend.locator('.lanes li').first().locator('.tag')).toHaveText('HOST');
    await expect(host.locator('.lanes')).toContainText('Pal');
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
