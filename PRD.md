# Squiggle Cup — Product Requirements Document

| | |
|---|---|
| **Status** | Updated Nov 1, 21:30 JST: one scene (the Sheet), self-running races in lanes, no tapping. Supersedes all earlier drafts. |
| **Date** | 2026-11-01 |
| **Working title** | Squiggle Cup. Check the name, a domain, the app stores and Steam before committing. |
| **One-liner** | Draw anything. It comes alive and races itself in its own lane. |
| **Core rule** | The drawing is the whole game: its shape decides how it moves. No controls, no hidden stats. |
| **Platform** | Web (installable PWA), portrait phone first, desktop supported |
| **Cost target** | Free tiers only. The one optional expense is a domain, about $10 a year. |
| **Primary growth channel** | X (Twitter), then Reddit, TikTok, itch.io and web game portals |
| **Right now** | Entered in the trmi × Lovhack × Nexus Hackathon 2026 ("Multiplayer Everything"). Submit on Devpost by **Mon Nov 2, 5:00 AM JST**. Section 28 is the only scope that matters until then. |

---

## Table of contents
1. Background and research
2. Product vision and design rules
3. Target players
4. Game overview
5. The scene: the Sheet
6. Drawing system
7. Creature movement
8. Fairness and balance
9. Race rules and results
10. Commentary
11. Modes
12. Multiplayer and netcode
13. Leaderboards and fairness (after the hackathon)
14. Virality and sharing
15. Visual design and microinteractions
16. Audio
17. Screens and user flows
18. Technical architecture
19. Data model and API (after the hackathon)
20. Performance, responsiveness, PWA, accessibility
21. Moderation and safety
22. Analytics and success metrics
23. Testing plan
24. Milestones
25. Risks and mitigations
26. Open questions and later ideas
27. Appendix: research data and sources
28. Hackathon build (trmi × Lovhack × Nexus 2026)

---

## 1. Background and research

### 1.1 Origin
The project began as "build Doodle Sports Day, but better", then widened into an original, multiplayer, competitive and funny draw-a-creature game designed to spread on X. Several concepts were explored. Five of them were merged into one game as **venues** (section 5).

### 1.2 Reference games we studied (by reading their code)

**Doodle Sports Day / らくがき運動会** (yurustudio.github.io/undoukai)
- **How the drawing becomes a racer:**
  - Hand-written geometry rules label each stroke: body (largest closed stroke), legs (strokes that dip downward), wings, tails, spikes, a scribble score (line crossings) and symmetry.
  - Those labels pick one of **8 fixed body types**: two-legged, one-legged, many-legged, flying, rolling, worm, jelly, scribble.
  - Animation is a puppet. Strokes wiggle by label, so speed is just a number.
- **Stats:**
  - A hidden formula gives a "quality" total, which is split across 4 events: Sprint, Obstacle Race, Hill, Puddles.
  - Being good at one event costs you in another. Players are meant to work out the formula by watching.
- **Engineering worth learning from (ideas only, never their code or art):**
  - **Deterministic simulation.** Only + − × ÷ and `sqrt`, with no `Math.sin`, because trig results differ slightly between browsers. Randomness comes from a seeded mulberry32 generator.
  - **Challenge links with no server.** The creature is stored in the URL after `#`: strokes simplified (RDP), rounded to 3 px, stored as byte offsets between points, base64url.
  - **A leaderboard that checks itself.** It stores drawing + time, and viewers' devices re-run the race and hide any time that doesn't match.
  - Photo-finish slow motion, a "funny play" award, a 1080×1350 result card, a 720×1280 vertical video in the paid app, and cheering (8 presses = a small boost).
- **Weaknesses:**
  - You watch rather than play.
  - The best design has been found: the top 6 all-time times sit within **81.58–82.15 s**.
  - Odd drawings all end up as "jelly".

**OddHoof** (oddhoof.com)
- **The drawing is mostly a costume:**
  - In the 100 m sprint, base speed is fixed at 7.45. Only rhythm-tapping changes it: +0.72 per tap, at most one tap every 0.22 s, capped at +2.2, and it fades over time.
  - In the mixed race, base speed is fixed at 6.4. Clearing obstacles is purely about timing, and a miss stops you for 1 s.
- **Animation:** one smooth distortion bends the whole picture ("arbitrary drawings are not anatomically segmented"). It works on any drawing but ignores its shape.
- **Rowing is the exception:** the boat drawing is reduced to 5 hull depths, which change drag and stability by ±15%. The waves are real physics from a shared weather seed, and players steer the trim.
- **Ghosts:** replays of tap timings on a fixed 1/120 s tick. The server API has `/api/races`, `/api/scores`, `/api/leaderboard` and `/api/ghosts`.
- **Lesson:** Doodle Sports Day means the drawing matters but you don't get to play. OddHoof means you play but the drawing doesn't matter. Rowing, the only event where both are true, is the model to follow.

