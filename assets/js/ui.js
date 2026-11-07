// Small DOM and formatting helpers for the Proofdesk interface.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const pct = (x, digits = 0) => `${((x || 0) * 100).toFixed(digits)}%`;
export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const ENDPOINTS = {
  pipeline: { label: 'Pipeline', group: 0 },
  extract: { label: 'Extract', group: 1 },
  fill: { label: 'Fill', group: 1 },
  decide: { label: 'Decide', group: 1 },
  pii: { label: 'Protect', group: 2 },
  injection: { label: 'Guard', group: 2 },
  script: { label: 'Inspect', group: 2 },
  grounding: { label: 'Verify', group: 3 },
  compare: { label: 'Compare', group: 3 },
  rerank: { label: 'Rerank', group: 3 },
  local: { label: 'Local', group: 0 },
};

export function endpointTag(name, extra = '') {
  const e = ENDPOINTS[name] || { label: name, group: 0 };
  return `<span class="ep ep-g${e.group} ${extra}">${esc(e.label)}</span>`;
}

// Render text with any number of (possibly overlapping) marks.
// marks: [{ start, end, cls, title, after }] in Unicode code points; `after` is HTML inserted at the mark's end.
export function renderMarked(text, marks = []) {
  const chars = Array.from(text);
  const valid = marks.filter((m) => Number.isInteger(m.start) && Number.isInteger(m.end) && m.end > m.start && m.start >= 0 && m.end <= chars.length);
  const cuts = new Set([0, chars.length]);
  for (const m of valid) { cuts.add(m.start); cuts.add(m.end); }
  const points = [...cuts].sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const active = valid.filter((m) => m.start <= a && m.end >= b);
    let seg = esc(chars.slice(a, b).join(''));
    for (const m of active) seg = `<span class="${esc(m.cls)}"${m.title ? ` title="${esc(m.title)}"` : ''}>${seg}</span>`;
    html += seg;
    for (const m of valid) if (m.end === b && m.after) html += m.after;
  }
  return html;
}

// Line-level structure marks for the handbook's simple markdown (headings, list items, code blocks).
export function structureMarks(text) {
  const marks = [];
  const lines = text.split('\n');
  let pos = 0;
  let inCode = false;
  for (const line of lines) {
    const len = Array.from(line).length;
    if (/^```/.test(line)) {
      marks.push({ start: pos, end: pos + len, cls: 'md-fence' });
      inCode = !inCode;
    } else if (inCode) {
      if (len) marks.push({ start: pos, end: pos + len, cls: 'md-code' });
    } else if (/^# /.test(line)) {
      marks.push({ start: pos, end: pos + 2, cls: 'md-hash' }, { start: pos, end: pos + len, cls: 'md-h1' });
    } else if (/^## /.test(line)) {
      marks.push({ start: pos, end: pos + 3, cls: 'md-hash' }, { start: pos, end: pos + len, cls: 'md-h2' });
    } else if (/^- /.test(line)) {
      marks.push({ start: pos, end: pos + 2, cls: 'md-bullet' });
    }
    pos += len + 1;
  }
  return marks;
}

export function meter(value, tone = 'ok') {
  const v = Math.max(0, Math.min(1, value || 0));
  return `<span class="meter meter-${tone}"><span style="width:${(v * 100).toFixed(1)}%"></span></span>`;
}

export function icon(name, size = 16) {
  const paths = {
    check: '<path d="M4 8.5l2.5 2.5L12 5.5"/>',
    x: '<path d="M5 5l6 6M11 5l-6 6"/>',
    alert: '<path d="M8 3.5v5"/><circle cx="8" cy="11.5" r=".6" fill="currentColor"/>',
    shield: '<path d="M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4z"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
    doc: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
    search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
    sort: '<path d="M4 4h8M4 8h5M4 12h2"/>',
    pen: '<path d="M3 13l1-3 7-7 2 2-7 7z"/>',
    scale: '<path d="M8 2v12M3 5h10M3 5l-1.5 4h3zM13 5l-1.5 4h3z"/>',
    route: '<circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M5.5 4H10a2 2 0 010 4H6a2 2 0 000 4h4.5"/>',
    code: '<path d="M6 4L2 8l4 4M10 4l4 4-4 4"/>',
    eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
    key: '<circle cx="5.5" cy="10.5" r="2.5"/><path d="M7.5 9l5-5M11 5.5l1.5 1.5"/>',
    play: '<path d="M5 3.5l7 4.5-7 4.5z"/>',
    arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
    split: '<path d="M8 2v12M2 4h4M2 8h4M2 12h4M10 4h4M10 8h4M10 12h4"/>',
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
    copy: '<rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3h8"/>',
    chevron: '<path d="M6 4l4 4-4 4"/>',
    user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.8-2.5 2.7-3.5 5-3.5s4.2 1 5 3.5"/>',
    mask: '<rect x="2" y="5.5" width="12" height="5" rx="2.5"/>',
    stack: '<path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/>',
  };
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

export function jsonBlock(obj) {
  const text = JSON.stringify(obj, null, 2);
  return `<pre class="json">${esc(text)}</pre>`;
}
