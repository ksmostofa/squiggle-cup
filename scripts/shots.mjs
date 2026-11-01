// Usage: node shots.mjs <baseURL> <outdir> [label]
import { chromium } from '@playwright/test';
const [base, out, label = 'x'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' });
const shots = [
  ['race-desktop', 1280, 800, '/?demo=race&t=5&kind=flyer'],
  ['race-desktop-late', 1280, 800, '/?demo=race&t=14&kind=flyer'],
  ['race-phone', 390, 844, '/?demo=race&t=5&kind=flyer'],
  ['race-phone-land', 844, 390, '/?demo=race&t=5&kind=flyer'],
  ['draw-desktop', 1280, 800, '/?demo=draw&kind=flyer'],
  ['draw-phone', 390, 844, '/?demo=draw&kind=flyer'],
  ['results-desktop', 1280, 800, '/?demo=results'],
  ['results-phone', 390, 844, '/?demo=results'],
  ['home-desktop', 1280, 800, '/'],
  ['gallery', 1400, 2400, '/?demo=gallery'],
];
const only = process.env.ONLY?.split(',');
for (const [name, w, h, path] of shots) {
  if (only && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(base + path);
  await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
  await page.screenshot({ path: `${out}/${label}-${name}.png` });
  await page.close();
}
await browser.close();
