import { canonical, codeOf } from '../src/drawing';
import { mulberry32 } from '../src/rng';
import { template } from '../src/templates';
import { verify } from '../src/verify';

// Posts one house drawing to a deployed leaderboard and checks the server's
// time matches the local race. node scripts/run-ts.mjs scripts/board-live.ts <api url>
const api = process.argv[3];
const code = codeOf(canonical(template(mulberry32(2026), 'cat', 0.9).strokes), 'Deploy check');
const pre = await fetch(api, { method: 'OPTIONS' });
console.log('CORS', pre.status, pre.headers.get('access-control-allow-origin'));
const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, creature: 'Deploy check', creator: 'Squiggle Cup', ms: 1 }) });
const body = await res.json();
console.log('POST', res.status, JSON.stringify(body).slice(0, 220));
console.log('server ms', body.entry?.ms, 'local ms', verify(code)?.ms, body.entry?.ms === verify(code)?.ms ? 'MATCH' : 'MISMATCH');
const list = await (await fetch(api)).json();
console.log('GET', list.rules, list.season, 'total', list.total);
