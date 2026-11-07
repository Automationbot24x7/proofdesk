// Crisp crops of real app states for the landing page (2x device pixels).
//   node tools/ui-crops.mjs [baseUrl]
import { writeFile } from 'node:fs/promises';
import { launch, sleep } from './cdp.mjs';

const BASE = process.argv[2] || 'http://localhost:5180';
const b = await launch({ width: 1440, height: 1000, scale: 2, port: 9353 });
const rect = (sel, maxH) => b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(Math.min(r.height, ${maxH})) }; })()`);
const crop = async (sel, maxH, file) => {
  const r = await rect(sel, maxH);
  const shot = await b.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r, scale: 1 } });
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file, r.width, 'x', r.height);
};

await b.goto(`${BASE}/app.html?c=1#sources`, 8000);
await b.evaluate("document.querySelector('[data-doc=\"it-printer\"]').click()");
await sleep(500);
await crop('#viewer', 640, 'video/ui-sources.png');

await b.goto(`${BASE}/app.html?c=2#answers?s=regional`, 9000);
await b.evaluate("document.querySelectorAll('.src-more').forEach((d) => d.removeAttribute('open'))");
await sleep(300);
await crop('.compare-grid', 600, 'video/ui-answers.png');
b.close();
process.exit(0);
