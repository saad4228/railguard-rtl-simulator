// Event history and detected sequences. Entries are buttons that seek the
// shared simulation time.

import { escapeHtml, groupDigits, formatScaled } from '../lib/format.js';
import { stateName, faultDiagnosis } from '../lib/trace.js';
import * as nav from '../nav.js';

const FILTERS = [
  ['all', 'All'],
  ['state', 'State changes'],
  ['fault', 'Faults'],
  ['signal', 'Signal edges'],
];

function matches(filter, e) {
  if (filter === 'all') return true;
  if (filter === 'state') return e.stateTo !== null || e.kind === 'start';
  if (filter === 'fault') return e.kind === 'fault' || e.kind === 'recovery';
  return e.stateTo === null && e.kind !== 'start';
}

function edgeChip(c, group) {
  return `<span class="edge edge-${group} ${c.to ? 'rise' : 'fall'}"><code>${c.sig}</code> ${c.from}→${c.to}</span>`;
}

export function mountEventLog(root, store) {
  root.innerHTML = `
    <div class="panel-head">
      <h2>Event history</h2>
      <span class="panel-meta" data-ref="count"></span>
    </div>
    <div class="filters" role="tablist" aria-label="Filter events">
      ${FILTERS.map(([k, label], n) => `<button type="button" role="tab" data-filter="${k}" aria-selected="${n === 0}">${label}</button>`).join('')}
    </div>
    <ol class="event-list" data-ref="list" aria-label="Recorded events"></ol>
  `;
  const list = root.querySelector('[data-ref="list"]');
  const count = root.querySelector('[data-ref="count"]');
  let filter = 'all';
  let activeId = null;
  let items = [];

  root.querySelector('.filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    root.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    render(store.state);
  });

  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seek]');
    if (b) nav.jumpTo(store, Number(b.dataset.seek));
  });

  function render(st) {
    const tr = st.trace;
    activeId = null;
    if (!tr) {
      list.innerHTML = '';
      count.textContent = '';
      items = [];
      return;
    }
    // Only the active scenario chapter's events (all of them in Full run).
    const { lo, hi } = store.range();
    const inChapter = tr.events.filter((e) => e.t >= lo && e.t <= hi);
    const evs = inChapter.filter((e) => matches(filter, e));
    count.textContent = `${evs.length} of ${inChapter.length} events`;
    items = evs;
    list.innerHTML = evs.length
      ? evs
          .map((e) => {
            const head =
              e.stateTo !== null && e.stateFrom !== null
                ? `<span class="st st-${e.stateFrom}">${stateName(e.stateFrom)}</span><span class="arrow">→</span><span class="st st-${e.stateTo}">${stateName(e.stateTo)}</span>`
                : e.kind === 'start'
                  ? `<span class="ev-title">Trace start</span><span class="st st-${e.stateTo}">${stateName(e.stateTo)}</span>`
                  : `<span class="ev-title">${e.inputs.length ? 'Input change' : 'Output change'}</span>`;
            const chips = [...e.inputs.map((c) => edgeChip(c, 'in')), ...e.outputs.map((c) => edgeChip(c, 'out'))].join('');
            return `<li>
              <button type="button" class="event kind-${e.kind}" data-id="${e.id}" data-seek="${e.t}" aria-label="${escapeHtml(`${e.title} at ${groupDigits(e.t)} picoseconds. Jump here.`)}">
                <span class="ev-time">${groupDigits(e.t)}<small>ps</small></span>
                <span class="ev-main">
                  <span class="ev-head">${head}</span>
                  ${chips ? `<span class="ev-edges">${chips}</span>` : ''}
                  ${e.note ? `<span class="ev-note">${escapeHtml(e.note)}</span>` : ''}
                </span>
              </button>
            </li>`;
          })
          .join('')
      : `<li class="event-empty">No events match this filter.</li>`;
    highlight(store.state);
  }

  function highlight(st) {
    if (!st.trace || !items.length) return;
    let cur = null;
    for (const e of items) {
      if (e.t <= st.t + 1e-6) cur = e;
      else break;
    }
    const id = cur ? cur.id : null;
    if (id === activeId) return;
    activeId = id;
    list.querySelectorAll('.event[aria-current]').forEach((el) => el.removeAttribute('aria-current'));
    if (!id) return;
    const el = list.querySelector(`.event[data-id="${id}"]`);
    if (!el) return;
    el.setAttribute('aria-current', 'step');
    // Keep the active entry visible without scrolling the page itself.
    const li = el.parentElement;
    const top = li.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + li.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: st.playing && !st.reducedMotion ? 'smooth' : 'auto' });
    }
  }

  store.subscribe((st, changed) => {
    if (changed.has('trace') || changed.has('rangeStart') || changed.has('rangeEnd')) render(st);
    else if (changed.has('t')) highlight(st);
  });
  render(store.state);
}

const SEQ_TONE = {
  normal: 'ok',
  partial: 'neutral',
  incomplete: 'neutral',
  'closing-timeout': 'fault',
  'opening-timeout': 'fault',
  fault: 'fault',
  recovery: 'recover',
  'fault-exit': 'neutral',
};

/**
 * Plain-language account of the fault recorded in the active chapter, built
 * only from values that are actually in the trace. Direct readings and inferred
 * interpretation are labelled separately so neither is mistaken for the other.
 */
