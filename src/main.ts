import './style.css';
import { type Anatomy, type Stroke, analyze } from './analyze';
import { isMuted, setMuted, sfx, unlock } from './audio';
import { RIVAL_KINDS, rivalDrawing } from './bots';
import { Commentator, PLACINGS, awards, fact, formalName } from './comedy';
import { DT, KINDS } from './creature';
import { type Dare, decode, encode } from './encode';
import { thumb } from './ink';
import { Pad, type PadResult } from './pad';
import { type Entry, Race, type Racer } from './race';
import { Renderer } from './render';
import { mulberry32, pick } from './rng';
import { ochre } from './venues/ochre';

// Flow: paint on the cave wall → it wakes → the race runs itself → results →
// race again / paint another / dare a friend.

const venue = ochre;
const app = document.getElementById('app')!;

interface Me { strokes: Stroke[]; anatomy: Anatomy; name: string }
let me: Me | null = null;
const dare: (Dare & { anatomy: Anatomy }) | null = readDare();

const store = {
  get<T>(k: string): T | null { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked */ } },
};

function readDare() {
  const m = /[#&]d=([A-Za-z0-9_-]+)/.exec(location.hash);
  const d = m ? decode(m[1]) : null;
  const anatomy = d ? analyze(unpack(d.strokes)) : null;
  return d && anatomy ? { ...d, anatomy } : null;
}

const unpack = (strokes: Dare['strokes']): Stroke[] =>
  strokes.map((s) => ({ pts: s.pts, color: venue.inks[s.ink] ?? venue.inks[0], w: s.thick ? 16 : 9 }));
const pack = (strokes: Stroke[]): Dare['strokes'] =>
  strokes.map((s) => ({ pts: s.pts, ink: Math.max(0, venue.inks.indexOf(s.color)), thick: s.w > 12 }));
// Race with the strokes exactly as a dare link carries them.
const canonical = (strokes: Stroke[]) => unpack(decode(encode({ venue: venue.index, seed: 0, name: '', strokes: pack(strokes) }))!.strokes);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function screen(cls: string, html = ''): HTMLElement {
  app.replaceChildren();
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  app.appendChild(el);
  return el;
}

const header = () => `<header class="brand">
  <div class="logo"><span class="kicker">Squiggle Cup · Venue</span><span class="title">Ochre</span></div>
  <button class="mute" aria-label="Sound">${isMuted() ? '🔇' : '🔊'}</button>
</header>`;

function wireMute(el: HTMLElement) {
  const b = el.querySelector<HTMLButtonElement>('.mute');
  b?.addEventListener('click', () => { unlock(); setMuted(!isMuted()); b.textContent = isMuted() ? '🔇' : '🔊'; });
}

// ---------- Paint ----------

function drawScreen(initial: Stroke[] = [], name = '') {
  const el = screen('draw', `${header()}
    ${dare ? `<div class="dare-banner"><b>${esc(dare.name)}</b> dares you. Paint a creature to race it.</div>` : '<p class="lede">Paint a creature on the cave wall. When night comes, it runs for the light.</p>'}`);
  wireMute(el);
  const pad = new Pad(venue, (r: PadResult) => {
    pad.destroy();
    const strokes = canonical(r.strokes);
    const anatomy = analyze(strokes) ?? r.anatomy;
    const name = r.name || formalName(anatomy, Math.random);
    store.set('sc:last', { strokes, name });
    me = { strokes, anatomy, name };
    race(dare ? dare.seed : (Math.random() * 2 ** 32) >>> 0);
  }, initial, name);
  pad.mount(el);
}

// ---------- Race ----------

function field(seed: number): Entry[] {
  const rng = mulberry32(seed ^ 0x51ab);
  const entries: Entry[] = [{ anatomy: me!.anatomy, name: me!.name, kind: 'player' }];
  if (dare) entries.push({ anatomy: dare.anatomy, name: dare.name, kind: 'rival' });
  const kinds = RIVAL_KINDS.slice();
  while (entries.length < 5) {
    const kind = kinds.splice(Math.floor(rng() * kinds.length), 1)[0] ?? pick(rng, RIVAL_KINDS);
    const a = analyze(rivalDrawing(rng, venue.inks, kind));
    if (a) entries.push({ anatomy: a, name: formalName(a, rng), kind: 'rival' });
  }
  return entries;
}

function race(seed: number) {
  const r = new Race(venue, field(seed), seed);
  const commentator = new Commentator(r, mulberry32(seed));
  const el = screen('race', `
    <canvas class="stage"></canvas>
    <div class="hud">
      <div class="track">${r.racers.map((c) => `<i class="dot${c.isPlayer ? ' me' : ''}"></i>`).join('')}</div>
      <div class="clock">0.0</div>
      <button class="mute" aria-label="Sound">${isMuted() ? '🔇' : '🔊'}</button>
    </div>
    <div class="count"></div>
    <div class="ticker" aria-live="polite"></div>`);
  wireMute(el);
  const canvas = el.querySelector<HTMLCanvasElement>('.stage')!;
  const view = new Renderer(canvas, r);
  const dots = [...el.querySelectorAll<HTMLElement>('.dot')];
  const clock = el.querySelector<HTMLElement>('.clock')!;
  const count = el.querySelector<HTMLElement>('.count')!;
  const ticker = el.querySelector<HTMLElement>('.ticker')!;

  let acc = 0, last = performance.now(), overAt = 0, lastLine = '';
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt * (r.playerRacer?.done ? 2 : 1);
    while (acc >= DT && !r.over) { r.step(); acc -= DT; }
    const events = r.events.splice(0);
    for (const e of events) {
      view.event(e);
      if (e.type === 'finish' && (e.value === 1 || e.who === r.player)) sfx.fanfare();
      if (e.type === 'photo') sfx.shutter();
      if (e.type === 'fall' && e.who === r.player) sfx.boing();
    }
    commentator.feed(events);
    const line = commentator.next(r.time);
    if (line && line !== lastLine) {
      lastLine = line;
      ticker.textContent = line;
      ticker.classList.remove('in'); void ticker.offsetWidth; ticker.classList.add('in');
    }
    const t = r.time;
    count.textContent = t < -2 ? 'Night falls…' : t < -0.8 ? 'The paint stirs…' : t < 0.8 ? 'Run!' : '';
    count.classList.toggle('go', t >= -0.8 && t < 0.8);
    clock.textContent = Math.max(0, r.playerRacer?.finishTime ?? t).toFixed(1);
    r.racers.forEach((c, i) => { dots[i].style.left = `${Math.max(0, Math.min(1, c.x / r.course.finish)) * 100}%`; });
    const mine = r.playerRacer;
    view.daylight = mine?.done ? Math.min(1, (t - mine.finishTime!) / 1.6) : 0;
    view.draw(now, dt);
    if (r.over) {
      overAt ||= now;
      if (now - overAt > 1500) { results(r, seed); return; }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------- Results ----------

function results(r: Race, seed: number) {
  const player = me!;
  const order = r.standings();
  const mine = r.playerRacer!;
  const place = order.indexOf(mine);
  const winner = order[0];
  const prizes = awards(r);
  const timeOf = (c: Racer) => (c.finishTime !== null ? `${c.finishTime.toFixed(1)} s` : `${Math.max(0, c.x).toFixed(0)} m`);
  const strokesOf = (c: Racer): Stroke[] => (c.isPlayer ? player.strokes : c.anatomy.parts.map((p) => ({ pts: p.pts, color: p.color, w: p.w })));
  const k = KINDS[mine.anatomy.kind];
  const el = screen('results', `${header()}
    <section class="dawn">
      <div class="th-wrap"></div>
      <div class="dawn-copy">
        <p class="kicker">${PLACINGS[place]} into the light</p>
        <h1>${mine.finishTime !== null ? mine.finishTime.toFixed(1) + '<small>s</small>' : timeOf(mine)}</h1>
        <p class="who">${esc(player.name)} · ${k.icon} ${k.label}</p>
      </div>
    </section>
    <p class="fact">${esc(fact(mine, winner))}</p>
    <section class="standings">
      ${order.map((c, i) => `<div class="row${c === mine ? ' me' : ''}">
        <span class="pos">${i + 1}</span><span class="mini" data-i="${c.idx}"></span>
        <span class="who"><b>${esc(c.name)}${c === mine ? ' <em>you</em>' : ''}</b><small>${KINDS[c.anatomy.kind].icon} ${KINDS[c.anatomy.kind].label} · ${prizes.get(c.idx)!.title}</small></span>
        <span class="time">${timeOf(c)}</span></div>`).join('')}
    </section>
    <div class="actions">
      <button class="pebble primary again">Race again</button>
      <button class="pebble ghost repaint">Paint another</button>
      <button class="pebble ghost dare">Dare a friend</button>
    </div>
    <p class="toast" role="status"></p>`);
  wireMute(el);
  el.querySelector('.th-wrap')!.appendChild(thumb(player.strokes, player.anatomy, 132));
  el.querySelectorAll<HTMLElement>('.mini').forEach((m) => {
    const c = r.racers[Number(m.dataset.i)];
    m.appendChild(thumb(strokesOf(c), c.anatomy, 46));
  });
  if (place === 0) sfx.fanfare();

  const link = `${location.origin}${location.pathname}#d=${encode({ venue: venue.index, seed, name: player.name, strokes: pack(player.strokes) })}`;
  const toast = el.querySelector<HTMLElement>('.toast')!;
  el.querySelector('.again')!.addEventListener('click', () => { sfx.click(); race(dare ? dare.seed : (Math.random() * 2 ** 32) >>> 0); });
  el.querySelector('.repaint')!.addEventListener('click', () => { sfx.click(); drawScreen(player.strokes, player.name); });
  el.querySelector('.dare')!.addEventListener('click', async () => {
    sfx.click();
    const text = `${player.name} came ${PLACINGS[place]} racing out of the cave. Paint something faster →`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text, url: link }); return; }
      await navigator.clipboard.writeText(link);
      toast.textContent = 'Dare link copied.';
    } catch {
      toast.innerHTML = `<input readonly value="${esc(link)}" onclick="this.select()">`;
    }
  });
}

// ?demo=race&kind=biped: a creature of that kind races a mixed field (for screenshots).
const params = new URLSearchParams(location.search);
if (params.get('demo')) {
  const kind = (params.get('kind') ?? 'quadruped') as Anatomy['kind'];
  const strokes = canonical(rivalDrawing(mulberry32(5), venue.inks, kind));
  const anatomy = analyze(strokes)!;
  me = { strokes, anatomy, name: formalName(anatomy, mulberry32(3)) };
  race(1234);
} else drawScreen();
