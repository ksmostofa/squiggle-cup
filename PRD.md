# Squiggle Cup — Product Requirements Document

| | |
|---|---|
| **Status** | Final plan for prototype work. Supersedes all earlier drafts. |
| **Date** | 2026-11-01 |
| **Working title** | Squiggle Cup. Check the name, a domain, the app stores and Steam before committing. |
| **One-liner** | Draw anything. It comes alive and competes. Badly. |
| **Core rule** | The shape of your drawing *is* its physics. No hidden stats. |
| **Platform** | Web (installable PWA), portrait phone first, desktop supported |
| **Cost target** | Free tiers only. The one optional expense is a domain, about $10 a year. |
| **Primary growth channel** | X (Twitter), then Reddit, TikTok, itch.io and web game portals |

---

## Table of contents
1. Background and research
2. Product vision and design rules
3. Target players
4. Game overview
5. Venues
6. Drawing system
7. Physics and creature model
8. Controls and feel
9. Race rules and results
10. Comedy system
11. Modes
12. Multiplayer and netcode
13. Leaderboards, ratings, fairness
14. Virality and sharing (X-first)
15. Visual design and microinteractions
16. Audio
17. Screens and user flows
18. Technical architecture (free stack)
19. Data model and API
20. Performance, responsiveness, PWA, accessibility
21. Moderation and safety
22. Analytics and success metrics
23. Testing plan
24. Milestones
25. Risks and mitigations
26. Open questions and later experiments
27. Appendix: research data and sources

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

---

## 2. Product vision and design rules

**Vision:** the funniest physics sport on the internet. Every player's scribble becomes an athlete, and every match produces a clip worth posting.

**Design rules** (they settle every disagreement):
1. **The world has to make a bad drawing look intentional.** Every venue's art style flatters bad drawings.
2. **The shape is the rules.** Everything that happens can be seen in the physics. Players learn by watching what happened.
3. **The game plays it straight; the drawing is the joke.** Everything around the creature is formal and earnest. Only the creature is absurd.
4. **Waiting time is drawing time.** The game loads in the background while you draw, so there's never a loading screen.
5. **One deterministic simulation (same inputs, same result) runs everything:** multiplayer, score checking, ghosts, bots, replays and videos.
6. **Fail fast, fail funny, rematch instantly.**
7. **Every share is a dare, not a brag.** Shared links are playable in one tap.
8. **Everything is free, nothing is pay-to-win, and no AI art.**

---

## 3. Target players
- **Casual X and TikTok scrollers** (primary): open a link from a post, play one race, share the result. Time to first race: under 30 s.
- **Friend groups and streamers:** rooms, Tug Day, sabotage clips.
- **Competitive players:** ranked rooms, seasons, venue records, category boards.
- **Spectators and bettors:** the Daily Cup bracket with predictions.
- **Age:** for everyone, with a safe-by-default silhouette mode for under-13s (section 21).

---

## 4. Game overview

### 4.1 Core loop (about 90 s)
1. **Draw.** Your creature, in the venue's art style. 20 s in multiplayer, untimed solo. Everyone gets the same ink.
2. **Reveal and wake-up.** All drawings are revealed at once. Each one blinks, stretches and comes alive. This is the emotional beat.
3. **Race.** Tap to stride, hold and release to leap. Creatures shove, flip, get stuck and get nudged free.
4. **Results.**
   - placings and awards
   - the judges' scorecards (Best in Show)
   - your drawing next to the winner's, with one fact taken from the replay
   - a slow-motion replay of the funniest fail
5. **Rematch.** Keep your creature, or redraw in 10 s. One tap.

### 4.2 Longer loops
- **Session:** rematch, learn from the winner's shape, redraw.
- **Daily:** enter the Daily Cup, bet pretend points on races, keep a streak, share the emoji strip.
- **Long term:**
  - ranked seasons
  - venue records
  - your personal gallery of every creature you've drawn, with each one's race history
  - category boards

---

## 5. Venues
One engine and one creature system. A venue adds a course, its rules, a visual style, an ink style and a commentary voice.

Shared course rules:
- Horizontal side view; creatures race left to right.
- Races last 40–70 s.
- A creature stuck for 5 s gets nudged forward by the handler (section 9).

Course numbers below are the **starting values for tuning**.

### 5.1 Best in Show (flagship; first to build)
- **Premise:** the world's most prestigious pet agility championship, and your entry is whatever you drew.
- **Course (92 m):**
  - hurdles at 11, 18, 70, 77 and 84 m (0.38–0.60 m high)
  - a seesaw at 27 m (5.5 m plank on a pivot)
  - a fabric tunnel at 39–45 m (ceiling 1.55 m, so tall creatures bonk)
  - 6 springy weave poles from 54 m (1.2 m tall, spaced 1.3 m, springing back upright)
  - finish at 92 m
- **The handler:** a tiny human in a blazer, on a leash attached by a rope physics joint. They get dragged, trip, and keep their dignity. Rendered as a sprite plus the rope. Added in M1; M0 can leave them out.
- **Judges:** three judges hold up scorecards after the race (section 10.5).
- **Look:**
  - green carpet, velvet ropes, gold rosettes, serif lettering in the style of a TV broadcast
  - strong contrast, so it survives video compression
  - ink is marker with a white sticker edge
  - inks: `#1d1b2e`, `#c8372d`, `#2a6fdb`, `#2f9e5a`
  - drawing pad: cream `#f4f1e6`
- **Voice:** a hushed, reverent announcer. *"Remarkable. It has gone into the tunnel and has not come out."*

### 5.2 STOMP
- **Premise:** drawn monsters race to the tower through a toy city.
- **Course (95 m):**
  - "buildings" are stacks of dynamic blocks, 0.42 m each, 2–4 columns × 3–8 rows, very light (density 0.22), so creatures plough through
  - parked toy cars (0.9 × 0.36 m) appear about 25% of the time between buildings
  - finish at the tower
