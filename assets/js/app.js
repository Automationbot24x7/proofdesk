// Proofdesk interface: wires the Clocked flows to the two checkpoint screens.
import { createClient } from './clocked.js';
import { loadHandbook, screenLibrary, ask, checkAnswer, PROFILES, DEFAULT_PROFILE, ROUTE_LABELS, uncheckedPassages, verifySummary } from './flows.js';
import { $, $$, esc, pct, plural, formatDate, endpointTag, renderMarked, structureMarks, meter, icon, jsonBlock } from './ui.js';

const KEY_STORE = 'proofdesk.clockedKey';
// Probabilities near 0 or 1 keep a decimal, so 0.9961 reads as 99.6% rather than a round 100%.
const pp = (x) => { const v = (x || 0) * 100; return (v >= 99.5 || (v > 0 && v < 0.5) ? v.toFixed(1) : Math.round(v)) + '%'; };

const state = {
  view: 'sources',
  key: '',
  recordings: null,
  handbook: null,
  samples: null,
  library: null,
  libraryLive: false,
  screening: false,
  docStatus: {},
  libSteps: {},
  libError: null,
  selectedDoc: 'benefits-faq',
  profile: { ...DEFAULT_PROFILE },
  scenario: null,
  result: null,
  running: false,
  credits: 0,
  costUsd: 0,
};

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

