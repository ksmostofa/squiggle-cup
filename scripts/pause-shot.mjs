// Pause in a solo race: Esc opens the menu and freezes the clock; Resume
// carries on; Quit goes home. Usage: node scripts/pause-shot.mjs <baseURL> <outdir>
import { chromium } from '@playwright/test';
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${base}/?demo=race&t=2`);
await page.waitForTimeout(1500);
await page.keyboard.press('Escape');
const a = await page.textContent('.clock');
await page.waitForTimeout(1500);
const b = await page.textContent('.clock');
console.log('menu open:', await page.isVisible('.pause-menu'), '| clock while paused:', a, '→', b, a === b ? 'FROZEN' : 'MOVED');
await page.screenshot({ path: `${out}/pause.png` });
await page.click('.pause-menu .resume');
await page.waitForTimeout(1000);
console.log('after resume:', await page.textContent('.clock'), '| menu open:', await page.isVisible('.pause-menu'));
await page.click('.pause-btn');
await page.click('.pause-menu .quit');
console.log('after quit:', await page.evaluate(() => document.querySelector('main')?.className));
await browser.close();
