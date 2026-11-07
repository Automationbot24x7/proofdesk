// Renders the video end card (tools/video/endcard.html) to video/endcard.png at 1920x1080.
//   node tools/video/render-stills.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..').replace(/\\/g, '/');
const b = await launch({ width: 1920, height: 1080, scale: 1, port: 9362 });
await b.cdp('Page.navigate', { url: `file:///${root}/tools/video/endcard.html` });
await sleep(2500);
await writeFile(`${root}/video/endcard.png`, await b.shot());
console.log('saved video/endcard.png');
b.close();
process.exit(0);
