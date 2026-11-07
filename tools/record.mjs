// Runs Proofdesk's flows against the live Clocked API and saves every response, so the hosted demo can
// replay real results for visitors who have not added a key.
//
//   node tools/record.mjs                 library check + every sample (writes data/recorded/recordings.json)
//   node tools/record.mjs library         library check only
//   node tools/record.mjs ask <sample-id> one sample question (prints the outcome)
//
// The key is read from CLOCKED_API_KEY or Credentials/clocked-key.txt (git-ignored).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '../assets/js/clocked.js';
import { loadHandbook, screenLibrary, ask, checkAnswer, buildLibrary } from '../assets/js/flows.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (p) => readFile(path.join(root, p), 'utf8');
const outFile = path.join(root, 'data/recorded/recordings.json');

async function getKey() {
  if (process.env.CLOCKED_API_KEY) return process.env.CLOCKED_API_KEY.trim();
  return (await readFile(path.join(root, 'Credentials/clocked-key.txt'), 'utf8')).trim();
}

const [mode = 'all', arg] = process.argv.slice(2);
const recordings = existsSync(outFile) ? JSON.parse(await readFile(outFile, 'utf8')) : {};
let credits = 0;
const client = createClient({
  key: await getKey(),
  concurrency: 4,
  onRecord: (hash, entry) => { recordings[hash] = entry; },
  onCall: (e) => {
    if (e.ok) { credits += e.meta.credits; console.log(`  ${e.endpoint.padEnd(9)} ${String(e.meta.credits).padStart(4)} cr ${String(e.meta.ms).padStart(6)} ms`); }
    else console.log(`  ${e.endpoint.padEnd(9)} ERROR ${e.error.message}`);
  },
});

const log = (e) => { if (e.status === 'done' || e.status === 'error' || e.status === 'skipped') console.log(`[${e.key}] ${e.status} ${e.summary || e.error?.message || ''}`); };

const handbook = await loadHandbook(readText);
const samples = JSON.parse(await readText('data/samples.json'));

console.log('Library check');
const library = await screenLibrary(client, handbook, { onStep: log });
for (const d of library.docs) {
  console.log(`  ${d.id.padEnd(15)} ${String(d.metadata?.effectiveIso || '-').padEnd(11)} ${d.flags.join(', ') || 'clear'}`);
}
for (const c of library.conflicts) console.log(`  conflict ${c.a} x ${c.b}: ${c.findings.length} findings, ${c.resolution.kind}`);

async function save() {
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(recordings));
  console.log(`Saved ${Object.keys(recordings).length} recordings. Credits this run: ${credits}`);
}

function printAsk(r) {
  console.log(`  masked: ${r.screen?.masked}`);
  console.log(`  used: ${(r.retrieval?.used || []).map((p) => p.id).join(', ')}`);
  for (const x of r.retrieval?.results || []) console.log(`    ${x.id.padEnd(18)} ${x.action.padEnd(6)} ${(x.reason || '').padEnd(15)} ${x.relevance_score.toFixed(3)} kw#${x.keywordRank ?? '-'}`);
  if (r.draft) console.log(`  draft: ${r.draft.answer}\n  key rule: ${r.draft.keyRule?.value}`);
  for (const c of r.verify?.claims || []) console.log(`    [${c.verdict}] ${c.claim}`);
  console.log(`  route: ${JSON.stringify(r.route)}`);
}

if (mode === 'ask') {
  const s = samples.ask.find((x) => x.id === arg);
  const r = await ask(client, library, s, { onStep: log });
  printAsk(r);
} else if (mode === 'check') {
  const s = samples.check.find((x) => x.id === arg);
  const r = await checkAnswer(client, library, s, { onStep: log });
  for (const c of r.verify?.claims || []) console.log(`    [${c.verdict}] ${c.claim}`);
} else if (mode === 'all') {
  for (const s of samples.ask) {
    console.log(`\nAsk: ${s.id}`);
    printAsk(await ask(client, library, s, { onStep: log }));
  }
  for (const s of samples.check) {
    console.log(`\nCheck: ${s.id}`);
    const r = await checkAnswer(client, library, s, { onStep: log });
    for (const c of r.verify?.claims || []) console.log(`    [${c.verdict}] ${c.claim}`);
  }
}
await save();
void buildLibrary;
