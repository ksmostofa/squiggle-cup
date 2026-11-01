import './style.css';
import { type Anatomy, type Kind, type Stroke, analyze } from './analyze';
import { isMuted, setMuted, sfx, unlock } from './audio';
import { rivalDrawing } from './bots';
import { INKS, LANES } from './course';
import { DT, KINDS } from './creature';
import { canonical, codeOf, fromCode } from './drawing';
import { thumb } from './ink';
import { board, postToBoard } from './board';
import { card, drawingPng, save } from './card';
import { type Cast, type Entrant, Room } from './net';
import { PLACINGS, fact, formalName } from './names';
import { DRAW_TIME, DRAW_TIMES, Pad, type PadResult } from './pad';
import { Race, type Racer } from './race';
import { Renderer } from './render';
import { mulberry32 } from './rng';
import { FAMILIES, FAMILY_NAMES, lineup, template } from './templates';

// Flow: home → (room lobby) → everyone draws at once → the race runs itself,
// players tap to their creature's beat → results → rematch / redraw / share.
// Races are deterministic, so a room shares only drawings and tap logs and
// every device replays the same race.

const app = document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pad2 = (n: number) => String(n).padStart(2, '0');

const store = {
  get(k: string): string { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
};

// ---------- Drawings travel as dare codes ----------

interface Contender { id: string; name: string; strokes: Stroke[]; anatomy: Anatomy; bot?: boolean }

// The house creatures fill empty lanes: four curated families dealt by the
// game's seed (src/templates.ts). A new game deals a new lineup; Rematch and
// Redraw keep it. Every device deals the same lineup from the same seed.
const houses = new Map<number, Contender[]>();
function house(seed: number): Contender[] {
  let cs = houses.get(seed);
  if (!cs) {
    const rng = mulberry32(seed ^ 0x5c0);
    cs = lineup(seed).map((t, i) => { const strokes = canonical(t.strokes); const a = analyze(strokes)!; return { id: `bot${i}`, name: formalName(a, rng), strokes, anatomy: a, bot: true }; });
    houses.set(seed, cs);
  }
  return cs;
}
const field = (people: Contender[], seed: number): Contender[] => [...people.slice(0, LANES), ...house(seed)].slice(0, LANES);
const entriesOf = (cs: Contender[], focus: string, taps?: Map<string, number[]>) =>
  cs.map((c) => ({ anatomy: c.anatomy, name: c.name, kind: c.id === focus ? 'player' as const : 'rival' as const, id: c.id, bot: c.bot, taps: taps?.get(c.id) }));

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
// This game's seed: it deals the house lineup and carries over to rematches.
let game = newSeed();

// ---------- State ----------

type Mode =
  | { kind: 'solo' }
  | { kind: 'room'; room: Room }
  | { kind: 'replay'; people: Contender[]; sharer: string };

let me: { strokes: Stroke[]; name: string } | null = null;
let room: Room | null = null;
let round = 0;
let heat = 0;
const sent = new Map<string, { code: string; name: string }>();
let drawingPad: Pad | null = null;
let hostDeadline = 0;
let drawTime = Number(store.get('sc:time')) || DRAW_TIME;
const TIME_LABELS = ['Quick', 'Normal', 'Careful'];
// Quick 20 / Normal 30 / Careful 60: the host's pick sets everyone's clock.
const timePicker = () => `<div class="seg" role="radiogroup" aria-label="Drawing time">${DRAW_TIMES.map((t, i) => `<button type="button" role="radio" aria-checked="${t === drawTime}" data-t="${t}" class="${t === drawTime ? 'on' : ''}"><b>${TIME_LABELS[i]}</b><span class="mono">${t}s</span></button>`).join('')}</div>`;
function wireTime(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => b.addEventListener('click', () => {
    drawTime = Number(b.dataset.t); store.set('sc:time', String(drawTime)); sfx.click();
    el.querySelectorAll('.seg button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
  }));
}
let started = -1;
let stopRace: (() => void) | null = null;

function screen(cls: string, html = ''): HTMLElement {
  stopRace?.(); stopRace = null;
  drawingPad?.destroy(); drawingPad = null;
  refresh = null;
  app.replaceChildren();
  const el = document.createElement('main');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  app.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  return el;
}

const masthead = (right = '') => `<header class="masthead">
  <button class="mark home-link" aria-label="Home"><img src="./logo.svg" alt="Squiggle Cup" width="130" height="35"></button>
  <span class="mono right">${right}</span>
  <button class="mono sound" aria-label="Sound">${isMuted() ? 'SOUND OFF' : 'SOUND ON'}</button>
</header>`;

function wire(el: HTMLElement) {
  const b = el.querySelector<HTMLButtonElement>('.sound');
  b?.addEventListener('click', () => { unlock(); setMuted(!isMuted()); b.textContent = isMuted() ? 'SOUND OFF' : 'SOUND ON'; });
  el.querySelector('.home-link')?.addEventListener('click', () => { leaveRoom(); location.hash = ''; home(); });
}

function leaveRoom() { room?.leave(); room = null; }

// ---------- Home ----------

function home(error = '') {
  const el = screen('home', `${masthead('NO. 01 — STRAIGHT')}
    <section class="hero">
      <h1>Draw it.<br><span>Race it.</span></h1>
      <p class="lede">Legs run. Wings flap. Blobs ooze. No luck.</p>
    </section>
    <section class="panel">
      <label class="field"><span class="mono">Your name</span><input class="pname" maxlength="22" autocomplete="nickname" placeholder="Your name" value="${esc(store.get('sc:name'))}"></label>
      ${timePicker()}
      <div class="actions">
        <button class="btn primary solo">Play solo <span aria-hidden="true">→</span></button>
        <button class="btn create">New room</button>
      </div>
      <form class="join">
        <input class="code mono" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" aria-label="Room code" value="${esc(roomInHash() ?? '')}">
        <button class="btn">Join</button>
      </form>
      <p class="error" role="alert">${esc(error)}</p>
      <button class="linkish mono to-board">Leaderboard →</button>
    </section>
    <footer class="foot mono"><span>DWG 01</span><span>NO LUCK</span><span>40 000 MM</span></footer>`);
  wire(el);
  wireTime(el);
  const nameIn = el.querySelector<HTMLInputElement>('.pname')!;
  const name = () => { const n = nameIn.value.trim().slice(0, 22); store.set('sc:name', n); return n; };
  el.querySelector('.solo')!.addEventListener('click', () => { unlock(); sfx.click(); name(); game = newSeed(); drawScreen({ kind: 'solo' }); });
  el.querySelector('.to-board')!.addEventListener('click', () => { sfx.click(); leaderboard(); });
  el.querySelector('.create')!.addEventListener('click', () => { unlock(); sfx.click(); connect(name()); });
  el.querySelector<HTMLFormElement>('.join')!.addEventListener('submit', (e) => {
    e.preventDefault(); unlock();
    const code = el.querySelector<HTMLInputElement>('.code')!.value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { el.querySelector('.error')!.textContent = 'Room codes are four letters.'; return; }
    connect(name(), code);
  });
}

const roomInHash = () => /[#&]room=([A-Za-z]{4})/.exec(location.hash)?.[1]?.toUpperCase() ?? null;

// ---------- Rooms ----------

async function connect(name: string, code?: string) {
  leaveRoom();
  try {
    room = await Room.open(name, code);
  } catch (e) {
    home((e as Error).message);
    return;
  }
  history.replaceState(null, '', `#room=${room.code}`);
  room.onCast = onCast;
  room.onPlayers = () => { refresh?.(); if (room?.isHost) hostCheck(); };
  room.onLost = () => { room = null; home('Lost the connection to the room.'); };
  lobby();
}

let refresh: (() => void) | null = null;

function lobby() {
  const r = room!;
  const el = screen('lobby', `${masthead(`ROOM ${r.code}`)}
    <section class="code-block">
      <p class="kicker mono">Room code</p>
      <div class="letters mono" aria-label="Room code ${r.code.split('').join(' ')}">${r.code.split('').map((c) => `<span>${c}</span>`).join('')}</div>
      <button class="btn ghost invite">Copy invite link</button>
    </section>
    <section class="roster">
      <p class="kicker mono">Lanes</p>
      <ol class="lanes"></ol>
      <p class="note">Empty lanes race the house.</p>
    </section>
    <div class="host-only">${timePicker()}</div>
    <div class="actions"><button class="btn primary start">Start <span aria-hidden="true">→</span></button><p class="wait mono"></p></div>
    <p class="toast" role="status"></p>`);
  wire(el);
  wireTime(el);
  const list = el.querySelector('.lanes')!;
  refresh = () => {
    list.innerHTML = Array.from({ length: LANES }, (_, i) => {
      const p = r.players[i];
      return `<li class="${p?.id === r.id ? 'me' : ''}${p ? '' : ' empty'}"><span class="bubble mono">${pad2(i + 1)}</span><span class="who">${p ? esc(p.name) : 'Bot'}</span><span class="tag mono">${p ? (p.id === r.host ? 'HOST' : p.id === r.id ? 'YOU' : '') : ''}</span></li>`;
    }).join('');
    el.querySelector<HTMLButtonElement>('.start')!.hidden = !r.isHost;
    el.querySelector<HTMLElement>('.host-only')!.hidden = !r.isHost;
    el.querySelector('.wait')!.textContent = r.isHost ? '' : 'Host starts';
  };
  refresh();
  el.querySelector('.start')!.addEventListener('click', () => { sfx.click(); r.cast({ k: 'draw', round: round + 1, time: drawTime, lineup: newSeed() }); });
  el.querySelector('.invite')!.addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#room=${r.code}`;
    try { await navigator.clipboard.writeText(link); el.querySelector('.toast')!.textContent = 'Invite link copied.'; }
    catch { el.querySelector('.toast')!.textContent = link; }
  });
}

