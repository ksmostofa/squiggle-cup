import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYTEST_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './test/browser',
  timeout: 300_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    },
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PLAYTEST_URL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
