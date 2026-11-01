import { expect, test } from '@playwright/test';

const sizes = [[320, 568], [375, 812], [1280, 900], [812, 375]];

for (const [width, height] of sizes) {
  test(`five racers and long names fit at ${width}x${height}`, async ({ page }, testInfo) => {
    test.skip(!!process.env.PLAYTEST_URL, 'Measures the source renderer and local fixtures.');
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?demo=race&t=6&name=WWWWWWWWWWWWWWWWWWWWWW');
    await expect(page.locator('.standings li')).toHaveCount(5);
    for (const row of await page.locator('.standings li').all()) await expect(row).toBeVisible();
    const canvas = (await page.locator('.race canvas.stage').boundingBox())!;
    const panel = (await page.locator('.titleblock').boundingBox())!;
    expect(canvas.y + canvas.height <= panel.y + 1 || canvas.x + canvas.width <= panel.x + 1).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const frames = await page.evaluate(async () => {
      const urls = ['/src/race.ts', '/src/render.ts', '/src/bots.ts', '/src/rng.ts', '/src/course.ts', '/src/analyze.ts', '/src/drawing.ts'];
      const [{ Race, COUNTDOWN }, { Renderer }, { rivalDrawing }, { mulberry32 }, { INKS }, { analyze }, { canonical }] = await Promise.all(urls.map((url) => import(url)));
      const canvas = document.querySelector<HTMLCanvasElement>('.race canvas.stage')!;
      const entries = ['quadruped', 'flyer', 'hopper', 'worm', 'roller'].map((kind, i) => {
        const anatomy = analyze(canonical(rivalDrawing(mulberry32(40 + i), INKS, kind)));
        return { anatomy, name: 'W'.repeat(22), kind: i === 0 ? 'player' : 'rival' };
      });
      type Rect = { left: number; top: number; right: number; bottom: number; text?: string };
      const intersects = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return [0, 6, 15.8].map((time) => {
        entries.forEach((entry) => entry.anatomy.parts.forEach((part: { color: string }) => { part.color = '#fcfcfa'; }));
        const race = new Race(entries);
        for (let i = 0; i < COUNTDOWN + Math.round(time * 60); i++) race.step();
        const view = new Renderer(canvas, race);
        for (const event of race.events) view.event(event, 9000);
        const text: Rect[] = [];
        const restore: (() => void)[] = [];
        for (const context of [view.ctx, view.sctx]) {
          const original = context.fillText;
          restore.push(() => { context.fillText = original; });
          context.fillText = (value: string, x: number, y: number) => {
            const m = context.measureText(value), t = context.getTransform();
            const xs = [x - m.actualBoundingBoxLeft, x + m.actualBoundingBoxRight];
            const ys = [y - m.actualBoundingBoxAscent, y + m.actualBoundingBoxDescent];
            const points = xs.flatMap((px) => ys.map((py) => ({ x: t.a * px + t.c * py + t.e, y: t.b * px + t.d * py + t.f })));
            text.push({ left: Math.min(...points.map((p) => p.x)), right: Math.max(...points.map((p) => p.x)), top: Math.min(...points.map((p) => p.y)), bottom: Math.max(...points.map((p) => p.y)), text: value });
            original.call(context, value, x, y);
          };
        }
        // Settle the camera in one draw; the physical race remains at this tick.
        view.draw(10_000, 1);
        restore.forEach((reset) => reset());
        const baseline = view.sctx.getImageData(0, 0, canvas.width, canvas.height).data;
        // Isolate each creature by changing only its ink. Comparing actual
        // pixels handles thin antialiased strokes and photo-finish overlays.
        const boxes: Rect[] = entries.map((_, index) => {
          entries.forEach((entry, i) => entry.anatomy.parts.forEach((part: { color: string }) => { part.color = i === index ? '#15171c' : '#fcfcfa'; }));
          view.draw(10_000, 0);
          const { data } = view.sctx.getImageData(0, 0, canvas.width, canvas.height);
          const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
          for (let pixel = 0; pixel < data.length; pixel += 4) {
            if (baseline[pixel] - data[pixel] < 20) continue;
            const x = (pixel / 4) % canvas.width, y = Math.floor(pixel / 4 / canvas.width);
            box.left = Math.min(box.left, x); box.right = Math.max(box.right, x + 1);
            box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y + 1);
          }
          return box;
        });
        const collisions = boxes.flatMap((box, i) => [
          ...boxes.slice(i + 1).filter((other) => intersects(box, other)).map(() => `creature ${i} overlaps another creature`),
          ...text.filter((label) => intersects(box, label)).map((label) => `creature ${i} overlaps ${label.text}`),
        ]);
        for (let i = 0; i < text.length; i++) {
          for (const other of text.slice(i + 1)) {
            if (intersects(text[i], other)) collisions.push(`text ${text[i].text} overlaps ${other.text}`);
          }
        }
        return { time, boxes, collisions, text, dpr: Math.min(2, devicePixelRatio || 1) };
      });
    });
    await testInfo.attach('rendered-frames', { body: JSON.stringify(frames), contentType: 'application/json' });
    for (const frame of frames) {
      expect(frame.collisions, JSON.stringify({ time: frame.time, boxes: frame.boxes })).toEqual([]);
      expect(frame.boxes.every((box) => Number.isFinite(box.left)), JSON.stringify({ time: frame.time, boxes: frame.boxes })).toBe(true);
      // Phone racers used to be roughly 20–30 px wide. Even the airborne
      // creature must have room to be legible with all five lanes present.
      if (height >= 568) {
        for (const box of frame.boxes) expect(Math.max(box.right - box.left, box.bottom - box.top) / frame.dpr, JSON.stringify({ time: frame.time, box })).toBeGreaterThanOrEqual(width <= 320 ? 28 : 30);
        const ball = frame.boxes[4];
        expect(Math.max(ball.right - ball.left, ball.bottom - ball.top) / frame.dpr).toBeGreaterThanOrEqual(width <= 320 ? 40 : 50);
      }
    }
    await page.screenshot({ path: testInfo.outputPath('race.png'), animations: 'disabled' });
    await page.goto('/?demo=results&name=WWWWWWWWWWWWWWWWWWWWWW');
    await expect(page.locator('.screen.results')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
