// Application header, CSV import (picker + drag-and-drop), import errors
// and the no-data empty state.

import { MARK, ICON } from './icons.js';
import { parseTraceCsv, TraceParseError, REQUIRED_COLUMNS } from '../lib/csv.js';
import { buildTrace } from '../lib/trace.js';
import { escapeHtml, groupDigits, formatScaled } from '../lib/format.js';

export const DEFAULT_TRACE_PATH = 'data/railguard_trace.csv';

/** Parse text into a trace and load it. Returns true on success. */
export function loadTraceText(store, text, fileName, source) {
  try {
    const parsed = parseTraceCsv(text, fileName);
    const trace = buildTrace(parsed);
    store.loadTrace(trace, source);
    return true;
  } catch (err) {
    const e =
      err instanceof TraceParseError
        ? { message: err.message, details: err.details, hint: err.hint, fileName }
        : { message: `${fileName} could not be processed.`, details: [String(err?.message || err)], hint: '', fileName };
    if (!(err instanceof TraceParseError)) console.error(err);
    store.set({ error: e, status: store.state.trace ? 'ready' : 'error', message: '' });
    return false;
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}

export function mountHeader(root, store, toast) {
  root.innerHTML = `
    <div class="brand">
      ${MARK}
      <div class="brand-text">
        <h1 class="wordmark">RAILGUARD</h1>
        <p class="tagline">Level-crossing controller — Verilog RTL trace replay</p>
      </div>
    </div>
    <div class="mode" role="note" aria-label="Data source">
      <span class="mode-pill"><span class="mode-dot" aria-hidden="true"></span>RTL simulation · trace replay</span>
      <span class="mode-note">Recorded simulation data. Not connected to hardware.</span>
    </div>
    <div class="dataset">
      <div class="dataset-file">
        <span class="dataset-status" data-ref="status"></span>
        <span class="dataset-name" data-ref="name">—</span>
        <span class="dataset-meta" data-ref="meta"></span>
      </div>
      <button type="button" class="primary-btn" data-ref="import">${ICON.upload}<span>Import CSV</span></button>
      <input type="file" accept=".csv,text/csv,text/plain" data-ref="file" hidden>
    </div>
  `;
  const ref = (n) => root.querySelector(`[data-ref="${n}"]`);
  const fileInput = ref('file');
  ref('import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) importFile(fileInput.files[0]);
    fileInput.value = '';
  });

  async function importFile(file) {
    if (!/\.(csv|txt)$/i.test(file.name) && file.type && !/csv|text/.test(file.type)) {
      store.set({
        error: { message: `${file.name} is not a CSV file.`, details: [`Detected type: ${file.type || 'unknown'}`], hint: 'Choose the .csv trace written by the testbench.', fileName: file.name },
      });
      return;
    }
    const prev = store.state.status;
    store.set({ status: 'loading', message: `Reading ${file.name}…`, playing: false });
    try {
      const text = await readFile(file);
      store.set({ message: `Validating ${file.name}…` });
      await new Promise((r) => requestAnimationFrame(() => r()));
      if (loadTraceText(store, text, file.name, 'imported')) {
        const tr = store.state.trace;
        toast(`Imported ${file.name} — ${tr.rows.length} samples over ${formatScaled(tr.duration)}`);
      }
    } catch (err) {
      store.set({
        status: store.state.trace ? 'ready' : prev === 'loading' ? 'empty' : prev,
        error: { message: `${file.name} could not be read.`, details: [String(err?.message || err)], hint: '', fileName: file.name },
      });
    }
  }

  // Drag-and-drop anywhere on the page.
  const overlay = document.getElementById('drop-overlay');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const files = [...e.dataTransfer.files];
    if (files.length > 1) toast(`Using ${files[0].name}; drop one trace at a time.`);
    if (files[0]) importFile(files[0]);
  });

  function update(st) {
    const tr = st.trace;
    const status = ref('status');
    if (st.status === 'loading') {
      status.textContent = 'Loading';
      status.dataset.tone = 'busy';
      ref('name').textContent = st.message || 'Loading…';
      ref('meta').textContent = '';
    } else if (tr) {
      status.textContent = st.source === 'default' ? 'Default trace' : 'Imported trace';
      status.dataset.tone = 'ok';
      ref('name').textContent = tr.meta.fileName;
      ref('name').title = tr.meta.fileName;
      const merged = tr.meta.mergedDuplicates ? ` · ${tr.meta.mergedDuplicates} same-time rows merged` : '';
      ref('meta').textContent = `${tr.rows.length} samples · ${groupDigits(tr.start)}–${groupDigits(tr.end)} ps${merged}`;
    } else {
      status.textContent = st.status === 'error' ? 'Invalid trace' : 'No trace';
      status.dataset.tone = st.status === 'error' ? 'fault' : 'idle';
      ref('name').textContent = st.status === 'error' && st.error ? st.error.fileName : 'No data loaded';
      ref('meta').textContent = 'Import a CSV to begin';
    }
    ref('import').toggleAttribute('disabled', st.status === 'loading');
  }

  store.subscribe((st, changed) => {
    if (changed.has('status') || changed.has('trace') || changed.has('message') || changed.has('source')) update(st);
  });
  update(store.state);
  return { importFile, openPicker: () => fileInput.click() };
}

