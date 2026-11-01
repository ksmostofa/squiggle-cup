import { analyze } from '../src/analyze';
import { canonical, codeOf } from '../src/drawing';
import { Race } from '../src/race';
import { mulberry32 } from '../src/rng';
import { RULES, SEASON } from '../src/verify';
import { template } from '../src/templates';
import { type Entry, createBoard, memoryStore, rank } from '../server/board';

// The leaderboard: server-verified times, shared ranks, versioned rules.

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const post = (b: ReturnType<typeof createBoard>, body: unknown, who = 'a') => b(new Request('http://x/api/board', { method: 'POST', body: JSON.stringify(body) }), who).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (b: ReturnType<typeof createBoard>, q = '') => b(new Request(`http://x/api/board${q}`)).then((r) => r.json());

const strokes = canonical(template(mulberry32(11), 'dog', 0.7).strokes);
const solo = (() => { const r = new Race([{ anatomy: analyze(strokes)!, name: '', kind: 'player' }]); while (!r.over) r.step(); return Math.round(r.racers[0].finishTime! * 1000); })();

const b = createBoard(memoryStore());
const first = await post(b, { code: codeOf(strokes, 'Rex'), creature: 'Rex', creator: 'Ana', ms: 1 });
check(first.status === 200 && first.body.entry.ms === solo, `the posted time is the drawing's own race time, raced by the server (${solo} ms), not the client's claim`);
check(first.body.entry.rules === RULES && first.body.entry.season === SEASON, `entries carry rules ${RULES} and season ${SEASON}`);
const again = await post(b, { code: codeOf(strokes, 'Rex again'), creature: 'Rex again', creator: 'Bo' });
check(again.body.entry.id === first.body.entry.id && again.body.total === 1, 'the same drawing posted twice is one entry');
const bad = await post(b, { code: 'not-a-drawing' });
check(bad.status === 422, 'an unreadable drawing is refused');
const bird = canonical(template(mulberry32(12), 'bird', 0.4).strokes);
await post(b, { code: codeOf(bird, 'Tweet'), creature: 'Tweet', creator: 'Cy' });
const all = await get(b), flyers = await get(b, '?kind=flyer');
check(all.total === 2 && flyers.total === 1 && flyers.entries[0].kind === 'flyer', 'overall and per-type views');
check(all.entries[0].ms <= all.entries[1].ms, 'fastest first');

const e = (id: string, ms: number, at: number): Entry => ({ id, code: '', creature: id, creator: '', kind: 'jelly', ms, score: 0, rules: RULES, season: SEASON, at });
const ranks = rank([e('c', 15100, 3), e('a', 15000, 1), e('b', 15000, 2), e('d', 15200, 4)]).map((x) => `${x.id}${x.rank}`).join(' ');
check(ranks === 'a1 b1 c3 d4', `equal verified times share a place (${ranks})`);

const flood = createBoard(memoryStore());
const codes = Array.from({ length: 14 }, (_, i) => codeOf(canonical(template(mulberry32(50 + i), 'blob', 0.5).strokes), 'x'));
const statuses = [];
for (const code of codes) statuses.push((await post(flood, { code }, 'spammer')).status);
check(statuses.includes(429) && statuses.filter((s) => s === 200).length <= 12, 'one client is limited to twelve entries a minute');

// Moderation: only the admin key deletes.
{
  const mod = createBoard(memoryStore(), () => Date.now(), 'secret');
  const posted = await post(mod, { code: codeOf(strokes, 'Rex'), creature: 'Rex' });
  const del = (key: string) => mod(new Request(`http://x/api/board?id=${posted.body.entry.id}`, { method: 'DELETE', headers: { 'x-board-key': key } }));
  check((await del('guess')).status === 403 && (await get(mod)).total === 1, 'a wrong key deletes nothing');
  check((await del('secret')).status === 200 && (await get(mod)).total === 0, 'the admin key removes an entry');
  check((await b(new Request('http://x/api/board?id=x', { method: 'DELETE' }))).status === 403, 'without a key set, nothing can be deleted');
}

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
