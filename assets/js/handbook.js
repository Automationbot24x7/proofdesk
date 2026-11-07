// Handbook parsing: documents, code blocks, passages and a small keyword retriever.
// Pure functions, shared by the browser and the Node recorder.

// Clocked offsets count Unicode code points; JavaScript strings count UTF-16 units.
export const cpLength = (s) => Array.from(s).length;
export const cpSlice = (s, start, end) => Array.from(s).slice(start, end).join('');
const toCp = (s, utf16Index) => cpLength(s.slice(0, utf16Index));

const FENCE = /```([a-z0-9_-]*)\n([\s\S]*?)```/gi;

export function parseDocument(id, file, raw) {
  const heading = (raw.match(/^# (.+)$/m) || [, id])[1].trim();
  const codeBlocks = [];
  for (const m of raw.matchAll(FENCE)) {
    const codeStart = m.index + 3 + m[1].length + 1;
    codeBlocks.push({
      lang: m[1] || 'text',
      code: m[2],
      start: toCp(raw, codeStart),
      end: toCp(raw, codeStart + m[2].length),
    });
  }
  return { id, file, raw, heading, codeBlocks };
}

// All code blocks of a document joined into one script for Inspect, with a map back to the document.
export function scriptFor(doc) {
  if (!doc.codeBlocks.length) return null;
  let script = '';
  const parts = [];
  for (const block of doc.codeBlocks) {
    if (script) script += '\n\n';
    parts.push({ scriptStart: cpLength(script), docStart: block.start, length: cpLength(block.code) });
    script += block.code;
  }
  const toDoc = (offset) => {
    const part = parts.find((p) => offset >= p.scriptStart && offset <= p.scriptStart + p.length);
    return part ? part.docStart + (offset - part.scriptStart) : null;
  };
  return { script, toDoc };
}

// Sections that start with "## " become passages. The header block above the first section is metadata.
export function splitPassages(doc, text, { withheldNote = null, title = doc.heading } = {}) {
  const lines = text.split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^## (.+)$/);
    if (m) {
      current = { heading: m[1].trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return sections.map((s, n) => {
    let body = s.body.join('\n').trim();
    let hasScript = false;
    body = body.replace(FENCE, (_, lang, code) => {
      hasScript = true;
      return withheldNote ? `[${withheldNote}]` : '```' + lang + '\n' + code + '```';
    });
    return {
      id: `${doc.id}:${n + 1}`,
      docId: doc.id,
      n: n + 1,
      heading: s.heading,
      title: `${title} · ${s.heading}`,
      text: body,
      hasScript,
      scriptWithheld: hasScript && !!withheldNote,
    };
  });
}

// ---- Keyword retrieval (BM25), standing in for a search index before Rerank ----

const STOP = new Set(('a an and are as at be but by can could do does for from had has have how i if in into is it its me my '
  + 'of on or our should so than that the their them then there these they this to was we were what when where which who '
  + 'will with would you your am any get got im ive id need want much many after before about also just been being').split(' '));

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((t) => !STOP.has(t) && t.length > 1)
    .map(stem);
}

// A light suffix stemmer: "working", "worked" and "works" all match "work".
function stem(t) {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function keywordSearch(passages, query, k = 20) {
  const docs = passages.map((p) => tokenize(p.title + ' ' + p.text));
  const N = docs.length;
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, N);
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const q = [...new Set(tokenize(query))];
  const k1 = 1.2, b = 0.75;
  const scored = passages.map((p, i) => {
    const d = docs[i];
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avg));
    }
    return { passage: p, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score || a.passage.id.localeCompare(b2.passage.id))
    .slice(0, k)
    .map((s, i) => ({ ...s, keywordRank: i + 1 }));
}