- **Stat:** buildings flattened. A block counts as smashed when it moves more than 0.35 m or tilts more than 0.4 rad; it's credited to the nearest creature.
- **Look:** a bright pastel tilt-shift diorama with tiny trees. Tiny people run away cartoonishly; no violence beyond that. Ink is crayon.
  - inks: `#2b2233`, `#e0482f`, `#3c8f3e`, `#7b4fd6`
  - drawing pad: `#fff8ec`
  - building colours: `#f6b2a6`, `#9fd3e8`, `#f7d774`, `#b9e0a5`, `#d6c1f0`, `#f3c58d`
- **Voice:** a breaking-news anchor. *"Authorities confirm the creature has no plan."*

### 5.3 Ochre
- **Premise:** paintings on a cave wall come alive at night. Race the dark to the cave mouth; fall behind and you turn back into a painting.
- **Course (100 m):**
  - rolling rock ground made of three layered sine waves, up to about ±1 m
  - stalagmites (fixed triangles, 0.45–0.95 m high)
  - loose scree (dynamic pebbles, radius 0.1–0.2 m)
- **The dark:** starts at −9 m and moves at 1.55 m/s, speeding up by 0.03 m/s every second. A creature it catches is eliminated: it freezes and fades back into a painting.
- **Finish:** at the cave mouth the whole screen floods with daylight. That reveal ends every race.
- **Look:**
  - a flickering torch lights the rock
  - ink is pigment with dry-brush grain, so a crude drawing reads as 30,000 years old
  - inks: red ochre `#b5452b`, yellow ochre `#d9a441`, charcoal `#1d1a19`, kaolin white `#efe6d8`
  - rock `#2b231f` to `#5a4a3f`, fire glow `#ffb347`, daylight sky `#bfe3ff`
- **Video risk:** dark scenes look muddy when compressed. Share clips must end on the bright daylight frame and use it as the thumbnail.
- **Voice:** a nature-documentary narrator (a generic one, never imitating a real person). *"Here we observe the rare one-legged Geraldus, which has evolved, for reasons unknown, a hat."*

### 5.4 Fog
- **Premise:** you draw with your finger on a misty window. Race across the glass before the fog forms again behind you.
- **Course (90 m):**
  - a flat window sill
  - condensation puddles every 9–15 m (2–4 m wide, almost no friction, so creatures slide)
  - occasional falling drips that knock creatures over
- **The fog:** starts at −9 m and moves at 1.6 m/s, speeding up by 0.028 m/s every second. A creature it catches is eliminated: it fades into the mist.
- **Look:**
  - lo-fi rain at night, glowing city lights behind the glass, droplets
  - ink is a clear streak wiped through the mist; one ink colour (white)
  - the prettiest venue in the game, and the calm one
  - drawing pad: `#9fb1c2`
- **Voice:** soft lo-fi radio. *"…and that was the fog. Stay cosy."*

### 5.5 Tug Day
- **Premise:** a summer-fair tug of war. Two teams, one rope, zero dignity.
- **Format:**
  - 2v2. A solo player gets a bot teammate.
  - The left team faces left (its drawings are mirrored); the right team faces right.
  - Each creature is tied by a rope joint to a central knot (a ball, radius 0.22 m).
  - A team wins when the knot crosses 6 m onto its side, or by knot position after 45 s.
- **Shape matters:** many short legs grip; long legs slip; more ink means more weight.
- **Team bonus:** when teammates tap in sync, both get a pulling bonus.
- **Look:** sunny grass, chalk ink, bunting, a mud stripe at the centre. Inks: `#25324a`, `#d2462f`, `#2c7be5`, `#e8a317`.
- **Voice:** an over-excited village fete announcer.
- **Rankings:** casual only; not part of ranked play.

### 5.6 Later venues
- **Notebook** ("Last Page" rules): margin doodles; the page turns as a timer; losers draw hazards onto the next page.
- **A new venue each month**, with a palette change.

---

## 6. Drawing system

### 6.1 The drawing pad
- **Size:** 600×600 logical pixels, scaled to fit the screen. **1 pad pixel = 0.005 m**, so the pad is 3 m across.
- **Guide:** a "Face this way →" arrow (the race direction), with a faint venue-themed background.
- **Pens:** the venue's 1–4 ink colours × 2 widths (thin 7 px, thick 14 px). Strokes are smoothed with perfect-freehand.
- **Ink budget:** about 3,000 px of stroke length per creature. Thick strokes cost 1.4× as much.
  - The meter drains as you draw; when it's empty you can't draw more.
  - Everyone gets the same budget in every mode.
- **Tools:** Undo, Clear, Done. An optional name field; if left empty, a formal name is generated.
- **Timer:** 20 s in multiplayer, with a visible countdown that auto-submits. Untimed solo.

### 6.2 Live feedback while drawing (teaches the rules without text)
- **Body:** when you close an outline, it fills with a soft wash of colour.
- **Limbs:** a stroke attached to the body gets a pulsing knuckle dot where it joins.
- **Eyes:** dots and small loops inside the body turn into googly eyes immediately and blink.
- **Status chip:** e.g. "Body ✓ · 4 legs · 2 eyes".

### 6.3 Reading the drawing (rules in pad pixels)
1. **Closed stroke:** at least 4 points, length over 60 px, and the gap between its ends at most max(26 px, 18% of its length).
2. **Body:** the closed stroke with the largest area whose bounding box is at least 54 px. If none, the longest stroke. Nothing usable means no valid creature: "Draw a body!"
3. **Eyes:** strokes smaller than 54 px whose centre is inside the body and that are either dots (under 16 px long) or closed loops. Eye radius = max(9 px, half its size + 4 px).
4. **Limbs:** a stroke at least 28 px long, with an end within **20 px** of the body (or inside it), that reaches at least 18 px away from the body. Its points are reordered so the attached end comes first.
5. **Decoration:** everything else. Rendered with the body, no collision.