function onCast(from: string, c: Cast) {
  const r = room;
  if (!r) return;
  if (c.k === 'draw') {
    round = c.round;
    sent.clear();
    started = -1;
    if (c.time) drawTime = c.time;
    if (c.lineup !== undefined) game = c.lineup;
    hostDeadline = performance.now() + (drawTime + 20) * 1000;
    drawScreen({ kind: 'room', room: r }, me?.strokes);
  } else if (c.k === 'drawing') {
    if (c.round !== round) return;
    sent.set(from, { code: c.code, name: c.name });
    refresh?.();
    if (r.isHost) hostCheck();
  } else if (c.k === 'race') {
    round = c.round;
    started = c.round;
    game = c.seed;
    const people = c.entrants.map((e) => { const d = fromCode(e.code); return d ? { id: e.id, name: e.name || d.name, strokes: d.strokes, anatomy: d.anatomy } : null; })
      .filter((x): x is Contender => !!x);
    runRace(field(people, c.seed), c.seed, r.id, { kind: 'room', room: r }, c.entrants);
  } else if (c.k === 'tap') {
    if (from === r.id || !live || c.round !== live.round) return;
    live.race.tap(live.ids.indexOf(from), c.tick);
  } else if (c.k === 'taps') {
    if (c.round === round) logs.set(from, c.ticks);
  } else if (c.k === 'lobby') lobby();
}