### 1.3 Competitive landscape (as of Nov 2026)
| Game | What it is | Relevance |
|---|---|---|
| **Doodle Smash** (Steam, 22 Oct 2026, ¥790, solo developer) | 2.5D platform brawler. Drawing size sets weight, shape sets mobility, colour sets one of 10 elements. Ranked online 4-player battle royale with CPUs filling empty seats; 6-digit friend rooms; drawings shared via Steam Workshop | The closest competitor. Its drawing becomes stats, not physics |
| **Kiln** (Double Fine, Apr 2026) | Pottery brawler, 4v4; pot shape decides physics (flat plates ricochet, tall vases are top-heavy) | Shows shape-as-physics works. Got a mixed reception: Metacritic 66, 40% of critics recommend it on OpenCritic |
| **Drawquarium** (Steam, mid-Nov 2026) | Cosy game: draw a fish and it comes alive in an aquarium | The emotional benchmark (section 1.4) |
| **AI Pixel Art Battle / AIドット絵バトル** (MONO ENTERTAINMENT, Steam, Aug 2026, ¥920) | Draw a monster; an AI decides its name, abilities and matchups | Shows the humour of an underdog beating a strong monster |
| **Scrawlcraft** (browser, Oct 2026) | Draw creatures for a 3-lane PvP battle | A browser competitor; players replied with "AI slop" |
| Unnamed draw-your-hero horde game (r/IndieGaming, Oct 2026, 253 points) | Draw a hero, fight hordes co-op | The genre is spreading |
| **Draw Climber** (Voodoo) / **Scribble Rider** | Draw legs or a wheel that spins; redraw mid-level | The most-played versions are the simplest: shape is visibly physics |
| **Evolution** (Keiwan), **ANLIFE** (Feb 2026) | Creatures that learn to walk | Players report creatures sliding or vibrating instead of walking. That's the exploit risk |
| **Meta Animated Drawings** (open-sourced Apr 2023, ~180k drawings) | Puts a skeleton on human-shaped drawings and animates them | Human shapes only. Use as reference, not as the main system |
| Draw Creatures (tatsumaki), Doodle Derby, DrawRace 2, Doodle Champs, Magic Pengel (PS2, 2002) | Older or neighbouring games | Magic Pengel did "ink spent + parts → stats" 20 years ago |

**Where we fit:** no game we found combines a freehand drawing, a physics body that moves because of its shape, player skill during the race, real-time competition, and jokes built into every venue.

### 1.4 What spreads on X (collected Oct–Nov 2026)
| Signal | Data | Lesson |
|---|---|---|
| The original draw-a-horse post: @yungcontent, 10 Sep 2026: "gave gpt-6 astra 2 hours to build a website that would go viral on twitter / it made a horse racing game where you have to draw the horse first" | 552k views, 4.6k likes, 2k bookmarks, 173 replies | The **story about how it was made** carried the post; the game was the proof |
| Top replies to that post | "You forgot to add the link." (68 likes, the top reply); "Woulda been way less viral if the 🦊s actually looked like 🐎"; "I was rooting for the hot dog"; "where bets"; "What if you draw a circle"; "Can I draw wheels on my horse?"; "drawing the horse first is a funny constraint. that alone will get it shared."; "bamzooki would like a word" | Bad drawings are the joke. People root for odd entries. People want to bet. People want to break the rules. Missing links lose players. Expect the Bamzooki comparison (a BBC kids' show where designed creatures raced) |
| Drawquarium's release-date post (26 Oct) | 459k views, 18k likes | |
| A Spanish-language repost of the Drawquarium trailer | 6.2M views, 163k likes | **"My drawing came alive"** is the strongest emotion in the genre. Memes *about* a game travel further than the game's own post |
| A meme about it: "It's just a game about painting fish that come alive, make something simple" / "the trailer they make:" | 1.8M views | |
| r/gaming, "Drawquarium - art is human" | 407 points; "I actually teared up." (109 upvotes) | Human-made art is a selling point right now |
| A Japanese YouTuber (883k followers) on AI Pixel Art Battle: "a golem is just a big rock, crack it and it's over" | 186k views, 7.8k likes | Underdog humour spreads through big creators |
| Horse Race Tests (@snakesandrews, Apr 2025) | Daily noon race simulation with a 10-second prediction window; the orange horse became a meme; about 2.2M views on one race (from a community-run log, not verified) | A daily **predict-the-winner** ritual creates recurring characters |
| Doodle Shooter (built mostly with AI) | Tens of thousands of players from 150+ countries; covered by Pirate Wires | A "how I made it" story spreads on its own |
| Scrawlcraft on r/WebGames | A reply: "Shouldn't be talking about AI slop when..." | Art that looks AI-made gets punished |

**Rule that follows:** a post wins if it's **beautiful, impressive or funny**. It also needs (a) a one-line story a stranger could retell and (b) something personal to root for.

### 1.5 What our own prototypes taught us (Nov 1)
- **Tapping to run made it a reflex game, not a drawing game.** Leaping dominated speed, so the shape mattered less than the rhythm. The drawing is now the whole game.
- **Physics engines alone don't look alive.** A Rapier ragdoll flopped and flipped; spring legs pogo-bounced. Natural motion needs controlled, physical gaits (section 7).
- **Theme graphics can make doodles look worse.** A cartoon dog show and a rock-art cave both clashed with player drawings. A clean white sheet flatters any doodle.
- **Fairness has to be designed.** Flyers ignored the terrain and won too often; every kind needs a real chance (section 8).

---

## 2. Product vision and design rules

**Vision:** the most satisfying "draw it and watch it live" race on the internet. Every player's doodle becomes a believable little animal that runs, hops, flies, rolls or slithers exactly the way its shape suggests, in its own lane, against friends' drawings.

**Design rules** (they settle every disagreement):
1. **The drawing is the whole game.** You draw; it races. No tapping, no controls, no player input after drawing.
2. **The shape decides how it moves.** Legs, wings, body shape and size decide its kind and its gait. Nothing is hidden: players learn by watching.
3. **Motion must look alive.** Natural, physical, readable movement is the product. If a creature's motion looks wrong (pogo-bouncing, sliding backwards, wings that don't flap), it is a bug.
4. **Fair by design.** No creature kind wins by default. Kinds trade strengths against weaknesses; the better-drawn creature plus a little seeded luck wins.
5. **What you see while drawing is what races.** The live preview uses the same simulation as the race and must never contradict it.
6. **One deterministic simulation (same inputs, same result) runs everything:** previews, rooms, dare links and replays.
7. **Clean, minimal, architectural.** White sheet, fine lines, lots of space. The doodle is the only loud thing on the page.
8. **Everything is free, nothing is pay-to-win, and no AI art.**

