#!/usr/bin/env node
// Builds prd/index.html (visual PRD: progress, handoff, recent changes, full spec)
// from PRD.md + prd/progress.json, and logs what changed to prd/changes.jsonl.
// `--hook`: read Claude Code hook JSON on stdin; rebuild only if one of those two
// files was edited. Always silent, never fails the tool call.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ORDER = ['verified', 'built', 'in-progress', 'planned', 'blocked'];
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DIR);
const P = {
  prd: path.join(ROOT, 'PRD.md'),
  progress: path.join(DIR, 'progress.json'),
  changes: path.join(DIR, 'changes.jsonl'),
  snap: path.join(DIR, '.snapshot.json'),
  out: path.join(DIR, 'index.html'),
};

if (process.argv.includes('--hook')) {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  const file = /"file_path"\s*:\s*"([^"]+)"/.exec(input)?.[1] || '';
  if (!/(^|\/)PRD\.md$|prd\/progress\.json$/.test(file)) process.exit(0);
  try { build(); } catch { /* never block the edit */ }
  process.exit(0);
}
build();
console.log(`built ${path.relative(process.cwd(), P.out)}`);

function build() {
  const md = fs.readFileSync(P.prd, 'utf8');
  const prog = JSON.parse(fs.readFileSync(P.progress, 'utf8'));
  const doc = parsePrd(md);
  logChanges(doc, prog);
  const changes = fs.existsSync(P.changes)
    ? fs.readFileSync(P.changes, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  fs.writeFileSync(P.out, page(doc, prog, changes));
}

// ---------- PRD.md -> sections ----------

function parsePrd(md) {
  const secs = [];
  let title = 'PRD', cur = { id: 'intro', num: '', title: '', level: 1, lines: [] };
  for (const line of md.split('\n')) {
    let m;
    if ((m = /^# (.+)/.exec(line))) title = m[1];
    else if ((m = /^## (\d+)\. (.+)/.exec(line)) || (m = /^### (\d+\.\d+) (.+)/.exec(line))) {
      secs.push(cur);
      cur = { id: 's' + m[1].replace('.', '-'), num: m[1], title: m[2], level: m[1].includes('.') ? 3 : 2, lines: [] };
    } else if (/^## /.test(line)) { secs.push(cur); cur = { skip: true, lines: [] }; } // table of contents
    else if (line !== '---') cur.lines.push(line);
  }
  secs.push(cur);
  return {
    title,
    sections: secs.filter((s) => !s.skip).map((s) => {
      const body = s.lines.join('\n').trim();
      return { ...s, body, hash: crypto.createHash('sha1').update(s.title + body).digest('hex').slice(0, 10) };
    }),
  };
}

// ---------- change log (diff against the last build) ----------

function logChanges(doc, prog) {
  const t = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const old = fs.existsSync(P.snap) ? JSON.parse(fs.readFileSync(P.snap, 'utf8')) : null;
  const feats = {};
  for (const m of prog.milestones) for (const f of m.features) feats[`${m.id}|${f.title}`] = f.status;
  const snap = {
    sections: Object.fromEntries(doc.sections.map((s) => [s.id, { num: s.num, title: s.title, hash: s.hash, body: s.body }])),
    feats,
    handoff: JSON.stringify(prog.handoff),
  };
  const out = [];
  if (!old) out.push({ t, kind: 'baseline', text: `Visual PRD started: ${doc.sections.length} sections, ${Object.keys(feats).length} features tracked` });
  else {
    for (const s of doc.sections) {
      const o = old.sections[s.id];
      if (!o) out.push({ t, kind: 'spec', ref: s.id, text: `§${s.num} ${s.title} added` });
      else if (o.hash !== s.hash) out.push({ t, kind: 'spec', ref: s.id, text: `§${s.num} ${s.title} edited (${lineDiff(o.body, s.body)})` });
    }
    for (const [id, o] of Object.entries(old.sections)) if (!snap.sections[id]) out.push({ t, kind: 'spec', text: `§${o.num} ${o.title} removed` });
    for (const [k, st] of Object.entries(feats)) {
      const was = old.feats[k];
      const [ms, title] = k.split('|');
      if (was !== st) out.push({ t, kind: 'progress', text: `${ms} · ${title}: ${was ? `${was} → ` : 'added as '}${st}` });
    }
    for (const k of Object.keys(old.feats)) if (!(k in feats)) out.push({ t, kind: 'progress', text: `${k.replace('|', ' · ')} removed` });
    if (old.handoff !== snap.handoff) out.push({ t, kind: 'handoff', text: 'Handoff updated' });
  }
  if (out.length) fs.appendFileSync(P.changes, out.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(P.snap, JSON.stringify(snap));
}

function lineDiff(a, b) {
  const count = (s) => s.split('\n').reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const A = count(a), B = count(b);
  let add = 0, del = 0;
  for (const [l, n] of B) add += Math.max(0, n - (A.get(l) || 0));
  for (const [l, n] of A) del += Math.max(0, n - (B.get(l) || 0));
  return `+${add} −${del} lines`;
}

// ---------- Markdown (the subset PRD.md uses) ----------

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function inline(s) {
  const code = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/https?:\/\/[^\s<)]+[^\s<).,;]/g, (u) => `<a href="${u}" rel="noopener" target="_blank">${u.replace(/^https?:\/\//, '').slice(0, 60)}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
}

function md(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const buf = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
    } else if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="tbl"><table><thead><tr>${cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`);
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const items = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        items.push({ ind: m[1].length, ol: /\d/.test(m[2]), text: m[3] });
      }
      out.push(list(items, 0, items.length));
    } else {
      const buf = [];
      for (; i < lines.length && lines[i].trim() && !/^(\s*([-*]|\d+\.)\s|\||```)/.test(lines[i]); i++) buf.push(lines[i]);
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

// Items in [a, b) at the indent of items[a]; deeper items nest under the previous one.
function list(items, a, b) {
  const ind = items[a].ind, tag = items[a].ol ? 'ol' : 'ul';
  let html = `<${tag}>`;
  for (let i = a; i < b;) {
    let j = i + 1;
    while (j < b && items[j].ind > ind) j++;
    html += `<li>${inline(items[i].text)}${j > i + 1 ? list(items, i + 1, j) : ''}</li>`;
    i = j;
  }
  return html + `</${tag}>`;
}

// ---------- page ----------

function page(doc, prog, changes) {
  const all = prog.milestones.flatMap((m) => m.features);
  const count = (fs_, st) => fs_.filter((f) => f.status === st).length;
  const label = prog.statuses;
  const anchor = (num) => (num ? `#s${String(num).replace('.', '-')}` : '#');
  const bar = (fs_) => `<div class="bar" role="img" aria-label="${ORDER.map((s) => `${count(fs_, s)} ${label[s]}`).join(', ')}">${
    ORDER.map((s) => { const n = count(fs_, s); return n ? `<span class="seg ${s}" style="flex:${n}" title="${label[s]}: ${n}"></span>` : ''; }).join('')}</div>`;
  const done = all.filter((f) => f.status === 'built' || f.status === 'verified').length;
  const recent = new Map(); // section id -> last change time
  for (const c of changes) if (c.ref) recent.set(c.ref, c.t);
  const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const h = prog.handoff;

  const milestones = prog.milestones.map((m) => `
    <details class="ms" ${m.features.some((f) => f.status !== 'planned') ? 'open' : ''}>
      <summary><span class="msid">${esc(m.id)}</span><span class="mst">${esc(m.title)}</span>
        <span class="msn">${count(m.features, 'built') + count(m.features, 'verified')}/${m.features.length}</span>${bar(m.features)}</summary>
      ${m.exit ? `<p class="exit"><b>Exit criteria:</b> ${inline(m.exit)}</p>` : ''}
      <ul class="feats">${m.features.map((f) => `<li><span class="dot ${f.status}"></span><a href="${anchor(f.section)}">${esc(f.title)}</a>
        <span class="st">${esc(label[f.status] || f.status)}</span>${f.note ? `<span class="note">${inline(f.note)}</span>` : ''}</li>`).join('')}</ul>
    </details>`).join('');

  const byDay = new Map();
  for (const c of changes.slice(-40).reverse()) {
    const d = c.t.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(c);
  }
  const changeHtml = [...byDay].map(([d, cs]) => `<h4>${d}</h4><ul class="chg">${cs.map((c) =>
    `<li><span class="k ${c.kind}">${c.kind}</span>${c.ref ? `<a href="#${c.ref}">${esc(c.text)}</a>` : esc(c.text)}<time>${c.t.slice(11)}</time></li>`).join('')}</ul>`).join('');

  const toc = doc.sections.filter((s) => s.level === 2).map((s) => `<a href="#${s.id}">${s.num}. ${esc(s.title)}</a>`).join('');
  const spec = doc.sections.map((s) => {
    const fresh = recent.has(s.id) && recent.get(s.id) >= cutoff;
    const hd = s.level === 1 ? '' : `<h${s.level} id="${s.id}">${s.num}${s.level === 2 ? '.' : ''} ${esc(s.title)}${fresh ? ` <span class="new">updated ${recent.get(s.id).slice(0, 10)}</span>` : ''}</h${s.level}>`;
    return `<section class="sec" data-l="${s.level}">${hd}${md(s.body)}</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title.split(/ [—-] /)[0])} PRD</title>
<style>
:root{--bg:#fcfcfb;--panel:#f3f2ee;--line:#e2e0d8;--ink:#0b0b0b;--ink2:#52514e;--ink3:#7a786f;--accent:#2a78d6;
--verified:#1baf7a;--built:#2a78d6;--in-progress:#eda100;--planned:#e6e4dc;--blocked:#e34948;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#1a1a19;--panel:#232321;--line:#383835;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#8f8d84;--accent:#6da7ec;
--verified:#199e70;--built:#3987e5;--in-progress:#c98500;--planned:#383835;--blocked:#e66767;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header{padding:20px 16px 8px;max-width:1240px;margin:auto}h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:var(--ink2);font-size:13px}
.wrap{max-width:1240px;margin:auto;padding:0 16px 48px}
.top{display:grid;grid-template-columns:1.3fr 1fr;gap:16px;margin:12px 0 28px}@media(max-width:860px){.top{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;min-width:0}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink2);margin:0 0 10px}
.kpi{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:10px}.kpi b{display:block;font-size:26px;line-height:1.1}.kpi span{font-size:12px;color:var(--ink2)}
.bar{display:flex;gap:2px;height:10px;border-radius:4px;overflow:hidden;background:var(--planned);flex:1;min-width:80px}
.seg{display:block;height:100%}.seg.verified{background:var(--verified)}.seg.built{background:var(--built)}.seg.in-progress{background:var(--in-progress)}.seg.planned{background:var(--planned)}.seg.blocked{background:var(--blocked)}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--ink2);margin:8px 0 12px}.legend i,.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}
.dot.planned,.legend i.planned{background:transparent;border:1.5px solid var(--ink3)}.verified{--c:var(--verified)}.built{--c:var(--built)}.in-progress{--c:var(--in-progress)}.blocked{--c:var(--blocked)}
.dot:not(.planned),.legend i:not(.planned){background:var(--c)}
.ms{border-top:1px solid var(--line)}.ms summary{display:flex;align-items:center;gap:10px;padding:9px 0;cursor:pointer;list-style:none}.ms summary::-webkit-details-marker{display:none}
.msid{font-weight:700;width:46px}.mst{width:150px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.msn{font-variant-numeric:tabular-nums;font-size:12px;color:var(--ink2);width:38px;text-align:right}
@media(max-width:520px){.mst{display:none}}
.exit{font-size:13px;color:var(--ink2);margin:0 0 8px}.feats{list-style:none;padding:0;margin:0 0 10px;columns:2 260px;column-gap:20px}
.feats li{break-inside:avoid;padding:3px 0;font-size:13.5px}.st{color:var(--ink3);font-size:12px;margin-left:6px}.note{display:block;color:var(--ink3);font-size:12px;margin-left:14px}
.handoff p{margin:0 0 10px}.handoff h3{font-size:13px;margin:12px 0 4px}.handoff ol,.handoff ul{margin:0;padding-left:20px;font-size:14px}
.chg{list-style:none;padding:0;margin:0 0 6px}.chg li{display:flex;gap:8px;align-items:baseline;padding:3px 0;font-size:13.5px;border-bottom:1px dashed var(--line)}
.chg time{margin-left:auto;color:var(--ink3);font-size:11px;font-variant-numeric:tabular-nums}.changes h4{margin:10px 0 2px;font-size:12px;color:var(--ink2)}
.changes{max-height:420px;overflow:auto}.k{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;padding:1px 6px;border-radius:4px;border:1px solid var(--line);color:var(--ink2);flex:none}
.doc{display:grid;grid-template-columns:230px 1fr;gap:28px}@media(max-width:860px){.doc{grid-template-columns:1fr}nav.toc{position:static!important;max-height:none!important}}
nav.toc{position:sticky;top:12px;align-self:start;max-height:calc(100vh - 24px);overflow:auto;font-size:13px}nav.toc a{display:block;padding:3px 0;color:var(--ink2)}
nav.toc input{width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;margin-bottom:8px}
.spec{min-width:0;max-width:820px}.spec h2{font-size:20px;margin:30px 0 8px;padding-top:12px;border-top:1px solid var(--line)}.spec h3{font-size:16px;margin:20px 0 6px}
.new{font-size:11px;font-weight:600;color:var(--bg);background:var(--accent);border-radius:4px;padding:1px 6px;vertical-align:middle}
.tbl{overflow-x:auto}table{border-collapse:collapse;font-size:13.5px;margin:8px 0}th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{background:var(--panel)}
code{font:12.5px ui-monospace,Menlo,monospace;background:var(--panel);padding:1px 4px;border-radius:4px}pre{background:var(--panel);padding:10px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
.hide{display:none}mark{background:#fab21955;color:inherit}
</style></head><body>
<header><h1>${esc(doc.title)}</h1><p>Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from PRD.md and prd/progress.json</p></header>
<div class="wrap">
<div class="top">
  <div class="card"><h2>Progress</h2>
    <div class="kpi"><div><b>${done}/${all.length}</b><span>features built or verified</span></div>
      <div><b>${count(all, 'verified')}</b><span>verified</span></div><div><b>${count(all, 'in-progress')}</b><span>partly built</span></div>
      <div><b>${count(all, 'blocked')}</b><span>blocked</span></div></div>
    ${bar(all)}
    <div class="legend">${ORDER.map((s) => `<span><i class="${s}"></i>${esc(label[s])} (${count(all, s)})</span>`).join('')}</div>
    ${milestones}
  </div>
  <div>
    <div class="card handoff"><h2>Handoff · ${esc(h.updated || '')}</h2><p>${inline(h.summary || '')}</p>
      ${h.next?.length ? `<h3>Next</h3><ol>${h.next.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>` : ''}
      ${h.open?.length ? `<h3>Open issues</h3><ul>${h.open.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}</div>
    <div class="card changes" style="margin-top:16px"><h2>Recent changes</h2>${changeHtml || '<p>None yet.</p>'}</div>
  </div>
</div>
<div class="doc">
  <nav class="toc"><input id="q" type="search" placeholder="Search the PRD…" aria-label="Search the PRD">${toc}</nav>
  <main class="spec">${spec}</main>
</div></div>
<script>
const q=document.getElementById('q'),secs=[...document.querySelectorAll('.sec')];
q.addEventListener('input',()=>{const t=q.value.trim().toLowerCase();
for(const s of secs)s.classList.toggle('hide',!!t&&!s.textContent.toLowerCase().includes(t));});
</script>
</body></html>
`;
}