export function mountImportError(root, store) {
  function update(st) {
    const e = st.error;
    root.hidden = !e;
    if (!e) {
      root.innerHTML = '';
      return;
    }
    root.innerHTML = `
      <div class="import-error" role="alert">
        <div class="ie-body">
          <strong>${escapeHtml(e.message)}</strong>
          ${e.details?.length ? `<ul>${e.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : ''}
          ${e.hint ? `<p>${escapeHtml(e.hint)}</p>` : ''}
          ${st.trace ? `<p class="ie-kept">Still showing the previous trace: ${escapeHtml(st.trace.meta.fileName)}.</p>` : ''}
        </div>
        <button type="button" class="icon-btn small" aria-label="Dismiss message">&times;</button>
      </div>`;
    root.querySelector('button').addEventListener('click', () => store.set({ error: null }));
  }
  store.subscribe((st, changed) => {
    if (changed.has('error') || changed.has('trace')) update(st);
  });
  update(store.state);
}

export function mountEmptyState(root, store, actions) {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.hidden = true;
  root.appendChild(el);

  function update(st) {
    const show = !st.trace;
    el.hidden = !show;
    if (!show) return;
    if (st.status === 'loading') {
      el.innerHTML = `<div class="empty-card" aria-busy="true"><div class="loader" aria-hidden="true"></div><p>${escapeHtml(st.message || 'Loading…')}</p></div>`;
      return;
    }
    const reason = st.error
      ? `${st.error.fileName || 'The file'} could not be loaded — see the message above.`
      : st.message;
    el.innerHTML = `
      <div class="empty-card">
        <h2>No simulation trace loaded</h2>
        <p>${escapeHtml(reason || 'Import the CSV written by the RAILGUARD testbench to replay it here.')}</p>
        <p class="empty-cols">Expected header<br><code>${REQUIRED_COLUMNS.join(',')}</code></p>
        <div class="empty-actions">
          <button type="button" class="primary-btn" data-act="pick">${ICON.upload}<span>Import CSV</span></button>
          <span>or drop the file anywhere on this page</span>
        </div>
        <p class="fine">To make it the default, save it as <code>${DEFAULT_TRACE_PATH}</code> in the project folder and reload.</p>
      </div>`;
    el.querySelector('[data-act="pick"]').addEventListener('click', actions.openPicker);
  }
  store.subscribe((st, changed) => {
    if (changed.has('trace') || changed.has('status') || changed.has('message')) update(st);
  });
  update(store.state);
}
