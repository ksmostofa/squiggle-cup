import { expect, test } from '@playwright/test';

// A long press or right click on the game opens no browser menu; the name
// field still allows its menu (for paste).
test('no context menu on the game, but text fields keep theirs', async ({ page }) => {
  await page.goto('/');
  const blocked = (sel: string) => page.evaluate((s) => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector(s)!.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, sel);
  expect(await blocked('.hero h1')).toBe(true);
  expect(await blocked('.solo')).toBe(true);
  expect(await blocked('.pname')).toBe(false);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#app')!).userSelect)).toBe('none');
  await page.goto('/?demo=race&t=2');
  expect(await blocked('canvas.stage')).toBe(true);
});