---

## 3. Target players
- **Friend groups and streamers** (primary for the hackathon): a room of 2–4 people draws at the same time and watches the race together.
- **Casual X and TikTok scrollers:** open a dare link, draw, race, share. Time to first race: under 30 s.
- **Drawers and tinkerers:** players who enjoy working out which shapes run best and redrawing to win.
- **Age:** for everyone, with a silhouette mode for under-13s (section 21).

---

## 4. Game overview

### 4.1 Core loop (about 60 s)
1. **Draw.** 20 s from your first stroke, everyone at once in a room. No ink limit. A live preview shows your creature moving as you draw it.
2. **Reveal.** All drawings appear in their lanes and wake up together.
3. **Race.** A short countdown, then every creature races itself down its own lane to the finish.
4. **Results.** Placings, each creature's drawing, time and kind, one honest fact from the race ("The winner's legs were 1.8× longer").
5. **Rematch** with the same drawings, or **redraw** a better shape. One tap.

### 4.2 Longer loops
- **Session:** watch why the winner won, redraw, rematch.
- **Sharing:** a dare link replays the exact race and lets a friend draw a challenger.
- **Later (after the hackathon):** a gallery of your creatures, daily races, leaderboards (section 13).

---

## 5. The scene: the Sheet

One scene for now: a clean white architectural drawing sheet, seen with a tilt-shift (miniature) camera.

### 5.1 Look
- **Paper:** bright white, a very faint drafting grid, a thin border and a small title block (game name, room code, race number, date), like an architect's presentation board.
- **Linework:** very fine, precise lines in greys. Dimension lines with tick marks show distances along the course (0 m … finish). The start and finish are lettered in a clean technical style.
- **Accent:** one accent colour, used only for your own lane and key UI.
- **Space:** generous white space; nothing cluttered. It should look like a beautiful architectural board, not a game UI.

### 5.2 Tilt-shift camera
- The race is viewed like a photo of a miniature model lying on a desk: the sheet is seen at a slight angle, so lanes recede a little in perspective.
- A sharp focus band runs along the lanes; above and below it the image blurs softly. Contrast and saturation are lifted slightly so it reads as a tiny diorama.
- Creatures cast small, soft contact shadows, as if standing on the paper.
- Your own creature and lane always stay sharp. Respect `prefers-reduced-motion`, and use a cheaper blur on low-end devices.

### 5.3 Lanes
- Every participant has their own lane, drawn as fine drafting lines across the sheet. Lanes are numbered.
- Creatures race left to right, side by side, and never collide or overlap.
- All lanes stay visible at once; the camera pans horizontally to follow the pack.
- **Course:** a straight, flat lane of 60 m (starting value for tuning). No hazards, obstacles, hills, chasing darkness or page turns.

### 5.4 Creatures on the sheet
- Each creature looks exactly like what its player drew: the same strokes, in clean pen ink. No stickers, no googly eyes, nothing added.
- Ink colours must contrast strongly against white.

---

## 6. Drawing system

### 6.1 The drawing pad
- **Size:** 600×600 logical pixels, scaled to fit the screen. The pad is the same white sheet (faint grid, fine border) as the race.
- **Guide:** a small "runs this way →" arrow.
- **Pens:** 3–4 ink colours × 2 widths. Strokes are smoothed with perfect-freehand for the look only; the simulation uses the simplified points.
- **No ink limit.**
- **Timer:** 20 s, starting at your first stroke, shown as a thin countdown bar. At zero the drawing submits itself; if it has no body yet, it submits as soon as one is drawn.
- **Tools:** Undo, Clear, Done, and an optional name. If the name is left empty, one is generated.

### 6.2 Live preview
- A strip under the pad shows the creature moving in its lane **exactly as it will race**, using the same simulation code and settings.
- It updates the moment each stroke ends, so adding two legs makes it walk and adding wings makes it fly.
- A line of plain text names the detected kind and gait, e.g. "Four-legged — trots".

### 6.3 Reading the drawing (rules in pad pixels)
All thresholds are fractions of the drawing's own size (M = the larger side of its bounding box), so small and large drawings read the same.
1. **Closed stroke:** at least 4 points, length ≥ 50 px, and the gap between its ends ≤ max(24 px, 16% of its length).
2. **Body:** among closed strokes with length ≥ 0.25 M, the one with the largest area × (0.4 + roundness), where roundness = 4πA/P². If there is none, the longest stroke.
3. **Eyes:** small dots and loops inside the body.
4. **Legs:** open strokes with "feet": low points in the bottom 30% of the drawing, below the body, standing out from their neighbours. A zigzag is several legs.
5. **Wings:** must be recognised reliably. Strokes rooted near the upper body that reach upward or outward, drawn as lines, loops, arcs or zigzags, count as wings. (The current rule, which needs wings to stick out sideways, misses many drawn birds; build a test set of hand-style wing variants.)
6. **Tails and fins:** sideways strokes at body height.
7. **Decoration:** everything else; it moves with the body.