### 6.4 Compact encoding (for dare links, ghosts, replays and storage)
- Simplify each stroke (RDP, 2 px), then round to a 3 px grid (coordinates 0–200 fit in one byte).
- **Bytes, in order:**
  1. version
  2. venue
  3. seed (4 bytes)
  4. name length, then the name in UTF-8 (at most 36 bytes)
  5. stroke count
  6. for each stroke:
     - a flags byte: ink index (3 bits), width (1 bit)
     - point count (at most 255)
     - first x and y
     - offsets to each following point (int8 pairs; extra points are added when a jump exceeds ±127)
- **Inputs** (when included): event count, then each event's tick offset from the previous one (variable-length integer) with its type (tap, press, release) in the low bits.
- **Format:** base64url in the URL after `#`. Target ≤ 2 KB, including a 60 s ghost run.

---

## 7. Physics and creature model

**Engine:** Rapier 2D deterministic build (`@dimforge/rapier2d-deterministic-compat` 0.21.0).
- **Units:** metres, y up, gravity −9.81.
- **Step rate:** fixed 60 steps per second. Everything random is seeded.

### 7.1 Building a creature
- **Body:** one dynamic rigid body.
  - A closed body becomes a convex-hull collider of its simplified outline (concave shapes are filled in).
  - An open body becomes capsules along the line (radius = half the stroke width, at least 0.04 m).
  - Density 1, friction 0.7, restitution 0.05, angular damping 0.6.
- **Limbs:** each limb is its own dynamic rigid body, made of capsules along the simplified stroke.
  - Radius ≥ 0.035 m, density 1.2, **friction 1.6** (grip).
  - A **revolute joint** (hinge) connects it to the body at the attach point.
- **Facing:** mirrored horizontally for left-facing teams in Tug Day.
- **Spawn:** placed so the lowest point sits 0.08 m above the ground.
- **No self-collision:** each creature has its own collision bit, so its parts never hit each other. They still hit the world and other creatures, up to 15 creatures in one world.
- **Weight:** comes from the colliders (more ink = heavier).

### 7.2 How it moves (spoke model, like Draw Climber)
- **Throttle:** each tap adds +1, up to 5. It fades by a factor of e^(−1.7·t).
- **Limb motors:** velocity-driven, with target = −facing × throttle × **3.4 rad/s**. Limbs turn like spokes, so long legs give big fast strides and many short legs give a steady crawl.
- **Motor gain:** 2 + 10·min(throttle, 1). With no throttle the limbs go slightly floppy, which is funny.
- **Motor torque limit:** 30 × the creature's total mass. Force-based, so heavy limbs really are harder to turn.
- **Natural rhythm:** each creature has one. Over-spinning flips it; under-spinning stalls it.

### 7.3 Leap
- **Hold:** at least 0.2 s. Charge c = min(1, (held − 0.2)/0.7).
- **On release (only when grounded and off cooldown):**
  - body impulse = mass × (1.2 + 2.2c) forward and mass × (3 + 4.5c) upward
  - each limb gets the matching upward impulse
- **Cooldown:** 0.9 s.
- **Grounded check:** a ray cast straight down from the body for (creature height + 0.35 m), ignoring the creature's own parts.

### 7.4 Staying upright
- **Each step**, apply a torque toward upright: (−k·angle − 1.6·angular velocity) × mass × dt × 0.6.
  - k = 7 normally: weak, so flips still happen.
  - k = 30 after 1.4 s upside down: the creature rights itself, which is also a comedy beat.
- **Flips:** counted when the angle passes ±2.6 rad and changes sign.

### 7.5 Anti-exploit rules
- **Progress:** in ranked play, distance only counts while touching the ground. Airborne launches still move the creature, but the leap is capped and on cooldown, so flinging gains little.
- **Physical limits:** motor torque is capped relative to weight (above) and the same ink budget applies to everyone.
- **Minimum body size in ranked:** a body bounding box of at least 80 px, so "dust speck" creatures aren't allowed.
- **Speed sanity check:** the server-side re-run rejects any creature averaging more than 9 m/s.
- **Fuzz testing:** 1,000 randomly generated creatures must stay inside the speed limit and never get stuck forever (section 23).

### 7.6 Render-only effects (not simulated; replays stay deterministic)
- **Googly pupils:** springs pushed by the body's acceleration and gravity, kept inside 45% of the eye radius.
- **Decoration jiggle:** a slight lagging rotation driven by the body's spin.
- **Squash and stretch** on landing.

---

## 8. Controls and feel
| Input | Mobile | Desktop | Action |
|---|---|---|---|
| Stride | Tap anywhere in the lower 60% of the screen | Space | +1 throttle; sound and visual feedback right away |
| Leap | Hold, then release | Hold Space, then release | Charges while held; leaps on release |
| Drawing | One finger | Mouse or pen | Pen pressure changes only the look of the stroke, never physics |

- **Instant feedback:** every press triggers sound, a ring pulse and a slight creature squash immediately, even when netcode applies the input a few steps later (section 12).
- **Rhythm ring:** a faint ring around your creature pulses at its ideal tapping speed. That tempo is estimated from limb length: longer limbs pulse slower.
- **Tap sounds:** taps in time with the ring play a soft drum hit; off-beat taps play a dull thud.
- **Tutorial:** no text tutorial. The first race shows a ghost hand tapping, and a prompt appears if the player hasn't tapped within 3 s.

---

## 9. Race rules and results

