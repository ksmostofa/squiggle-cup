import { expect, test } from '@playwright/test';
import { NOT_WINGS, strokes } from '../fixtures';

test('rolling preview uses the submitted drawing and the race simulation', async ({ page }) => {
  test.skip(!!process.env.PLAYTEST_URL, 'Compares the actual source modules in the local dev server.');
  await page.goto('/');
  const drawing = strokes(NOT_WINGS.ball.draw, 1);
  const result = await page.evaluate(async (drawing) => {
    const urls = ['/src/pad.ts', '/src/race.ts', '/src/encode.ts', '/src/analyze.ts', '/src/course.ts', '/src/creature.ts'];
    const [{ Pad }, { Race, COUNTDOWN }, { encode, decode }, { analyze }, { INKS }, { DT }] = await Promise.all(urls.map((url) => import(url)));
    const packed = encode({ pick: 0, seed: 0, name: '', strokes: drawing.map((s) => ({ pts: s.pts, ink: Math.max(0, INKS.indexOf(s.color)), thick: s.w > 8.5 })) });
    const submitted = decode(packed).strokes.map((s: { pts: number[][]; ink: number; thick: boolean }) => ({ pts: s.pts, color: INKS[s.ink], w: s.thick ? 11 : 6 }));
    const expected = new Race([{ anatomy: analyze(submitted), name: 'Ball', kind: 'player' }]);
    // The preview skips showing the countdown, but must preserve its settling.
    for (let tick = 0; tick < COUNTDOWN + 120; tick++) expected.step();
    const host = document.createElement('div');
    host.style.width = '560px';
    document.body.appendChild(host);
    const pad = new Pad(() => {}, { initial: drawing });
    pad.mount(host);
    cancelAnimationFrame(pad.raf);
    for (let tick = 0; tick < 120; tick++) pad.renderStage(DT);
    const live = pad.live;
    const actual = live.race?.playerRacer ?? live;
    const snapshot = (body: { x: number; y: number; th: number; vx: number; vy: number; w: number; m: number; hull: number[][] }) => ({
      x: body.x, y: body.y, angle: body.th, vx: body.vx, vy: body.vy, spin: body.w, mass: body.m, hull: body.hull,
    });
    const result = { actual: snapshot(actual.body), expected: snapshot(expected.playerRacer.body) };
    pad.destroy();
    host.remove();
    return result;
  }, drawing);
  expect(result.actual.hull).toEqual(result.expected.hull);
  expect(result.actual).toEqual(result.expected);
});
