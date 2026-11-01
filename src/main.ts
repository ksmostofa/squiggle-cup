import './style.css';
import { type Anatomy, type Kind, type Stroke, analyze } from './analyze';
import { isMuted, setMuted, sfx, unlock } from './audio';
import { rivalDrawing } from './bots';
import { INKS, LANES } from './course';
import { DT, KINDS } from './creature';
import { type Dare, decode, encode } from './encode';
import { thumb } from './ink';
import { type Cast, type Entrant, Room } from './net';
import { PLACINGS, fact, formalName } from './names';
import { Pad, type PadResult, THICK, THIN } from './pad';
import { Race, type Racer } from './race';
import { Renderer } from './render';
import { mulberry32 } from './rng';

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

const pack = (strokes: Stroke[]): Dare['strokes'] => strokes.map((s) => ({ pts: s.pts, ink: Math.max(0, INKS.indexOf(s.color)), thick: s.w > (THIN + THICK) / 2 }));
const unpack = (ps: Dare['strokes']): Stroke[] => ps.map((s) => ({ pts: s.pts, color: INKS[s.ink] ?? INKS[0], w: s.thick ? THICK : THIN }));
const codeOf = (strokes: Stroke[], name: string) => encode({ venue: 0, seed: 0, name, strokes: pack(strokes) });
function fromCode(code: string): { strokes: Stroke[]; anatomy: Anatomy; name: string } | null {
  const d = decode(code);
  if (!d) return null;
  const strokes = unpack(d.strokes);
  const anatomy = analyze(strokes);
  return anatomy ? { strokes, anatomy, name: d.name } : null;
}
// The exact strokes every other device will see.
const canonical = (strokes: Stroke[]) => unpack(decode(codeOf(strokes, ''))!.strokes);

// The house creatures fill empty lanes: always the same four, so they run
// the same times every race and work as par for the course.
const HOUSE: Contender[] = (['quadruped', 'flyer', 'worm', 'roller'] as Kind[]).flatMap((kind, i) => {
  const rng = mulberry32(0x5c0 + i * 977);
  const strokes = canonical(rivalDrawing(rng, INKS, kind));
  const a = analyze(strokes);
  return a ? [{ id: `bot${i}`, name: formalName(a, rng), strokes, anatomy: a, bot: true }] : [];
});
const field = (people: Contender[], _seed = 0): Contender[] => [...people.slice(0, LANES), ...HOUSE].slice(0, LANES);
const entriesOf = (cs: Contender[], focus: string, taps?: Map<string, number[]>) =>
  cs.map((c) => ({ anatomy: c.anatomy, name: c.name, kind: c.id === focus ? 'player' as const : 'rival' as const, id: c.id, bot: c.bot, taps: taps?.get(c.id) }));

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

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
let started = -1;
let stopRace: (() => void) | null = null;

function screen(cls: string, html = ''): HTMLElement {
  stopRace?.(); stopRace = null;
  drawingPad?.destroy(); drawingPad = null;
  app.replaceChildren();
  const el = document.createElement('main');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  app.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  return el;
}