// Host: start the race once everyone has sent a drawing (or time is up).
function hostCheck() {
  const r = room;
  if (!r?.isHost || started === round || !sent.size) return;
  const all = r.players.every((p) => sent.has(p.id));
  if (!all && performance.now() < hostDeadline) return;
  const entrants: Entrant[] = r.players.filter((p) => sent.has(p.id)).map((p) => ({ id: p.id, name: sent.get(p.id)!.name || p.name, code: sent.get(p.id)!.code }));
  started = round;
  r.cast({ k: 'race', round, seed: game, entrants });
}
setInterval(() => { if (room?.isHost && sent.size && started !== round && performance.now() >= hostDeadline) hostCheck(); }, 1000);

// ---------- Draw ----------

function drawScreen(mode: Mode, initial: Stroke[] = []) {
  const inRoom = mode.kind === 'room';
  const el = screen('draw', `${masthead(inRoom ? `ROOM ${mode.room.code} · ROUND ${pad2(round)}` : mode.kind === 'replay' ? 'DARE' : 'SOLO')}
    ${inRoom ? '<ol class="who-drew mono" aria-label="Who has finished"></ol>' : ''}
    <div class="waiting" role="status"><p class="mono">SENT</p><p class="msg"></p></div>`);
  wire(el);
  const pad = new Pad((r: PadResult) => submit(mode, r, el), { initial, name: me?.name ?? store.get('sc:name'), title: inRoom ? `DWG ${pad2(round)} — DRAW NOW` : 'DWG 01 — CREATURE', time: drawTime });
  drawingPad = pad;
  pad.mount(el);
  if (inRoom) {
    const strip = el.querySelector('.who-drew')!;
    refresh = () => {
      strip.innerHTML = mode.room.players.map((p) => `<li class="${sent.has(p.id) ? 'done' : ''}${p.id === mode.room.id ? ' me' : ''}">${esc(p.name)}</li>`).join('');
      const left = mode.room.players.filter((p) => !sent.has(p.id)).length;
      el.querySelector('.waiting .msg')!.textContent = left ? `Waiting for ${left} more ${left === 1 ? 'drawing' : 'drawings'}…` : 'Starting…';
    };
    refresh();
  }
}

