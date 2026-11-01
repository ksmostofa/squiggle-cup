// PRD §16, prototype edition: everything synthesised with Web Audio, no files.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = load();

function load() {
  try { return localStorage.getItem('sc:mute') === '1'; } catch { return false; }
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('sc:mute', m ? '1' : '0'); } catch { /* storage may be blocked */ }
  if (master) master.gain.value = m ? 0 : 0.55;
}

// Must be called from a user gesture before the first sound.
export function unlock() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
    } catch { return; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol: number, freq: number, q = 1, sweepTo?: number, delay = 0) {
  if (!ctx || !master || muted) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf;
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  pluck: () => tone('triangle', 520 + Math.random() * 260, 300, 0.09, 0.25),
  drum: () => { tone('sine', 180, 55, 0.16, 0.7); noise(0.05, 0.15, 2500, 1.5); },
  thud: () => tone('sine', 110, 70, 0.1, 0.35),
  whoosh: () => noise(0.35, 0.35, 400, 0.8, 2400),
  land: () => { tone('sine', 90, 40, 0.18, 0.5); noise(0.12, 0.2, 300, 0.7); },
  boing: () => { tone('sine', 300, 700, 0.12, 0.3); tone('sine', 700, 220, 0.25, 0.25, 0.1); },
  gasp: () => noise(0.9, 0.18, 900, 0.6, 1600),
  shutter: () => { noise(0.04, 0.6, 3000, 2); noise(0.05, 0.4, 1800, 2, undefined, 0.07); },
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, i === 3 ? 0.5 : 0.14, 0.12, i * 0.13)),
  click: () => tone('square', 1400, 900, 0.03, 0.08),
  blink: () => tone('sine', 900, 1400, 0.06, 0.08),
};
