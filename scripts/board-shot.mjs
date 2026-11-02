// Posts a demo result to the leaderboard in a real browser and screenshots
// the toast and the board. Usage: node scripts/board-shot.mjs <baseURL> <outdir>
import { chromium } from '@playwright/test';
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' });
for (const [name, w, h] of [['desktop', 1280, 900], ['phone', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${base}/?demo=results&name=Biscuit`);
  await page.click('.post');
  await page.waitForSelector('.toast .see-board', { timeout: 15000 });
  console.log(name, 'toast:', await page.textContent('.toast'));
  await page.screenshot({ path: `${out}/board-${name}-posted.png`, fullPage: true });
  await page.click('.see-board');
  await page.waitForSelector('.board-rows li:not(.muted)');
  console.log(name, 'rows:', await page.locator('.board-rows li').count());
  await page.screenshot({ path: `${out}/board-${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
