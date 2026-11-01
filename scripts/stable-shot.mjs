// Races a creature, then checks My creatures keeps it and can race it again.
// Usage: node scripts/stable-shot.mjs <baseURL> <outdir>
import { chromium } from '@playwright/test';
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
for (const kind of ['quadruped', 'flyer', 'quadruped']) {
  await page.goto(`${base}/?demo=draw&kind=${kind}`);
  await page.click('.btn.done');
  await page.waitForSelector('.screen.results', { timeout: 60000 });
}
await page.click('.home-link');
await page.click('.to-stable');
await page.waitForSelector('.stable .board-rows li');
console.log('kept:', (await page.locator('.stable .board-rows li').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()));
await page.screenshot({ path: `${out}/stable.png`, fullPage: true });
await page.click('.stable .use');
await page.waitForSelector('.screen.draw');
console.log('draw readout:', (await page.textContent('.readout'))?.replace(/\s+/g, ' ').trim());
await browser.close();
