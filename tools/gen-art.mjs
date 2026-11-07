// Generates Proofdesk's landing-page illustrations with Gemini image generation.
// Originals go to video/art (not committed); web copies are written to assets/img by tools/web-art.py.
// Usage: GEMINI_KEY_FILE=path/to/key.txt node tools/gen-art.mjs [only-name]
// Every call is added to a shared media budget ledger (MEDIA_LEDGER) and stops at MEDIA_BUDGET_USD.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const key = process.env.GEMINI_API_KEY || readFileSync(process.env.GEMINI_KEY_FILE, 'utf8').trim();
const MODEL = process.env.IMAGE_MODEL || 'gemini-3-pro-image';
const OUT = 'video/art';
const LEDGER = process.env.MEDIA_LEDGER || 'video/media-spend.json';
const BUDGET = Number(process.env.MEDIA_BUDGET_USD || 9.5);
const PRICE = 0.134; // per 1K/2K image
mkdirSync(OUT, { recursive: true });

const STYLE = 'Premium editorial 3D illustration with clean geometric forms, soft volumetric light and a subtle film grain. '
  + 'Deep ink-navy background (#0a0f1f). Luminous indigo (#5b6cff) and cool white light are the main colours, with small '
  + 'accents of coral red (#ff6b5e) for danger and soft violet (#a78bfa) for privacy. Calm, precise, enterprise-security mood. '
  + 'No text, no letters, no numbers, no logos, no watermark, no user interface, no border.';

const JOBS = [
  {
    name: 'hero', ratio: '16:9', size: '2K',
    prompt: 'Wide cinematic key art. A loose, slightly chaotic cloud of floating paper documents drifts in from the left edge '
      + 'and passes through a tall, thin, translucent gate made of fine indigo light lines, standing in the right-centre of the '
      + 'frame like a security arch. On the far side of the gate the documents emerge glowing softly and settle into a neat, '
      + 'orderly stack. One document is caught inside the gate, glowing coral red and held in a faint containment field. On '
      + 'another page a thin strip of lines dissolves into soft violet particles. Keep the left third dark and nearly empty, '
      + 'with only a few faint pages, as space for a title. Shallow depth of field. ' + STYLE,
  },
  {
    name: 'sources', ratio: '4:3', size: '1K',
    prompt: 'A single sheet of paper floats at a slight angle under a thin horizontal scanning beam of indigo light. Where the '
      + 'beam has passed, some lines of the page glow softly white, one line glows coral red, and one short strip is covered '
      + 'by a soft violet frosted bar as if masked. Behind it, a few other pages wait in soft focus, and one older page fades '
      + 'into grey. ' + STYLE,
  },
  {
    name: 'answers', ratio: '4:3', size: '1K',
    prompt: 'Two floating speech bubbles made of translucent glass, side by side. The left bubble holds neat glowing blocks, '
      + 'each tied by a thin indigo thread to a small source page below it, every thread ending in a tiny bright anchor point. '
      + 'The right bubble has no threads; it is hairline-cracked and one of its blocks glows coral red. ' + STYLE,
  },
];

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { usd: 0, calls: [] };
async function gen(job) {
  const file = `${OUT}/${job.name}.png`;
  if (existsSync(file) && !process.argv[2]) return `skip ${job.name}`;
  if (ledger.usd + PRICE > BUDGET) throw new Error(`budget stop at $${ledger.usd}`);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: job.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: job.ratio, imageSize: job.size } },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${job.name}: ${j.error?.message || r.status}`);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(`${job.name}: no image returned`);
  writeFileSync(file, Buffer.from(part.inlineData.data, 'base64'));
  ledger.usd = +(ledger.usd + PRICE).toFixed(4);
  ledger.calls.push({ what: `proofdesk image ${job.name}`, usd: PRICE, at: new Date().toISOString() });
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
  return `ok ${job.name}`;
}

const only = process.argv[2];
const jobs = JOBS.filter((j) => !only || j.name === only);
const res = await Promise.allSettled(jobs.map(gen));
for (const r of res) console.log(r.status === 'fulfilled' ? r.value : `FAIL ${r.reason.message}`);
console.log(`media ledger: $${ledger.usd}`);
