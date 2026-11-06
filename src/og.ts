import { LIVE_LOGO } from './logo';
import { PAPER, SANS, TEXT } from './render';

// The share preview (?demo=og): the live logo on clean paper. The squiggle
// draws in, its creature scurries along it, bobs and blinks.
// scripts/og.mjs captures it as public/og.png and public/og.mp4.
export function ogScene(app: HTMLElement) {
  app.innerHTML = `<div class="og">${LIVE_LOGO}<p>Draw a creature. Race your friends.</p></div>`;
  const style = document.createElement('style');
  // The logo's artwork ends at x≈458 of its 520-wide box: nudge it right to sit centred.
  style.textContent = `body { margin: 0; background: ${PAPER}; overflow: hidden; }
    .og { width: 1200px; height: 630px; display: grid; place-content: center; justify-items: center; }
    .og .live-logo { width: 760px; transform: translateX(45px); }
    .og p { margin: 8px 0 0; font: 500 32px ${SANS}; color: ${TEXT}; letter-spacing: -0.01em; }`;
  document.head.appendChild(style);
}
