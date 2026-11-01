# Brief for a fresh agent: Squiggle Cup on the Sheet

Paste this into a new agent session (in trmi, from your seat). The full spec is `PRD.md`; this brief tells you what matters and where to look.

## Read first
- `CLAUDE.md` (hackathon rules: trmi lanes, your seat's files, feature freeze 02:30 JST, submit by 04:30 JST).
- `PRD.md` §2 (design rules), §5 (the Sheet), §6 (drawing), §7 (movement), §8 (fairness), §9 (race and results), §28 (hackathon scope, multiplayer model, seats, timeline).
- `prd/progress.json` (statuses and handoff). Update it when your work changes a feature; "verified" only with real evidence. Never edit `prd/index.html`.

## The game in one paragraph
You draw a creature. Its shape decides what kind it is (two-legged, four-legged, many-legged, hopper, flyer, roller, snake, jelly, scribble) and how it moves. Then it races **itself**, in its own lane, side by side with the other players' creatures, across a clean, minimal, white architectural drawing sheet seen like a tilt-shift miniature. No tapping or controls, no hazards, no chasing darkness. 2–4 people play together in a room; bots fill empty lanes.

## Must-haves
1. **The Sheet** (PRD §5): bright white paper, faint drafting grid, fine grey linework, title block, dimension ticks, numbered lanes drawn as fine lines, one accent colour for "you". Tilt-shift camera: slight angle, sharp focus band on the lanes, soft blur above and below, small contact shadows; your own lane always sharp. Award-level, minimal, architectural.
2. **Creatures look exactly as drawn** in clean pen ink. Nothing added.
3. **Live preview** while drawing (PRD §6.2): uses the same simulation as the race, updates on every stroke, shows the kind in plain words. It must never contradict the race.
4. **Natural movement for every kind** (PRD §7): planted feet that step (bipeds alternate, quadrupeds trot, many legs ripple), soft kangaroo hops, wings that visibly flap and keep flyers up, rolling, a snake that slithers **forward** with a travelling wave, jellies that ooze. Judge it by watching, not only by tests.
5. **Reliable wing detection** (PRD §6.3): wings drawn upward, outward, as loops or zigzags all count. Build a test set of hand-style variants.
6. **Fairness** (PRD §8): no kind wins by default; flyers must not always win. Headless balance test over thousands of mixed races: no kind above ~1.5× its fair share of wins, every kind wins sometimes.
7. **Determinism** (PRD §7.4): only + − × ÷ and sqrt in the simulation; polynomial trig (`src/dmath.ts`); seeded RNG (`src/rng.ts`).
8. **Rooms** (PRD §28.4): only drawings and one seed travel; every client simulates; the host's results are authoritative.

## Starting point
Branch `m0-prototype` has a working simulation to start from: `src/body.ts` (physics), `src/analyze.ts` (drawing reader, 9 kinds), `src/race.ts` (self-running race), `src/creature.ts`, `src/bots.ts` (rival drawings of every kind), `src/dmath.ts`, `src/encode.ts` (dare links), `scripts/run-ts.mjs` + `test/sim.test.ts` (headless tests, `npm test`). Its cave renderer and screens are replaced by the Sheet. Known problems: wings often missed, snake slides backwards, motion not yet convincing, no balance test.

## Working rules
- Stay inside your seat's files (PRD §28.5); one trmi lane per feature; a teammate approves.
- Never copy code or art from Doodle Sports Day, OddHoof or Outdraw; ideas only.
- Commits are authored by the team members only: no Claude/Anthropic attribution or Co-Authored-By lines.
- Take headless screenshots (phone and desktop) and look at them before claiming something works; the final check is in a real browser (Helium).

## Before you build
Restate your understanding of this brief and your seat's part of it, and wait for confirmation.