const masthead = (right = '') => `<header class="masthead">
  <button class="mark mono home-link" aria-label="Home">SQUIGGLE CUP</button>
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
      <p class="kicker mono">A drawing race · 2–5 players</p>
      <h1>Draw a creature.<br><span>It races on its own.</span></h1>
      <p class="lede">Its shape decides how it moves: legs run, wings fly, round things roll, long things slither. Five lanes, forty metres, no buttons. The better drawing wins.</p>
    </section>
    <section class="panel">
      <label class="field"><span class="mono">Your name</span><input class="pname" maxlength="22" autocomplete="nickname" placeholder="Player" value="${esc(store.get('sc:name'))}"></label>
      <div class="actions">
        <button class="btn primary solo">Race solo <span aria-hidden="true">→</span></button>
        <button class="btn create">Create a room</button>
      </div>
      <form class="join">
        <input class="code mono" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" aria-label="Room code" value="${esc(roomInHash() ?? '')}">
        <button class="btn">Join room</button>
      </form>
      <p class="error" role="alert">${esc(error)}</p>
    </section>
    <footer class="foot mono"><span>DWG 01</span><span>SCALE NTS</span><span>40 000 MM</span></footer>`);
  wire(el);
  const nameIn = el.querySelector<HTMLInputElement>('.pname')!;
  const name = () => { const n = nameIn.value.trim().slice(0, 22); store.set('sc:name', n); return n; };
  el.querySelector('.solo')!.addEventListener('click', () => { unlock(); sfx.click(); name(); drawScreen({ kind: 'solo' }); });
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
      <p class="note">Empty lanes are filled with drawn bots.</p>
    </section>
    <div class="actions"><button class="btn primary start">Everyone draw <span aria-hidden="true">→</span></button><p class="wait mono"></p></div>
    <p class="toast" role="status"></p>`);
  wire(el);
  const list = el.querySelector('.lanes')!;
  refresh = () => {
    list.innerHTML = Array.from({ length: LANES }, (_, i) => {
      const p = r.players[i];
      return `<li class="${p?.id === r.id ? 'me' : ''}${p ? '' : ' empty'}"><span class="bubble mono">${pad2(i + 1)}</span><span class="who">${p ? esc(p.name) : 'Bot'}</span><span class="tag mono">${p ? (p.id === r.host ? 'HOST' : p.id === r.id ? 'YOU' : '') : ''}</span></li>`;
    }).join('');
    el.querySelector<HTMLButtonElement>('.start')!.hidden = !r.isHost;
    el.querySelector('.wait')!.textContent = r.isHost ? '' : 'Waiting for the host to start';
  };
  refresh();
  el.querySelector('.start')!.addEventListener('click', () => { sfx.click(); r.cast({ k: 'draw', round: round + 1 }); });
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
    hostDeadline = performance.now() + 45000;
    drawScreen({ kind: 'room', room: r }, me?.strokes);
  } else if (c.k === 'drawing') {
    if (c.round !== round) return;
    sent.set(from, { code: c.code, name: c.name });
    refresh?.();
    if (r.isHost) hostCheck();
  } else if (c.k === 'race') {
    round = c.round;
    started = c.round;
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
  r.cast({ k: 'race', round, seed: newSeed(), entrants });
}
setInterval(() => { if (room?.isHost && sent.size && started !== round && performance.now() >= hostDeadline) hostCheck(); }, 1000);

// ---------- Draw ----------

function drawScreen(mode: Mode, initial: Stroke[] = []) {
  const inRoom = mode.kind === 'room';
  const el = screen('draw', `${masthead(inRoom ? `ROOM ${mode.room.code} · ROUND ${pad2(round)}` : mode.kind === 'replay' ? 'DARE' : 'SOLO')}
    ${inRoom ? '<ol class="who-drew mono" aria-label="Who has finished"></ol>' : ''}
    <div class="waiting" role="status"><p class="mono">SENT</p><p class="msg"></p></div>`);
  wire(el);
  const pad = new Pad((r: PadResult) => submit(mode, r, el), { initial, name: me?.name ?? store.get('sc:name'), title: inRoom ? `DWG ${pad2(round)} — DRAW NOW` : 'DWG 01 — CREATURE' });
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
    const seed = newSeed();
    runRace(field([mine, ...mode.people.slice(0, LANES - 1)], seed), seed, 'me', { kind: 'solo' });
  } else {
    const seed = newSeed();
    runRace(field([mine], seed), seed, 'me', mode);
  }
}

// ---------- Race ----------

// The live race, so taps arriving from the room reach the right lane.
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
    ${mine >= 0 && !replaying ? `<button class="beat" aria-label="Tap on the beat"><i class="ring"></i><i class="dot"></i><b class="groove"><i></i></b><span class="mono hint">TAP ON THE BEAT</span></button>` : ''}
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
  if (me && !replaying) { el.addEventListener('pointerdown', tap); addEventListener('keydown', onKey); }

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
  const host = mode.kind === 'room' && mode.room.isHost;
  const guest = mode.kind === 'room' && !mode.room.isHost;
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
        : guest ? '<p class="wait mono">The host picks what\'s next</p>'
        : '<button class="btn primary again">Rematch</button><button class="btn redraw">Redraw</button>'}
      <button class="btn ghost share">Share this race</button>
    </div>
    <p class="toast" role="status"></p>`);
  wire(el);
  el.querySelector('.th-wrap')!.appendChild(thumb(cs[subject.idx].strokes, 132));
  el.querySelectorAll<HTMLElement>('.mini').forEach((m) => m.appendChild(thumb(cs[Number(m.dataset.i)].strokes, 40)));
  if (!watching && place === 0) sfx.fanfare();

  const people = cs.filter((c) => !c.bot);
  el.querySelector('.again')?.addEventListener('click', () => {
    sfx.click();
    if (mode.kind === 'room') { if (host && entrants) mode.room.cast({ k: 'race', round: round + 1, seed: newSeed(), entrants }); }
    else if (mode.kind === 'replay') runRace(cs, seed, mode.sharer, mode, undefined, 0, taps);
    else { const s = newSeed(); runRace(field(people, s), s, 'me', mode); }
  });
  el.querySelector('.redraw')?.addEventListener('click', () => {
    sfx.click();
    if (mode.kind === 'room') { if (host) mode.room.cast({ k: 'draw', round: round + 1 }); }
    else drawScreen(mode, me?.strokes);
  });
  el.querySelector('.beat')?.addEventListener('click', () => { sfx.click(); if (mode.kind === 'replay') drawScreen(mode); });
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
  } else if (demo === 'lobby') {
    const fake = { code: 'KQRT', id: 'a', host: 'a', players: [{ id: 'a', name: 'Sadid' }, { id: 'b', name: 'Mei' }, { id: 'c', name: 'Jonas' }], isHost: true, cast() {}, leave() {} };
    room = fake as unknown as Room;
    lobby();
  } else home();
} else if (shared) {
  const cs = field(shared.people, shared.seed);
  runRace(cs, shared.seed, shared.people[shared.focus].id, { kind: 'replay', people: shared.people, sharer: shared.people[shared.focus].id }, undefined, 0, shared.taps);
} else if (roomInHash()) {
  connect(store.get('sc:name'), roomInHash()!);
} else home();
