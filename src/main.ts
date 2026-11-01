import './style.css';
import { type Anatomy, type Stroke, analyze } from './analyze';
import { isMuted, setMuted, sfx, unlock } from './audio';
import { botDrawing } from './bots';
import { Commentator, PLACINGS, awards, fact, formalName, judges } from './comedy';
import { DT } from './creature';
import { type Dare, decode, encode } from './encode';
import { thumb } from './ink';
import { Pad, type PadResult } from './pad';
import { type Entry, Race, loadPhysics } from './race';
import { Renderer, markerColor } from './render';
import { mulberry32 } from './rng';
import { bestInShow } from './venues/bestInShow';

// M0 flow: draw → wake-up and countdown → race → results → rematch / redraw / dare.

const venue = bestInShow;
const app = document.getElementById('app')!;
void loadPhysics(); // the WASM loads while the player draws (PRD §2 rule 4)

interface Me { strokes: Stroke[]; anatomy: Anatomy; name: string }
let me: Me | null = null;
let dare: (Dare & { anatomy: Anatomy }) | null = readDare();

const store = {
  get<T>(k: string): T | null { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* X's in-app browser may block storage */ } },
};

function readDare() {
  const m = /[#&]d=([A-Za-z0-9_-]+)/.exec(location.hash);
  const d = m ? decode(m[1]) : null;
  if (!d) return null;
  const anatomy = analyze(unpack(d.strokes));
  return anatomy ? { ...d, anatomy } : null;
}

const unpack = (strokes: Dare['strokes']): Stroke[] =>
  strokes.map((s) => ({ pts: s.pts, color: venue.inks[s.ink] ?? venue.inks[0], w: s.thick ? 14 : 7 }));
const pack = (strokes: Stroke[]): Dare['strokes'] =>
  strokes.map((s) => ({ pts: s.pts, ink: Math.max(0, venue.inks.indexOf(s.color)), thick: s.w > 10 }));

// Race with the strokes as a dare link would carry them, so a ghost made from
// your link moves exactly like the creature you raced.
function canonical(strokes: Stroke[]): Stroke[] {
  return unpack(decode(encode({ venue: venue.index, seed: 0, name: '', strokes: pack(strokes), inputs: [] }))!.strokes);
}

function screen(cls: string, html = ''): HTMLElement {
  app.replaceChildren();
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  app.appendChild(el);
  return el;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function header() {
  return `<header class="brand">
    <div class="logo">S<span class="q">Q<i class="scribble"></i></span>UIGGLE CUP</div>
    <button class="mute" aria-label="Sound">${isMuted() ? '🔇' : '🔊'}</button>
  </header>`;
}

function wireMute(el: HTMLElement) {
  const b = el.querySelector<HTMLButtonElement>('.mute');
  b?.addEventListener('click', () => { unlock(); setMuted(!isMuted()); b.textContent = isMuted() ? '🔇' : '🔊'; });
}

// ---------- Draw ----------

function drawScreen(initial: Stroke[] = [], name = '') {
  const el = screen('draw', `${header()}
    <div class="venue-line"><span class="venue-name">${venue.name}</span><span class="tagline">${venue.tagline}</span></div>
    ${dare ? `<div class="dare-banner">🐾 <b>${esc(dare.name)}</b> challenges you in ${venue.name}. Draw a challenger to race their ghost.</div>` : ''}`);
  wireMute(el);
  const last = store.get<Me>('sc:last');
  const lastAnatomy = last?.strokes ? analyze(last.strokes) : null;
  if (!initial.length && last && lastAnatomy && dare) {
    const b = document.createElement('button');
    b.className = 'pebble small reuse';
    b.textContent = `Use ${last.name || 'my last creature'}`;
    b.addEventListener('click', () => { pad.destroy(); start({ ...last, anatomy: lastAnatomy }); });
    el.querySelector('.dare-banner')!.appendChild(b);
  }
  const pad = new Pad(venue, (r: PadResult) => {
    pad.destroy();
    const strokes = canonical(r.strokes);
    const anatomy = analyze(strokes) ?? r.anatomy;
    const name = r.name || formalName(anatomy, Math.random);
    store.set('sc:last', { strokes, name });
    start({ strokes, anatomy, name });
  }, initial, name);
  pad.mount(el);
}

function start(creature: Me) {
  me = creature;
  void race(dare ? dare.seed : (Math.random() * 2 ** 32) >>> 0);
}

// ---------- Race ----------

async function race(seed: number) {
  await loadPhysics();
  const player = me!;
  const rng = mulberry32(seed ^ 0x51ab);
  const entries: Entry[] = [{ anatomy: player.anatomy, name: player.name, kind: 'player' }];
  if (dare) entries.push({ anatomy: dare.anatomy, name: dare.name, kind: 'ghost', inputs: dare.inputs });
  while (entries.length < 4) {
    const a = analyze(botDrawing(rng, venue.inks));
    if (a) entries.push({ anatomy: a, name: formalName(a, rng), kind: 'bot' });
  }
  const r = new Race(venue, entries, seed);
  const commentator = new Commentator(r, mulberry32(seed));

  const el = screen('race', `
    <canvas class="stage"></canvas>
    <div class="hud">
      <div class="track">${r.creatures.map((c) => `<i class="dot${c.isPlayer ? ' me' : ''}${c.ghost ? ' ghost' : ''}" style="--c:${markerColor(c.idx)}"></i>`).join('')}</div>
      <div class="clock">0.00</div>
      <button class="mute" aria-label="Sound">${isMuted() ? '🔇' : '🔊'}</button>
    </div>
    <div class="count"></div>
    <div class="hint">Tap to stride · hold &amp; release to leap</div>
    <div class="ticker" aria-live="polite"></div>
    <div class="flash"></div>`);
  wireMute(el);
  const canvas = el.querySelector<HTMLCanvasElement>('.stage')!;
  const view = new Renderer(canvas, r);
  const dots = [...el.querySelectorAll<HTMLElement>('.dot')];
  const clock = el.querySelector<HTMLElement>('.clock')!;
  const count = el.querySelector<HTMLElement>('.count')!;
  const hint = el.querySelector<HTMLElement>('.hint')!;
  const ticker = el.querySelector<HTMLElement>('.ticker')!;
  const flash = el.querySelector<HTMLElement>('.flash')!;
  const firstRace = !store.get<number>('sc:races');

  // Input: anywhere on the stage (PRD §8). Feedback fires on the press itself.
  let held = false, lastTap = 0, tapped = false;
  const press = () => {
    unlock();
    if (held || !r.started || r.over) return;
    held = true; tapped = true;
    const c = r.playerCreature!;
    if (c.done) return;
    r.input(r.player, 'press');
    const now = performance.now() / 1000, gap = now - lastTap;
    lastTap = now;
    (Math.abs(gap * c.idealRate - 1) < 0.22 ? sfx.drum : gap > 1.5 ? sfx.pluck : sfx.thud)();
    view.tapFx(c);
  };
  const release = () => {
    if (!held) return;
    held = false;
    r.input(r.player, 'release');
  };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  const key = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (e.type === 'keydown' && !e.repeat) press();
    if (e.type === 'keyup') release();
  };
  addEventListener('keydown', key);
  addEventListener('keyup', key);

  // ?demo=race autopilots you (for screenshots and playtest recordings); ?demo=results skips to the end.
  const autopilot = (tick: number) => {
    if (tick % 90 === 0) r.input(r.player, 'press');
    else if (tick % 90 === 30) r.input(r.player, 'release');
    else if (tick % 90 > 30 && tick % 15 === 0) { r.input(r.player, 'press'); r.input(r.player, 'release'); }
  };
  if (demo === 'results') {
    while (!r.over) { autopilot(r.tick); r.step(); }
    r.events.length = 0;
  }

  let acc = 0, last = performance.now(), overAt = 0, lastLine = '';
  sfx.gasp();
  await new Promise<void>((done) => {
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const fast = r.playerCreature?.done ? 3 : 1;
      acc += dt * fast;
      while (acc >= DT && !r.over) {
        if (demo) autopilot(r.tick);
        r.step();
        acc -= DT;
      }
      const events = r.events.splice(0);
      for (const e of events) {
        view.event(e);
        const mine = e.who === r.player;
        if (e.type === 'leap' && mine) sfx.whoosh();
        if (e.type === 'land' && mine && (e.value ?? 0) > 0.4) sfx.land();
        if (e.type === 'flip' && (mine || Math.random() < 0.3)) sfx.boing();
        if (e.type === 'finish' && (e.value === 1 || mine)) sfx.fanfare();
        if (e.type === 'photo') { sfx.shutter(); flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); }
      }
      commentator.feed(events);
      const line = commentator.next(r.time);
      if (line && line !== lastLine) {
        lastLine = line;
        ticker.textContent = line;
        ticker.classList.remove('in'); void ticker.offsetWidth; ticker.classList.add('in');
      }

      const t = r.time;
      count.textContent = t < -1.5 ? 'Ready…' : t < 0 ? 'Set…' : t < 0.8 ? 'Squiggle!' : '';
      count.classList.toggle('go', t >= 0 && t < 0.8);
      hint.classList.toggle('show', !r.over && t > -1 && !(r.playerCreature?.done) && (firstRace ? t < 6 && !tapped : t > 3 && !tapped));
      clock.textContent = Math.max(0, (r.playerCreature?.finishTime ?? t)).toFixed(2);
      r.creatures.forEach((c, i) => {
        dots[i].style.left = `${Math.max(0, Math.min(1, c.pos.x / r.course.finish)) * 100}%`;
      });

      view.draw(now, dt);
      if (r.over) {
        if (!overAt) overAt = now;
        if (now - overAt > 1400) { done(); return; }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  removeEventListener('pointerup', release);
  removeEventListener('pointercancel', release);
  removeEventListener('keydown', key);
  removeEventListener('keyup', key);
  store.set('sc:races', (store.get<number>('sc:races') ?? 0) + 1);
  results(r, seed);
}

// ---------- Results ----------

function results(r: Race, seed: number) {
  const player = me!;
  const order = r.standings();
  const mine = r.playerCreature!;
  const place = order.indexOf(mine);
  const winner = order[0];
  const prizes = awards(r);
  const cards = judges(mine, r.time, mulberry32(seed ^ 0x7));
  const award = prizes.get(mine.idx)!;
  const timeOf = (c: typeof mine) => (c.finishTime !== null ? `${c.finishTime.toFixed(2)} s` : `DNF · ${Math.max(0, c.pos.x).toFixed(0)} m`);
  const strokesOf = (i: number): Stroke[] => {
    const e = r.entries[i];
    if (e.kind === 'player') return player.strokes;
    const a = e.anatomy;
    return [{ ...a.body, pts: a.body.pts }, ...a.limbs, ...a.decor];
  };
  const ghost = r.creatures.find((c) => c.ghost);
  const headline = ghost
    ? (order.indexOf(mine) < order.indexOf(ghost) ? `You beat ${esc(ghost.name)}'s ghost.` : `${esc(ghost.name)}'s ghost wins. For now.`)
    : place === 0 ? 'Champion.' : `${ordinal(place + 1)} place.`;

  const el = screen('results', `${header()}
    <div class="result-head">
      <div class="rosette big" style="--c:${['#d9a441', '#2a6fdb', '#c8372d', '#2f9e5a'][Math.min(place, 3)]}"><span>${place + 1}</span></div>
      <div>
        <h1>${headline}</h1>
        <p class="rosette-text">“${esc(player.name)} — ${PLACINGS[place]}, ${award.title}.”</p>
      </div>
    </div>
    <section class="compare card">
      <figure class="you"><div class="th"></div><figcaption>You · ${timeOf(mine)}</figcaption></figure>
      <div class="vs">${mine === winner ? '🏆' : 'vs'}</div>
      <figure class="winner"><div class="th"></div><figcaption>${mine === winner ? 'Nobody' : `Winner · ${timeOf(winner)}`}</figcaption></figure>
      <p class="fact">${esc(fact(r, mine, winner))}</p>
    </section>
    <section class="judges">
      <div class="scorecard"><small>Grace</small><b>${cards.grace}</b></div>
      <div class="scorecard"><small>Legs</small><b>${cards.legs}</b></div>
      <div class="scorecard"><small>Spirit</small><b>${cards.spirit}</b></div>
    </section>
    <section class="standings card">
      ${order.map((c, i) => `<div class="row${c === mine ? ' me' : ''}">
        <span class="pos">${i + 1}</span><span class="mini" data-i="${c.idx}"></span>
        <span class="who"><b>${esc(c === mine ? `${player.name} (you)` : c.ghost ? `👻 ${c.name}` : c.name)}</b><small>${prizes.get(c.idx)!.title} · ${prizes.get(c.idx)!.why}</small></span>
        <span class="time">${timeOf(c)}</span></div>`).join('')}
    </section>
    <div class="actions">
      <button class="pebble primary rematch">Rematch</button>
      <button class="pebble redraw">Redraw</button>
      <button class="pebble dare">Dare a friend</button>
    </div>
    <p class="toast" role="status"></p>`);
  wireMute(el);
  el.querySelector('.you .th')!.appendChild(thumb(player.strokes, player.anatomy, 128));
  el.querySelector('.winner .th')!.appendChild(thumb(strokesOf(winner.idx), r.entries[winner.idx].anatomy, 128));
  el.querySelectorAll<HTMLElement>('.mini').forEach((m) => {
    const i = Number(m.dataset.i);
    m.appendChild(thumb(strokesOf(i), r.entries[i].anatomy, 44));
  });
  if (place === 0) sfx.fanfare();

  const link = `${location.origin}${location.pathname}#d=${encode({ venue: venue.index, seed, name: player.name, strokes: pack(player.strokes), inputs: r.playerInputs })}`;
  r.free();
  const toast = el.querySelector<HTMLElement>('.toast')!;
  el.querySelector('.rematch')!.addEventListener('click', () => { sfx.click(); void race(dare ? dare.seed : (Math.random() * 2 ** 32) >>> 0); });
  el.querySelector('.redraw')!.addEventListener('click', () => { sfx.click(); drawScreen(player.strokes, player.name); });
  el.querySelector('.dare')!.addEventListener('click', async () => {
    sfx.click();
    const text = `${player.name} came ${ordinal(place + 1)} in ${venue.name} at Squiggle Cup. Beat ${player.name} →`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text, url: link }); return; }
      await navigator.clipboard.writeText(link);
      toast.textContent = 'Dare link copied. Paste it anywhere.';
    } catch {
      toast.innerHTML = `<input readonly value="${esc(link)}" onclick="this.select()">`;
    }
  });
}

const demo = new URLSearchParams(location.search).get('demo');
if (demo === 'race' || demo === 'results') {
  const a = analyze(botDrawing(mulberry32(5), venue.inks))!;
  const strokes = canonical(botDrawing(mulberry32(5), venue.inks));
  start({ strokes, anatomy: analyze(strokes) ?? a, name: 'Gerald' });
} else drawScreen();
