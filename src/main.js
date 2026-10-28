// RAILGUARD trace replay — application shell.
import { store } from './store.js';
import { mountHeader, mountImportError, mountEmptyState, loadTraceText, DEFAULT_TRACE_PATH } from './components/header.js';
import { mountChapters } from './components/chapters.js';
import { mountScene } from './components/scene.js';
import { mountTelemetry } from './components/telemetry.js';
import { mountPlayer } from './components/player.js';
import { mountEventLog, mountSequences } from './components/eventlog.js';
import { mountVerification } from './components/verification.js';
import * as nav from './nav.js';

const $ = (id) => document.getElementById(id);

// ---- toast
const toastEl = $('toast');
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4200);
}

// ---- reduced motion
const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
const applyRM = () => {
  store.set({ reducedMotion: rm.matches });
  document.documentElement.classList.toggle('reduced-motion', rm.matches);
};
rm.addEventListener?.('change', applyRM);
applyRM();

// ---- mount components (all share the one store)
const actions = mountHeader($('app-header'), store, toast);
mountImportError($('import-error'), store);
mountChapters($('chapter-root'), store);
mountScene($('scene-root'), store);
mountEmptyState($('scene-root'), store, actions);
mountTelemetry($('telemetry-root'), store);
mountPlayer($('player-root'), store);
mountEventLog($('events-root'), store);
mountSequences($('sequences-root'), store);
mountVerification($('verify-root'), store);

document.body.classList.toggle('no-trace', !store.state.trace);
store.subscribe((st, changed) => {
  if (changed.has('trace')) document.body.classList.toggle('no-trace', !st.trace);
});

// ---- keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const onButton = tag === 'button' || e.target.getAttribute?.('role') === 'radio' || e.target.getAttribute?.('role') === 'tab';
  if (!store.state.trace) return;
  if (e.key === ' ' && !onButton) {
    e.preventDefault();
    store.toggle();
  } else if (e.key === 'ArrowRight' && !onButton) {
    e.preventDefault();
    e.shiftKey ? nav.nextEvent(store) : nav.nextSample(store);
  } else if (e.key === 'ArrowLeft' && !onButton) {
    e.preventDefault();
    e.shiftKey ? nav.prevEvent(store) : nav.prevSample(store);
  } else if (e.key === 'f' || e.key === 'F') {
    nav.nextFault(store);
  } else if (e.key === 'Home' && !onButton) {
    e.preventDefault();
    nav.restart(store);
  }
});

// ---- default dataset
async function loadDefault() {
  store.set({ status: 'loading', message: 'Loading default trace…' });
  const name = DEFAULT_TRACE_PATH.split('/').pop();
  let res;
  try {
    res = await fetch(DEFAULT_TRACE_PATH, { cache: 'no-store' });
  } catch {
    store.set({
      status: 'empty',
      message:
        location.protocol === 'file:'
          ? 'This page was opened straight from disk, so the browser blocked loading the default trace. Start it with start.bat (or "node server.js"), or import the CSV below.'
          : `Could not fetch ${DEFAULT_TRACE_PATH}. Import the CSV below.`,
    });
    return;
  }
  const text = res.ok ? await res.text() : '';
  // Some dev servers answer a missing file with index.html; treat that as missing.
  if (!res.ok || /^\s*<(!doctype|html)/i.test(text)) {
    store.set({
      status: 'empty',
      message: `The default trace ${DEFAULT_TRACE_PATH} was not found. Copy your railguard_trace.csv there and reload, or import it below.`,
    });
    return;
  }
  loadTraceText(store, text, name, 'default');
}
loadDefault();
