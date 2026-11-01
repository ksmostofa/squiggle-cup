import { expect, test, type Page } from '@playwright/test';
import { NOT_WINGS, WINGS, strokes } from '../fixtures';

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

test('game document, branding and phone layout', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(page.getByRole('heading', { name: 'Draw it. Race it.' })).toBeVisible();
  // Home draws the logo inline so it can animate; other screens use the file.
  const logo = page.getByRole('img', { name: 'Squiggle Cup' });
  await expect(logo).toBeVisible();
  expect((await logo.boundingBox())!.width).toBeGreaterThan(100);
  const file = await page.request.get('logo.svg');
  expect(file.headers()['content-type']).toContain('image/svg');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const image = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(image).toBeTruthy();
  const asset = await page.request.get(new URL(image!).pathname);
  expect(asset.headers()['content-type']).toContain('image/png');
  const video = await page.locator('meta[property="og:video"]').getAttribute('content');
  expect((await page.request.get(new URL(video!).pathname)).headers()['content-type']).toContain('video/mp4');
});

test('downloaded drawing has an opaque white background', async ({ page }) => {
  await page.goto('/?demo=results');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save drawing', exact: true }).click();
  const download = await pending;
  const stream = (await download.createReadStream())!;
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const data = Buffer.concat(chunks).toString('base64');
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    return { corner: [...rgba.slice(0, 4)], opaque: rgba.every((v, i) => i % 4 !== 3 || v === 255) };
  }, data);
  expect(pixels.corner).toEqual([255, 255, 255, 255]);
  expect(pixels.opaque).toBe(true);
});

test('three players draw, agree on results, save PNGs and rematch three times', async ({ browser, baseURL }, testInfo) => {
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ baseURL, viewport: { width: 800, height: 600 }, acceptDownloads: true })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  const names = ['Dog Person', 'Bird Person', 'Snake Person'];
  pages.forEach((p) => p.on('pageerror', (error) => errors.push(error.message)));
  try {
    await Promise.all(pages.map(async (page, i) => {
      await page.goto('/');
      await page.locator('.pname').fill(names[i]);
    }));
    await pages[0].getByRole('button', { name: 'New room', exact: true }).click();
    await expect(pages[0].locator('.letters')).toBeVisible();
    const code = (await pages[0].locator('.letters').innerText()).replace(/\s/g, '');
    expect(code).toMatch(/^[A-Z]{4}$/);
    await Promise.all(pages.slice(1).map(async (page) => {
      await page.getByRole('textbox', { name: 'Room code' }).fill(code);
      await page.getByRole('button', { name: 'Join', exact: true }).click();
    }));
    for (const page of pages) {
      for (const name of names) await expect(page.locator('.lanes')).toContainText(name);
    }
    const nextHostName = await pages[0].locator('.lanes .who').nth(1).innerText();
    await pages[0].getByRole('radio', { name: 'Normal 30s' }).click();
    await pages[0].getByRole('button', { name: 'Start', exact: false }).click();
    await Promise.all(pages.map((page) => expect(page.locator('canvas.pad')).toBeVisible()));
    for (const page of pages) await expect(page.locator('.pad-screen .clock')).toHaveText('00:30');
    const drawings = [NOT_WINGS['dog with ears'].draw, WINGS['flung out, diagonal'], NOT_WINGS['snake, long wavy line'].draw];
    await Promise.all(pages.map(async (page, i) => {
      await draw(page, strokes(drawings[i], 7).map((s) => s.pts));
      await expect(page.locator('.readout .kind')).toContainText(['Four-legged', 'Flying', 'Slithering'][i], { ignoreCase: true });
      await page.getByRole('textbox', { name: 'Creature name' }).fill(names[i]);
    }));
    await Promise.all(pages.map((page) => page.locator('.done').click()));
    let baseline: string[] | undefined;
    for (let heat = 0; heat < 4; heat++) {
      await Promise.all(pages.map((page) => expect(page.locator('.screen.results')).toBeVisible({ timeout: 60_000 })));
      const tables = await Promise.all(pages.map((page) => page.locator('.table li').evaluateAll((rows) => rows.map((row) => `${row.querySelector('.who b')?.childNodes[0].textContent?.trim()}: ${row.querySelector('.time')?.textContent}`))));
      expect(tables[1]).toEqual(tables[0]);
      expect(tables[2]).toEqual(tables[0]);
      if (baseline) expect(tables[0]).toEqual(baseline);
      baseline = tables[0];
      expect(baseline).toHaveLength(5);
      for (const name of names) expect(baseline.some((row) => row.startsWith(name))).toBe(true);
      await expect(pages[1].getByRole('button', { name: 'Rematch', exact: true })).toBeHidden();
      if (heat < 3) await pages[0].getByRole('button', { name: 'Rematch', exact: true }).click();
    }
    for (const [button, width, height] of [['Save card', 1080, 1350], ['Save drawing', 512, 512]] as const) {
      const pending = pages[0].waitForEvent('download');
      await pages[0].getByRole('button', { name: button, exact: true }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toMatch(/\.png$/);
      const destination = testInfo.outputPath(download.suggestedFilename());
      await download.saveAs(destination);
      const { readFile } = await import('node:fs/promises');
      const data = await readFile(destination);
      expect(data.subarray(1, 4).toString()).toBe('PNG');
      expect(data.readUInt32BE(16)).toBe(width);
      expect(data.readUInt32BE(20)).toBe(height);
    }
    await pages[0].screenshot({ path: testInfo.outputPath('results.png') });
    await contexts[0].close();
    const nextHost = pages[names.indexOf(nextHostName)];
    await expect(nextHost.getByRole('button', { name: 'Rematch', exact: true })).toBeVisible();
    await nextHost.getByRole('button', { name: 'Rematch', exact: true }).click();
    await Promise.all(pages.slice(1).map((page) => expect(page.locator('.screen.race')).toBeVisible()));
    await Promise.all(pages.slice(1).map((page) => expect(page.locator('.screen.results')).toBeVisible({ timeout: 60_000 })));
    await expect(nextHost.locator('.table')).not.toContainText(names[0]);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
