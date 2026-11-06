// @ts-expect-error plain JS, shared with the standalone relay
import { createRelay } from '../server/rooms.mjs';
import { analyze, kindsFor, withKind } from '../src/analyze';
import { canonical, codeOf, fromCode } from '../src/drawing';
import { mulberry32 } from '../src/rng';
import { template } from '../src/templates';

// The room relay: seats held through a dropped connection, rejoining with a
// token, catching up on missed casts, and the host passing on only once the
// hold runs out. Also the kind a player picks travelling in a drawing code.

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

type Msg = { t: string; [k: string]: any };
function client(relay: any) {
  const inbox: Msg[] = [];
  const conn = relay.connect((s: string) => inbox.push(JSON.parse(s)));
  return { inbox, send: (m: Msg) => conn.message(JSON.stringify(m)), close: () => conn.close(), last: (t: string) => inbox.filter((m) => m.t === t).pop() };
}

const relay = createRelay({ hold: 50 });
const host = client(relay);
host.send({ t: 'create', name: 'Host' });
const { code, token, id: hostId } = host.last('welcome')!;
const friend = client(relay);
friend.send({ t: 'join', code, name: 'Friend' });
check(friend.last('players')!.players.length === 2, 'a friend joins the room');

// The host switches apps to send the link: the socket drops, the seat stays.
host.close();
const roster = friend.last('players')!;
check(roster.host === hostId && roster.players[0].away === true, 'a dropped host keeps the seat and the host role, shown as away');
friend.send({ t: 'cast', data: { k: 'draw', round: 1 } });
friend.send({ t: 'cast', data: { k: 'drawing', round: 1, code: 'x', name: 'F' } });

// Back in the game: same seat, same id, and the casts it missed.
const back = client(relay);
back.send({ t: 'join', code, name: 'Host', token, seen: 0 });
check(back.last('welcome')!.id === hostId, 'rejoining with the token gets the same seat back');
check(back.last('players')!.host === hostId && !back.last('players')!.players[0].away, 'and the host role, no longer away');
const missed = back.inbox.filter((m) => m.t === 'cast');
check(missed.length === 2 && missed.every((m) => m.replay) && missed[0].data.k === 'draw', 'and every cast of this round it missed');

// A reconnect that has seen everything gets nothing again.
back.close();
const again = client(relay);
again.send({ t: 'join', code, name: 'Host', token, seen: missed[1].seq });
check(!again.inbox.some((m) => m.t === 'cast'), 'nothing is replayed twice');

// Gone for good: once the hold runs out, the next player becomes host.
again.close();
await new Promise((r) => setTimeout(r, 120));
const after = friend.last('players')!;
check(after.players.length === 1 && after.host === friend.last('welcome')!.id, 'after the hold, the seat is freed and the host role passes on');

// An explicit leave frees the seat at once.
const r2 = createRelay({ hold: 60_000 });
const a = client(r2); a.send({ t: 'create', name: 'A' });
const b = client(r2); b.send({ t: 'join', code: a.last('welcome')!.code, name: 'B' });
a.send({ t: 'leave' });
check(b.last('players')!.players.length === 1, 'leaving frees the seat at once');

// A room the relay lost (a restart) opens again for a player with a token.
const r3 = createRelay();
const c = client(r3); c.send({ t: 'join', code: 'ABCD', name: 'C', token: 'tok' });
check(c.last('welcome')?.code === 'ABCD', 'a returning player reopens a lost room under its code');
const d = client(r3); d.send({ t: 'join', code: 'WXYZ', name: 'D' });
check(d.last('error')?.error === 'No room with that code.', 'a typo without a token still finds no room');

// The picked kind travels with the drawing and is checked against it.
const snake = canonical(template(mulberry32(3), 'snake', 0.7).strokes);
const read = analyze(snake)!;
const alt = kindsFor(read).find((k) => k !== read.kind)!;
check(!!alt, `a legless ${read.kind} has other kinds to pick (${kindsFor(read).join(', ')})`);
const back2 = fromCode(codeOf(snake, 'S', alt))!;
check(back2.anatomy.kind === alt && back2.pick === alt, 'the picked kind survives a drawing code');
check(fromCode(codeOf(snake, 'S'))!.pick === null, 'no pick reads as drawn');
const dog = analyze(canonical(template(mulberry32(5), 'dog', 0.7).strokes))!;
check(withKind(dog, 'worm').kind === dog.kind, 'legs fix a walker\'s kind: a dog cannot be picked as a worm');

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall rooms checks passed');
