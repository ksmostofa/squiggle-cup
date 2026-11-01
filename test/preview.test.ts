import assert from 'node:assert/strict';
import { analyze } from '../src/analyze';
import { RIVAL_KINDS, rivalDrawing } from '../src/bots';
import { INKS } from '../src/course';
import { DT } from '../src/creature';
import { canonical } from '../src/drawing';
import { RacePreview } from '../src/preview';
import { COUNTDOWN, Race } from '../src/race';
import { mulberry32 } from '../src/rng';
import { NOT_WINGS, WINGS, strokes } from './fixtures';

const drawings = [
  ...RIVAL_KINDS.map((kind, i) => rivalDrawing(mulberry32(100 + i), INKS, kind)),
  ...Object.values(NOT_WINGS).map((fixture) => strokes(fixture.draw, 1)),
  ...Object.values(WINGS).map((draw) => strokes(draw, 7)),
];

for (const drawing of drawings) {
  const prepared = canonical(drawing);
  assert.deepEqual(canonical(prepared), prepared, 'race preparation is idempotent');
  const anatomy = analyze(prepared)!;
  const preview = new RacePreview(anatomy);
  let expected = new Race([{ anatomy, name: '', kind: 'player' }]);
  for (let tick = 0; tick < COUNTDOWN; tick++) expected.step();
  assert.equal(preview.race.hash(), expected.hash());
  let resets = 0;
  // Two whole races, checking every simulated tick, including the loop reset.
  for (let tick = 0; tick < 2400; tick++) {
    if (expected.over) {
      expected = new Race([{ anatomy, name: '', kind: 'player' }]);
      for (let idle = 0; idle < COUNTDOWN; idle++) expected.step();
      resets++;
    }
    expected.step();
    preview.advance(DT);
    assert.equal(preview.race.tick, expected.tick);
    assert.equal(preview.race.hash(), expected.hash(), `${anatomy.kind} differs at tick ${tick}`);
    assert.equal(preview.race.playerRacer!.finishTime, expected.playerRacer!.finishTime);
  }
  assert.ok(resets >= 2, 'preview loops the full race');
}
console.log(`ok   preview matches the race tick-for-tick for ${drawings.length} drawings, including loop resets`);

// Display frame rates cannot change the simulated motion.
const anatomy = analyze(canonical(strokes(NOT_WINGS.ball.draw, 3)))!;
const slow = new RacePreview(anatomy), fast = new RacePreview(anatomy);
for (let i = 0; i < 300; i++) slow.advance(DT * 2);
for (let i = 0; i < 1200; i++) fast.advance(DT / 2);
assert.equal(slow.race.tick, fast.race.tick);
assert.equal(slow.race.hash(), fast.race.hash());
console.log('ok   preview agrees at 30 and 120 display frames per second');
