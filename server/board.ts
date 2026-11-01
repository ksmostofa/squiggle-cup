import type { Kind } from '../src/analyze';
import { RULES, SEASON, verify } from '../src/verify';

// The global leaderboard, transport-agnostic: a fetch-style handler over a
// tiny key-value store. The game Worker runs it in a Durable Object
// (worker/site.mjs); `npm run dev` runs it in memory (vite.config.ts).
//   POST /api/board        { code, creature, creator }  → { entry, rank, total }
//   GET  /api/board?kind=  → { rules, season, entries: [...ranked] }
// Times are never taken from the client: the server races the drawing itself.

export interface Entry {
  id: string; code: string; creature: string; creator: string; kind: Kind;
  ms: number; score: number; rules: string; season: string; at: number;
}
export interface Ranked extends Entry { rank: number }
export interface Store { load(): Promise<Entry[]>; save(e: Entry): Promise<void> }

const MAX_BODY = 32 * 1024;
const PER_MINUTE = 12;
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// FNV-1a over the drawing: the same strokes are the same entry.
function idOf(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36) + s.length.toString(36);
}

// Equal verified times share a rank (1, 2, 2, 4).
export function rank(entries: Entry[]): Ranked[] {
  const sorted = entries.slice().sort((a, b) => a.ms - b.ms || a.at - b.at);
  let r = 0;
  return sorted.map((e, i) => { if (!i || sorted[i - 1].ms !== e.ms) r = i + 1; return { ...e, rank: r }; });
}

export function createBoard(store: Store, now = () => Date.now()) {
  let cache: Map<string, Entry> | null = null;
  const recent = new Map<string, number[]>();
  const entries = async () => (cache ??= new Map((await store.load()).map((e) => [e.id, e])));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' },
  });
  const current = async (kind?: string) => [...(await entries()).values()].filter((e) => e.rules === RULES && e.season === SEASON && (!kind || e.kind === kind));

  return async function handle(req: Request, client = 'anon'): Promise<Response> {
    if (req.method === 'OPTIONS') return json({});
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const kind = url.searchParams.get('kind') || undefined;
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      const all = rank(await current(kind));
      return json({ rules: RULES, season: SEASON, total: all.length, entries: all.slice(0, limit) });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

    const t = now(), times = (recent.get(client) ?? []).filter((x) => t - x < 60_000);
    if (times.length >= PER_MINUTE) return json({ error: 'Too many entries, try again in a minute.' }, 429);
    times.push(t); recent.set(client, times);

    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: 'Drawing too large.' }, 413);
    let body: { code?: unknown; creature?: unknown; creator?: unknown };
    try { body = JSON.parse(text); } catch { return json({ error: 'Bad request.' }, 400); }
    const v = verify(String(body.code ?? ''));
    if (!v) return json({ error: 'That drawing could not be raced.' }, 422);

    const id = idOf(`${RULES}.${SEASON}.${v.strokes}`);
    const all = await entries();
    let entry = all.get(id);
    if (!entry) {
      entry = { id, code: String(body.code), creature: clean(body.creature, 36) || 'Unnamed', creator: clean(body.creator, 22) || 'Anonymous', kind: v.kind, ms: v.ms, score: v.score, rules: RULES, season: SEASON, at: t };
      all.set(id, entry);
      await store.save(entry);
    }
    const ranked = rank(await current());
    const mine = ranked.find((e) => e.id === id)!;
    const kindRank = rank(await current(v.kind)).find((e) => e.id === id)!.rank;
    return json({ entry: mine, rank: mine.rank, kindRank, total: ranked.length });
  };
}

// In-memory store for the dev server and tests.
export const memoryStore = (): Store => { const m: Entry[] = []; return { load: async () => m.slice(), save: async (e) => { m.push(e); } }; };
