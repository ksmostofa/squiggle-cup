import crypto from 'node:crypto';

// A minimal WebSocket server endpoint (RFC 6455): text frames, ping/pong,
// close. Enough for the room relay without a dependency.

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 20;

export function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const hash = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${hash}\r\n\r\n`);
  socket.setNoDelay(true);

  const conn = { onmessage: null, onclose: null, send: (text) => frame(1, Buffer.from(text, 'utf8')), close: () => end() };
  let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  let parts = [];
  let closed = false;

  function frame(op, data) {
    if (closed || socket.destroyed) return;
    const n = data.length;
    let h;
    if (n < 126) h = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    socket.write(Buffer.concat([h, data]));
  }

  function end() {
    if (closed) return;
    frame(8, Buffer.alloc(0));
    closed = true;
    clearInterval(ping);
    socket.end();
    conn.onclose?.();
  }

  function parse() {
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let n = buf[1] & 0x7f, off = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (n > MAX_FRAME) { socket.destroy(); return; }
      const maskAt = off;
      if (masked) off += 4;
      if (buf.length < off + n) return;
      const data = Buffer.from(buf.subarray(off, off + n));
      if (masked) for (let i = 0; i < data.length; i++) data[i] ^= buf[maskAt + (i & 3)];
      buf = buf.subarray(off + n);
      if (op === 8) { end(); return; }
      if (op === 9) { frame(10, data); continue; }
      if (op === 10) continue;
      parts.push(data);
      if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; conn.onmessage?.(text); }
    }
  }

  socket.on('data', (d) => { buf = Buffer.concat([buf, d]); parse(); });
  socket.on('close', () => { if (!closed) { closed = true; clearInterval(ping); conn.onclose?.(); } });
  socket.on('error', () => socket.destroy());
  const ping = setInterval(() => frame(9, Buffer.alloc(0)), 25000);
  queueMicrotask(parse);
  return conn;
}

// Wires an upgrade request on `path` to a relay from rooms.mjs.
export function attach(server, relay, path = '/relay') {
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith(path)) return;
    const conn = accept(req, socket, head);
    if (!conn) return;
    const client = relay.connect(conn.send);
    conn.onmessage = (m) => client.message(m);
    conn.onclose = () => client.close();
  });
}