const readText = async (p) => {
  const res = await fetch(p, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${p}`);
  return res.text();
};

async function boot() {
  try { state.key = sessionStorage.getItem(KEY_STORE) || ''; } catch { /* storage blocked */ }
  bindChrome();
  renderMode();
  try {
    const [handbook, samples, recordings] = await Promise.all([
      loadHandbook(readText),
      readText('data/samples.json').then(JSON.parse),
      readText('data/recorded/recordings.json').then(JSON.parse).catch(() => null),
    ]);
    state.handbook = handbook;
    state.samples = samples;
    state.recordings = recordings;
  } catch (err) {
    $('#view-sources').insertAdjacentHTML('afterbegin', `<div class="inline-error bad">${icon('alert')}<span>${esc(err.message)}</span></div>`);
    return;
  }
  renderPersona();
  renderScenarios();
  route();
  renderSources();
  renderResult();
  if (state.recordings || state.key) runSourceCheck();
}

function bindChrome() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => { location.hash = t.dataset.view; }));
  window.addEventListener('hashchange', route);
  $('#key-btn').addEventListener('click', () => (state.key ? forgetKey() : openKeyDialog()));
  $('#rescan-btn').addEventListener('click', () => runSourceCheck());
  $('#ask-btn').addEventListener('click', () => runAsk($('#question').value.trim()));
  $('#question').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runAsk($('#question').value.trim()); });
  $('#check-btn').addEventListener('click', () => runCheck($('#question').value.trim(), $('#pasted').value.trim()));
  $('#p-country').addEventListener('change', (e) => { state.profile.country = e.target.value; markScenario(null); });
  $('#p-employment').addEventListener('change', (e) => { state.profile.employment = e.target.value; markScenario(null); });
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  $('#key-dialog').addEventListener('close', onKeyDialogClose);
  document.addEventListener('click', onDelegatedClick);
}

function route() {
  const [view, query] = (location.hash.slice(1) || 'sources').split('?');
  state.view = view === 'answers' ? 'answers' : 'sources';
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === state.view)));
  $('#view-sources').hidden = state.view !== 'sources';
  $('#view-answers').hidden = state.view !== 'answers';
  const params = new URLSearchParams(query || '');
  const s = params.get('s');
  if (state.view === 'answers' && s && state.samples) {
    const sample = state.samples.ask.find((x) => x.id === s);
    if (sample && state.scenario !== s) {
      if (state.library) setTimeout(() => runScenario(sample), 50);
      else { state.pendingScenario = sample; markScenario(sample.id); }
    }
  }
  const d = params.get('doc');
  if (d) { state.selectedDoc = d; renderSources(); }
}

// ---------------------------------------------------------------------------------------------
// Key and mode
// ---------------------------------------------------------------------------------------------

function makeClient({ replayDelayMs = 380 } = {}) {
  const onCall = (e) => {
    if (e.ok && !e.meta.replay) { state.credits += e.meta.credits || 0; state.costUsd += e.meta.costUsd || 0; renderMode(); }
  };
  if (state.key) return createClient({ key: state.key, mode: 'live', concurrency: 4, onCall });
  return createClient({ mode: 'replay', recordings: state.recordings || {}, replayDelayMs, concurrency: 4, onCall });
}

function renderMode() {
  const pill = $('#mode-pill');
  pill.classList.toggle('live', !!state.key);
  $('#mode-text').innerHTML = state.key
    ? `<b>Live</b><span class="long"> · ${state.credits.toLocaleString()} credits used</span>`
    : `<b>Recorded</b><span class="long"> responses</span>`;
  $('#key-btn').innerHTML = state.key ? 'Remove key' : `${icon('key')}Run live<span class="long"> with your key</span>`;
  $('#key-btn').className = state.key ? 'btn btn-sm btn-ghost' : 'btn btn-sm btn-primary';
  $('#rescan-btn').innerHTML = state.key ? `${icon('play')}Run source check live` : `${icon('play')}Replay source check`;
}

function openKeyDialog() {
  $('#key-input').value = '';
  $('#key-dialog').showModal();
  setTimeout(() => $('#key-input').focus(), 30);
}

function onKeyDialogClose() {
  if ($('#key-dialog').returnValue !== 'save') return;
  const key = $('#key-input').value.trim();
  if (!key) return;
  state.key = key;
  $('#key-input').value = '';
  try { if ($('#key-remember').checked) sessionStorage.setItem(KEY_STORE, key); } catch { /* ignore */ }
  renderMode();
  renderResult();
}

function forgetKey() {
  state.key = '';
  try { sessionStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
  renderMode();
  renderResult();
}

// ---------------------------------------------------------------------------------------------
// Source check
// ---------------------------------------------------------------------------------------------

async function runSourceCheck() {
  if (state.screening || !state.handbook) return;
  state.screening = true;
  state.libError = null;
  state.library = null;
  state.libSteps = {};
  state.docStatus = Object.fromEntries(state.handbook.docs.map((d) => [d.id, { status: 'running' }]));
  renderSources();
  const live = !!state.key;
  try {
    const client = makeClient({ replayDelayMs: 700 });
    const library = await screenLibrary(client, state.handbook, {
      onStep: (e) => { state.libSteps[e.key] = { ...(state.libSteps[e.key] || {}), ...e }; renderSources(); },
      onDoc: (d) => { state.docStatus[d.id] = { status: 'done', doc: d }; renderSources(); },
    });
    state.library = library;
    state.libraryLive = live;
  } catch (err) {
    state.libError = err;
  }
  state.screening = false;
  renderSources();
  renderResult();
  if (state.pendingScenario && state.library) {
    const sample = state.pendingScenario;
    state.pendingScenario = null;
    runScenario(sample);
  }
}

function docState(id) {
  const lib = state.library?.docs.find((d) => d.id === id);
  if (lib) return { doc: lib, final: true };
  const st = state.docStatus[id];
  if (st?.doc) return { doc: st.doc, final: false };
  return { doc: state.handbook.docs.find((d) => d.id === id), final: false, pending: !st, running: st?.status === 'running' };
}

const FLAG_CHIPS = {
  quarantined: ['chip-bad', 'Quarantined'],
  superseded: ['chip-warn', 'Retired version'],
  script_withheld: ['chip-bad', 'Script withheld'],
  script_ok: ['chip-ok', 'Script inspected'],
  masked: ['chip-violet', 'Personal data masked'],
  conflict: ['chip-warn', 'Conflict to review'],
  failed: ['chip-bad', 'Check failed'],
};

function provisionalFlags(d) {
  const f = [];
  if (d.failed) f.push('failed');
  if (d.guard?.flagged) f.push('quarantined');
  if (d.scriptCheck?.flagged) f.push('script_withheld'); else if (d.scriptCheck) f.push('script_ok');
  if (d.pii?.entities?.length) f.push('masked');
  return f;
}

function renderSources() {
  if (!state.handbook) return;
  const docs = state.handbook.docs.map((d) => docState(d.id));
  renderStats(docs);
  renderDocList(docs);
  renderConflicts();
  renderViewer();
  $('#rescan-btn').disabled = state.screening || (!state.key && !state.recordings);
}

function renderStats(docs) {
  const done = !!state.library;
  const screened = docs.filter((x) => x.doc.metadata !== undefined || x.doc.failed);
  const piiCount = screened.reduce((s, x) => s + (x.doc.pii?.entities?.length || 0), 0);
  const quarantined = screened.filter((x) => x.doc.guard?.flagged).length;
  const withheld = screened.filter((x) => x.doc.scriptCheck?.flagged).length;
  const retired = done ? state.library.docs.filter((d) => d.flags.includes('superseded')).length : null;
  const searchable = done ? state.library.docs.filter((d) => d.searchable).length : null;
  const anyDone = screened.length > 0;
  const tile = (num, lbl, tone, eps, pending, jump = '', extra = '') => {
    const tag = jump && !pending && num ? 'button' : 'div';
    return `<${tag} class="stat ${pending ? 'pending' : 'tone-' + tone}"${tag === 'button' ? ` type="button" data-jump="${jump}" title="Show this document"` : ''}>
      <div class="num">${pending ? '–' : num}</div>
      <div class="lbl">${lbl}</div>
      <div class="by ep-row">${eps.map((e) => endpointTag(e)).join('')}${extra}</div>
    </${tag}>`;
  };
  $('#stats').innerHTML = [
    tile(state.handbook.docs.length, 'Documents imported', 'neutral', ['pipeline']),
    tile(piiCount, 'Personal details masked', 'violet', ['pii'], !anyDone, 'masked'),
    tile(quarantined, 'Quarantined for hidden instructions', 'bad', ['injection'], !anyDone, 'quarantined'),
    tile(withheld, 'Unsafe script withheld', 'bad', ['script'], !anyDone, 'script_withheld'),
    tile(retired, 'Retired policy version', 'warn', ['compare', 'extract'], retired === null, 'superseded'),
    tile(searchable, 'Searchable by the assistant', 'ok', [], searchable === null, '', '<span class="chip chip-ok">Indexed, masked copies</span>'),
  ].join('');
}

const SEVERITY = ['quarantined', 'script_withheld', 'superseded', 'failed', 'masked', 'conflict'];
function severity(x) {
  const flags = x.final ? x.doc.flags : provisionalFlags(x.doc);
  const i = SEVERITY.findIndex((f) => flags.includes(f));
  return i < 0 ? SEVERITY.length : i;
}

function renderDocList(docs) {
  const order = state.handbook.docs.map((d) => d.id);
  const sorted = [...docs].sort((a, b) => severity(a) - severity(b) || order.indexOf(a.doc.id) - order.indexOf(b.doc.id));
  const rows = sorted.map(({ doc, final, running }) => {
    const flags = final ? doc.flags : provisionalFlags(doc);
    const excluded = final && !doc.searchable;
    let stateCls = 'state-pending', stateIc = icon('clock', 13);
    if (running && !doc.metadata) { stateCls = 'state-running'; stateIc = '<span class="spin"></span>'; }
    else if (doc.failed || flags.includes('quarantined')) { stateCls = 'state-bad'; stateIc = icon('x', 13); }
    else if (flags.includes('superseded') || flags.includes('script_withheld')) { stateCls = 'state-warn'; stateIc = icon('alert', 13); }
    else if (doc.metadata !== undefined) { stateCls = 'state-ok'; stateIc = icon('check', 13); }
    const md = doc.metadata;
    const sub = md
      ? [md.version?.value, md.effectiveIso ? 'effective ' + formatDate(md.effectiveIso) : null].filter(Boolean).join(' · ')
      : (running ? 'Screening…' : doc.file);
    const title = (final && doc.title) || md?.title?.value || doc.heading;
    return `<button class="doc-row ${excluded ? 'excluded' : ''}" type="button" data-doc="${esc(doc.id)}" aria-current="${state.selectedDoc === doc.id}">
      <span class="state ${stateCls}">${stateIc}</span>
      <span style="min-width:0"><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></span>
      <span class="flags">${flags.filter((f) => FLAG_CHIPS[f]).map((f) => `<span class="chip ${FLAG_CHIPS[f][0]}">${FLAG_CHIPS[f][1]}</span>`).join('')}</span>
    </button>`;
  }).join('');
  const steps = state.libSteps;
  const head = `<div class="card-head"><h2>Knowledge base · ${state.handbook.docs.length} documents</h2>
    <span class="faint" style="font-size:12.5px">${state.screening ? '<span class="spin"></span> Checking…' : (state.library ? (state.libraryLive ? 'Checked live just now' : 'Recorded run') : '')}</span></div>`;
  let err = '';
  if (state.libError) err = errorBox(state.libError);
  else if (!state.recordings && !state.key) err = `<div class="inline-error">${icon('key')}<span>No recorded run is available yet. Add your Clocked key to run the source check live.</span></div>`;
  $('#doc-list').innerHTML = head + (err ? `<div style="padding:0 18px">${err}</div>` : '') + rows;
  void steps;
}

function titleOf(id) {
  const d = state.library?.docs.find((x) => x.id === id) || state.handbook.docs.find((x) => x.id === id);
  const md = d?.metadata;
  return { title: d?.title || md?.title?.value || d?.heading || id, version: md?.version?.value || '', date: md?.effectiveIso };
}

function renderConflicts() {
  const el = $('#conflicts');
  const step = state.libSteps.compare;
  if (!state.library && !step) { el.innerHTML = `<div class="card-head"><h2>Documents that disagree</h2>${endpointTag('compare')}</div><div class="card-body faint">Compared after every document is screened.</div>`; return; }
  if (step?.status === 'running') { el.innerHTML = `<div class="card-head"><h2>Documents that disagree</h2>${endpointTag('compare')}</div><div class="card-body"><span class="spin"></span> <span class="muted">Comparing ${esc(step.detail || '')}…</span></div>`; return; }
  if (step?.status === 'error') { el.innerHTML = `<div class="card-head"><h2>Documents that disagree</h2>${endpointTag('compare')}</div><div class="card-body">${errorBox(step.error, 'Comparison failed, so answers are shown without a version check.')}</div>`; return; }
  const conflicts = state.library?.conflicts || [];
  const pairs = state.library?.comparison?.data?.pairs?.length || 0;
  let body = '';
  if (!conflicts.length) body = `<div class="card-body muted">No conflicting rules across ${pairs} document pairs.</div>`;
  for (const c of conflicts) {
    const A = titleOf(c.a), B = titleOf(c.b);
    const sup = c.resolution.kind === 'superseded';
    const older = sup ? c.resolution.older : null;
    const label = (x, id) => `${esc(x.title)}${x.version ? ` <span class="faint">${esc(x.version)}</span>` : ''}${older === id ? ' <span class="chip chip-warn">Retired</span>' : (sup ? ' <span class="chip chip-ok">In force</span>' : '')}`;
    const res = sup
      ? `Proofdesk retired ${esc(titleOf(older).version || titleOf(older).title)}: its effective date (${esc(formatDate(titleOf(older).date))}) is older than ${esc(formatDate(titleOf(c.resolution.newer).date))}, as read by Extract. It is not searchable.`
      : 'Different documents disagree. Both stay searchable and are flagged for their owners to review.';
    const findings = c.findings.slice(0, 4).map((f) => {
      const oldSide = older && f.a?.document === older ? 'a' : (older && f.b?.document === older ? 'b' : null);
      const cell = (side) => {
        const q = f[side];
        if (!q) return '<div class="faint">No passage returned</div>';
        const t = titleOf(q.document);
        return `<div class="${oldSide === side ? 'old' : ''}"><div class="who">${esc(t.version || t.title)}</div><q>${esc(q.quote)}</q></div>`;
      };
      return `<div class="finding">${cell('a')}${cell('b')}</div>`;
    }).join('');
    body += `<div class="conflict">
      <div class="conflict-head"><div><div class="pair">${label(A, c.a)} <span class="faint">vs</span> ${label(B, c.b)}</div><div class="res">${res}</div></div>
      <span class="chip chip-warn">${plural(c.findings.length, 'conflicting statement')}</span></div>
      ${findings}${c.findings.length > 4 ? `<div class="more-findings">${c.findings.length - 4} more conflicting statements in the Compare response.</div>` : ''}
    </div>`;
  }
  el.innerHTML = `<div class="card-head"><h2>Documents that disagree</h2><span class="ep-row">${endpointTag('compare')}${endpointTag('extract')}</span></div>${body}`;
}

function docMarks(doc) {
  const marks = structureMarks(doc.raw);
  const md = doc.metadata;
  if (md) {
    for (const [k, label] of [['title', 'title'], ['version', 'version'], ['effectiveDate', 'effective'], ['owner', 'owner']]) {
      const f = md[k];
      if (f && Number.isInteger(f.start)) marks.push({ start: f.start, end: f.end, cls: 'm-meta', title: `Extract · ${label}`, after: `<span class="tagmark meta">${label}</span>` });
    }
  }
  for (const e of doc.pii?.entities || []) {
    marks.push({ start: e.start, end: e.end, cls: 'm-pii', title: `Protect · ${e.type} (${pct(e.confidence)})`, after: `<span class="tagmark pii">${esc(e.type.replace(/_/g, ' '))}</span>` });
  }
  for (const e of doc.guard?.flagged ? doc.guard.evidence : []) {
    marks.push({ start: e.start, end: e.end, cls: 'm-inj', title: `Guard · ${doc.guard.category}`, after: '<span class="tagmark inj">injection</span>' });
  }
  for (const e of doc.scriptCheck?.evidence || []) {
    if (Number.isInteger(e.docStart) && Number.isInteger(e.docEnd)) {
      marks.push({ start: e.docStart, end: e.docEnd, cls: doc.scriptCheck.flagged ? 'm-script-bad' : 'm-script-ok', title: `Inspect · ${doc.scriptCheck.category}`, after: doc.scriptCheck.flagged ? '<span class="tagmark script">unsafe</span>' : '' });
    }
  }
  for (const c of state.library?.conflicts || []) {
    for (const f of c.findings) {
      for (const side of ['a', 'b']) {
        const q = f[side];
        if (!q || q.document !== doc.id || !q.quote) continue;
        const idx = doc.raw.indexOf(q.quote);
        if (idx < 0) continue;
        const start = Array.from(doc.raw.slice(0, idx)).length;
        marks.push({ start, end: start + Array.from(q.quote).length, cls: 'm-conflict', title: 'Compare · conflicting statement' });
      }
    }
  }
  return marks;
}

function docLedger(doc, final) {
  const items = [];
  const add = (ep, what, then) => items.push(`<div class="ledger-item"><div>${endpointTag(ep)}</div><div><div class="what">${what}</div><div class="then">${then}</div></div></div>`);
  if (doc.failed) {
    add('pipeline', 'The screening call failed.', `<b>Not indexed.</b> ${esc(doc.failure?.message || '')}`);
    return items.join('');
  }
  const md = doc.metadata;
  if (md) {
    const got = [md.version ? `version ${esc(md.version.value)}` : 'no version', md.effectiveIso ? `effective ${esc(formatDate(md.effectiveIso))}` : 'no effective date', md.owner ? `owner ${esc(md.owner.value)}` : 'no owner'];
    add('extract', `Read ${got.join(' · ')}.`,
      md.effectiveIso ? 'The effective date decides which version stays in force when documents conflict.' : '<b>No effective date</b>, so this document can never retire another one automatically.');
  }
  if (doc.pii) {
    const n = doc.pii.entities.length;
    const ev = n ? `<div class="ev ev-pii">${doc.pii.entities.map((e) => `<span><s>${esc(e.value)}</s>${icon('arrow', 12)}&lt;${esc(e.type.toUpperCase())}&gt;</span>`).join('')}</div>` : '';
    add('pii', n ? `Found ${plural(n, 'personal detail')}: ${[...new Set(doc.pii.entities.map((e) => e.type.replace(/_/g, ' ')))].map(esc).join(', ')}.` : 'No personal data found.',
      (n ? '<b>Masked in the searchable copy.</b> The assistant only ever reads the masked text.' : 'Indexed as written. Company team mailboxes are allowed through.') + ev);
  }
  if (doc.guard) {
    const ev = doc.guard.flagged && doc.guard.evidence.length ? `<div class="ev">${doc.guard.evidence.map((e) => `<div class="ev-quote bad">“${esc(e.quote)}”</div>`).join('')}</div>` : '';
    add('injection', doc.guard.flagged ? `Hidden instructions: ${esc(doc.guard.category)} (${esc(doc.guard.severity || 'flagged')}, ${pp(doc.guard.injection)}).` : `No injection found (${pp(doc.guard.injection)} risk).`,
      (doc.guard.flagged ? '<b>Quarantined.</b> Not searchable and not compared with other documents.' : 'Allowed into the index.') + ev);
  }
  if (doc.scriptCheck) {
    const sc = doc.scriptCheck;
    const ev = sc.flagged && sc.evidence.length ? `<div class="ev">${sc.evidence.map((e) => `<div class="ev-quote bad code">${esc(e.line)}</div>`).join('')}</div>` : '';
    add('script', sc.failed ? 'The script could not be inspected.' : `Script classed as ${esc(sc.category)}${sc.severity ? ` (${esc(sc.severity)})` : ''}, ${pp(sc.malicious)} malicious.`,
      (sc.flagged ? '<b>Script removed</b> from the searchable copy. Questions about this fix are routed to the IT Service Desk.' : 'Kept, and shown to employees with an inspected label.') + ev);
  }
  if (final) {
    for (const c of state.library.conflicts.filter((x) => x.a === doc.id || x.b === doc.id)) {
      const other = c.a === doc.id ? c.b : c.a;
      const o = titleOf(other);
      const retiredSide = c.resolution.kind === 'superseded' ? c.resolution.older : null;
      const cell = (q) => (q ? `<div class="${retiredSide === q.document ? 'old' : ''}"><span class="who">${esc(titleOf(q.document).version || titleOf(q.document).title)}</span><q>${esc(q.quote)}</q></div>` : '<div class="faint">No passage</div>');
      const pairs = c.findings.slice(0, 2).map((f) => {
        const mine = f.a?.document === doc.id ? f.a : f.b;
        const theirs = f.a?.document === doc.id ? f.b : f.a;
        return `<div class="ev-pair">${cell(mine)}${cell(theirs)}</div>`;
      }).join('');
      const evc = `<div class="ev">${pairs}${c.findings.length > 2 ? `<div class="ev-more">${c.findings.length - 2} more conflicting statements in the Compare response</div>` : ''}</div>`;
      if (c.resolution.kind === 'superseded') {
        const retired = c.resolution.older === doc.id;
        add('compare', `${plural(c.findings.length, 'conflicting statement')} with ${esc(o.title)} ${esc(o.version)}.`,
          (retired ? '<b>Retired:</b> its effective date is older, so it is excluded from answers.' : '<b>Stays in force:</b> it is the newer version.') + evc);
      } else {
        add('compare', `${plural(c.findings.length, 'conflicting statement')} with ${esc(o.title)}.`, 'Both stay searchable; flagged for review.');
      }
    }
    if (!state.library.conflicts.some((x) => x.a === doc.id || x.b === doc.id) && doc.searchable && state.library.comparison) {
      add('compare', 'No conflicts with other documents.', 'Nothing to resolve.');
    }
  }
  return items.join('');
}

function renderViewer() {
  const el = $('#viewer');
  const { doc, final, running } = docState(state.selectedDoc);
  if (!doc) { el.innerHTML = ''; return; }
  const md = doc.metadata;
  const flags = final ? doc.flags : provisionalFlags(doc);
  const title = (final && doc.title) || md?.title?.value || doc.heading;
  el.innerHTML = `
    <div class="card-head">
      <div style="min-width:0">
        <div class="viewer-title">${esc(title)}</div>
        <div class="viewer-meta">
          ${md?.version ? `<span>Version <b>${esc(md.version.value)}</b></span>` : ''}
          ${md?.effectiveIso ? `<span>Effective <b>${esc(formatDate(md.effectiveIso))}</b></span>` : ''}
          ${md?.owner ? `<span>Owner <b>${esc(md.owner.value)}</b></span>` : ''}
          ${!md ? `<span class="faint">${running ? '<span class="spin"></span> Screening…' : esc(doc.file)}</span>` : ''}
        </div>
      </div>
      <div class="ep-row" style="justify-content:flex-end">${flags.filter((f) => FLAG_CHIPS[f]).map((f) => `<span class="chip ${FLAG_CHIPS[f][0]}">${FLAG_CHIPS[f][1]}</span>`).join('')}</div>
    </div>
    ${md !== undefined || doc.failed ? `<div class="ledger">${docLedger(doc, final)}</div>` : ''}
    <div class="legend"><span class="l-meta">Read by Extract</span><span class="l-pii">Masked by Protect</span><span class="l-inj">Flagged by Guard or Inspect</span><span class="l-conflict">Conflict found by Compare</span></div>
    <div class="doc-text">${renderMarked(doc.raw, docMarks(doc))}</div>`;
}

// ---------------------------------------------------------------------------------------------
// Answer check
// ---------------------------------------------------------------------------------------------

function renderPersona() {
  $('#p-country').innerHTML = PROFILES.countries.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#p-employment').innerHTML = PROFILES.employment.map((c) => `<option>${esc(c)}</option>`).join('');
  syncPersona();
}
function syncPersona() {
  $('#p-country').value = state.profile.country;
  $('#p-employment').value = state.profile.employment;
}

const SCENARIO_TAGS = {
  regional: ['rerank'], outdated: ['compare', 'extract'], 'unsafe-fix': ['script', 'decide'],
  sensitive: ['decide'], personal: ['pii'], manipulation: ['injection'],
};

function renderScenarios() {
  const featured = state.samples.ask.filter((s) => s.featured);
  const more = state.samples.ask.filter((s) => !s.featured);
  $('#scenarios').innerHTML = featured.map((s) => `
    <button class="scenario" type="button" data-scenario="${esc(s.id)}" aria-pressed="false">
      <div class="n"><span>${esc(s.label)}</span><span class="ep-row">${(SCENARIO_TAGS[s.id] || []).map((e) => endpointTag(e)).join('')}</span></div>
      <div class="h">${esc(s.hint)}</div>
    </button>`).join('')
    + (more.length ? `<details class="paste-box" style="margin-top:4px"><summary>More examples</summary><div class="scenarios">${more.map((s) => `
      <button class="scenario" type="button" data-scenario="${esc(s.id)}" aria-pressed="false"><div class="n"><span>${esc(s.label)}</span></div><div class="h">${esc(s.question)}</div></button>`).join('')}</div></details>` : '');
}

function markScenario(id) {
  state.scenario = id;
  $$('.scenario').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scenario === id)));
}

function runScenario(sample) {
  if (window.innerWidth < 920) setTimeout(() => $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  state.profile = { ...sample.profile };
  syncPersona();
  $('#question').value = sample.question;
  markScenario(sample.id);
  runAsk(sample.question, sample.id);
}

async function runAsk(question, scenarioId = null) {
  if (!question || state.running) return;
  if (!state.library) { flashLibraryNeeded(); return; }
  if (!scenarioId) markScenario(null);
  state.running = true;
  const compare = $('#compare-toggle').checked;
  state.result = { kind: 'ask', question, profile: { ...state.profile }, compare, steps: {}, pending: true };
  renderResult();
  const client = makeClient();
  const out = await ask(client, state.library, { question, profile: { ...state.profile }, compare }, {
    onStep: (e) => { state.result.steps[e.key] = { ...(state.result.steps[e.key] || {}), ...e }; renderResult(); },
  });
  state.result = { ...out, compare, pending: false };
  state.running = false;
  renderResult();
}

async function runCheck(question, answer) {
  if (!question || !answer || state.running) return;
  if (!state.library) { flashLibraryNeeded(); return; }
  markScenario(null);
  state.running = true;
  state.result = { kind: 'check', question, answer, profile: { ...state.profile }, steps: {}, pending: true };
  renderResult();
  const out = await checkAnswer(makeClient(), state.library, { question, answer, profile: { ...state.profile } }, {
    onStep: (e) => { state.result.steps[e.key] = { ...(state.result.steps[e.key] || {}), ...e }; renderResult(); },
  });
  state.result = { ...out, pending: false };
  state.running = false;
  renderResult();
}

function flashLibraryNeeded() {
  $('#result').innerHTML = `<div class="inline-error">${icon('alert')}<span>The source check has not finished yet. Answers are only drawn from documents that passed it.</span><a class="btn btn-sm" href="#sources">Open source check</a></div>`;
}

function errorBox(err, lead = '') {
  const notRecorded = err?.code === 'not_recorded' || err?.code === 'no_key';
  return `<div class="inline-error ${notRecorded ? '' : 'bad'}">${icon(notRecorded ? 'key' : 'alert')}<span>${lead ? esc(lead) + ' ' : ''}${esc(err?.message || String(err))}</span>${notRecorded ? '<button class="btn btn-sm btn-primary" type="button" data-action="key">Add key</button>' : ''}</div>`;
}

const ASK_STEPS = [
  { key: 'screen', name: 'Screen question', eps: ['pii', 'injection'] },
  { key: 'search', name: 'Keyword search', eps: ['local'] },
  { key: 'rerank', name: 'Rerank', eps: ['rerank'] },
  { key: 'draft', name: 'Draft', eps: ['fill'] },
  { key: 'verify', name: 'Verify claims', eps: ['grounding'] },
  { key: 'route', name: 'Route', eps: ['decide'] },
];
const CHECK_STEPS = ASK_STEPS.filter((s) => ['screen', 'search', 'rerank', 'verify'].includes(s.key));

// Which steps changed the outcome in this run: 'act' (stepped in), 'warn', 'bad' or plain pass-through.
function stepTone(key, r) {
  if (key === 'screen' && r.screen) return r.screen.guard.flagged ? 'bad' : (r.screen.entities.length ? 'act' : '');
  if (key === 'rerank' && r.retrieval) return r.retrieval.results.some((x) => x.reason === 'different_case') ? 'act' : '';
  if (key === 'verify' && r.verify) {
    const s = verifySummary(r.verify);
    return s.contradicted ? 'bad' : (s.notStated ? 'warn' : '');
  }
  if (key === 'route' && r.route) return ['people_team', 'it_desk'].includes(r.route.key) ? 'act' : (r.route.key === 'answer_with_conditions' ? 'warn' : '');
  return '';
}

function stepper(r) {
  const defs = r.kind === 'check' ? CHECK_STEPS : ASK_STEPS;
  const blocked = r.screen?.guard?.flagged;
  return `<div class="stepper" style="--n:${defs.length}">${defs.map((d) => {
    const s = r.steps[d.key];
    let cls = 'pending', st = `<span class="st state-pending">${icon('clock', 11)}</span>`;
    if (s?.status === 'running') { cls = 'running'; st = '<span class="spin"></span>'; }
    else if (s?.status === 'done') {
      const bad = d.key === 'screen' && blocked;
      const tone = stepTone(d.key, r);
      cls = bad ? 'blocked tone-bad' : `done${tone ? ` tone-${tone}` : ''}`;
      st = bad ? `<span class="st state-bad">${icon('x', 11)}</span>` : `<span class="st state-ok">${icon(tone === 'bad' || tone === 'warn' ? 'alert' : 'check', 11)}</span>`;
    } else if (s?.status === 'error') { cls = 'error'; st = `<span class="st state-bad">${icon('alert', 11)}</span>`; }
    else if (s?.status === 'skipped' || (!s && !r.pending)) { cls = 'skipped'; st = `<span class="st state-pending">–</span>`; }
    const sum = s?.status === 'error' ? 'Failed' : (s?.summary || (s?.status === 'running' ? (s.detail || 'Working…') : (cls === 'skipped' ? 'Not needed' : '')));
    return `<div class="stp ${cls}"><div class="top"><span class="name">${esc(d.name)}</span>${st}</div><div class="ep-row" style="margin-top:6px">${d.eps.map((e) => endpointTag(e)).join('')}</div><div class="sum">${esc(sum)}</div><div class="bar"></div></div>`;
  }).join('')}</div>`;
}

function maskedQuestion(r) {
  const s = r.screen;
  if (!s || !s.entities.length) return '';
  const html = esc(s.masked).replace(/&lt;([A-Z_]+)&gt;/g, '<span class="tok">$1</span>');
  return `<div class="masked-q">${icon('mask', 14)} Sent on as: ${html}</div>`;
}

function questionCard(r) {
  const p = r.profile;
  const guardBad = r.screen?.guard?.flagged;
  let qHtml = esc(r.question);
  if (guardBad && r.screen.guard.evidence.length) {
    const marks = r.screen.guard.evidence.map((e) => ({ start: e.start, end: e.end, cls: 'm-inj' }));
    qHtml = renderMarked(r.question, marks);
  } else if (r.screen?.entities?.length) {
    qHtml = renderMarked(r.question, r.screen.entities.map((e) => ({ start: e.start, end: e.end, cls: 'm-pii', title: e.type })));
  }
  return `<div class="card question-card fade-in">
    <div class="avatar">${icon('user', 18)}</div>
    <div style="min-width:0">
      <div class="q-text">${qHtml}</div>
      <div class="q-sub"><span class="chip chip-outline">${esc(p.employment)}</span><span class="chip chip-outline">${esc(p.country)}</span>${r.kind === 'check' ? '<span class="chip chip-info">Checking a pasted answer</span>' : ''}</div>
      ${maskedQuestion(r)}
    </div>
  </div>`;
}

function passageById(id) {
  if (!id) return null;
  if (id.startsWith('raw:')) return uncheckedPassages(state.library).find((p) => p.id === id) || null;
  return state.library?.docs.flatMap((d) => d.passages).find((p) => p.id === id) || null;
}

// Answer text with each claim marked by its Verify verdict and a citation to its evidence.
function claimsHtml(verify, { prefix = 'c', neutral = false } = {}) {
  const claims = verify?.claims || [];
  let n = 0;
  return claims.map((c, i) => {
    const counted = c.counted !== false && c.kind !== 'not_a_claim';
    if (!counted) return `<span>${esc(c.claim)}</span>`;
    const v = c.verdict || 'not_stated';
    const look = neutral && v === 'supported' ? 'neutral' : v;
    const cls = `claim ${look}`;
    const ev = c.evidence;
    n++;
    const cite = `<button class="cite ${look}" type="button" data-claim="${prefix}:${i}" title="${esc(verdictLabel(v))}${ev?.quote ? ': ' + esc(ev.quote) : ''}">${v === 'supported' ? n : (v === 'contradicted' ? '✕' : '?')}</button>`;
    return `<span class="${cls}">${esc(c.claim)}</span>${cite}`;
  }).join(' ');
}

function verdictLabel(v) {
  return { supported: 'Supported by the handbook', contradicted: 'Contradicted by the handbook', not_stated: 'Not stated in the handbook' }[v] || v;
}

function claimNotes(verify, { removed = true } = {}) {
  const notes = [];
  for (const c of verify?.claims || []) {
    if (c.counted === false || c.kind === 'not_a_claim') continue;
    if (c.verdict === 'contradicted') {
      notes.push(`<div class="note bad">${icon('x', 15)}<div><b>${removed ? 'Removed' : 'Contradicted'}:</b> “${esc(c.claim)}”${c.evidence?.quote ? `<br>The handbook says: <q>${esc(c.evidence.quote)}</q>` : ''}</div></div>`);
    } else if (c.verdict === 'not_stated') {
      notes.push(`<div class="note warn">${icon('alert', 15)}<div><b>Not stated in the sources:</b> “${esc(c.claim)}”${c.evidence?.quote ? `<br>Closest passage: <q>${esc(c.evidence.quote)}</q>` : ''}</div></div>`);
    }
  }
  return notes.join('');
}

function routeBlock(r) {
  const key = r.route?.key;
  if (!key) return '';
  const L = ROUTE_LABELS[key] || { long: key, tone: 'info' };
  const ic = { ok: 'check', warn: 'alert', info: 'route', bad: 'x' }[L.tone];
  let why = '';
  if (key === 'blocked') why = esc(r.route.reason);
  else if (r.route.decided) {
    const p = r.route.probabilities?.[r.route.decided];
    why = `${endpointTag('decide')} ${esc((ROUTE_LABELS[r.route.decided]?.short || r.route.decided))} at ${pp(p ?? r.route.confidence)}`;
    if (r.route.concerns?.length) why += ` · ${r.route.concerns.map((c) => esc(c.replace(/_/g, ' '))).join(', ')}`;
    if (r.route.reason) why += `<br>${esc(r.route.reason)}`;
  } else if (r.route.reason) why = esc(r.route.reason);
  return `<div class="route"><span class="badge ${L.tone}">${icon(ic, 15)}${esc(L.long)}</span><span class="why">${why}</span></div>`;
}

function proofdeskCard(r) {
  const head = `<div class="card-head"><h3><img src="assets/img/mark.svg" alt="" width="18" height="18">Proofdesk</h3><span class="faint" style="font-size:12.5px">Checked sources · checked answer</span></div>`;
  if (r.pending && !r.steps.route?.status?.match(/done|error/)) {
    const err = Object.values(r.steps).find((s) => s.status === 'error');
    return `<div class="card answer-card">${head}<div class="answer-body">${err ? errorBox(err.error) : '<span class="spin"></span> <span class="muted">Checking…</span>'}</div></div>`;
  }
  if (r.route?.key === 'blocked') {
    const g = r.screen.guard;
    return `<div class="card answer-card fade-in">${head}${routeBlock(r)}
      <div class="notes" style="padding-top:14px">
        <div class="note bad">${icon('shield', 15)}<div><b>Guard: ${esc(g.category)}</b> (${esc(g.severity || 'flagged')}, ${pct(g.injection)}). ${g.evidence.map((e) => `<q>${esc(e.quote)}</q>`).join(' ')}<br>Nothing was searched, drafted or logged beyond the masked question.</div></div>
      </div></div>`;
  }
  if (r.error && !r.verify && !r.draft) {
    return `<div class="card answer-card">${head}${routeBlock(r)}<div class="card-body">${errorBox(r.error)}</div></div>`;
  }
  const used = r.retrieval?.used || [];
  let answer = '';
  if (r.verify) answer = claimsHtml(r.verify, { prefix: 'pd' });
  else if (r.draft?.answer) answer = `<span class="claim not_stated">${esc(r.draft.answer)}</span><div class="note warn" style="margin-top:10px">${icon('alert', 15)}<div>This draft could not be verified, so it is not shown to the employee as an answer.</div></div>`;
  else answer = '<span class="muted">No handbook passage answers this question for this employee, so no answer was drafted.</span>';
  const f = r.draft?.fields || {};
  const yn = (x) => (x?.value ? 'Yes' : 'No');
  const facts = r.draft ? `<div class="facts">
      <span class="chip chip-outline">${endpointTag('fill')} Topic: ${esc(f.topic?.value || '–')}</span>
      <span class="chip chip-outline">Approval needed: <b>${yn(f.approval_needed)}</b></span>
      <span class="chip chip-outline">Handbook covers it fully: <b>${yn(f.fully_answered)}</b></span>
      ${r.verify ? `<span class="chip chip-outline">${endpointTag('grounding')} ${pct(r.verify.grounded)} supported ${meter(r.verify.grounded, r.verify.grounded >= 0.6 ? 'ok' : 'warn')}</span>` : ''}
    </div>` : '';
  const kr = r.draft?.keyRule;
  const keyRule = kr ? `<div class="keyrule"><div class="k">Key rule, quoted word for word</div>“${esc(kr.value)}”${kr.passageId ? ` <button class="btn btn-ghost btn-sm" type="button" data-passage="${esc(kr.passageId)}" data-quote="${esc(kr.value)}" style="height:22px;padding:0 6px">${esc(passageById(kr.passageId)?.title || '')}</button>` : ''}</div>` : '';
  const withheld = used.filter((p) => p.scriptWithheld);
  const scriptOk = used.filter((p) => p.hasScript && !p.scriptWithheld);
  const extraNotes = [
    ...withheld.map((p) => `<div class="note bad">${icon('code', 15)}<div><b>Script withheld.</b> ${esc(p.title)} contains a script that failed Inspect, so it is not shown.</div></div>`),
    ...scriptOk.map((p) => `<div class="note ok">${icon('shield', 15)}<div><b>Script inspected:</b> the fix in ${esc(p.title)} was classed as routine administration before it was indexed.</div></div>`),
  ].join('');
  const all = r.retrieval?.results || [];
  const srcRow = (x) => `
      <div class="src"><div class="nm"><button type="button" data-passage="${esc(x.id)}">${esc(x.passage?.title || x.id)}</button><span class="kw">keyword #${x.keywordRank ?? '–'}</span></div>
      <div class="right">${rerankChip(x)}${meter(x.relevance_score, x.action === 'use' ? 'ok' : 'neutral')}</div></div>`;
  const usedRows = all.filter((x) => x.action === 'use');
  const setAside = all.filter((x) => x.action !== 'use')
    .sort((a, b) => (b.reason === 'different_case') - (a.reason === 'different_case') || b.relevance_score - a.relevance_score);
  const diffCase = setAside.filter((x) => x.reason === 'different_case').length;
  const srcHtml = all.length ? `<div class="sources"><div class="section-title" style="display:flex;gap:8px;align-items:center">Passages used ${endpointTag('rerank')}</div>${usedRows.map(srcRow).join('') || '<div class="muted" style="font-size:13px">None applies to this employee.</div>'}
      ${setAside.length ? `<details class="src-more"${usedRows.length ? '' : ' open'}><summary>${icon('chevron', 12)} ${plural(setAside.length, 'passage')} set aside${diffCase ? `, ${diffCase} written for a different case` : ''}</summary>${setAside.map(srcRow).join('')}</details>` : ''}</div>` : '';
  const human = r.route?.key === 'people_team' || r.route?.key === 'it_desk';
  if (human) {
    const team = r.route.key === 'it_desk' ? 'IT Service Desk' : 'People Team';
    const reasons = [];
    if (withheld.length) reasons.push('the fix in the handbook includes a script that failed a safety inspection');
    for (const c of r.route.concerns || []) reasons.push({ wellbeing_or_conduct: 'the message mentions wellbeing or conduct', dispute: 'it involves a dispute', exception_request: 'it asks for an exception', not_covered: 'the handbook does not cover it' }[c] || c.replace(/_/g, ' '));
    const handoff = `<div class="handoff"><div class="k">What the employee sees</div>Your question has been passed to the ${team}${reasons.length ? `, because ${esc(reasons.join(', and '))}` : ''}. Someone will reply to you directly.</div>`;
    return `<div class="card answer-card fade-in">${head}${routeBlock(r)}${handoff}
      ${r.draft ? `<details class="held"><summary>${icon('chevron', 14)}Checked draft attached for the ${team}, not sent to the employee</summary>
        <div class="answer-body">${answer}</div><div class="notes">${claimNotes(r.verify)}${extraNotes}</div>${keyRule}${facts}</details>` : `<div class="notes" style="padding-top:12px">${extraNotes}</div>`}
      ${srcHtml}</div>`;
  }
  return `<div class="card answer-card fade-in">${head}${routeBlock(r)}
    <div class="answer-body">${answer}</div>
    <div class="notes">${claimNotes(r.verify)}${extraNotes}</div>
    ${keyRule}${facts}${srcHtml}</div>`;
}

function rerankChip(x) {
  if (x.action === 'use') return '<span class="chip chip-ok">Use</span>';
  if (x.action === 'expand') return '<span class="chip chip-info">Answer is elsewhere in it</span>';
  if (x.reason === 'different_case') return '<span class="chip chip-warn">Different case</span>';
  if (x.reason === 'already_given') return '<span class="chip chip-neutral">Already given</span>';
  return '<span class="chip chip-neutral">Unrelated</span>';
}

function baselineDangers(b, r) {
  const out = [];
  const rr = Object.fromEntries((r.retrieval?.results || []).map((x) => [x.id, x]));
  for (const p of b.passages || []) {
    const d = state.library.docs.find((x) => x.id === p.docId);
    const id = p.id.replace(/^raw:/, '');
    const tags = [];
    if (d?.flags.includes('quarantined')) tags.push(['chip-bad', 'Hidden instructions']);
    if (d?.flags.includes('superseded')) tags.push(['chip-warn', 'Retired version']);
    if (p.hasScript && d?.scriptCheck?.flagged) tags.push(['chip-bad', 'Unsafe script']);
    if (d?.pii?.entities?.length && d.pii.entities.some((e) => p.text.includes(e.value))) tags.push(['chip-violet', 'Personal data']);
    if (rr[id]?.reason === 'different_case') tags.push(['chip-warn', 'Different case']);
    out.push(`<div class="src baseline-src"><div class="nm"><button type="button" data-passage="${esc(p.id)}">${esc(p.title)}</button></div><div class="right">${tags.map((t) => `<span class="chip ${t[0]}">${t[1]}</span>`).join('') || '<span class="chip chip-neutral">No issue found</span>'}</div></div>`);
  }
  return out.join('');
}

function unsafeScriptNote(d) {
  const block = d.codeBlocks[0];
  const marks = (d.scriptCheck.evidence || []).filter((e) => Number.isInteger(e.docStart)).map((e) => ({ start: e.docStart - block.start, end: e.docEnd - block.start, cls: 'm-script-bad' }));
  return `<div class="note bad" style="display:block">${icon('code', 15)} <b>It points the employee to this script.</b> Inspect classed it as ${esc(d.scriptCheck.category)} (${esc(d.scriptCheck.severity || 'flagged')}):
    <pre class="script-pre">${renderMarked(block.code.trimEnd(), marks)}</pre></div>`;
}

function baselineCard(r) {
  const head = `<div class="card-head"><h3>${icon('alert', 16)}Unchecked desk</h3><span class="faint" style="font-size:12.5px">Same draft step, raw documents</span></div>`;
  const s = r.steps.baseline;
  if (!s || s.status === 'running') return `<div class="card answer-card baseline-card">${head}<div class="answer-body"><span class="spin"></span> <span class="muted">Drafting from raw documents…</span></div></div>`;
  if (s.status === 'error') return `<div class="card answer-card baseline-card">${head}<div class="card-body">${errorBox(s.error)}</div></div>`;
  const b = r.baseline;
  if (!b?.answer) return `<div class="card answer-card baseline-card">${head}<div class="answer-body muted">No keyword match, so no unchecked answer.</div></div>`;
  const bv = r.baselineVerify;
  const sum = bv ? verifySummary(bv) : null;
  const body = bv ? claimsHtml(bv, { prefix: 'bl', neutral: true }) : esc(b.answer);
  const humanRoute = r.route?.key === 'people_team' || r.route?.key === 'it_desk';
  let badge = '';
  if (bv) {
    if (sum.contradicted) badge = `<span class="badge bad">${icon('x', 15)}${plural(sum.contradicted, 'claim')} contradicted</span>`;
    else if (sum.notStated) badge = `<span class="badge warn">${icon('alert', 15)}${plural(sum.notStated, 'claim')} not stated in the sources</span>`;
    else if (humanRoute && (r.route.concerns || []).includes('wellbeing_or_conduct')) badge = `<span class="badge bad">${icon('alert', 15)}Auto-replied to a wellbeing concern</span>`;
    else if (humanRoute) badge = `<span class="badge bad">${icon('alert', 15)}Sent automatically; needed a person</span>`;
    else badge = `<span class="badge ok">${icon('check', 15)}Supported this time</span>`;
  } else if (r.route?.key === 'blocked') badge = `<span class="badge warn">${icon('alert', 15)}Answered a manipulative message</span>`;
  const verdict = badge
    ? `<div class="route">${badge}<span class="why">${bv ? `${endpointTag('grounding')} checked against the passages Proofdesk selected` : 'No screening step'}</span></div>`
    : (r.steps['baseline-verify']?.status === 'running' ? '<div class="route"><span class="spin"></span><span class="why">Checking this answer…</span></div>' : '');
  const extra = [];
  if (humanRoute) extra.push(`<div class="note warn">${icon('route', 15)}<div><b>No routing step.</b> The unchecked desk answers everything automatically; Proofdesk passed this one to a person.</div></div>`);
  if (r.screen?.entities?.length) extra.push(`<div class="note warn">${icon('mask', 15)}<div><b>Logged unmasked.</b> The question was searched and stored with ${esc([...new Set(r.screen.entities.map((e) => e.type.replace(/_/g, ' ')))].join(' and '))} in plain text.</div></div>`);
  const unsafe = (b.passages || []).map((p) => ({ p, d: state.library.docs.find((x) => x.id === p.docId) })).find(({ p, d }) => p.hasScript && d?.scriptCheck?.flagged);
  if (unsafe) extra.push(unsafeScriptNote(unsafe.d));
  return `<div class="card answer-card baseline-card fade-in">${head}${verdict}
    <div class="answer-body">${body}</div>
    <div class="notes">${bv ? claimNotes(bv, { removed: false }) : ''}${extra.join('')}</div>
    <div class="sources"><div class="section-title">What it read (top 3 keyword matches, unscreened)</div>${baselineDangers(b, r)}</div></div>`;
}

function checkCard(r) {
  const head = `<div class="card-head"><h3>${icon('scale', 16)}Pasted answer, checked</h3></div>`;
  if (r.pending && !r.verify) {
    const err = Object.values(r.steps).find((s) => s.status === 'error');
    return `<div class="card answer-card">${head}<div class="answer-body">${err ? errorBox(err.error) : '<span class="spin"></span> <span class="muted">Checking…</span>'}</div></div>`;
  }
  if (r.blocked) return `<div class="card answer-card">${head}<div class="card-body">${errorBox({ message: `Guard flagged the question (${r.screen.guard.category}).` })}</div></div>`;
  if (r.notCovered) return `<div class="card answer-card">${head}<div class="answer-body muted">The handbook has no passage that answers this question, so none of the answer can be confirmed.</div></div>`;
  if (!r.verify) return `<div class="card answer-card">${head}<div class="card-body">${errorBox(r.error || { message: 'Not checked.' })}</div></div>`;
  const s = verifySummary(r.verify);
  return `<div class="card answer-card check-card fade-in">${head}
    <div class="route"><span class="badge ${s.contradicted ? 'bad' : (s.notStated ? 'warn' : 'ok')}">${s.supported} of ${s.total} claims supported</span><span class="why">${endpointTag('grounding')} ${pct(r.verify.grounded)} of the answer by length</span></div>
    <div class="answer-body">${claimsHtml(r.verify, { strike: false, prefix: 'ck' })}</div>
    <div class="notes">${claimNotes(r.verify, { removed: false })}</div></div>`;
}

const LEDGER_ORDER = ['screen', 'search', 'rerank', 'draft', 'verify', 'route', 'baseline', 'baseline-verify'];
const LEDGER_NAMES = {
  screen: 'Screen the question', search: 'Keyword search', rerank: 'Rerank for this person', expand: 'Read around',
  draft: 'Draft the answer', verify: 'Check every claim', route: 'Decide who answers',
  baseline: 'Unchecked desk: draft', 'baseline-verify': 'Unchecked desk: check',
};
const LEDGER_EPS = { screen: ['pipeline', 'pii', 'injection'], search: ['local'], rerank: ['rerank'], expand: ['rerank'], draft: ['fill'], verify: ['grounding'], route: ['decide'], baseline: ['fill'], 'baseline-verify': ['grounding'] };

function ledgerCard(r) {
  const rows = LEDGER_ORDER.filter((k) => r.steps[k]).map((k) => {
    const s = r.steps[k];
    let impact = s.impact || s.summary || '';
    if (s.status === 'running') impact = '<span class="spin"></span> Running…';
    if (s.status === 'error') impact = `<span style="color:var(--bad)">${esc(s.error?.message || 'Failed')}</span>`;
    if (s.status === 'skipped') impact = esc(s.summary || 'Skipped');
    else if (s.status === 'done') impact = esc(impact);
    let extra = '';
    if (k === 'rerank' && s.results) {
      const ex = r.steps.expand;
      if (ex?.status === 'done') extra += `<div class="sm">Read around: ${plural(ex.results?.length || 0, 'neighbouring section')} re-read in a second Rerank call, ${ex.results?.filter((x) => x.action === 'use').length || 0} more to use.</div>`;
      extra += `<details class="rr"><summary>All ${s.results.length} rerank decisions</summary>${rerankTable(s.results)}</details>`;
    }
    if (k === 'search' && s.hits) extra = `<div class="sm">Top matches: ${s.hits.slice(0, 4).map((h) => esc(h.passage.title)).join(' · ')}</div>`;
    const json = s.request || s.response ? `<details><summary>Request and response</summary>${s.request ? jsonBlock(s.request) : ''}${s.response ? jsonBlock(s.response) : ''}</details>` : '';
    const exMeta = k === 'rerank' && r.steps.expand?.meta ? r.steps.expand.meta.credits : 0;
    const meta = s.meta ? `<span>${s.meta.replay ? 'recorded' : `${s.meta.ms} ms`}</span><span>${s.meta.credits + exMeta} credits</span>` : '';
    return `<div class="lg ${s.lane === 'baseline' ? 'lane-baseline' : ''}">
      <div class="l"><b>${esc(LEDGER_NAMES[k])}</b><span class="ep-row">${LEDGER_EPS[k].map((e) => endpointTag(e)).join('')}</span></div>
      <div class="r"><div class="imp">${impact}</div>${s.status === 'done' && s.impact && s.summary ? `<div class="sm">${esc(s.summary)}</div>` : ''}${extra}${json}</div>
      <div class="x">${meta}</div>
    </div>`;
  }).join('');
  if (!rows) return '';
  const credits = Object.values(r.steps).reduce((t, s) => t + (s.meta?.credits || 0), 0);
  return `<div class="card ledger-card"><div class="card-head"><h2>What each Clocked call changed</h2><span class="faint" style="font-size:12.5px">${credits} credits${Object.values(r.steps).some((s) => s.meta?.replay) ? ' when recorded' : ''}</span></div>${rows}</div>`;
}

function rerankTable(results) {
  const rows = results.slice(0, 10).map((x) => `<tr><td class="t" title="${esc(x.passage?.title || x.id)}">${esc(x.passage?.title || x.id)}</td><td class="num">#${x.keywordRank ?? '–'}</td><td>${rerankChip(x)}</td><td class="num">${(x.relevance_score ?? 0).toFixed(3)}</td></tr>`).join('');
  return `<table class="rr-table"><thead><tr><th>Passage</th><th>Keyword</th><th>Rerank</th><th>Relevance</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderResult() {
  const el = $('#result');
  if (!el) return;
  const r = state.result;
  if (!r) {
    el.innerHTML = `<div class="card empty"><h3>Pick a judge scenario or ask your own question</h3><p>Each scenario shows a different way an unchecked help desk goes wrong, and which Clocked check stops it.</p></div>`;
    return;
  }
  const notRec = Object.values(r.steps).find((s) => s.status === 'error' && (s.error?.code === 'not_recorded' || s.error?.code === 'no_key'));
  if (notRec) {
    el.innerHTML = questionCard(r) + `<div class="inline-error">${icon('key')}<span>This question has not been recorded, so it needs to run live. Add your Clocked key (it stays in this tab) and press Check again.</span><button class="btn btn-sm btn-primary" type="button" data-action="key">Add key</button></div>`;
    return;
  }
  const showBaseline = r.kind === 'ask' && r.compare && r.steps.baseline;
  const main = r.kind === 'check' ? checkCard(r) : proofdeskCard(r);
  el.innerHTML = questionCard(r) + stepper(r)
    + `<div class="compare-grid ${showBaseline ? '' : 'single'}">${main}${showBaseline ? baselineCard(r) : ''}</div>`
    + ledgerCard(r);
}

// ---------------------------------------------------------------------------------------------
// Drawer: passages and evidence
// ---------------------------------------------------------------------------------------------

function openDrawer(title, sub, html) {
  $('#drawer-title').textContent = title;
  $('#drawer-sub').innerHTML = sub;
  $('#drawer-body').innerHTML = html;
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('open');
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('open');
}

function openPassage(id, quote = null, span = null) {
  const p = passageById(id);
  if (!p) return;
  const text = `${p.title}\n${p.text}`;
  const marks = [{ start: 0, end: Array.from(p.title).length, cls: 'md-h2' }];
  if (span && Number.isInteger(span.start)) marks.push({ start: span.start, end: span.end, cls: 'm-evidence' });
  else if (quote) {
    const i = text.indexOf(quote);
    if (i >= 0) { const s = Array.from(text.slice(0, i)).length; marks.push({ start: s, end: s + Array.from(quote).length, cls: 'm-evidence' }); }
  }
  const d = state.library.docs.find((x) => x.id === p.docId);
  const raw = id.startsWith('raw:');
  const sub = raw ? 'As the unchecked desk read it: unscreened text' : `Searchable copy${d?.flags.includes('masked') ? ', personal data masked' : ''}`;
  openDrawer(p.title.split(' · ')[0], esc(sub), `<div class="doc-text">${renderMarked(text, marks)}</div>
    <div style="padding:0 20px 20px"><button class="btn btn-sm" type="button" data-open-doc="${esc(p.docId)}">${icon('doc', 14)}See this document in the source check</button></div>`);
}

function onDelegatedClick(e) {
  const t = e.target.closest('[data-doc],[data-jump],[data-scenario],[data-passage],[data-claim],[data-action],[data-open-doc]');
  if (!t) return;
  if (t.dataset.doc) { state.selectedDoc = t.dataset.doc; renderSources(); return; }
  if (t.dataset.jump) {
    const d = state.library?.docs.find((x) => x.flags.includes(t.dataset.jump));
    if (d) { state.selectedDoc = d.id; renderSources(); $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    return;
  }
  if (t.dataset.scenario) { const s = state.samples.ask.find((x) => x.id === t.dataset.scenario); if (s) runScenario(s); return; }
  if (t.dataset.passage) { openPassage(t.dataset.passage, t.dataset.quote || null); return; }
  if (t.dataset.action === 'key') { openKeyDialog(); return; }
  if (t.dataset.openDoc) { closeDrawer(); state.selectedDoc = t.dataset.openDoc; location.hash = 'sources'; renderSources(); return; }
  if (t.dataset.claim) {
    const [prefix, idx] = t.dataset.claim.split(':');
    const r = state.result;
    const v = prefix === 'bl' ? r.baselineVerify : r.verify;
    const c = v?.claims?.[Number(idx)];
    if (!c) return;
    const ev = c.evidence;
    if (ev?.document) openPassage(ev.document, ev.quote, { start: ev.start, end: ev.end });
    else {
      openDrawer(verdictLabel(c.verdict), '', `<div class="card-body"><p>“${esc(c.claim)}”</p><p class="muted" style="margin-top:10px">Verify returned no supporting passage for this claim. Supported ${pct(c.supported)}, contradicted ${pct(c.contradicted)}, not stated ${pct(c.not_stated)}.</p></div>`);
    }
  }
}

boot();