### 6.4 Kinds
Picked in this order (first match wins), then tuned by playtests:

| Kind | When | Gait |
|---|---|---|
| Scribble | many self-crossings and dense ink | erratic |
| Flyer | wings with 0–1 legs, or 2+ wings with ≤ 4 legs | flaps |
| Many-legged | 5+ legs | ripples |
| Four-legged | 3–4 legs | trots |
| Two-legged | 2 legs | runs, legs alternating |
| One-legged | 1 leg | hops |
| Roller | round closed body, no legs | rolls |
| Snake | long body (width ≥ 1.9 × height), no legs | slithers |
| Jelly | anything else | wobbles and oozes |

### 6.5 Compact encoding (dare links)
- Snap each stroke to a 3 px grid (coordinates 0–200 fit in one byte), simplify (RDP), and store byte offsets between points.
- **Bytes:** version, venue, seed (4 bytes), name (≤ 36 bytes UTF-8), stroke count, then per stroke: flags (ink, width), point count, first point, offsets.
- No inputs are stored: races run themselves, so drawings plus the seed replay a race exactly.
- **Format:** base64url after `#d=`. Re-encoding a decoded creature gives the same bytes.

---

## 7. Creature movement

### 7.1 Principles
- One rigid body per creature with real mass (from its painted area and ink), inertia, gravity and momentum.
- Every drawn part moves with the simulation: a drawn leg is shown where the simulated leg is, and wings beat with the flap.
- Motion must be natural and readable. Earlier attempts and what they taught us:
  - a Rapier ragdoll with motorised limbs flopped and flipped;
  - spring-mass legs pogo-bounced;
  - the current approach (critically damped ride height, planted-foot stepping) is the best so far but still needs work (section 7.3).

### 7.2 Gaits by kind
| Kind | How it moves |
|---|---|
| Two-legged | Body held at a steady ride height by damped "muscles". Feet stay planted until the body passes them, then step forward in a smooth arc; legs alternate |
| Four-legged | Same, with legs stepping in alternating pairs (a trot) |
| Many-legged | Same, with a ripple running along the legs |
| One-legged | Kangaroo hops: crouch, launch, soft landing |
| Flyer | Wing lift proportional to wing area holds a cruising height with gentle damping; wings visibly flap; the body bobs softly with each beat. A heavy body with small wings flutters lower |
| Roller | A rigid round body spun by torque; it rolls without sliding |
| Snake | Slides forward on belly scales (slip forwards, grip backwards) with a smooth travelling wave along the body |
| Jelly | Oozes forward with a squash-and-stretch wobble |
| Scribble | Uses whatever parts it has, with an erratic, seeded pace |

### 7.3 Known motion bugs to fix
- The snake sometimes jumps and slides backwards; it must slither forward smoothly.
- Wings are not always detected, so some flyers don't fly or flap (section 6.3).
- Motion must be judged by watching it, not only by tests.

### 7.4 Determinism
- Fixed 60 ticks per second, with substeps as needed.
- Only + − × ÷ and sqrt in the simulation. Trig is polynomial (`src/dmath.ts`); randomness comes from a seeded mulberry32 (`src/rng.ts`). Never `Math.random` in the simulation.
- The same drawings and seed must give the same race on every browser and device.

### 7.5 Render-only effects
- Soft contact shadows, small dust puffs on landings, ink "drying" on new strokes. None of these affect the simulation.

---

## 8. Fairness and balance
- **No kind may dominate. Flyers must not always win.**
- Each kind has a different profile that trades off against the others, e.g. quick acceleration vs high top speed, steady vs streaky pace.
- On the flat lane, expected finish times for a well-drawn creature of each kind fall in a narrow band. Proportions (leg length, size, symmetry) matter within a kind; a little seeded luck decides close races.
- **Balance test:** thousands of headless mixed races with generated creatures of every kind. No kind may win more than about 1.5× its fair share, and every kind must win sometimes. Report the win rate per kind.
- Speeds scale like real animals: by √(g × leg length), so longer legs run faster within a kind.

---

## 9. Race rules and results

### 9.1 Race flow
1. **Reveal and countdown** (about 3 s). Creatures appear in their lanes and wake up.
2. **Race.** Each creature runs itself down its lane. Finishing is when its body crosses the finish line; time is recorded to the tick.
3. **End:** when everyone has finished, or 5 s after the last player in the room finishes, or after 120 s.
4. **Ranking:** finishers by time, then everyone else by distance.

### 9.2 Results screen
- Placings with each creature's drawing, name, kind and time.
- One honest fact from the race, comparing you with the winner (kind, leg length, size or top speed).
- One light award per creature (Fastest Stride, Most Airborne, Steadiest Gait…).
- Buttons: **Rematch** (same drawings, new seed), **Redraw**, **Share / dare link**.
- If the gap between first and second is under 0.3 s: a photo-finish moment.

---

## 10. Commentary
- **Format:** a short ticker of template lines in a calm, dry, architectural-documentary voice, at most one line every 2.5 s.
- **Triggers:** start, lead change (after 3 s, at most every 4 s), a long time in the air, a fall, the winner finishing, your own creature finishing, photo finish.
- **Example lines:** "Specimen 3 adopts a four-legged gait." · "Lane 2 takes the lead." · "The flyer has elected not to land." · "Too close to call."
- **Names:** generated when the player leaves the name empty, e.g. "Gerald Fourfoot".

