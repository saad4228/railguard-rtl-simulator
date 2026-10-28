// Scenario chapter selector. Sits directly above the scene so a chapter can be
// switched while the crossing is still in view. It is the only control bound to
// store.scenario — the store holds the selection, this just reflects it.

import { escapeHtml, groupDigits } from '../lib/format.js';

export function mountChapters(root, store) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chapter]');
    if (!b || b.disabled) return;
    store.setScenario(b.dataset.chapter === 'all' ? null : Number(b.dataset.chapter));
  });

  function build(tr) {
    if (!tr || tr.scenarios.length < 2) {
      root.innerHTML = '';
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const chip = (value, label, title, n) =>
      `<button type="button" role="radio" aria-checked="false" data-chapter="${value}" title="${escapeHtml(title)}">` +
      `${n ? `<span class="ch-n">${n}</span>` : ''}<span>${escapeHtml(label)}</span></button>`;
    root.innerHTML =
      `<span class="ch-label" id="ch-label">Scenario</span>` +
      `<div class="ch-set" role="radiogroup" aria-labelledby="ch-label">` +
      tr.scenarios
        .map((s, k) =>
          chip(String(k), s.label, `${s.label} — ${groupDigits(s.tStart)}–${groupDigits(s.tEnd)} ps (boundary inferred). ${s.detail}`, k + 1)
        )
        .join('') +
      chip('all', 'Full run', `The complete recorded trace, ${groupDigits(tr.start)}–${groupDigits(tr.end)} ps, with every scenario in order.`, '') +
      `</div>` +
      `<span class="ch-note" data-ref="note"></span>`;
  }

  function update(st) {
    if (!st.trace || st.trace.scenarios.length < 2) return;
    const active = st.scenario === null ? 'all' : String(st.scenario);
    root.querySelectorAll('[data-chapter]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.chapter === active)));
    const note = root.querySelector('[data-ref="note"]');
    if (note) {
      note.textContent = `${groupDigits(st.rangeStart)}–${groupDigits(st.rangeEnd)} ps`;
      note.title = 'Recorded time range of the selected scenario. Scenario boundaries are inferred from the recorded approach edges; the CSV has no scenario column.';
    }
  }

  store.subscribe((st, changed) => {
    if (changed.has('trace')) build(st.trace);
    if (changed.has('trace') || changed.has('scenario') || changed.has('rangeStart') || changed.has('rangeEnd')) update(st);
  });
  build(store.state.trace);
  update(store.state);
}
