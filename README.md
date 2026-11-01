# Squiggle Cup

Draw it. Race it. Up to five players draw creatures, then race them across a white architectural sheet. Legs trot, wings flap and snakes slither. The shape decides the motion; the same drawing runs the same time.

**Play:** https://squiggle-cup.ksmostofa576.workers.dev/

Create a room and share its four-letter code, or play solo against the house creatures. Choose a 20, 30 or 60 second drawing timer, draw and watch the live preview, then press Race. Empty lanes get house creatures. The results offer rematch, redraw, a replay link, a 1080×1350 result card and a drawing PNG with a solid white background.

## Development

```bash
npm ci
npm run dev
npm test
npm run build
```

Vite includes the WebSocket relay at `/relay` for both dev and preview. The relay forwards drawings and a seed; each browser runs the deterministic simulation. Rhythm input is currently disabled.

```bash
npx playwright install chromium
npm run test:browser
```

To use an installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. To test the deployment, also set `PLAYTEST_URL=https://squiggle-cup.ksmostofa576.workers.dev`. The browser suite uses three isolated sessions and real pointer input, checks matching results through three rematches, downloads both PNGs and checks host handoff. It does not record video.

## Deployment

```bash
npx wrangler login
npm run deploy
```

The deploy script ships the relay using `wrangler.toml`, builds the game with its live WebSocket URL, and ships the game using `wrangler.site.toml`. It then checks that the public URL serves the game document. Both services use Workers; `squiggle-cup.pages.dev` is not the game URL.

- Game: https://squiggle-cup.ksmostofa576.workers.dev/
- Relay: wss://squiggle-cup-relay.ksmostofa576.workers.dev/relay
- Preview image: `public/og.png` (1200×630)
- Handoff: `prd/progress.json`; `npm run prd` rebuilds the progress page.

The historic PRD includes earlier designs. The handoff describes the current build. Demo and OG videos are omitted at the user's request.