### 9.1 Race flow
1. **Countdown:** "Ready… Set… Squiggle!" (3 s). Inputs are ignored until it ends.
2. **Finish:** a creature finishes when its body crosses the finish line; its time is recorded to the tick.
3. **Elimination** (Ochre and Fog): a creature whose body is behind the chasing dark or fog is eliminated. It freezes and fades.
4. **Handler nudge:** if a creature moves less than 0.6 m in 5 s, it's moved forward 2.2 m and up 1.2 m, with its velocity reset. This counts as a "nudge" stat and comes with commentary ("The handler has intervened. This is permitted."). In ranked play each nudge adds a 1.5 s time penalty.
5. **Race end:** when everyone has finished or been eliminated, or 6 s after the player is done (the rest of the race runs at 3× speed), or after 120 s.
6. **Ranking order:**
   1. finishers, by time
   2. creatures still running, by distance
   3. eliminated creatures, with later elimination ranked higher

### 9.2 Results screen
- **Podium** with rosettes (1st, 2nd, 3rd).
- **Your creature beside the winner's**, plus one fact taken from the replay. Template examples:
  - "Winner's legs: 2.1× longer."
  - "You tapped 4.2/s; your ideal was 3.1/s."
  - "You flipped 6 times."
- **Funniest-fail replay:** in slow motion (section 10.4).
- **Awards:** every creature in the race gets at least one (section 10.3).
- **Judges' scorecards** (Best in Show only).
- **Buttons:** Rematch (keep the creature), Redraw (10 s), Change venue, Share (card or clip), Dare link (copy).

---

## 10. Comedy system

**Principle:** the game is the straight man and the creature is the joke. Comedy comes from the gap between what you expected and what happened, from seriousness against nonsense, from visible loss of control, from the underdog winning, and from timing.

