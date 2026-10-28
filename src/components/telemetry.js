// Current state and telemetry panel. Values are the recorded sample in
// effect at the shared simulation time (sample-and-hold).

import { indexAt, lastChangeAt, stateName, STATE_NAMES, STATE_SHORT, STATE_ROUTE } from '../lib/trace.js';
import { groupDigits, formatScaled } from '../lib/format.js';

const GROUPS = [
  {
    title: 'Train sensors',
    kind: 'input',
    signals: [
      ['train_approach', 'Train detected on approach'],
      ['train_in_crossing', 'Train occupying the crossing'],
    ],
  },
  {
    title: 'Gate feedback',
    kind: 'input',
    note: 'Reported position',
    signals: [
      ['gate_closed', 'Barrier reports fully closed'],
      ['gate_open', 'Barrier reports fully open'],
    ],
  },
  {
    title: 'Gate commands',
    kind: 'output',
    note: 'Controller request',
    signals: [
      ['gate_close_cmd', 'Drive barrier down'],
      ['gate_open_cmd', 'Drive barrier up'],
    ],
  },
  {
    title: 'Warning and fault outputs',
    kind: 'output',
    signals: [
      ['warning_light', 'Crossing lamps on'],
      ['road_stop', 'Road traffic held'],
      ['fault', 'Controller fault flag'],
    ],
  },
];

export function mountTelemetry(root, store) {
  // The mimic runs in the order the controller visits its states, so
  // WAIT_FOR_TRAIN (6) sits between CLOSING and PASSING where it belongs.
  const fsmOrder = STATE_ROUTE;
  const SHORT = STATE_SHORT;
  root.innerHTML = `
    <div class="panel-head"><h2>Telemetry</h2><span class="panel-meta" data-ref="sample">—</span></div>
    <div class="clock">
      <div class="clock-ps" data-ref="ps">—</div>
      <div class="clock-sub"><span data-ref="scaled"></span></div>
    </div>
    <div class="fsm" data-ref="fsm">
      <div class="fsm-head">
        <span class="fsm-label">FSM state</span>
        <span class="fsm-current"><b data-ref="stateName">—</b> <code data-ref="stateCode"></code></span>
      </div>
      <ol class="fsm-track" aria-label="Controller states">
        ${fsmOrder.map((s) => `<li data-s="${s}" title="${STATE_NAMES[s]}"><span class="fsm-code">${s}</span>${SHORT[s]}</li>`).join('')}
        <li data-s="5" class="fsm-fault" title="FAULT"><span class="fsm-code">5</span>FAULT</li>
      </ol>
    </div>
    ${GROUPS.map(
      (g) => `
      <section class="sig-group sig-${g.kind}" aria-label="${g.title}">
        <h3>${g.title}${g.note ? ` <span>${g.note}</span>` : ''}</h3>
        <ul>
          ${g.signals
            .map(
              ([sig, desc]) => `
            <li class="sig" data-sig="${sig}">
              <div class="sig-name"><code>${sig}</code><span>${desc}</span></div>
              <div class="sig-val"><span class="bit" data-ref="v-${sig}">–</span><span class="since" data-ref="s-${sig}"></span></div>
            </li>`
            )
            .join('')}
        </ul>
      </section>`
    ).join('')}
  `;
  const ref = (n) => root.querySelector(`[data-ref="${n}"]`);
  const sigEls = Object.fromEntries([...root.querySelectorAll('.sig')].map((el) => [el.dataset.sig, el]));
  const fsmItems = [...root.querySelectorAll('.fsm-track li')];
  let lastI = -1;
  let lastTrace = null;

  function update(st) {
    const tr = st.trace;
    root.classList.toggle('is-empty', !tr);
    if (!tr) return;
    const t = st.t;
    ref('ps').textContent = `${groupDigits(t)} ps`;
    ref('scaled').textContent = `${formatScaled(t - tr.start)} into trace`;
    const i = indexAt(tr, t);
    if (i === lastI && tr === lastTrace) return;
    lastI = i;
    lastTrace = tr;
    const r = tr.rows[i];
    ref('sample').textContent = `Sample ${i + 1} of ${tr.rows.length} · CSV line ${r.line}`;
    ref('stateName').textContent = stateName(r.state);
    ref('stateCode').textContent = `state = ${r.state}`;
    ref('fsm').dataset.state = String(r.state);
    for (const li of fsmItems) li.classList.toggle('active', Number(li.dataset.s) === r.state);
    for (const [sig, el] of Object.entries(sigEls)) {
      const v = r[sig];
      el.classList.toggle('on', v === 1);
      const bit = ref(`v-${sig}`);
      bit.textContent = v ? '1 ON' : '0 OFF';
      bit.setAttribute('aria-label', `${sig} ${v ? 'on' : 'off'}`);
      const since = lastChangeAt(tr, sig, t);
      ref(`s-${sig}`).textContent = since === tr.start ? 'since start' : `since ${groupDigits(since)} ps`;
    }
  }

  store.subscribe((st, changed) => {
    if (changed.has('t') || changed.has('trace')) update(st);
  });
  update(store.state);
}
