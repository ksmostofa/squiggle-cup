# Squiggle Cup

**Draw anything. It comes alive and races your friends. Badly.**

A multiplayer physics party game for 2–4 players. Everyone in a room draws a creature at the same time, then all of them wake up and race the same agility course. There are no hidden stats: the shape you draw *is* the physics. Long legs stride, round blobs roll, top-heavy towers fall over in the tunnel. Rematch, redraw a better shape and win.

Built for the **trmi × Lovhack × Nexus Hackathon 2026**, theme *Multiplayer Everything*.

- **Play:** _TBD (public URL)_
- **Demo video:** _TBD_
- **Devpost:** https://lovhack-trmi-2026.devpost.com

## How to play
1. One player creates a room and shares the 4-letter code.
2. Everyone draws a creature in 20 seconds with the same amount of ink.
3. The creatures are revealed together and race: tap to stride, hold and release to leap.
4. See the placings, everyone's award, and what the winner's shape did better. Rematch.

## How it works
- **Drawing → body.** Strokes are simplified and analysed (body, legs, symmetry, scribble) in `src/analyze.ts`, then built into a Rapier 2D physics body with motorised limbs in `src/creature.ts`.
- **Rooms.** A small WebSocket relay (one room per code) forwards messages. The host's browser runs the simulation and streams snapshots at 20 Hz; guests send only their drawing and their taps. See PRD §28.4.
- **Stack.** TypeScript, Vite, `@dimforge/rapier2d-deterministic-compat`, `perfect-freehand`, Canvas 2D, Cloudflare Workers + Durable Objects (relay) and Pages (hosting).

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
