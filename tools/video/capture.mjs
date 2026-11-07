// Records the demo video scenes from the running app with headless Chrome (DevTools protocol, no deps).
// Each scene saves timestamped JPEG frames to video/cap/<scene>/ plus an ffconcat list for ffmpeg.
// Zoom-ins are done in the page (CSS transform), so text stays sharp. Scene lengths follow the narration.
//   node tools/video/capture.mjs [baseUrl] [scene ...]
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from '../cdp.mjs';

const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5180';
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('http'));
const OUT = path.resolve('video/cap');
const PAD = 0.7; // seconds of air after each narration line

// Scene length = narration length + padding (24 kHz, 16-bit mono WAV = 48000 bytes per second).
const D = {};
for (let i = 1; i <= 10; i++) {
  const bytes = fs.statSync(`video/vo/s${i}.wav`).size;
  D[`s${i}`] = +(((bytes - 44) / 48000) + PAD).toFixed(2);
}
fs.writeFileSync('video/durations.json', JSON.stringify(D, null, 1));
console.log('durations', D, 'total', Object.values(D).reduce((a, b) => a + b, 0).toFixed(1));

const b = await launch({ width: 1536, height: 864, scale: 1.25, port: 9361 });
const { cdp, evaluate } = b;
let onFrame = null;
b.on((m) => {
  if (m.method !== 'Page.screencastFrame') return;
  if (onFrame) onFrame(m.params);
  else cdp('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
});

const J = JSON.stringify;
const W = (s) => sleep(s * 1000);
const goto = async (url, wait) => { await cdp('Page.navigate', { url: BASE + url }); await W(wait); };
const click = (sel) => evaluate(`document.querySelector(${J(sel)})?.click()`);
const scrollTo = (sel, block = 'center') => evaluate(`document.querySelector(${J(sel)})?.scrollIntoView({behavior:"smooth",block:"${block}"})`);
const scrollTop = () => evaluate('window.scrollTo({top:0,behavior:"smooth"})');
// Smoothly zoom the page so the element fills most of the frame (leaving room for the caption bar).
const zoomEl = (expr, max = 1.8, ms = 1100) => evaluate(`(()=>{const e=${expr}; if(!e) return 0;
  const r=e.getBoundingClientRect(), vw=innerWidth, vh=innerHeight-86;
  const s=Math.max(1.04, Math.min(${max}, 0.92*vw/r.width, 0.9*vh/r.height));
  const cx=r.left+r.width/2+scrollX, cy=r.top+r.height/2+scrollY;
  const dx=vw/2-(r.left+r.width/2), dy=vh/2-(r.top+r.height/2);
  const bd=document.body; bd.style.transition="transform ${ms}ms cubic-bezier(.45,0,.2,1)"; bd.style.transformOrigin=cx+"px "+cy+"px";
  bd.style.transform="translate("+dx+"px,"+dy+"px) scale("+s+")";
  for (const t of document.querySelectorAll(".topbar,.lp-top")) { t.style.transition="opacity .3s"; t.style.opacity=0; }
  return s})()`);
const zoomTo = (sel, max, ms) => zoomEl(`document.querySelector(${J(sel)})`, max, ms);
const unzoom = (ms = 900) => evaluate(`(()=>{const bd=document.body; bd.style.transition="transform ${ms}ms cubic-bezier(.45,0,.2,1)"; bd.style.transform="";
  for (const t of document.querySelectorAll(".topbar,.lp-top")) t.style.opacity=1;})()`);
const ledgerItem = (text) => `[...document.querySelectorAll(".viewer .ledger-item")].find(e=>e.textContent.includes(${J(text)}))`;
const pdCard = `document.querySelector(".compare-grid > .answer-card:not(.baseline-card)")`;

async function record(name, action) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const seconds = D[name];
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const t0 = Date.now();
  const save = (data, t) => {
    const f = path.join(dir, `f${String(frames.length).padStart(4, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push({ f, t });
  };
  save((await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 92 })).data, 0);
  onFrame = (p) => {
    const t = Date.now() - t0;
    if (t < seconds * 1000) save(p.data, t);
    cdp('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  };
  await cdp('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const act = (async () => { try { await action(); } catch (e) { console.error(name, e.message); } })();
  while (Date.now() - t0 < seconds * 1000) await sleep(40);
  await cdp('Page.stopScreencast');
  onFrame = null;
  await act;
  await unzoom(0);
  const lines = ['ffconcat version 1.0'];
  frames.forEach((fr, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : seconds * 1000;
    lines.push(`file '${path.basename(fr.f)}'`, `duration ${((next - fr.t) / 1000).toFixed(3)}`);
  });
  lines.push(`file '${path.basename(frames.at(-1).f)}'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n') + '\n');
  console.log(`${name}: ${frames.length} frames over ${seconds}s`);
}

// s1: the problem, an unchecked desk repeating a poisoned FAQ
if (!ONLY.length || ONLY.includes('s1')) await goto('/app.html?v=1#answers?s=poisoned', 11);
await record('s1', async () => {
  await W(1.3);
  await zoomEl(`document.querySelector(".baseline-card")`, 1.55); await W(4.4);
  await zoomTo('.baseline-card .note.bad', 2.1); await W(4.2);
  await zoomTo('.baseline-card .sources', 2.0);
});

// s2: what Proofdesk is (landing hero, product shot)
if (!ONLY.length || ONLY.includes('s2')) await goto('/index.html?v=1', 3);
await record('s2', async () => {
  await W(6.8);
  await scrollTo('.shot-wrap', 'center'); await W(4.6);
  await scrollTo('#checkpoints', 'start');
});

// s3: checkpoint one, the source check sweep
if (!ONLY.length || ONLY.includes('s3')) await goto('/app.html?v=2#sources', 9);
await record('s3', async () => {
  await W(0.8);
  await click('#rescan-btn'); await W(4.2);
  await zoomTo('#stats', 1.5); await W(5.2);
  await unzoom(); await W(0.8);
  await zoomTo('#doc-list', 1.3);
});

// s4: Guard, Inspect and Protect findings, with their evidence
await record('s4', async () => {
  await click('[data-doc="benefits-faq"]'); await W(0.5);
  await zoomEl(ledgerItem('Hidden instructions'), 1.7); await W(6.0);
  await unzoom(600); await W(0.5);
  await click('[data-doc="it-printer"]'); await W(0.4);
  await zoomEl(ledgerItem('Script classed'), 1.7); await W(6.6);
  await unzoom(600); await W(0.5);
  await click('[data-doc="onboarding-blr"]'); await W(0.4);
  await zoomEl(ledgerItem('personal detail'), 1.8);
});

// s5: Compare retires the outdated travel policy
await record('s5', async () => {
  await click('[data-doc="travel-2025"]'); await W(0.5);
  await zoomEl(ledgerItem('conflicting statement'), 1.6); await W(7.2);
  await unzoom(); await W(0.4);
  await scrollTo('#conflicts', 'center'); await W(1.2);
  await zoomTo('#conflicts', 1.25);
});

// s6: checkpoint two on the wrong-country scenario
if (!ONLY.length || ONLY.includes('s6')) await goto('/app.html?v=3#answers', 8);
await record('s6', async () => {
  await W(0.6);
  await click('[data-scenario="regional"]'); await W(0.6);
  await zoomTo('.stepper', 1.35, 900); await W(5.6);
  await unzoom(700); await W(0.4);
  await zoomEl(`${pdCard}?.querySelector(".answer-body")`, 1.9); await W(5.2);
  await evaluate(`document.querySelector(".src-more")?.setAttribute("open","")`);
  await zoomEl(`${pdCard}?.querySelector(".sources")`, 1.7); await W(5.8);
  await zoomTo('.baseline-card', 1.45);
});

// s7: Decide hands questions to IT or the People Team
await record('s7', async () => {
  await unzoom(0); await evaluate('window.scrollTo(0,0)');
  await click('[data-scenario="unsafe-fix"]'); await W(3.6);
  await zoomEl(pdCard, 1.45); await W(5.0);
  await unzoom(600); await W(0.3);
  await click('[data-scenario="sensitive"]'); await W(3.4);
  await zoomEl(pdCard, 1.45);
});

// s8: Protect masks personal details, Guard blocks a manipulation attempt
await record('s8', async () => {
  await unzoom(0);
  await click('[data-scenario="personal"]'); await W(2.6);
  await zoomTo('.question-card', 1.9); await W(3.6);
  await unzoom(500); await W(0.2);
  await click('[data-scenario="manipulation"]'); await W(1.8);
  await zoomEl(pdCard, 1.6);
});

// s9: the ledger of what each call changed, with request and response; live mode with your own key
await record('s9', async () => {
  await unzoom(0);
  await click('[data-scenario="poisoned"]'); await W(2.8);
  await scrollTo('.ledger-card', 'start'); await W(1.2);
  await zoomTo('.ledger-card', 1.25); await W(4.4);
  await unzoom(500);
  await evaluate(`(()=>{const d=[...document.querySelectorAll(".ledger-card .lg details:not(.rr)")][4]; if(d){d.open=true; d.scrollIntoView({block:"center"});}})()`);
  await W(0.6);
  await zoomEl(`[...document.querySelectorAll(".ledger-card .lg details:not(.rr)")][4]`, 1.5); await W(4.6);
  await unzoom(400); await scrollTop(); await W(0.8);
  await click('#key-btn');
});
await evaluate(`document.querySelector("#key-dialog")?.close?.()`).catch(() => {});

b.close();
process.exit(0);