function submit(mode: Mode, r: PadResult, el: HTMLElement) {
  const strokes = canonical(r.strokes);
  const name = r.name || store.get('sc:name') || formalName(r.anatomy, Math.random);
  me = { strokes, name };
  if (mode.kind === 'room') {
    el.classList.add('sent');
    mode.room.cast({ k: 'drawing', round, code: codeOf(strokes, name), name });
    return;
  }
  const mine: Contender = { id: 'me', name, strokes, anatomy: analyze(strokes)! };
  if (mode.kind === 'replay') {
    runRace(field([mine, ...mode.people.slice(0, LANES - 1)], game), game, 'me', { kind: 'solo' });
  } else {
    runRace(field([mine], game), game, 'me', mode);
  }
}

// ---------- Race ----------

// The live race, so taps arriving from the room reach the right lane.
// Rhythm taps are switched off until the control is clear enough to explain
// itself; the race engine still supports them (src/race.ts).
const RHYTHM = false;
let live: { race: Race; round: number; ids: string[] } | null = null;
const logs = new Map<string, number[]>(); // finished tap logs this round, by player id

function runRace(cs: Contender[], seed: number, focus: string, mode: Mode, entrants?: Entrant[], skip = 0, taps?: Map<string, number[]>) {
  heat++;
  const race = new Race(entriesOf(cs, focus, taps), seed);
  const ids = cs.map((c) => c.id);
  const mine = race.player;
  const replaying = !!taps;
  live = { race, round, ids };
  if (mode.kind === 'room') logs.clear();
  for (let i = 0; i < skip && !race.over; i++) race.step();
  const el = screen('race', `
    <canvas class="stage" aria-label="The race"></canvas>
    <header class="titleblock">
      <div class="tb-cell"><span class="mono k">HEAT</span><span class="mono v">${pad2(heat)}</span></div>
      <div class="tb-cell clock-cell"><span class="mono k">TIME</span><span class="mono v clock">00.00</span></div>
      <ol class="standings mono" aria-live="off"></ol>
    </header>
    ${RHYTHM && mine >= 0 && !replaying ? `<button class="beat" aria-label="Tap on the beat"><i class="ring"></i><i class="dot"></i><b class="groove"><i></i></b><span class="mono hint">TAP ON THE BEAT</span></button>` : ''}
    <div class="count mono" aria-live="assertive"></div>`);
  const canvas = el.querySelector<HTMLCanvasElement>('.stage')!;
  const view = new Renderer(canvas, race);
  const clock = el.querySelector<HTMLElement>('.clock')!;
  const count = el.querySelector<HTMLElement>('.count')!;
  const standings = el.querySelector<HTMLElement>('.standings')!;
  const beatEl = el.querySelector<HTMLElement>('.beat');
  const me = race.playerRacer;

  // Input: tap anywhere (or press space / any key) on your creature's beat.
  const tap = (e: Event) => {
    if (!me || replaying || race.over || me.done) return;
    e.preventDefault();
    const tick = race.tick;
    race.tap(mine, tick);
    if (mode.kind === 'room') mode.room.cast({ k: 'tap', round, tick });
  };
  const onKey = (e: KeyboardEvent) => { if (!e.repeat && (e.code === 'Space' || e.code === 'Enter' || e.key.length === 1)) tap(e); };
  if (RHYTHM && me && !replaying) { el.addEventListener('pointerdown', tap); addEventListener('keydown', onKey); }

  let acc = 0, last = performance.now(), overAt = 0, shown = '', frame = 0, raf = 0, lastBeat = -1, sentLog = false;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= DT && !race.over) { race.step(); acc -= DT; }
    for (const e of race.events.splice(0)) {
      view.event(e, now);
      if (e.type === 'finish' && (e.value === 1 || race.racers[e.who].isPlayer)) sfx.fanfare();
      if (e.type === 'photo') sfx.shutter();
      if (e.type === 'start') sfx.click();
      if (beatEl && e.who === mine && (e.type === 'hit' || e.type === 'miss')) {
        beatEl.classList.remove('hit', 'miss'); void beatEl.offsetWidth; beatEl.classList.add(e.type);
        if (e.type === 'hit') sfx.blink();
      }
    }
    const t = race.time;
    // The beat: the ring pulses on it, with a soft click to tap along to.
    if (beatEl && me) {
      const ph = (t - me.start) / me.beat;
      const k = Math.floor(ph), f = ph - k;
      beatEl.style.setProperty('--f', String(t < me.start ? 0 : f));
      beatEl.style.setProperty('--g', me.groove.toFixed(3));
      beatEl.classList.toggle('on', t >= me.start - 1 && !me.done);
      if (t >= me.start && k !== lastBeat && !me.done) { lastBeat = k; sfx.click(); }
      if (me.done) beatEl.classList.add('off');
    }
    const label = t < -2 ? '3' : t < -1 ? '2' : t < 0 ? '1' : t < 0.7 ? 'GO' : '';
    if (label !== shown) {
      shown = label;
      count.textContent = label;
      count.classList.toggle('go', label === 'GO');
      count.classList.remove('pop'); void count.offsetWidth; if (label) count.classList.add('pop');
      if (label && label !== 'GO') sfx.pluck();
    }
    const shownT = Math.max(0, me?.finishTime ?? t);
    clock.textContent = shownT.toFixed(2).padStart(5, '0');
    if (frame++ % 6 === 0) standings.innerHTML = race.standings().map((r, i) =>
      `<li class="${r.isPlayer ? 'me' : ''}${r.done ? ' done' : ''}"><span class="p">${i + 1}</span><span class="l">${pad2(r.idx + 1)}</span><span class="n">${esc(r.name)}</span><span class="d">${r.finishTime != null ? r.finishTime.toFixed(2) : `${Math.max(0, r.x).toFixed(1)} m`}</span></li>`).join('');
    view.draw(now, dt);
    if (race.over) {
      overAt ||= now;
      if (mode.kind === 'room' && !sentLog) { sentLog = true; mode.room.cast({ k: 'taps', round, ticks: me?.log ?? [] }); }
      // In a room, wait (briefly) for everyone's tap log, then replay them all
      // exactly so every device shows the same result.
      const people = cs.filter((c) => !c.bot);
      const ready = mode.kind !== 'room' || people.every((c) => logs.has(c.id)) || now - overAt > 5000;
      if (now - overAt > 1800 && ready) {
        let final = race;
        if (mode.kind === 'room') {
          final = new Race(entriesOf(cs, focus, logs), seed);
          while (!final.over) final.step();
        }
        const allTaps = new Map(race.racers.filter((r) => !r.bot).map((r) => [r.id ?? '', mode.kind === 'room' ? logs.get(r.id ?? '') ?? [] : r.log.length ? r.log : taps?.get(r.id ?? '') ?? []]));
        results(final, seed, cs, mode, entrants, allTaps);
        return;
      }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  stopRace = () => { cancelAnimationFrame(raf); removeEventListener('keydown', onKey); live = null; };
}

