// Clocked API client shared by the browser app and the Node recorder.
//
// Two transports:
//   live   - calls https://clocked.rezolve.ai/clocked/<endpoint> with the viewer's own key
//   replay - answers from responses recorded earlier with a real key (data/recorded/*.json),
//            looked up by a hash of the exact endpoint + request body
//
// Retries follow the Clocked guide: the same Idempotency-Key is reused for 429, 5xx and
// network failures, and a new one is created only when the API says retryAsNew.

export const API_BASE = 'https://clocked.rezolve.ai/clocked/';

export class ClockedError extends Error {
  constructor(message, { status = 0, endpoint = '', detail = null, code = '' } = {}) {
    super(message);
    this.name = 'ClockedError';
    this.status = status;
    this.endpoint = endpoint;
    this.detail = detail;
    this.code = code;
  }
}

// Stable JSON: object keys sorted, so the same request always hashes the same way.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export async function requestHash(endpoint, body) {
  const bytes = new TextEncoder().encode(endpoint + '\n' + stableStringify(body));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeError(status, payload) {
  const detail = payload?.detail ?? payload?.error ?? payload?.message ?? payload;
  let text = '';
  if (Array.isArray(detail)) {
    text = detail.map((d) => (d.loc ? d.loc.join('.') + ': ' : '') + (d.msg || JSON.stringify(d))).join('; ');
  } else if (detail && typeof detail === 'object') {
    text = detail.message || detail.msg || JSON.stringify(detail);
  } else if (detail) {
    text = String(detail);
  }
  const lead = {
    400: 'The request was not accepted',
    401: 'The Clocked key was not accepted',
    402: 'The Clocked account is out of credits',
    403: 'The Clocked key does not have permission for this',
    409: 'A matching request is still running',
    413: 'The request is too large',
    422: 'The request was not valid for this endpoint',
    429: 'Clocked is busy (too many requests at once)',
  }[status] || (status >= 500 ? 'Clocked had a server error' : `Request failed (${status})`);
  return text ? `${lead}: ${text}` : lead;
}

// A small semaphore: the hackathon plan allows four requests in flight per account.
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

export function createClient({
  key = '',
  mode = 'live',
  recordings = null,      // { [hash]: { endpoint, response, meta } } for replay
  onRecord = null,        // (hash, entry) => void, called after each live success (recorder)
  onCall = null,          // (event) => void, for usage counters and logs
  concurrency = 3,
  timeoutMs = 120000,
  replayDelayMs = 0,      // replay can wait a little so the interface shows each step
} = {}) {
  const run = limiter(concurrency);

  async function live(endpoint, body) {
    if (!key) throw new ClockedError('Add a Clocked API key to run this live.', { code: 'no_key', endpoint });
    let idem = uuid();
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(Math.min(8000, 700 * 2 ** (attempt - 1)) + Math.random() * 400);
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(API_BASE + endpoint, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + key,
            'Content-Type': 'application/json',
            'Idempotency-Key': idem,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        lastError = new ClockedError(
          err?.name === 'AbortError' ? 'Clocked did not answer in time' : 'Could not reach Clocked (network error)',
          { endpoint, code: 'network' },
        );
        continue; // same idempotency key: the outcome is unknown
      }
      clearTimeout(timer);
      const text = await res.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
      const ms = Date.now() - started;
      if (res.ok) {
        const h = (name) => res.headers.get(name);
        const meta = {
          endpoint,
          status: res.status,
          ms,
          credits: Number(h('X-Clocked-Credits')) || 0,
          modelMs: Number(h('X-Clocked-Model-Ms')) || 0,
          costUsd: Number(h('X-Clocked-Cost-Usd')) || 0,
          costBasis: h('X-Clocked-Cost-Basis') || '',
          transport: h('X-Clocked-Transport') || '',
          replay: false,
        };
        return { data: payload, meta };
      }
      lastError = new ClockedError(describeError(res.status, payload), { status: res.status, endpoint, detail: payload });
      if (payload && payload.retryAsNew === true) { idem = uuid(); continue; }
      if (res.status === 429 || res.status >= 500) continue;
      throw lastError; // 4xx: fix the input, do not retry
    }
    throw lastError;
  }

  async function replay(endpoint, body, hash) {
    const entry = recordings && recordings[hash];
    if (!entry) {
      throw new ClockedError('This request has not been recorded. Add your Clocked key to run it live.', {
        code: 'not_recorded', endpoint,
      });
    }
    if (replayDelayMs) await sleep(replayDelayMs * (0.6 + Math.random() * 0.8));
    return { data: structuredClone(entry.response), meta: { ...entry.meta, replay: true } };
  }

  async function call(endpoint, body) {
    const hash = await requestHash(endpoint, body);
    return run(async () => {
      try {
        const out = mode === 'replay' ? await replay(endpoint, body, hash) : await live(endpoint, body);
        if (mode !== 'replay' && onRecord) onRecord(hash, { endpoint, response: out.data, meta: out.meta });
        onCall?.({ ok: true, endpoint, hash, meta: out.meta });
        return out;
      } catch (err) {
        onCall?.({ ok: false, endpoint, hash, error: err });
        throw err;
      }
    });
  }

  return {
    call,
    get mode() { return mode; },
    hasRecording: async (endpoint, body) => !!(recordings && recordings[await requestHash(endpoint, body)]),
  };
}
