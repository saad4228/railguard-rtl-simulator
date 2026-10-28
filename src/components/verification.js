// Verification summary — reports the latest supplied testbench run.
// Nothing here is computed from the CSV; the "Show" links only navigate to
// where the corresponding behaviour appears in the loaded trace.

import { VERIFICATION_RUN, VERIFICATION_CHECKS } from '../data/verification.js';
import { firstEntry, firstTransition } from '../lib/trace.js';
import { escapeHtml, groupDigits } from '../lib/format.js';
import * as nav from '../nav.js';

function locate(tr, loc) {
  if (!tr) return null;
  if (loc.type === 'state') return firstEntry(tr, loc.state);
  if (loc.type === 'transition') return firstTransition(tr, loc.from, loc.to);
  if (loc.type === 'sequence') {
    const s = tr.sequences.find((q) => q.kind === loc.kind);
    return s ? s.tEnd : null;
  }
  return null;
}

export function mountVerification(root, store) {
  const run = VERIFICATION_RUN;
  const allPass = run.checksPassed === run.checksTotal && run.assertionFailures === 0;
  root.innerHTML = `
    <div class="panel-head"><h2>Verification</h2><span class="panel-meta">${escapeHtml(run.label)}</span></div>
    <div class="verify-summary ${allPass ? 'pass' : 'fail'}">
      <div class="verify-score"><b>${run.checksPassed}</b><span>/ ${run.checksTotal}</span></div>
      <div class="verify-text">
        <strong>${allPass ? 'All testbench checks passed' : 'Some testbench checks failed'}</strong>
        <span>${run.assertionFailures} assertion failure${run.assertionFailures === 1 ? '' : 's'}</span>
      </div>
    </div>
    <ol class="check-list" data-ref="list"></ol>
    <p class="fine">Reported by the testbench, not recomputed from this CSV. These directed checks cover the listed scenarios only — they are not exhaustive verification and do not imply real-world safety certification.</p>
  `;
  const list = root.querySelector('[data-ref="list"]');

  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seek]');
    if (b) nav.jumpTo(store, Number(b.dataset.seek));
  });

  function render(tr) {
    list.innerHTML = VERIFICATION_CHECKS.map((c, k) => {
      const t = locate(tr, c.locate);
      const pass = c.result === 'pass';
      return `<li class="check ${pass ? 'pass' : 'fail'}">
        <span class="check-n">${k + 1}</span>
        <span class="check-name">${escapeHtml(c.name)}</span>
        <span class="check-result">${pass ? 'Pass' : 'Fail'}</span>
        ${
          t !== null
            ? `<button type="button" class="link-btn" data-seek="${t}" aria-label="Show ${escapeHtml(c.name)} in the trace at ${groupDigits(t)} picoseconds">Show</button>`
            : `<span class="check-missing" title="${tr ? 'This behaviour does not appear in the loaded trace' : 'No trace loaded'}">${tr ? 'Not in trace' : '—'}</span>`
        }
      </li>`;
    }).join('');
  }

  store.subscribe((st, changed) => {
    if (changed.has('trace')) render(st.trace);
  });
  render(store.state.trace);
}
