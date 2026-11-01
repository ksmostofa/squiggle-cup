// Makes the share preview: public/og.png (1200×630 still of a race) and
// public/og.mp4 (8 s silent loop of the same race, H.264). Needs ffmpeg.
// Usage: node scripts/og.mjs <baseURL>
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [base] = process.argv.slice(2);
const size = { width: 1200, height: 630 };
const race = `${base}/?demo=race&family=dog&name=Your%20Creature`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' });
// For the preview only: no pause button, and the name of the game in the corner.
const brand = (page) => page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = `.pause-btn { display: none !important; }
    .og-card { position: fixed; left: 18px; bottom: 18px; z-index: 20; padding: 12px 16px 10px; background: #fcfcfa; border: 1px solid #15171c; box-shadow: 0 10px 30px -14px rgba(30,30,40,.45); }
    .og-card img { display: block; width: 230px; height: auto; }
    .og-card p { margin: 4px 0 0; font: 600 15px Archivo, system-ui, sans-serif; color: #6a707a; }`;
  document.head.appendChild(style);
  const card = document.createElement('div');
  card.className = 'og-card';
  card.innerHTML = '<img src="./logo.svg" alt=""><p>Draw it. Race it.</p>';
  document.body.appendChild(card);
});

// The still: mid-race, everyone in view.
const still = await browser.newPage({ viewport: size });
await still.goto(`${race}&t=6`);
await brand(still);
await still.waitForTimeout(2500);
await still.screenshot({ path: 'public/og.png' });
await still.close();

// The loop: record from the gun, keep 8 s of running.
const dir = mkdtempSync(path.join(tmpdir(), 'og-'));
const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
const page = await ctx.newPage();
await page.goto(`${race}&t=0.5`);
await brand(page);
await page.waitForTimeout(11500);
await ctx.close();
await browser.close();
const webm = path.join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '2.5', '-t', '8', '-i', webm, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26',
  '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', 'public/og.mp4']);
rmSync(dir, { recursive: true, force: true });
console.log('og.png', statSync('public/og.png').size, 'bytes; og.mp4', statSync('public/og.mp4').size, 'bytes');
