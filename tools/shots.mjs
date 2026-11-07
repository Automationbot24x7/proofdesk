// Screenshots of the running app for design reviews and the landing page hero.
//   node tools/shots.mjs [baseUrl] [outDir]
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launch, sleep } from './cdp.mjs';

const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = path.resolve(process.argv[3] || 'video/shots');
await mkdir(OUT, { recursive: true });

const b = await launch({ width: 1440, height: 900, scale: 1 });
const save = async (name, buf) => { await writeFile(path.join(OUT, name), buf); console.log('saved', name); };

await b.goto(`${BASE}/index.html`, 2500);
await save('01-landing.png', await b.shot());
await save('01-landing-full.png', await b.shot(null, true));

await b.goto(`${BASE}/app.html#sources`, 9000);
await save('02-sources.png', await b.shot());
await b.evaluate("document.querySelector('[data-doc=\"onboarding-blr\"]').click()");
await sleep(400);
await save('03-sources-pii.png', await b.shot());
await b.evaluate("document.querySelector('[data-doc=\"it-printer\"]').click(); document.querySelector('.viewer .doc-text').scrollTop = 400");
await sleep(400);
await save('04-sources-script.png', await b.shot());
await save('05-sources-full.png', await b.shot(null, true));

for (const s of ['poisoned', 'regional', 'sensitive', 'manipulation', 'personal']) {
  await b.goto(`${BASE}/app.html#answers?s=${s}`, 9000);
  await save(`10-answer-${s}.png`, await b.shot());
  await save(`11-answer-${s}-full.png`, await b.shot(null, true));
}

// Hero image for the landing page: the poisoned-FAQ comparison at 2x.
await b.setViewport(1440, 900, 2);
await b.goto(`${BASE}/app.html#answers?s=poisoned`, 9000);
await save('hero.png', await b.shot());

// Phone width
await b.setViewport(390, 844, 2, true);
await b.goto(`${BASE}/app.html#answers?s=regional`, 9000);
await save('20-mobile-answer.png', await b.shot());
await b.goto(`${BASE}/index.html`, 2500);
await save('21-mobile-landing.png', await b.shot());
b.close();
process.exit(0);
