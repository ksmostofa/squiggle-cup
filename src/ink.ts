import getStroke from 'perfect-freehand';
import type { Anatomy, Stroke } from './analyze';
import type { Pt } from './geom';

// Marker strokes with a white die-cut sticker edge (PRD §5.1). perfect-freehand
// is for the look only; physics uses the raw points.

const cache = new WeakMap<object, Path2D>();

export function strokePath(pts: Pt[], size: number, key?: object, complete = true): Path2D {
  const hit = key && cache.get(key);
  if (hit) return hit;
  const outline = getStroke(pts, { size, thinning: 0.25, smoothing: 0.55, streamline: 0.35, simulatePressure: true, last: complete });
  const path = new Path2D(svgPath(outline));
  if (key && complete) cache.set(key, path);
  return path;
}

function svgPath(points: number[][]): string {
  if (points.length < 2) return '';
  const d: (string | number)[] = ['M', points[0][0], points[0][1], 'Q'];
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.push('Z');
  return d.join(' ');
}

export interface InkItem { path: Path2D; color: string }

// Two passes so one stroke's white edge never cuts across another's ink.
export function paintInk(ctx: CanvasRenderingContext2D, items: InkItem[], edge: number) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = edge;
  for (const it of items) ctx.stroke(it.path);
  for (const it of items) { ctx.fillStyle = it.color; ctx.fill(it.path); }
}

export function fillWash(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, alpha = 0.2) {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.9;
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.globalAlpha = a * alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = a;
}

// px, py: pupil offset; open: 1 = open, 0 = shut.
export function googlyEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, px: number, py: number, open = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, Math.max(0.08, open));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.strokeStyle = '#1d1b2e';
  ctx.stroke();
  if (open > 0.3) {
    ctx.beginPath();
    ctx.arc(px, py, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#1d1b2e';
    ctx.fill();
  }
  ctx.restore();
}

// A whole drawing in pad pixels as cave pigment, used for thumbnails.
export function drawDrawing(ctx: CanvasRenderingContext2D, strokes: Stroke[], anatomy: Anatomy | null) {
  for (const s of strokes) {
    const path = strokePath(s.pts, s.w, s);
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = s.color;
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
  for (const e of anatomy?.eyes ?? []) {
    ctx.fillStyle = '#1d1a19';
    ctx.beginPath(); ctx.arc(e.c[0], e.c[1], Math.max(5, e.r * 0.55), 0, Math.PI * 2); ctx.fill();
  }
}

export function thumb(strokes: Stroke[], anatomy: Anatomy | null, size = 120): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = size * dpr;
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const span = Math.max(x1 - x0, y1 - y0, 60) + 40;
  const k = (size * dpr) / span;
  ctx.setTransform(k, 0, 0, k, (size * dpr) / 2 - ((x0 + x1) / 2) * k, (size * dpr) / 2 - ((y0 + y1) / 2) * k);
  drawDrawing(ctx, strokes, anatomy);
  return c;
}
