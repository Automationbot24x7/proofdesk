// Background music bed for the demo video (Lyria via the Gemini API). Shares the media spend ledger.
// Usage: GEMINI_KEY_FILE=path/to/key.txt node tools/video/gen-music.mjs [--force]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const key = process.env.GEMINI_API_KEY || readFileSync(process.env.GEMINI_KEY_FILE, "utf8").trim();
const LEDGER = process.env.MEDIA_LEDGER || "video/media-spend.json", BUDGET = 9.5, PRICE = 0.08;
const OUT = "video/music.mp3";
mkdirSync("video", { recursive: true });
if (existsSync(OUT) && !process.argv.includes("--force")) { console.log("exists"); process.exit(0); }
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { usd: 0, calls: [] };
if (ledger.usd + PRICE > BUDGET) throw new Error(`budget stop at $${ledger.usd}`);

const prompt = "Instrumental background bed for an enterprise security software product demo, about two minutes forty seconds. Minimal, precise modern electronic: deep soft pads, a clean ticking pulse like a quiet clock, a restrained piano motif, subtle low synth bass entering after the intro, sense of focus, trust and calm control, steady 92 BPM, no big drops, no vocals, leaves plenty of room for a voice-over, ends with a soft resolved chord.";
const r = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Api-Revision": "2026-05-20", "x-goog-api-key": key },
  body: JSON.stringify({ model: "lyria-3.5", input: prompt, response_format: { type: "audio" } }),
});
const j = await r.json();
if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
const audio = j.steps?.flatMap((s) => s.content || []).find((c) => c.type === "audio");
if (!audio) throw new Error("no audio in response");
writeFileSync(OUT, Buffer.from(audio.data, "base64"));
ledger.usd = +(ledger.usd + PRICE).toFixed(4);
ledger.calls.push({ what: "lyria proofdesk-bed", usd: PRICE, at: new Date().toISOString() });
writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
console.log(`music saved (${audio.mime_type || "audio"}) · ledger $${ledger.usd}`);