---

## 11. Modes

### 11.1 Rooms (hackathon priority)
- 2–4 players join by link or 4-letter code. The host starts the game. Bots fill empty lanes if the host turns them on.
- Everyone draws at the same time, races together, sees the same results, and can rematch.

### 11.2 Solo
- One player against 3 bot creatures of different kinds. No account needed.
- **Bot creatures:** generated drawings of every kind (body, legs, wings, tail, eyes) drawn with a slightly wobbly hand, read by the same drawing reader as players' drawings.

### 11.3 Dare links
- The link carries the challenger's drawing and the race seed. The receiver draws a creature and races it against theirs in the same race.

### 11.4 Later
- Daily race, ranked play, leaderboards, gallery (section 13).

---

## 12. Multiplayer and netcode
- **No inputs during a race**, so there is no input netcode. A race is fully decided by the drawings and one seed.
- **Flow:**
  1. Players join a room; a relay assigns lanes.
  2. During the draw phase each player sends their drawing once (simplified points, a few hundred bytes).
  3. The host sends `start{seed, drawings, startsAt}` to everyone.
  4. Every client runs the identical simulation locally and shows the race.
  5. The host's results are authoritative: the host sends `results{ranking, times}` and every client shows those, so a rare floating-point difference on one device can never change who won.
- **Server role:** a tiny WebSocket relay, one room per code. It only forwards messages and assigns lanes.
- **Messages:** `join{name}`, `hello{lane, players}`, `lobby{players}`, `phase{draw|race|results, endsAt}`, `drawing{points}`, `start{seed, drawings}`, `results{ranking, times}`, `rematch`.
- **Disconnects:** a player who drops keeps their creature in the race (it runs itself anyway). If the host leaves, the room ends with a "host left" screen.

---

## 13. Leaderboards and fairness (after the hackathon)
- Verified scores: a submitted race (drawings + seed) is re-run headlessly and accepted only if the result matches.
- Boards: fastest time per kind, daily races, best creature of the day.
- Equal conditions: same timer and same seed for everyone in a race.

---

## 14. Virality and sharing
- **Every share is a dare:** a link that opens straight into "draw a challenger", plays in one tap, and needs no sign-up.
- **Result card:** the creature drawn large on the white sheet with lane, time, place and kind, in the architectural style (1200×630 and 1080×1350).
- **Replay clip (later):** rendered from the deterministic replay, tilt-shift look, burned-in captions.
- Phones use `navigator.share`; desktop copies the link.
- **No AI-generated art** anywhere in the product or the marketing.

---

## 15. Visual design and microinteractions

### 15.1 Direction
- **Clean, minimal, architectural.** Near-monochrome: white paper, grey linework, ink-black text, and one accent colour for "you".
- **Typography:** a deliberate pairing from Google Fonts: a clean grotesk or neo-grotesk for UI and headings, plus a technical or mono face for numbers, labels and dimensions. Tabular figures for times.
- **Layout:** portrait phone first, desktop supported; precise alignment on a grid; generous margins.
- **Quality bar:** award-level, clearly better than Doodle Sports Day, OddHoof and Outdraw / Deviation Game. Learn from them; never copy their code or art.

### 15.2 Microinteractions
- **Drawing:** ink dries with a subtle sheen in 300–400 ms; the preview creature reacts the moment a stroke ends; the kind label updates with a small fade.
- **Reveal:** lane lines draw themselves in; creatures appear in their lanes and wake up.
- **Race:** soft shadows and dust puffs; the camera glides with the pack; the focus band stays on the action.
- **Finish:** a clean finish-line moment; photo-finish freeze for close races.
- **Results:** times count up in tabular figures; rows slide in one by one.
- **Buttons:** precise, tactile press states; visible focus rings.
- Respect `prefers-reduced-motion`.

---

## 16. Audio
- **Engine:** Web Audio API, a few synthesised sounds, no files needed for the hackathon.
- **Sounds:** pen scratch while drawing, a soft click on buttons, a countdown tick, a finish chime, a camera shutter for photo finishes.
- **Settings:** mute, remembered.

---

## 17. Screens and user flows
1. **Home:** Create room, Join with code, Play solo.
2. **Lobby:** room code, players and their lanes, host's Start button, bots on/off.
3. **Draw:** the sheet pad, timer, pens, Undo/Clear, name, live preview strip with the kind label.
4. **Race:** the tilt-shift sheet with lanes, a thin progress bar, the commentary ticker.
5. **Results:** placings, fact, awards, Rematch / Redraw / Share.
6. **Dare landing:** "{name} dares you", then Draw.
7. **Settings:** sound, reduced motion, silhouette mode.

---

## 18. Technical architecture

### 18.1 Client
| Layer | Choice | Notes |
|---|---|---|
| Language and build | TypeScript, Vite 8 | `base: './'`, ES2022 target |
| Rendering | Canvas 2D | Tilt-shift via a perspective transform plus a blurred copy masked outside the focus band |
| Simulation | Own deterministic creature physics (`src/body.ts`) | Replaces Rapier, which is no longer used |
| Strokes | `perfect-freehand` | For the look only |
| Audio | Web Audio API | No library |
| Storage | `localStorage`, wrapped in try/catch | Last creature, settings |