function diagnosisHtml(d) {
  if (d.status === 'none') {
    return `<div class="diag diag-clear"><span class="diag-head">No fault recorded in this scenario</span>
      <span class="diag-line"><code>fault</code> = ${d.faultBit} at this frame</span></div>`;
  }
  const row = (k, v) => `<span class="diag-line"><em>${k}</em>${v}</span>`;
  const tone = d.status === 'active' ? 'active' : 'past';
  const head =
    d.status === 'active'
      ? `Fault active now — <code>fault</code> = 1`
      : d.status === 'upcoming'
        ? `Fault recorded later in this scenario — <code>fault</code> = ${d.faultBit} now`
        : `Fault recorded earlier in this scenario — <code>fault</code> = ${d.faultBit} now`;
  return `<div class="diag diag-${tone}">
    <span class="diag-head">${head}</span>
    <span class="diag-kind">${escapeHtml(d.label)}<em class="tag-inferred">inferred</em></span>
    ${row('Recorded', `<code>${stateName(d.fromState)}</code> → <code>FAULT</code> at <b>${groupDigits(d.tFault)} ps</b>`)}
    ${d.command ? row('Commanded', `<code>${d.command}</code> = ${d.commandValue} from ${groupDigits(d.waitFrom)} ps`) : ''}
    ${d.missing ? row('Never came', `<code>${d.missing}</code> stayed ${d.missingValue} for ${d.waitSamples} recorded samples`) : ''}
    ${row('Crossing', d.occupied ? '<code>train_in_crossing</code> did go high — the train had reached the crossing' : '<code>train_in_crossing</code> stayed 0 — no train occupancy was ever recorded')}
    ${
      d.recovery
        ? row('Then', `state returned to <code>${stateName(d.recovery.state)}</code> at <b>${groupDigits(d.recovery.t)} ps</b><em class="tag-inferred">reset inferred</em>`)
        : row('Then', `the controller stays in <code>FAULT</code>; the trace ends in <code>${stateName(d.finalState)}</code> with <code>gate_closed</code> = ${d.finalGate.gate_closed}, <code>gate_open</code> = ${d.finalGate.gate_open}`)
    }
  </div>`;
}

export function mountSequences(root, store) {
  root.innerHTML = `
    <div class="panel-head"><h2>Detected sequences</h2><span class="panel-meta" data-ref="n"></span></div>
    <div data-ref="diag"></div>
    <ol class="seq-list" data-ref="list"></ol>
    <p class="fine">Detected from the recorded state path and gate feedback. The CSV has no scenario or reset column, so timeouts and resets are labelled as inferred.</p>
  `;
  const list = root.querySelector('[data-ref="list"]');
  const n = root.querySelector('[data-ref="n"]');
  const diag = root.querySelector('[data-ref="diag"]');
  let lastActive = null;
  let lastDiag = null;

  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seek]');
    if (b) nav.jumpTo(store, Number(b.dataset.seek));
  });

  function render(st) {
    const tr = st.trace;
    lastActive = null;
    lastDiag = null;
    if (!tr) {
      list.innerHTML = '';
      diag.innerHTML = '';
      n.textContent = '';
      return;
    }
    // Scoped to the active chapter too, so no entry here seeks outside it.
    const { lo, hi } = store.range();
    const seqs = tr.sequences.filter((s) => s.tEnd >= lo && s.tStart <= hi);
    n.textContent = `${seqs.length} found`;
    list.innerHTML = seqs.length
      ? seqs
          .map(
            (s, k) => `<li>
          <button type="button" class="seq-item tone-${SEQ_TONE[s.kind]}" data-id="${s.id}" data-seek="${s.tStart}">
            <span class="seq-idx">${k + 1}</span>
            <span class="seq-body">
              <span class="seq-name">${escapeHtml(s.label)}${s.inferred ? '<em class="tag-inferred">inferred</em>' : ''}</span>
              <span class="seq-range">${groupDigits(s.tStart)} – ${groupDigits(s.tEnd)} ps · ${formatScaled(s.tEnd - s.tStart)}</span>
              <span class="seq-detail">${escapeHtml(s.detail)}</span>
            </span>
          </button></li>`
          )
          .join('')
      : `<li class="event-empty">No state sequences found — the controller never left its initial state.</li>`;
    highlight(store.state);
  }

  function highlight(st) {
    const tr = st.trace;
    if (!tr) return;
    const { lo, hi } = store.range();
    const d = faultDiagnosis(tr, st.t, lo, hi);
    const key = `${d.status}|${d.kind || ''}|${d.faultBit}`;
    if (key !== lastDiag) {
      lastDiag = key;
      diag.innerHTML = diagnosisHtml(d);
    }
    const s = tr.sequences.find((q) => st.t >= q.tStart && st.t <= q.tEnd);
    const id = s ? s.id : null;
    if (id === lastActive) return;
    lastActive = id;
    list.querySelectorAll('.seq-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  }

  store.subscribe((st, changed) => {
    if (changed.has('trace') || changed.has('rangeStart') || changed.has('rangeEnd')) render(st);
    else if (changed.has('t')) highlight(st);
  });
  render(store.state);
}
