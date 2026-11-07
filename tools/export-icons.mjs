// Renders the SVG logo to PNG sizes (transparent background) and a README lockup.
//   node tools/export-icons.mjs
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const b = await launch({ width: 800, height: 400, scale: 1, port: 9355 });
await b.cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

async function render(html, w, h, file, scale = 1) {
  await b.setViewport(w, h, scale);
  // A file:// page (not data:) so it may load the local SVG.
  const tmp = `${root}/video/tmp-render.html`;
  await writeFile(tmp, html);
  await b.cdp('Page.navigate', { url: `file:///${tmp}` });
  await new Promise((r) => setTimeout(r, 1200));
  const shot = await b.cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);
}
const mark = `file:///${root}/assets/img/mark.svg`;
for (const s of [180, 512]) {
  await render(`<body style="margin:0;background:transparent"><img src="${mark}" width="${s}" height="${s}" style="display:block"></body>`, s, s, `${root}/assets/img/icon-${s}.png`);
}
const lockup = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@650&display=swap" rel="stylesheet"></head>
<body style="margin:0;background:transparent;font-family:Inter,sans-serif"><div style="display:flex;align-items:flex-end;padding:6px 4px;font-weight:650;letter-spacing:-0.03em;line-height:1;color:#0d1524">
<img src="${mark}" width="56" height="56" style="margin-right:2px"><span style="font-size:48px;padding-bottom:6.5px">roofdesk</span></div></body></html>`;
await render(lockup, 270, 68, `${root}/assets/img/lockup.png`, 2);
await unlink(`${root}/video/tmp-render.html`).catch(() => {});
b.close();
process.exit(0);
