// Tiny Chrome DevTools Protocol helper (no dependencies) used by the screenshot and video capture tools.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9341, width = 1440, height = 900, scale = 1, mobile = false } = {}) {
  const profile = path.join(os.tmpdir(), `proofdesk-chrome-${port}`);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--hide-scrollbars', '--force-color-profile=srgb', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => chrome.kill());
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else for (const l of listeners) l(m);
  });
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  const setViewport = (w, h, s = scale, m = mobile) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: s, mobile: m });
  await setViewport(width, height);
  const goto = async (url, wait = 1500) => { await cdp('Page.navigate', { url }); await sleep(wait); };
  const shot = async (clip = null, fullPage = false) => {
    let params = { format: 'png' };
    if (fullPage) {
      const h = await evaluate('Math.ceil(document.documentElement.scrollHeight)');
      params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } };
    } else if (clip) params = { ...params, clip: { ...clip, scale: 1 } };
    return Buffer.from((await cdp('Page.captureScreenshot', params)).data, 'base64');
  };
  return { cdp, evaluate, goto, shot, setViewport, on: (fn) => listeners.add(fn), close: () => { ws.close(); chrome.kill(); } };
}