**Module layout:** `geom`, `dmath` (deterministic trig), `rng`, `analyze` (reading the drawing), `creature` (kind and tuning), `body` (physics), `race` (simulation), `bots` (generated creatures), `comedy` (names, commentary, awards), `encode` (dare links), `pad` (drawing + preview), `render` (sheet and tilt-shift), `net` (rooms), `main` (screens).

**The simulation never touches the page (DOM)**, so the same code runs in the browser, in tests and in a Worker.

### 18.2 Backend
| Need | Service |
|---|---|
| Static hosting | Cloudflare Pages |
| Rooms | Cloudflare Worker + Durable Object relay (`server/`). Fallback: the same relay as a Node `ws` server for local/LAN play |
| Later | D1 for leaderboards, R2 for share cards |

### 18.3 Going viral costs nothing
- Solo play and dare links use only static files plus data in the URL.
- Rooms use a relay that only forwards a few small messages per game.

---

## 19. Data model and API (after the hackathon)
```sql
creatures(id TEXT PK, player_id TEXT, drawing BLOB, name TEXT, kind TEXT, created INT, reports INT DEFAULT 0, hidden INT DEFAULT 0)
races(id TEXT PK, seed INT, created INT)
entries(race_id TEXT, creature_id TEXT, lane INT, time_ms INT, place INT, PRIMARY KEY(race_id, lane))
reports(id TEXT PK, creature_id TEXT, reporter TEXT, reason TEXT, created INT)
```
| Method | Path | Purpose |
|---|---|---|
| WS | `/room/:code` | Room relay (section 12) |
| POST | `/api/races` | Submit a race for verification (later) |
| GET | `/api/leaderboard` | Leaderboards (later) |

---

## 20. Performance, responsiveness, PWA, accessibility
- **First load:** ≤ 120 KB gzipped; the drawing pad is ready in under 1 s on a mid-range phone.
- **Frame rate:** 60 fps with 4 creatures on a 2020 mid-range Android; the tilt-shift blur degrades gracefully.
- **Screens:** portrait phone first (360–430 px wide), landscape and desktop supported; safe areas respected; `touch-action: none` on the pad.
- **Accessibility:** lane numbers plus the accent colour (never colour alone), large readable times and commentary, reduced motion respected, full keyboard support for menus.
- **PWA (later):** installable, offline solo play.

---

## 21. Moderation and safety
- Expect rude drawings; rely on reports and silhouette mode rather than a classifier.
- **Silhouette mode** shows other players' creatures as plain filled shapes. On by default for under-13s.
- **Names:** profanity filter, 24-character limit.
- **Data:** no personal data; rooms are temporary.

---

## 22. Analytics and success metrics
**Events:** `land`, `draw_start`, `draw_done`, `race_start`, `race_end`, `rematch`, `redraw`, `share`, `dare_open`, `room_create`, `room_join`.

| Metric | Target |
|---|---|
| Time from opening to first race | < 30 s (median) |
| Rematch or redraw rate | > 50% of finished races |
| Win rate per kind in real games | no kind above 1.5× its fair share |
| Dare link open → race | > 50% |
| Playtest | people watch the preview and say "it's alive" |

---

## 23. Testing plan
- **Classification:** a test set of hand-style drawings of every kind, especially wing variants and snakes.
- **Motion:** every kind finishes the lane with natural motion (no backwards sliding, no pogo bounce, no falls on flat ground). Confirmed by watching screenshots and the live build, not only by numbers.
- **Determinism:** same drawings and seed give an identical state hash, in Node and in each browser.
- **Fairness:** the balance test in section 8.
- **Encoding:** dare links round-trip and re-encode to the same bytes.
- **Rooms:** 2–4 devices on different networks finish a race and three rematches in a row.
- **Screens:** headless screenshots of draw, preview, race and results at phone and desktop sizes; final review in a real browser (Helium).

---

## 24. Milestones
| Milestone | What gets built | What has to be true to continue |
|---|---|---|
| **M0: the creature** | Drawing reader (with reliable wings), creature movement for every kind, live preview, fairness test | Every kind looks alive in the preview; balance test passes |
| **M1: the Sheet** | Architectural sheet renderer, tilt-shift camera, lanes, race and results screens, solo vs bots | Looks award-level on a phone; a full solo race works |
| **M2: rooms** | Relay, lobby, simultaneous draw, shared seed race, host results, rematch | 3 devices finish a race and rematch 3 times |
| **M3: share** | Dare links, result card, deploy | A dare link replays the same race on another device |
| **Later** | Daily race, leaderboards, gallery, replay clips, more scenes | |

---

## 25. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Motion still looks unnatural | Judge by watching; tune per kind; keep render-only polish (shadows, dust) separate from the simulation |
| One kind dominates | Balance test with win rates per kind; per-kind trade-offs |
| Wings and other parts misread | A hand-style test set; tune thresholds against it |
| Tilt-shift blur is slow on phones | Cheaper blur fallback; keep your own lane sharp |
| Floating-point differences between devices in rooms | Host results are authoritative; polynomial trig only in the simulation |
| Rude drawings | Reports and silhouette mode |
| Direction changes late in the hackathon | Keep the scope in section 28; cut anything that risks the deadline |

---

