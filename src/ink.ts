import getStroke from 'perfect-freehand';
import type { Stroke } from './analyze';
import type { Pt } from './geom';

// Clean pen ink. perfect-freehand shapes the line for the look only; the
// physics uses the raw points. Nothing is added that wasn't drawn.

const cache = new WeakMap<object, Path2D>();

export function strokePath(pts: Pt[], size: number, key?: object, complete = true): Path2D {
  const hit = key && cache.get(key);
  if (hit) return hit;
  const outline = getStroke(pts, { size, thinning: 0.12, smoothing: 0.6, streamline: 0.4, simulatePressure: false, last: complete });
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

// A whole drawing in pad pixels.
export function drawDrawing(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  for (const s of strokes) {
    ctx.fillStyle = s.color;
    ctx.fill(strokePath(s.pts, s.w, s));
  }
}

export function thumb(strokes: Stroke[], size = 120): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = size * dpr;
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const span = Math.max(x1 - x0, y1 - y0, 60) * 1.18;
  const k = (size * dpr) / span;
  ctx.setTransform(k, 0, 0, k, (size * dpr) / 2 - ((x0 + x1) / 2) * k, (size * dpr) / 2 - ((y0 + y1) / 2) * k);
  drawDrawing(ctx, strokes);
  return c;
}
