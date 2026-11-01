# Squiggle Cup

Draw it. Race it. Up to five players draw creatures, then race them across a white architectural sheet. Legs trot, wings flap and snakes slither. The shape decides the motion; the same drawing runs the same time.

**Play:** https://squiggle-cup.ksmostofa576.workers.dev/ (also https://squigglecup.pages.dev/)

Create a room and share its four-letter code, or play solo against the house creatures. Choose a 20, 30 or 60 second drawing timer, draw and watch the live preview, then press Race. Empty lanes get house creatures. The results offer rematch, redraw, a replay link, a 1080×1350 result card, a drawing PNG with a solid white background, and posting to the global leaderboard.

## How speed works

A drawing's score decides its speed (`src/score.ts`):

- **Movement design (45%)**: proportions that help its kind move, such as even legs of a good length, big wings or a round body.
- **Craftsmanship (55%)**: a joined-up creature (no floating bits, no scribbled tangle), a face looking the way it runs, and the kinds of detail it has (head, tail, ears, markings). Detail counts kinds of feature, not strokes, and each new kind adds less.

Speed flattens toward the top, so the last points are the hardest. Every kind has the same best possible time (14.60 s over 40 m). The draw screen shows the score, its two halves and the next thing to try.

House creatures come from ten curated families: horse, dog, cat, human, robot, bird, bat, snake, blob and many-legged. Each is drawn from a seed with a skill level, and scored by the same rules. A new game deals a new lineup; Rematch and Redraw keep it. Their skill levels are set against ordinary first drawings (`test/beginners.ts`): an ordinary drawing finishes mid-pack and sometimes wins; a careful one usually wins. Vehicles (wheels, cars, jets, rockets) are planned as a separate mode.

The leaderboard (`server/board.ts`) re-races every posted drawing on the server, so its times are verified. It has overall and per-type views, and equal times share a place. Entries carry a rules version and a season (`src/verify.ts`); bump `RULES` whenever the simulation or scoring changes.

## Development

```bash
npm ci
npm run dev
npm test
npm run build
```

Vite includes the WebSocket relay at `/relay` and an in-memory leaderboard at `/api/board` for both dev and preview. The relay forwards drawings and a seed; each browser runs the deterministic simulation. Rhythm input is currently disabled. `?demo=gallery` shows the house creatures with their scores and times; `?demo=board` opens the leaderboard.

```bash
npx playwright install chromium
npm run test:browser
```

To use an installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. To test a deployment, also set `PLAYTEST_URL` to its address. The browser suite uses three isolated sessions and real pointer input, checks matching results through three rematches, downloads both PNGs and checks host handoff. Locally it also checks that no creature or label overlaps another at phone, desktop and landscape sizes. It does not record video.

`node scripts/run-ts.mjs scripts/tune.ts` recalibrates the shared ceiling and reports where beginners and house creatures land.

## Deployment

```bash
npx wrangler login
npm run deploy        # relay + game Worker (primary site, leaderboard)
npm run deploy:pages  # the same frontend on Cloudflare Pages
```

`npm run deploy` ships the relay using `wrangler.toml`, builds the game with its live WebSocket URL, and ships the game Worker using `wrangler.site.toml`. The game Worker also hosts the leaderboard Durable Object. The script then checks that the public URL serves the game document.

`npm run deploy:pages` builds a separate copy into `dist-pages` that points at the same relay and the Worker's leaderboard. It creates the Pages project if needed, deploys it, then checks the document. Its settings (project, branch, relay and API URLs) are at the top of `scripts/deploy-pages.sh`. Rooms and the leaderboard are shared, so players on either address can play together.

- Game (Workers): https://squiggle-cup.ksmostofa576.workers.dev/
- Game (Pages): https://squigglecup.pages.dev/
- Relay: wss://squiggle-cup-relay.ksmostofa576.workers.dev/relay
- Leaderboard API: https://squiggle-cup.ksmostofa576.workers.dev/api/board
- Preview image: `public/og.png` (1200×630)
- Handoff: `prd/progress.json`; `npm run prd` rebuilds the progress page.

The historic PRD includes earlier designs. The handoff describes the current build. Demo and OG videos are omitted at the user's request.