### 10.1 Always-on features
- **Googly eyes:** see section 7.6.
- **Jiggle:** see section 7.6.
- **Formal names** (when the player doesn't type one). A title, a shape-based core and a suffix:
  - titles: Sir, Dame, The Honourable, Lord, Lady, Professor, Captain
  - core from the shape: Fourlegs, Nolegs, Longshanks, Blob, Wobblington…
  - suffixes: III, Esq., of Croydon, the Unbothered, Jr.
  - examples: *Sir Reginald Fourlegs III*, *The Honourable Blob*
- **Underdog swings:** bounded random events (a gust of wind, a banana peel) give weak drawings a small but real chance to win. Rare and seeded; never in ranked play.

### 10.2 Deadpan commentary
- **Format:** a ticker of template lines in each venue's voice, triggered by race events. At most one line every 2.5 s, with priority order: photo finish > elimination > nudge > flip > airtime > lead change.
- **Triggers:**
  - start
  - flip
  - more than 1 s in the air
  - a nudge
  - a lead change (only after 3 s, at most every 4 s)
  - an elimination
  - every 10 blocks smashed (STOMP)
  - finish
  - photo finish (gap under 0.3 s)
  - a Tug Day win
- **Example lines (Best in Show):**
  - "A bold strategy: zero legs."
  - "{name} has lost contact with the ground. {name} remains confident."
  - "The judges are writing something down."
- **Clips:** every line is burned into the shared clip as a caption, because X plays video muted.

### 10.3 Awards (each creature gets the best one that applies)
- **Most Confident Loser:** last place with the most taps.
- **Fastest While Upside Down:** highest speed while inverted.
- **Technically Finished:** the slowest finisher.
- **Frequent Flyer:** the most time in the air.
- **Gymnast:** the most flips.
- **Wrecking Ball:** the most buildings smashed (STOMP).
- **Last Light:** the last creature caught (Ochre and Fog).
- **Handler's Favourite:** the most nudges.
- **Unbothered:** the fewest taps in the field.

### 10.4 Fail detector
- **Scoring:** the replay is scored for moments of longest airtime, fastest spin, getting trampled (a heavy contact from above), a big lead lost in the last 10 m, and flips.
- **Highlight:** the top moment is played at 0.35× speed with a zoom-in, a caption and a sound sting.
- **Reuse:** the same moment becomes the default share clip (section 14).

### 10.5 Judges' scorecards (Best in Show)
- **Three judges** hold up one card each:
  - **Grace:** 10 − flips × 1.5, minimum 0.5, one decimal.
  - **Legs:** "Yes", "No", "Too many" or "Unclear", based on the limb count.
  - **Spirit:** taps per second × 2 plus a seeded random offset, capped at 10.
- **Rosette text:** e.g. *"Gerald — Reserve Champion, Most Legs."*

---

## 11. Modes

### 11.1 Quick Race (M0–M1)
- **Format:** solo against 3–5 bots in any venue. No account needed.
- **Bots (ghosts):**
  - Real players' drawings plus their recorded inputs when available, labelled with a ghost icon.
  - Before there's data: generated creatures (a lumpy closed body, 0–6 legs, dot eyes, an optional tail) driven by a bot pilot.
  - Bot pilot: taps at 2.4–4.4 per second with jitter, and leaps when an obstacle is 1.6 m ahead (with a per-bot success chance).

### 11.2 Rooms (M2)
- **Format:** 2–6 players, joined by link or 4-letter code. The host chooses the venue and rules (draw timer, number of rounds, bots on/off).
- **Elimination-venue twist:** in Ochre and Fog, eliminated players become **spirits** who can draw one rockfall or drip stroke ahead of the leaders. Nobody gets bored after going out.

### 11.3 Ranked (M3)
- **Matchmaking:** a regional matchmaker builds 6-player races in Best in Show, STOMP, Ochre and Fog. It waits at most 8 s, then fills seats with ghost bots of similar skill (labelled).
- **Skill rating:** OpenSkill with placement-based updates; resets each month (season).
- **Rules:** ground-contact progress only, nudge penalties, no underdog swing events, a minimum body size.

### 11.4 Daily Cup (M3)
- **Entry:** one creature per player per day (00:00–23:59 UTC).
- **Venue:** rotates daily. Best in Show days are titled "Best in Show of the Day".
- **Bracket:**
  - 64 entries, chosen from the pool by recent activity and a seeded random draw, with the player's own entry always tracked.
  - Heats of 4, top 2 advance: 16 heats → 8 → 4 → 2 → a final of 4.
- **Fairness:** every entrant is driven by the same **house jockey** bot at its creature's ideal rhythm. It's a contest of drawings, like Horse Race Tests.
- **When it runs:** deterministically by a scheduled job. Results are stored as seeds and the bracket; clients replay the races locally.
- **Watching and betting:**
  - Featured heats play on a schedule.
  - A **10-second prediction window** opens before each one. Bets use pretend points only, with no real money ever.
  - A streak counts correct picks.
- **Daily share:** an emoji strip, e.g. `Squiggle Cup Day 41 🐾🐾🌑🏆 #12`.

### 11.5 Graft (M3+, a mode that lives in X threads)
- **How it works:** a post contains a creature link. Each reply link adds **exactly one stroke** to it (length-capped), runs a test race, and produces a new link to post as a reply.
- **Branches:** each branch is a family line. The best-scoring version shows in a "Graft tree" view.
- **Server:** none needed. The whole stroke history lives in the link.

### 11.6 Tug Day (M1 against bots, M2 in rooms)
See section 5.5.

---

## 12. Multiplayer and netcode
- **Model:** deterministic lockstep at 60 ticks per second.
  - Drawings are sent **once** when the race starts (a few hundred bytes each).
  - After that, only inputs travel: `{tick, playerSlot, type: tap|press|release}`.
- **Input delay:** 3 ticks (50 ms) by default, adjusting between 2 and 6 based on measured round-trip time.
- **Hiding the delay:** local feedback (sound, ring, squash) fires on the press itself.
- **Rollback (later):** if playtests say shoving feels laggy at about 100 ms, switch to rollback, where each machine predicts and then corrects. Rapier can save and restore whole physics states (`world.takeSnapshot()` / `restoreSnapshot`), and a world with 6 small creatures is cheap to restore.
- **Server role:** one Cloudflare **Durable Object per room**. It:
  - relays inputs and assigns slots
  - keeps the official input record
  - re-runs the race at the end to confirm the result
  - uses the WebSocket mode that doesn't bill idle connections
- **Messages:** `join`, `hello{slot}`, `drawing{bytes}`, `ready`, `start{seed, startTick, venue}`, `input{tick,type}`, `inputs{tick, [..]}` (sent by the server each tick), `end{results}`, `rematch`.
- **Disconnects:** a dropped player's creature continues as a ghost bot driven by the house jockey. They can reconnect within the race.
- **Desync detection:** every 60 ticks, clients send a hash of all body positions. If they differ, the room is flagged and the server's version wins. This should never happen with the deterministic build.

---

## 13. Leaderboards, ratings, fairness
- **Checked scores:** a submitted run = drawing bytes + venue + seed + input events + claimed time.
  - A Worker re-runs it headlessly with the same Rapier WASM build and accepts it only if the time matches to the tick.
  - Confirm the CPU time against Workers limits during M3.
- **Boards:**
  - **Per venue, all time:** best verified time, one entry per player.
  - **Daily:** per venue, resetting at 00:00 UTC.
  - **Category boards (daily):** fastest one-legged, fastest legless, most buildings flattened, longest airtime, most flips while still finishing. Lots of players get to be #1 at something.
  - **Season rating** (ranked).
  - **Daily Cup:** champion, plus a prediction streak board.
- **Equal conditions:** same ink, same timer, same seed per race, drawings revealed at the same time.
- **Replays:** any leaderboard entry can be watched or raced as a ghost.

---

## 14. Virality and sharing (X-first)

### 14.1 Principles
1. **Every share is a dare:** a "Beat {name} →" link that opens in **X's built-in browser** and plays in one tap. No sign-up, no install, no pop-ups. Playable in under 3 s.
2. **Post native media and put the link in the first reply.** X shows the attached media instead of a link preview, and posts with outside links are widely reported to get less reach.
3. **Clips work muted:** the first frame explains itself, colours are bold, and text is big and burned in.
4. **Bad drawings are the stars:** present them beautifully; never "fix" them.
5. **No AI-generated art** anywhere in the product or the marketing.

### 14.2 What players can share (all made on their device; no server cost)
- **Result card:**
  - 1200×630 (link previews) and 1080×1350 (Instagram)
  - the creature drawn large in the venue's style, rosette, placing, time, venue, award, name
  - a handprint watermark and a short URL
- **Replay clip:** 9:16, 6–12 s, rendered **from the deterministic replay** (not a screen recording).
  - Contents: the funniest-fail moment, the photo finish and the closing reveal (rosette, daylight, collapse).
  - Smooth camera moves, burned-in captions, made with WebCodecs plus Mediabunny.
  - Falls back to MediaRecorder where WebCodecs isn't available.
- **Daily Cup emoji strip:** text, ready to paste.
- **Dare link:** the creature plus the ghost's inputs, stored in the URL after `#`.
- **How sharing works:**
  - Phones: `navigator.share({files, text, url})`.
  - Desktop: download the file, then open an `x.com/intent/post` link with the text pre-filled. The intent link can't attach media.

### 14.3 Share-page previews (optional, M4)
- Link format: `/r/{id}`. The card image uploads to R2, and the page serves OG/Twitter meta tags pointing at it, with the verified result shown as text.

### 14.4 Launch content plan
- **Trailer (30–45 s):**
  - opens on a crude drawing coming alive (the Drawquarium emotional beat)
  - then the chaos: a circle rolling, a creature with wheels, a hot dog winning, the handler being dragged
  - ends on the line "Your drawing. Your athlete."
- **Builder story post:** "How I made it" (process, timelapse, the funniest bugs).
- **Seed content:** 20 pre-made clips, one funny race per day.
- **Venue launches:** each new venue gets its own trailer.
- **Expect the Bamzooki comparison:** reply to it warmly.

### 14.5 Built-in hooks
- Rule-breaking is intentional, and the trailer and FAQ show it: draw a circle and it rolls; draw wheels and they work.
- Every result screen leads to a share with one tap.
- A creature's page tracks: "Beaten 31 times · current king: @…".

---

## 15. Visual design and microinteractions

### 15.1 Overall direction
- **UI style:** chunky and tactile: pebble-shaped buttons, stone or card panels, thick outlines.
- **Fonts:** **Bricolage Grotesque** for headings (variable font, trimmed to the characters used); the system font for body text.
- **Colour:** each venue sets the palette of its own screens; menus use warm cream `#f4f1e6` with near-black `#1d1b2e`.
- **Logo:** the wordmark "SQUIGGLE CUP" with a small googly-eyed scribble jumping through the "Q".
- **App icon:** the scribble with googly eyes on a gold rosette. Must read at 48 px.
- **Landing page = the game:** the hero area is a drawing canvas that says "Draw something." You're drawing within 1 s. Below it: a looping 6 s clip, today's Daily Cup leader, and Play.

### 15.2 Microinteractions
- **Drawing:**
  - wet strokes have a sheen that dries in 400 ms
  - the ink meter drains
  - the knuckle dot pulses when a limb attaches
  - a wash fills in when the body closes
  - eyes blink as soon as they're recognised
  - a haptic tick per stroke on Android (iPhone browsers don't support vibration)
- **Reveal:** drawings flip over at the same moment, like cards.
- **Wake-up:** a blink, a stretch and a squash, and the venue's light flares (torch, spotlight, streetlight).
- **Race:**
  - the rhythm ring
  - squash on each tap
  - dust puffs and a small camera shake on collisions (no shake when the device asks for reduced motion)
  - speed lines when you're over 6 m/s
  - the torch flickers harder near the exit (Ochre)
- **Finish:**
  - photo finish: freeze, white flash, paint-stroke wipe, a "PHOTO" stamp
  - then confetti or rosettes, or the daylight flood (Ochre)
- **Results:** ratings count up with click sounds, and your creature gets a rosette stamp and is added to your gallery.
- **Buttons:** squash to 96% when pressed, with a small ink splat; slight warmth on hover (desktop).

---

## 16. Audio
- **Engine:** Web Audio API with one sprite file, about 150 KB; Kenney CC0 sound effects. Music is optional per venue and off by default on mobile.
- **Sounds:**
  - tap pluck (random pitch)
  - on-beat drum, off-beat thud
  - leap whoosh, landing thump
  - flip boing
  - elimination fade
  - crowd gasp (Best in Show), crumble (STOMP), cave reverb (Ochre), rain (Fog), brass band (Tug)
  - finish fanfare, photo-finish camera shutter
- **Settings:** separate sound and music volumes; mute is remembered.

---

## 17. Screens and user flows
1. **Landing / title:** canvas hero, Play, Daily Cup, Rooms, gallery, settings.
2. **Venue select:** five cards (title, tagline, a looping preview).
3. **Draw:** the pad, ink meter, pens, timer, status chip, Done.
4. **Reveal and wake-up:** about 2 s.
5. **Race:** countdown, the race itself, a position bar with creature icons, the commentary ticker, a tap zone. Spectate once you're done.
6. **Results:** podium, comparison, fail replay, awards, scorecards, actions.
7. **Share sheet:** card, clip, dare link, emoji strip.
8. **Dare landing (from a link):**
   - a banner: "{name} challenges you in {venue}"
   - then: draw (or use your last creature), and race against their ghost
9. **Rooms:** create or join, the lobby (players, venue, settings), then shared draw, race and results, and Rematch.
10. **Daily Cup:** enter, the bracket view, the watch-and-bet screen, results, streak.
11. **Gallery:** a grid of your creatures, each with its records, replays and a share button.
12. **Settings:** sound, music, reduced motion, silhouette mode, name, language (English at launch).

---

## 18. Technical architecture (free stack)

### 18.1 Client
| Layer | Choice | Notes |
|---|---|---|
| Language and build | TypeScript, Vite 8 | `base: './'`, ES2022 target |
| Rendering | PixiJS v8 (WebGL, with WebGPU where available) | Shaders for torch lighting, fog, grain and blur. A Canvas 2D fallback is acceptable for M0 |
| Menus and screens | Svelte 5 | Small bundle; the game canvas stays separate from the UI |
| Physics | `@dimforge/rapier2d-deterministic-compat` 0.21.0 | WASM is bundled inline in the JS; load it while the player draws |
| Strokes | `perfect-freehand` 1.2.3 | For the look only; physics uses the simplified points |
| Audio | Web Audio API | No library |
| Video | WebCodecs + Mediabunny (or mp4-muxer) | Replays rendered offline at any size |
| Storage | `localStorage` / IndexedDB, wrapped in try/catch | Gallery, settings and the device ID. X's built-in browser keeps storage separate, so the game must work with empty storage |

**Module layout:**
- `geom` (point maths), `rng` (seeded random), `analyze` (reading the drawing), `creature` (physics creature)
- `venues/*` (course, rules and voice for each venue), `race` (the simulation), `bots`
- `comedy` (names, commentary, awards, judges), `render/*` (per-venue renderers), `audio`
- `share` (cards, clips), `encode` (link and replay bytes), `net` (rooms), `ui/*` (Svelte)

**The simulation never touches the browser page (DOM)**, so the same code runs headless in Workers and in tests.

### 18.2 Backend (Cloudflare free tiers; check current limits before launch)
| Need | Service |
|---|---|
| Static hosting | Cloudflare Pages (`*.pages.dev` until there's a domain). Static traffic is unmetered |
| API | Workers: score submission, leaderboards, cup, bets, reports |
| Live rooms and matchmaking | Durable Objects (SQLite-backed; on the free plan since 2025), using the WebSocket mode that doesn't bill idle connections |
| Database | D1 (SQLite) |
| Files | R2 (no download fees): replays, cup results JSON, share cards, thumbnails |
| Scheduled jobs | Workers Cron Triggers: Daily Cup at 00:00 UTC, season rollover |
| Analytics | Cloudflare Web Analytics (free, no cookies) |
| Errors | Sentry free developer plan |

### 18.3 Design so going viral costs nothing
- **Free path:** opening a dare link, playing and sharing use only static files plus data in the URL. No Worker requests.
- **Server path:** only optional extras touch Workers or Durable Objects: score submission, the cup, rooms and bets.
- **If a free limit is hit:** leaderboards show "updating soon", rooms fall back to ghost races, and solo play is unaffected.

---

## 19. Data model and API

### 19.1 D1 tables
```sql
players(id TEXT PK, name TEXT, created INT, flags INT)                 -- anonymous device id
creatures(id TEXT PK, player_id TEXT, venue TEXT, drawing BLOB, name TEXT,
          created INT, reports INT DEFAULT 0, hidden INT DEFAULT 0)
runs(id TEXT PK, creature_id TEXT, player_id TEXT, venue TEXT, seed INT,
     inputs BLOB, time_ms INT, verified INT, day TEXT, created INT,
     legs INT, smashed INT, airtime_ms INT, flips INT)                  -- category boards read these columns
cup_entries(day TEXT, creature_id TEXT, player_id TEXT, PRIMARY KEY(day, player_id))
cup_results(day TEXT PK, venue TEXT, r2_key TEXT)                       -- bracket stored in R2
bets(day TEXT, player_id TEXT, heat TEXT, pick TEXT, stake INT, PRIMARY KEY(day, player_id, heat))
ratings(player_id TEXT, season TEXT, mu REAL, sigma REAL, games INT, PRIMARY KEY(player_id, season))
reports(id TEXT PK, creature_id TEXT, reporter TEXT, reason TEXT, created INT)
```

### 19.2 HTTP and WebSocket endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/runs` | Submit a run (drawing, venue, seed, inputs, claimed time). The server re-runs and stores it |
| GET | `/api/leaderboard?venue=&board=&day=&page=` | Leaderboards |
| GET | `/api/ghosts?venue=&rating=` | Ghost opponents for Quick Race and matchmaking |
| POST | `/api/cup/enter` | Enter today's Daily Cup |
| GET | `/api/cup/:day` | Bracket plus seeds (clients replay locally) |
| POST | `/api/bets` | Place a pretend-points bet within the window |
| POST | `/api/report` | Report a creature |
| WS | `/room/:code` | Room Durable Object (section 12) |
| WS | `/match?mode=ranked&venue=` | Matchmaker Durable Object |

**Rate limits:** submissions are limited per device ID and per IP. Payloads are capped (drawing ≤ 4 KB, inputs ≤ 8 KB).

---

## 20. Performance, responsiveness, PWA, accessibility

### 20.1 Speed budgets
| Item | Target |
|---|---|
| First load (HTML, CSS, core JS) | ≤ 120 KB gzipped |
| Canvas ready to draw | under 1 s on a mid-range Android over 4G |
| Physics, renderer, audio, venue art | lazy-loaded during the draw phase |
| Art per venue | ≤ 300 KB (AVIF/WebP) |
| Frame rate | 60 fps on a 2020 mid-range Android with 6 creatures; physics at 60 steps per second, with smoothing for 120 Hz screens |
| Lighthouse (landing page) | Performance ≥ 95, Accessibility ≥ 95 |

### 20.2 Screen sizes
- **Portrait phone first** (360–430 px wide). Landscape on phones is supported.
- **Camera:**
  - Shows about 9 m of course in portrait and 16 m in landscape or on desktop.
  - Sits ahead of the player's creature so you can see what's coming.
  - Follows the leader once the player is done.
- **Tablet and desktop:** a bigger view of the course, with standings in a side panel.
- **Safe areas:** use `env(safe-area-inset-*)` for notches; set `touch-action: none` on the pad and race area so the page doesn't scroll or zoom.
- **Input:** Pointer Events handle mouse, touch and pen; no hover-only actions.

### 20.3 PWA (installable web app)
- Manifest, icons (192/512 px plus maskable), a dark-cream theme colour.
- Service worker (vite-plugin-pwa or a hand-written one):
  - pre-cache the app shell
  - fetch HTML network-first so new versions arrive
- **Offline:** Quick Race against cached ghosts, and the gallery. Ranked, rooms and the cup need a connection.
- **Install prompt:** shown after the 2nd completed race, never the first. iPhone users get an "Add to Home Screen" hint instead.
- **X's built-in browser:** must work there with no install, no pop-ups and storage that may be empty.

### 20.4 Accessibility
- **Reduced motion:** respect the device setting (no camera shake, gentler flashes).
- **Colour blindness:** each player has a stencil handprint marker as well as a colour.
- **Readable text:** captions and commentary are large and high-contrast.
- **One-button play:** only tap and hold, so it's playable with a single switch input.
- **Sound:** separate sound and music volumes.

---

## 21. Moderation and safety
- **Expect rude drawings.** Rely on design and reports, not a classifier.
- **Reports:** creatures shown publicly (gallery, leaderboards, cup) are hidden after N reports, scaled by audience.
- **Human review:** the daily top 100 and every cup finalist are reviewed by a person before being featured.
- **Silhouette mode:** shows other players' creatures as plain filled shapes in the player's ink colour. On by default for players who say they're under 13, and in streamer mode.
- **Names:** profanity filter, 24-character limit.
- **Betting:** pretend points only. No real money, no purchasable points, ever.
- **Data:** an anonymous device ID; no personal data collected; a privacy page explains what's stored.

---

## 22. Analytics and success metrics
**Events:** `land`, `draw_start`, `draw_done`, `race_start`, `race_end`, `rematch`, `share_open`, `share_done{type}`, `dare_open`, `dare_play`, `install`, `room_create`, `room_join`, `cup_enter`, `bet`.

| Metric | Target (my estimates, adjust after launch) |
|---|---|
| Time from opening to first race | < 30 s (median) |
| Rematch rate | > 40% of finished races |
| Share rate | > 8% of finished races |
| Dare link open → play | > 50% |
| Day-1 / Day-7 return | > 25% / > 8% |
| Daily Cup entries | > 10% of daily players |
| Playtest laugh test (M0) | ≥ 3 of 5 strangers laugh out loud within 30 s |

---

## 23. Testing plan
- **Determinism:**
  - The same drawing, seed and inputs must give an identical hash of all final body positions on Chrome, Firefox, Safari, Android Chrome and iOS Safari, and in the headless Worker.
  - Run in CI on every physics change.
- **Physics fuzz:**
  - Generate 1,000 random creatures (blobs, sticks, scribbles, circles, no limbs, 12 limbs) and race them with the bot pilot.
  - Check: no creature averages over 9 m/s, there are no NaNs, and nobody stays stuck forever (the nudge works).
  - Watch for sliding or vibrating creatures winning.
- **Balance:** win rate by number of legs, body size and ink use, per venue. No single shape should win more than about 35% of races in the shared field.
- **Netcode:** simulated 50/150/300 ms delay and 2% packet loss, plus reconnect tests.
- **Devices:** a low-end Android, an iPhone in Safari, and X's built-in browser on both, tested by tapping real links.
- **Playtests:** the laugh test at every milestone; record sessions and note where people laugh and where they get confused.

---

## 24. Milestones
| Milestone | What gets built | What has to be true to continue |
|---|---|---|
| **M0: core proof** | Draw pad with live feedback, analysis, physics creature, tap and leap, Best in Show course (no handler yet), race 1–3 ghosts, basic results, dare link (URL after `#`), Canvas 2D rendering allowed | 3 of 5 strangers laugh within 30 s and press rematch. Ugly creatures are fun to race. No sliding exploit wins |
| **M1: five venues** | All 5 venues with their rules and visual style, the handler and leash, bots, all comedy features, awards, judges, result card, venue select, PixiJS renderer | Every venue is readable and fun on a phone; determinism matches across browsers |
| **M2: rooms** | Durable Object rooms with 2–6 players, lockstep netcode, spirits in Ochre and Fog, Tug Day 2v2 online | Shoving feels fair at about 100 ms |
| **M3: competition** | Checked leaderboards, category boards, ranked play with matchmaking and ghost fill, Daily Cup with betting, Graft | Day-2 retention; the cup runs reliably every day |
| **M4: launch** | Replay clip rendering, PWA, polish pass, logo, icon, share-page previews, trailer, launch on X, r/WebGames, itch.io and web portals (e.g. Poki) | Share rate, D1/D7 return, dare-link conversion |
| **Later** | Notebook venue, a new venue each month, cosmetic-only extras (inks, rosettes, gallery frames) | |

---

## 25. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Physics exploits (sliding, vibrating, flinging) | Progress counts only on the ground; motor torque capped by weight; leap capped with cooldown; fuzz tests; server speed sanity check |
| Some drawings can't move at all | Spoke-style motors make almost any limb produce motion; legless bodies still roll or wobble forward; handler nudges; the "Unbothered" award turns failure into a joke |
| Too many creatures to read | At most 6 per race; your creature is highlighted; the others are drawn slightly transparent |
| Crowded genre (Doodle Smash, Scrawlcraft, Kiln, Drawquarium) | Stand out through venues, deadpan comedy, playable dare links and the Daily Cup. Lead with the 5-second clip that shows shape is physics |
| Dark venues look muddy in feeds | Share clips end on bright frames (daylight, rosettes); Best in Show and STOMP lead the marketing |
| Free-tier limits during a spike | The viral path is static only; server features degrade gracefully |
| Rude drawings | Reports, human review of featured entries, silhouette mode |
| Netcode lag makes shoving feel unfair | Instant local feedback; adjustable input delay; rollback if needed |
| Determinism breaks across browsers | Deterministic Rapier build, no browser-dependent maths in the simulation, cross-browser CI hash test |
| Comparison to Bamzooki and existing games | Welcome it in replies; the playable link answers it |

---

## 26. Open questions and later experiments
- **Final name:** "Squiggle Cup" is a placeholder; check trademarks and domains.
- **Limb repaint between sections** (inspired by Scribble Rider and Draw Climber): a 5 s break at checkpoints to redraw limbs with leftover ink. Test after M1 against a version without it, because it may add too much to think about.
- **Machine-learned gaits:** an optimiser that tunes each creature's gait during a "warm-up". Only if spoke motion feels flat in playtests.
- **Animating the body as well as the limbs** (in the style of Meta's Animated Drawings, a mesh that bends) so it doesn't just ride the limbs: render-only, later.
- **Languages:** English at launch; Japanese and Korean are strong candidates given where this genre is popular.
- **Monetisation:** cosmetic only, or none. Decide after M4 based on traffic.

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
