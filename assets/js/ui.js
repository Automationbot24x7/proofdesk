// Small DOM and formatting helpers for the Proofdesk interface.
import { ICONS } from './icons.js';

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
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function jsonBlock(obj) {
  const text = JSON.stringify(obj, null, 2);
  return `<pre class="json">${esc(text)}</pre>`;
}
