// Walks the 1v1 challenge in a real browser: post a creature, open the board,
// challenge it, race, redraw, race again. Usage: node scripts/challenge-shot.mjs <baseURL> <outdir>
import { chromium } from '@playwright/test';
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${base}/?demo=results&name=Biscuit`);
await page.click('.post');
await page.waitForSelector('.toast .see-board', { timeout: 15000 });
await page.click('.see-board');
await page.waitForSelector('.board-rows .vs');
await page.screenshot({ path: `${out}/challenge-board.png` });
await page.click('.board-rows .vs');
await page.waitForSelector('.screen.draw');
console.log('draw header:', await page.textContent('.masthead .right'));
await page.screenshot({ path: `${out}/challenge-draw.png` });
for (let round = 1; round <= 2; round++) {
  await page.click('.btn.done');
  await page.waitForSelector('.screen.results', { timeout: 60000 });
  console.log(`round ${round}:`, (await page.locator('.table li').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).join(' | '));
  if (round === 1) {
    await page.screenshot({ path: `${out}/challenge-results.png`, fullPage: true });
    await page.click('.redraw');
    await page.waitForSelector('.screen.draw');
  }
}
await page.click('.again');
await page.waitForSelector('.screen.race');
await page.waitForSelector('.screen.results', { timeout: 60000 });
console.log('rematch:', (await page.locator('.table li').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).join(' | '));
await browser.close();
