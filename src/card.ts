import type { Stroke } from './analyze';
import { ACCENT } from './course';
import { thumb } from './ink';
import { FAINT, INK, LINE, MONO, PAPER, SANS, TEXT } from './render';

// Keepsakes: the placement card (the creature large on the white sheet with
// its place and time, 1080×1350) and the bare drawing (transparent PNG).

export interface CardInfo { strokes: Stroke[]; name: string; place: string; time: string; kind: string; win: boolean }

export function card(info: CardInfo): HTMLCanvasElement {
  const W = 1080, H = 1350, M = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
  x.fillStyle = FAINT;
  for (let i = 0; i < W; i += 36) x.fillRect(i, 0, 1, H);
  for (let j = 0; j < H; j += 36) x.fillRect(0, j, W, 1);
  x.strokeStyle = TEXT; x.lineWidth = 2; x.strokeRect(M / 2, M / 2, W - M, H - M);
  x.strokeStyle = LINE; x.lineWidth = 1; x.strokeRect(M / 2 + 10, M / 2 + 10, W - M - 20, H - M - 20);

  x.textBaseline = 'alphabetic';
  x.fillStyle = INK; x.font = `600 26px ${MONO}`; x.textAlign = 'left';
  x.fillText('SQUIGGLE CUP', M + 20, M + 64);
  x.fillStyle = TEXT; x.textAlign = 'right';
  x.fillText('40 000 MM', W - M - 20, M + 64);
  x.fillStyle = INK; x.fillRect(M + 20, M + 92, W - 2 * M - 40, 3);

  const t = thumb(info.strokes, 400); // 400 CSS px at devicePixelRatio; drawn to fit
  x.drawImage(t, (W - 760) / 2, 200, 760, 760);

  x.textAlign = 'left';
  x.fillStyle = info.win ? ACCENT : INK;
  x.font = `600 168px ${SANS}`;
  x.fillText(info.place, M + 20, 1130);
  x.fillStyle = INK; x.font = `500 56px ${MONO}`; x.textAlign = 'right';
  x.fillText(info.time, W - M - 20, 1130);
  x.fillStyle = LINE; x.fillRect(M + 20, 1170, W - 2 * M - 40, 2);
  x.textAlign = 'left'; x.fillStyle = INK; x.font = `600 40px ${SANS}`;
  x.fillText(info.name, M + 20, 1236);
  x.fillStyle = TEXT; x.font = `500 26px ${MONO}`;
  x.fillText(info.kind.toUpperCase(), M + 20, 1278);
  x.textAlign = 'right';
  x.fillText(location.host, W - M - 20, 1278);
  return c;
}

export const drawingPng = (strokes: Stroke[]) => thumb(strokes, 512);

// Share the image where the device can (phones), otherwise download it.
export async function save(canvas: HTMLCanvasElement, filename: string) {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], filename, { type: 'image/png' });
  try {
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch { /* fall through to download */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