// ---------- Results ----------

function results(race: Race, seed: number, cs: Contender[], mode: Mode, entrants?: Entrant[], taps = new Map<string, number[]>()) {
  const order = race.standings();
  const mine = race.playerRacer;
  const watching = mode.kind === 'replay' || !mine;
  const subject = mine ?? order[0];
  const place = order.indexOf(subject);
  const timeOf = (r: Racer) => (r.finishTime !== null ? `${r.finishTime.toFixed(2)} s` : `${Math.max(0, r.x).toFixed(1)} m`);
  const k = KINDS[subject.anatomy.kind];
  const el = screen('results', `${masthead(`RESULTS — HEAT ${pad2(heat)}`)}
    <section class="hero-result">
      <div class="th-wrap"></div>
      <div class="copy">
        <p class="kicker mono">${watching ? esc(subject.name) : 'Your creature'}</p>
        <h1>${PLACINGS[place]}</h1>
        <p class="time mono">${timeOf(subject)}</p>
        <p class="who">${watching ? '' : `${esc(subject.name)} · `}${k.label}</p>
      </div>
    </section>
    <p class="fact"><span class="mono">NOTE</span>${esc(fact(race, subject))}</p>
    <ol class="table">
      ${order.map((r, i) => `<li class="${r === mine ? 'me' : ''}">
        <span class="pos mono">${i + 1}</span><span class="mini" data-i="${r.idx}"></span>
        <span class="who"><b>${esc(r.name)}${r === mine && !watching ? ' <em>you</em>' : ''}</b><small>${KINDS[r.anatomy.kind].label}${cs[r.idx]?.bot ? ' · bot' : ''}</small></span>
        <span class="time mono">${timeOf(r)}</span></li>`).join('')}
    </ol>
    <div class="actions">
      ${mode.kind === 'replay'
        ? '<button class="btn primary beat">Draw one to race them <span aria-hidden="true">→</span></button><button class="btn again">Watch again</button>'
        : '<button class="btn primary again">Rematch</button><button class="btn redraw">Redraw</button>'}
      ${mode.kind === 'room' ? '<p class="wait mono">Host picks next</p>' : ''}
      <button class="btn ghost share">Share race</button>
      <button class="btn ghost save-card">Save card</button>
    </div>
    <div class="links">${watching ? '' : '<button class="linkish mono post">Post to leaderboard</button>'}<button class="linkish mono save-drawing">Save drawing</button></div>
    <p class="toast" role="status"></p>`);
  wire(el);
  if (mode.kind === 'room') {
    refresh = () => {
      el.querySelector<HTMLButtonElement>('.again')!.hidden = !mode.room.isHost;
      el.querySelector<HTMLButtonElement>('.redraw')!.hidden = !mode.room.isHost;
      el.querySelector<HTMLElement>('.wait')!.hidden = mode.room.isHost;
    };
    refresh();
  }
  el.querySelector('.th-wrap')!.appendChild(thumb(cs[subject.idx].strokes, 132));
  el.querySelectorAll<HTMLElement>('.mini').forEach((m) => m.appendChild(thumb(cs[Number(m.dataset.i)].strokes, 40)));
  if (!watching && place === 0) sfx.fanfare();

  const people = cs.filter((c) => !c.bot);
  el.querySelector('.again')?.addEventListener('click', () => {
    sfx.click();
    if (mode.kind === 'room') {
      if (mode.room.isHost && entrants) mode.room.cast({ k: 'race', round: round + 1, seed, entrants: entrants.filter((e) => mode.room.players.some((p) => p.id === e.id)) });
    }
    else if (mode.kind === 'replay') runRace(cs, seed, mode.sharer, mode, undefined, 0, taps);
    else runRace(field(people, seed), seed, 'me', mode);
  });
  el.querySelector('.redraw')?.addEventListener('click', () => {
    sfx.click();
    if (mode.kind === 'room') { if (mode.room.isHost) mode.room.cast({ k: 'draw', round: round + 1, time: drawTime, lineup: seed }); }
    else drawScreen(mode, me?.strokes);
  });
  el.querySelector('.beat')?.addEventListener('click', () => { sfx.click(); if (mode.kind === 'replay') drawScreen(mode); });
  const slug = subject.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'creature';
  el.querySelector('.save-card')!.addEventListener('click', () => {
    sfx.click();
    save(card({ strokes: cs[subject.idx].strokes, name: subject.name, place: PLACINGS[place], time: timeOf(subject), kind: k.label, win: place === 0 }), `squiggle-cup-${slug}.png`);
  });
  el.querySelector('.save-drawing')!.addEventListener('click', () => { sfx.click(); save(drawingPng(cs[subject.idx].strokes), `${slug}.png`); });
  // The server races the drawing again itself; the time it posts is verified.
  const post = el.querySelector<HTMLButtonElement>('.post');
  post?.addEventListener('click', async () => {
    sfx.click();
    post.disabled = true;
    const toast = el.querySelector<HTMLElement>('.toast')!;
    toast.textContent = 'Verifying…';
    try {
      const r = await postToBoard(codeOf(cs[subject.idx].strokes, subject.name), subject.name, store.get('sc:name') || 'Anonymous');
      toast.innerHTML = `Verified ${(r.entry.ms / 1000).toFixed(3)} s · <b>#${r.rank}</b> of ${r.total} overall, #${r.kindRank} ${esc(KINDS[r.entry.kind].label.toLowerCase())}. <button class="linkish mono see-board">See the board →</button>`;
      toast.querySelector('.see-board')!.addEventListener('click', () => leaderboard(r.entry.kind, r.entry.id));
    } catch (e) { toast.textContent = (e as Error).message; post.disabled = false; }
  });
  el.querySelector('.share')!.addEventListener('click', async () => {
    sfx.click();
    const focus = people.findIndex((c) => c.id === (mine?.id ?? ''));
    const tapCode = people.map((c) => packTaps(taps.get(c.id) ?? [])).join('.');
    const link = `${location.origin}${location.pathname}#race=${seed}.${people.map((c) => codeOf(c.strokes, c.name)).join('.')}&me=${Math.max(0, focus)}${/[^.]/.test(tapCode) ? `&taps=${tapCode}` : ''}`;
    const toast = el.querySelector<HTMLElement>('.toast')!;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text: `${subject.name} came ${PLACINGS[place]} in Squiggle Cup. Draw something faster.`, url: link }); return; }
      await navigator.clipboard.writeText(link);
      toast.textContent = 'Link copied. It replays this exact race.';
    } catch {
      toast.innerHTML = `<input readonly value="${esc(link)}" onclick="this.select()">`;
    }
  });
}

