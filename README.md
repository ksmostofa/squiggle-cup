# Squiggle Cup

**Draw anything. It comes alive and races your friends' drawings.**

A multiplayer drawing race for 2–4 players. Everyone in a room draws a creature at the same time, watching it come alive in a live preview as they draw. Then every creature races itself, side by side in its own lane, across a clean white architectural sheet seen like a tilt-shift miniature. There are no controls and no hidden stats: the shape you draw decides how it moves. Two legs run, four legs trot, wings fly, round bodies roll, long ones slither. Rematch, or redraw a better shape and win.

Built for the **trmi × Lovhack × Nexus Hackathon 2026**, theme *Multiplayer Everything*.

- **Play:** _TBD (public URL)_
- **Demo video:** _TBD_
- **Devpost:** https://lovhack-trmi-2026.devpost.com

## How to play
1. One player creates a room and shares the 4-letter code.
2. Everyone draws a creature in 20 seconds. The preview shows how it will move while you draw.
3. The creatures appear in their lanes and race themselves. No tapping: the drawing is the whole game.
4. See the placings, each creature's kind and time, and what the winner's shape did better. Rematch or redraw.

## How it works
- **Drawing → creature.** Strokes are labelled (body, legs, wings, tail, eyes) and the creature is classified into one of nine kinds in `src/analyze.ts`.
- **Movement.** A small deterministic physics model in `src/body.ts` gives each kind a natural gait: planted-foot stepping for legs, wing lift by area, rolling, slithering. Kinds are balanced so none wins by default. See PRD §7–8.
- **Rooms.** A small WebSocket relay (one room per code) forwards messages. Races have no inputs, so the host sends everyone the drawings and one seed; every device simulates the same race and the host's results are authoritative. See PRD §28.4.
- **Stack.** TypeScript, Vite, `perfect-freehand`, Canvas 2D, Cloudflare Workers + Durable Objects (relay) and Pages (hosting).

## Run locally
```bash
npm install
npm run dev
```

## Built with trmi
We built this as a team of three in one shared trmi project, each sending Claude Code prompts from our own seat and reviewing each other's changes before they merged.

| Seat | Owned |
|---|---|
| A: Simulation | race loop, course, bots |
| B: Play screens | draw pad, renderer, screens |
| C: Rooms + ship | relay server, netcode, deployment |

_Add before submitting: how reviews in trmi caught bugs, a couple of screenshots, and what each person prompted._

## Project docs
- `PRD.md`: full design. §28 is the hackathon scope.
- `prd/progress.json`: feature status and handoff (`npm run prd` renders `prd/index.html`).