## 26. Open questions and later ideas
- **More scenes** after the Sheet. Earlier venue concepts, now parked: Best in Show (dog-show agility), STOMP (toy city), Ochre (cave paintings), Fog (misty window), Tug Day (tug of war), Notebook (lined paper). Any future scene keeps the rules in section 2: no player input, lanes, no hazards unless deliberately reintroduced.
- **Hazards, page turns, chasing darkness:** dropped for now.
- **Tap or cheer controls:** dropped; the drawing is the whole game.
- **Languages:** English first; Japanese and Korean later.
- **Monetisation:** cosmetic only, or none.

---

## 27. Appendix: research data and sources

### 27.1 Reference games
- Doodle Sports Day: https://yurustudio.github.io/undoukai/ (its `sim.js` and `main.js` were studied)
- OddHoof: https://www.oddhoof.com/ (its `/game/*.js` modules were studied); a lookalike copy exists at https://oddhoof.cc/

### 27.2 Competitors
- Doodle Smash: https://store.steampowered.com/app/5329870
- Kiln: https://en.wikipedia.org/wiki/Kiln_(video_game)
- Drawquarium: https://www.invenglobal.com/articles/27688/drawquarium-the-aquarium-for-your-drawn-fish-confirmed-for-november-14-steam-release
- AI Pixel Art Battle: https://www.4gamer.net/games/960/G096009/
- Scrawlcraft: https://www.reddit.com/r/WebGames/comments/1xgmowg/scrawlcraft_draw_your_own_creatures_and_send_them/
- Draw-your-hero horde game: https://www.reddit.com/r/IndieGaming/comments/1xf1ql7/im_making_a_game_where_you_draw_your_own_hero/
- Draw Climber: https://www.crazygames.com/jp/game/draw-climber
- Scribble Rider: https://www.pockettactics.com/scribble-rider/download
- Evolution (Keiwan): https://keiwan.itch.io/evolution
- ANLIFE: https://store.steampowered.com/app/2452130/ANLIFE_MotionLearning_Life_Evolution/
- Meta Animated Drawings: https://about.fb.com/news/2021/12/using-ai-to-animate-childrens-drawings/
- Magic Pengel: https://en.wikipedia.org/wiki/Magic_Pengel:_The_Quest_for_Color
- Doodle Champs: https://store.steampowered.com/app/1618320/Doodle_Champs/
- Draw Creatures: https://play.google.com/store/apps/details?id=games.tatsumaki.drawcreatures

### 27.3 Evidence of what spreads
- Draw-a-horse origin post: https://x.com/yungcontent/status/2098140729084403967
  - top replies: https://x.com/AdamHoltererer/status/2098168374161232229, https://x.com/adnys/status/2098409993263538604, https://x.com/shacheng/status/2098254387600826791, https://x.com/its_xlab/status/2098531751807078455, https://x.com/OmakaseBar/status/2098324107385516434, https://x.com/jasonkeath/status/2098185864803144091, https://x.com/attacomsian/status/2098291748586033507, https://x.com/sudbalaji/status/2098513407259365736
- Drawquarium:
  - release-date post: https://x.com/DrawquariumGame/status/2114724027868586219
  - meme: https://x.com/elminehuy/status/2115849711072764317
  - r/gaming thread: https://www.reddit.com/r/gaming/comments/1xizt6b/drawquarium_art_is_human/
- AI Pixel Art Battle creator video: https://x.com/ushizawa/status/2114265958265004381
- Horse Race Tests: https://knowyourmeme.com/memes/subcultures/horse-race-tests
- Doodle Shooter story: https://x.com/PirateWires/status/2100157223313838428
- Raw research files: `~/Documents/Last30Days/draw-your-own-creature-games-going-viral-*-raw-v3*.md`

---

---

## 28. Hackathon build (trmi × Lovhack × Nexus 2026)
This section overrides the rest of the PRD until submission. Everything not listed here waits until after the hackathon. Updated Nov 1, 21:30 JST for the new direction (the Sheet, self-running races).

### 28.1 Event facts
- **Theme:** "Multiplayer Everything": people must be able to use it together.
- **Team:** 3 students (2–4 allowed). Late entry approved. One captain submits.
- **Required tool:** trmi (trmi.dev). One shared trmi project linked to our GitHub repo. Each teammate sends Claude Code prompts from their own seat, and teammates review, approve and test each other's changes there. Judges score how much we really collaborated through trmi, so **do the work in trmi, not alone in a local terminal**.
- **Originality:** coding started after kickoff (Oct 31, 10 PM JST). The research and PRD are "ideas and sketches", which are allowed. Libraries, templates and AI agents are allowed.
- **Deadline:** Devpost says **Mon Nov 2, 5:00 AM JST** (trmi says 6:00 AM; trust the earlier one). Aim to submit by **4:30 AM JST**.
- **Judging:** Creativity & Innovation, Technical Execution, TRMI & Team Collaboration, Real-World Impact, Demo & Presentation (no published weights).
- **Submit:** Devpost entry (name, description), public GitHub repo URL, short demo video, links and team info, public playable URL (strongly recommended), and an explanation of how we used trmi (recommended).
- **Links:** https://trmi.dev/hackathon · https://lovhack-trmi-2026.devpost.com · rules: https://lovhack-trmi-2026.devpost.com/rules · Discord (deadline questions): https://discord.gg/qCmA6fFS2

### 28.2 The one thing we ship
**A live room where 2–4 friends draw creatures at the same time, watch them come alive in the live preview, then see them race themselves side by side in their own lanes on a clean white architectural sheet, from their own phones or laptops.**