// ---------- Leaderboard ----------

const BOARD_KINDS: Kind[] = ['quadruped', 'biped', 'centipede', 'hopper', 'flyer', 'roller', 'worm', 'jelly'];

async function leaderboard(kind?: Kind, highlight?: string) {
  const el = screen('board', `${masthead('LEADERBOARD')}
    <section class="board-head">
      <h1>Fastest creatures</h1>
      <p class="lede">Every time is raced again by the server. Equal times share a place.</p>
      <nav class="tabs mono" aria-label="Creature type">
        <button data-k="" class="${kind ? '' : 'on'}">All</button>
        ${BOARD_KINDS.map((k) => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${KINDS[k].label}</button>`).join('')}
      </nav>
    </section>
    <ol class="table board-rows" aria-live="polite"><li class="muted mono">Loading…</li></ol>
    <p class="foot-note mono"></p>
    <div class="actions"><button class="btn primary draw-one">Draw one <span aria-hidden="true">→</span></button></div>`);
  wire(el);
  el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.addEventListener('click', () => { sfx.click(); leaderboard((b.dataset.k || undefined) as Kind | undefined); }));
  el.querySelector('.draw-one')!.addEventListener('click', () => { sfx.click(); game = newSeed(); drawScreen({ kind: 'solo' }); });
  const rows = el.querySelector('.board-rows')!;
  try {
    const page = await board(kind);
    if (!el.isConnected) return;
    el.querySelector('.foot-note')!.textContent = `RULES ${page.rules.toUpperCase()} · SEASON ${page.season.slice(1)} · ${page.total} ${page.total === 1 ? 'CREATURE' : 'CREATURES'}`;
    rows.innerHTML = page.entries.length ? '' : '<li class="muted">No creatures yet. Race one and post it.</li>';
    for (const e of page.entries) {
      const li = document.createElement('li');
      if (e.id === highlight) li.className = 'me';
      li.innerHTML = `<span class="pos mono">${e.rank}</span><span class="mini"></span><span class="who"><b>${esc(e.creature)}</b><small>${esc(e.creator)} · ${KINDS[e.kind].label}</small></span><span class="time mono">${(e.ms / 1000).toFixed(3)} s</span>`;
      const d = fromCode(e.code);
      if (d) li.querySelector('.mini')!.appendChild(thumb(d.strokes, 40));
      rows.appendChild(li);
    }
  } catch (e) {
    rows.innerHTML = `<li class="muted">${esc((e as Error).message)}</li>`;
  }
}

// ---------- Shared races: #race=<seed>.<code>.<code>&me=<i> ----------

// Tap logs travel as base-36 gaps between ticks, '-'-separated, one per person.
const packTaps = (ticks: number[]) => ticks.map((t, i) => (t - (ticks[i - 1] ?? 0)).toString(36)).join('-');
const unpackTaps = (s: string) => { let t = 0; return s ? s.split('-').map((d) => (t += parseInt(d, 36) || 0)) : []; };

function readShared(): { seed: number; people: Contender[]; focus: number; taps: Map<string, number[]> } | null {
  const m = /[#&]race=(\d+)\.([A-Za-z0-9_.-]+)/.exec(location.hash);
  if (!m) return null;
  const people = m[2].split('.').map((code, i) => { const d = fromCode(code); return d ? { id: `l${i}`, name: d.name || `Player ${i + 1}`, strokes: d.strokes, anatomy: d.anatomy } : null; })
    .filter((x): x is Contender => !!x);
  const focus = Number(/[#&]me=(\d+)/.exec(location.hash)?.[1] ?? 0);
  const tapCodes = (/[#&]taps=([0-9a-z.-]*)/.exec(location.hash)?.[1] ?? '').split('.');
  const taps = new Map(people.map((p, i) => [p.id, unpackTaps(tapCodes[i] ?? '')]));
  return people.length ? { seed: Number(m[1]) >>> 0, people, focus: Math.min(focus, people.length - 1), taps } : null;
}

// ---------- Gallery: every house family at three skill levels (?demo=gallery) ----------

function gallery() {
  const el = screen('gallery', `${masthead('HOUSE CREATURES')}<section class="gallery-grid"></section>`);
  wire(el);
  const grid = el.querySelector('.gallery-grid')!;
  for (const fam of FAMILIES) for (const skill of [0.15, 0.5, 0.95]) {
    const t = template(mulberry32(1000 + FAMILIES.indexOf(fam) * 31 + skill * 100), fam, skill);
    const strokes = canonical(t.strokes);
    const a = analyze(strokes)!;
    const race = new Race([{ anatomy: a, name: '', kind: 'player' }]);
    while (!race.over) race.step();
    const sc = race.racers[0].s.score;
    const card = document.createElement('figure');
    card.appendChild(thumb(strokes, 150));
    card.insertAdjacentHTML('beforeend', `<figcaption><b>${FAMILY_NAMES[fam]}</b> <span class="mono">skill ${skill}</span><br><span class="mono">${KINDS[a.kind].label} · form ${Math.round(sc.form * 100)} · craft ${Math.round(sc.craft * 100)} · score ${Math.round(sc.total * 100)}</span><br><span class="mono">${race.racers[0].finishTime?.toFixed(2)} s · ${sc.features.join(', ') || 'no details'}</span></figcaption>`);
    grid.appendChild(card);
  }
}

// ---------- Boot ----------

const params = new URLSearchParams(location.search);
const demo = params.get('demo');
const shared = readShared();
if (demo) {
  // Screenshot entry points: ?demo=draw|race|results|lobby[&kind=flyer][&t=6]
  const kind = (params.get('kind') ?? 'quadruped') as Kind;
  const strokes = canonical(rivalDrawing(mulberry32(5), INKS, kind));
  const a = analyze(strokes)!;
  me = { strokes, name: params.get('name') ?? 'Your Creature' };
  const mine: Contender = { id: 'me', name: me.name, strokes, anatomy: a };
  const cs = field([mine], 1234);
  if (demo === 'draw') drawScreen({ kind: 'solo' }, params.has('empty') ? [] : strokes);
  else if (demo === 'race') runRace(cs, 1234, 'me', { kind: 'solo' }, undefined, Math.round((Number(params.get('t') ?? 0) + 3) / DT));
  else if (demo === 'results') {
    const race = new Race(entriesOf(cs, 'me'), 1234);
    while (!race.over) race.step();
    heat = 1;
    results(race, 1234, cs, { kind: 'solo' });
  } else if (demo === 'gallery') gallery();
  else if (demo === 'board') leaderboard();
  else if (demo === 'lobby') {
    const fake = { code: 'KQRT', id: 'a', host: 'a', players: [{ id: 'a', name: 'Sadid' }, { id: 'b', name: 'Mei' }, { id: 'c', name: 'Jonas' }], isHost: true, cast() {}, leave() {} };
    room = fake as unknown as Room;
    lobby();
  } else home();
} else if (shared) {
  game = shared.seed;
  const cs = field(shared.people, shared.seed);
  runRace(cs, shared.seed, shared.people[shared.focus].id, { kind: 'replay', people: shared.people, sharer: shared.people[shared.focus].id }, undefined, 0, shared.taps);
} else if (roomInHash()) {
  connect(store.get('sc:name'), roomInHash()!);
} else home();
