// Makes the share preview from the live logo (?demo=og): public/og.png
// (1200×630, the logo at rest) and public/og.mp4 (6 s silent loop of it
// drawing in, H.264). Needs ffmpeg.
// Usage: node scripts/og.mjs <baseURL>
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [base] = process.argv.slice(2);
const size = { width: 1200, height: 630 };
const url = `${base}/?demo=og`;
const LOOP = 6; // seconds: draw in (~3 s), bob and blink, fade
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' });
// Starts the logo's animations again from their first frame.
const restart = (page) => page.evaluate(() => { const logo = document.querySelector('.live-logo'); logo.replaceWith(logo.cloneNode(true)); });

// The still: once it has drawn in and settled.
const still = await browser.newPage({ viewport: size });
await still.goto(url);
await still.evaluate(() => document.fonts.ready);
await still.waitForTimeout(3500);
await still.screenshot({ path: 'public/og.png' });
await still.close();

// The loop: step every animation to each frame's time and screenshot it, so
// the video starts at the first frame and plays evenly whatever the machine.
const FPS = 30;
const dir = mkdtempSync(path.join(tmpdir(), 'og-'));
const page = await browser.newPage({ viewport: size });
await page.goto(url);
await page.evaluate(() => document.fonts.ready);
await restart(page);
await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
for (let f = 0; f < LOOP * FPS; f++) {
  await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), (f * 1000) / FPS);
  await page.screenshot({ path: path.join(dir, `f${String(f).padStart(4, '0')}.png`) });
}
await browser.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-an',
  '-vf', `fade=t=out:st=${LOOP - 0.5}:d=0.5:color=0xfcfcfa`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'public/og.mp4']);
rmSync(dir, { recursive: true, force: true });
console.log('og.png', statSync('public/og.png').size, 'bytes; og.mp4', statSync('public/og.mp4').size, 'bytes');