Demo story (what the video shows):
1. Player 1 creates a room and reads out the 4-letter code. Players 2 and 3 join from other devices.
2. A 20 s draw phase runs for everyone at once. Each player's preview shows their creature walking, hopping, flying, rolling or slithering the moment they draw it.
3. The creatures appear in their lanes on the tilt-shift sheet and race themselves. No tapping.
4. Results: placings, each creature's kind and time, and one honest fact ("The winner's legs were 1.8× longer").
5. Someone redraws a better shape, rematches and wins. The drawing is the whole game.

### 28.3 Scope
| In | Cut (back to the main PRD after the hackathon) |
|---|---|
| Drawing pad with 20 s timer, no ink limit (6.1) | Leaderboards, daily race, gallery, ranked play |
| Drawing reader with reliable wings (6.3–6.4) | Replay clips, result cards, PWA |
| Creature movement for every kind (7) and the live preview (6.2) | Silhouette mode, reports |
| Fairness balance test (8) | More scenes |
| The Sheet: white architectural page, lanes, tilt-shift (5) | Dare links (keep if time allows; encoding already works) |
| Race flow and results with Rematch / Redraw (9) | Audio beyond a few Web Audio sounds |
| Rooms of 2–4 by 4-letter code, bots fill empty lanes (11.1, 12) | Cross-browser determinism checks (host results are authoritative) |

### 28.4 Multiplayer model (simplest thing that works)
- **Relay server:** a tiny WebSocket relay, one room per 4-letter code. It only forwards messages and assigns lanes. Built as a Cloudflare Worker + Durable Object in `server/` (free plan), deployed with `wrangler`. Static client on Cloudflare Pages. Fallback if Cloudflare setup blocks us: the same relay as a Node `ws` server on any free host.
- **No race inputs:** creatures race themselves, so only drawings and one seed travel.
- **Host:** when everyone has submitted (or the draw timer ends), the host sends `start{seed, drawings}`. Every client runs the same simulation locally. The host then sends `results{ranking, times}`, which everyone displays, so a tiny floating-point difference on one device can never change the winner.
- **Messages:** `join{name}`, `hello{lane, players}`, `lobby{players}`, `phase{draw|race|results, endsAt}`, `drawing{points}`, `start{seed, drawings}`, `results{ranking, times}`, `rematch`.
- **Disconnects:** a dropped player's creature still races (it runs itself). If the host leaves, the room ends with a "host left" screen (acceptable for the demo).

### 28.5 Team split (3 people, all in trmi)
| Seat | Owns | First prompts |
|---|---|---|
| A: Simulation | `src/analyze.ts`, `src/creature.ts`, `src/body.ts`, `src/race.ts`, `src/bots.ts`, `src/dmath.ts`, `test/` | Reliable wing detection; snake slithers forward; natural gaits for every kind; fairness balance test |
| B: Play screens | `index.html`, `src/main.ts`, `src/pad.ts`, `src/render.ts`, `src/style.css`, `src/ui/*` | The Sheet renderer with lanes and tilt-shift; draw screen with live preview; lobby / draw / race / results screens |
| C: Rooms + ship | `server/`, `src/net.ts`, deploy, Devpost | Relay, room join by code, `start{seed, drawings}` and host results, deploy to Pages, demo video, Devpost write-up |

A working starting point for seats A and B exists on branch `m0-prototype` (`src/body.ts`, `src/analyze.ts`, `src/race.ts`, `src/pad.ts`, `scripts/run-ts.mjs`, `test/sim.test.ts`): self-running races for every kind, deterministic, all kinds finishing in tests. Its cave renderer is replaced by the Sheet; its known bugs are listed in section 7.3.

Rules: each seat works in its own trmi **lane** (one branch per feature). Teammates approve the agent's edit cards in trmi (approval mode: Majority or Everyone, never Auto on main). A finished lane opens a PR into trmi's main; the captain merges trmi's main into the GitHub default branch before deploys. Use trmi's main session only for planning and small edits everyone needs right away. Watch trmi's overlap warnings when two lanes touch the same file. Each seat writes a one-line handoff in prd/progress.json when a feature changes status. Keep a few screenshots of trmi reviews for the Devpost collaboration section.

### 28.6 Timeline (JST, Nov 1–2)
| Time | Goal |
|---|---|
| 19:30–20:00 | Repo on GitHub, shared trmi project, everyone can prompt. `npm run dev` shows a page |
| 21:30 | **Direction change:** the Sheet scene, self-running races, no tapping, fairness. This section updated |
| 21:30–23:30 | Seats A/B/C build in parallel. A solo race on the Sheet works locally by 23:30 |
| 23:30–01:00 | Integrate rooms. Three devices in one room finish a race online |
| 01:00–02:30 | Three-player playtests, fix what breaks, balance tuning, polish |
| 02:30–03:30 | Record the demo video (three real players, 2–3 min) |
| 03:30–04:30 | Devpost entry, README, trmi collaboration write-up. **Submit** |
| 04:30–05:00 | Buffer only. No new features |

Feature freeze at 02:30 no matter what. A working Sheet race in a room beats unfinished extras.

### 28.7 Definition of done
- A public URL where 3 people on different networks can join one room, draw, watch the race and see results.
- Every kind visibly moves the way its shape suggests, in the preview and in the race.
- No kind wins every time: the balance test passes.
- Rematch works at least 3 times in a row without reloading.
- Phone portrait and desktop both playable.
- Public GitHub repo with README, demo video uploaded, Devpost submitted before 5:00 AM JST.
