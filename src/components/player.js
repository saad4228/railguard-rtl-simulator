// Simulation player: transport controls, timeline scrubber with transition
// and fault markers, detected-sequence bands and a logic-analyser style
// waveform view. Owns the playback clock, which only ever advances the one
// shared `t` in the store.

import { ICON } from './icons.js';
import { BINARY_SIGNALS } from '../lib/csv.js';
import { indexAt, stateName, STATE_NAMES, STATE_SHORT } from '../lib/trace.js';
import { groupDigits, formatScaled, formatRate, escapeHtml } from '../lib/format.js';
import * as nav from '../nav.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const LANES = ['state', ...BINARY_SIGNALS];
const LANE_H = 20;

const SIGNAL_TONE = {
  train_approach: 'input',
  train_in_crossing: 'input',
  gate_closed: 'feedback',
  gate_open: 'feedback',
  warning_light: 'output',
  road_stop: 'output',
  gate_close_cmd: 'command',
  gate_open_cmd: 'command',
  fault: 'fault',
};

export function mountPlayer(root, store) {
  root.innerHTML = `
    <div class="panel-head">
      <h2>Trace replay</h2>
      <span class="panel-meta" data-ref="rate"></span>
    </div>
    <div class="transport" role="toolbar" aria-label="Playback controls">
      <div class="btn-group">
        <button type="button" class="icon-btn" data-act="restart" aria-label="Restart from the first sample" title="Restart (Home)">${ICON.restart}</button>
        <button type="button" class="icon-btn" data-act="prev" aria-label="Previous recorded sample" title="Previous sample (←)">${ICON.stepBack}</button>
        <button type="button" class="icon-btn play" data-act="play" aria-label="Play" title="Play / pause (Space)">${ICON.play}</button>
        <button type="button" class="icon-btn" data-act="next" aria-label="Next recorded sample" title="Next sample (→)">${ICON.stepFwd}</button>
      </div>
      <div class="btn-group">
        <button type="button" class="text-btn" data-act="prevEvent" aria-label="Previous event" title="Previous event (Shift + ←)">${ICON.eventPrev}<span>Event</span></button>
        <button type="button" class="text-btn" data-act="nextEvent" aria-label="Next event" title="Next event (Shift + →)"><span>Event</span>${ICON.eventNext}</button>
        <button type="button" class="text-btn fault-btn" data-act="nextFault" aria-label="Jump to next fault" title="Next fault (F)">${ICON.fault}<span>Next fault</span></button>
      </div>
      <div class="speed" role="radiogroup" aria-label="Playback speed">
        ${SPEEDS.map((s) => `<button type="button" role="radio" data-speed="${s}" aria-checked="false">${s}×</button>`).join('')}
      </div>
      <div class="readout" aria-live="off">
        <span class="readout-now" data-ref="now">—</span>
        <span class="readout-sep">/</span>
        <span class="readout-total" data-ref="total">—</span>
      </div>
    </div>

    <div class="timeline">
      <div class="tl-labels" aria-hidden="true">
        <div class="tl-label tl-label-seq">Sequences</div>
        <div class="tl-label tl-label-scrub">Transitions</div>
        <div class="tl-wave-labels" data-ref="waveLabels">
          ${LANES.map((l) => `<div class="tl-label wave-label tone-${SIGNAL_TONE[l] || 'state'}">${l}</div>`).join('')}
        </div>
      </div>
      <div class="tl-plot" data-ref="plot">
        <div class="seq-band" data-ref="seqBand"></div>
        <div class="scrub" data-ref="scrub" role="slider" tabindex="0" aria-label="Simulation time" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
          <div class="scrub-rail"></div>
          <div class="scrub-fill" data-ref="fill"></div>
          <div class="scrub-markers" data-ref="markers"></div>
          <div class="scrub-thumb" data-ref="thumb"></div>
        </div>
        <div class="wave-wrap" data-ref="waveWrap">
          <canvas class="wave" data-ref="wave" aria-label="Waveform of all recorded signals. Click or drag to seek." role="img"></canvas>
        </div>
        <div class="tl-cursor" data-ref="cursor" aria-hidden="true"></div>
      </div>
    </div>
    <div class="tl-foot">
      <button type="button" class="link-btn" data-act="toggleWave" aria-expanded="true">${ICON.wave}<span data-ref="waveToggleText">Hide waveforms</span></button>
      <span class="kbd-help">Space play/pause · ← → step samples · Shift + ← → events · F next fault</span>
    </div>
  `;

  const ref = (n) => root.querySelector(`[data-ref="${n}"]`);
  const plot = ref('plot');
  const scrub = ref('scrub');
  const canvas = ref('wave');
  const playBtn = root.querySelector('[data-act="play"]');
  const speedBtns = [...root.querySelectorAll('[data-speed]')];
  let waveVisible = true;

  // ---------------- controls
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    if (btn.dataset.speed) store.set({ speed: Number(btn.dataset.speed) });
    else if (act === 'play') store.toggle();
    else if (act === 'restart') nav.restart(store);
    else if (act === 'prev') nav.prevSample(store);
    else if (act === 'next') nav.nextSample(store);
    else if (act === 'prevEvent') nav.prevEvent(store);
    else if (act === 'nextEvent') nav.nextEvent(store);
    else if (act === 'nextFault') nav.nextFault(store);
    else if (act === 'toggleWave') {
      waveVisible = !waveVisible;
      root.classList.toggle('waves-hidden', !waveVisible);
      btn.setAttribute('aria-expanded', String(waveVisible));
      ref('waveToggleText').textContent = waveVisible ? 'Hide waveforms' : 'Show waveforms';
      if (waveVisible) drawWave();
    } else if (btn.dataset.seek) {
      nav.jumpTo(store, Number(btn.dataset.seek));
    }
  });

  speedBtns.forEach((b) =>
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const k = SPEEDS.indexOf(store.state.speed) + (e.key === 'ArrowRight' ? 1 : -1);
      const s = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, k))];
      store.set({ speed: s });
      root.querySelector(`[data-speed="${s}"]`).focus();
    })
  );

  // ---------------- scrubbing (scrubber and waveform share one x-axis)
  function timeFromX(clientX) {
    const { lo, hi } = store.range();
    const rect = plot.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    // Undo the display-only tail pad, then clamp: pointing into the pad means
    // the end of the recording, never a time beyond it.
    return Math.min(hi, lo + (f / (1 - TAIL_PAD)) * (hi - lo));
  }

  function startDrag(e) {
    if (!store.state.trace || e.button !== 0) return;
    if (e.target.closest('button')) return;
    e.preventDefault();
    const wasPlaying = store.state.playing;
    store.pause();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
    store.seek(timeFromX(e.clientX));
    const move = (ev) => store.seek(timeFromX(ev.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      root.classList.remove('dragging');
      if (wasPlaying) store.play();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    if (target === scrub) scrub.focus({ preventScroll: true });
  }
  scrub.addEventListener('pointerdown', startDrag);
  ref('waveWrap').addEventListener('pointerdown', startDrag);

  scrub.addEventListener('keydown', (e) => {
    const map = {
      ArrowLeft: () => (e.shiftKey ? nav.prevEvent(store) : nav.prevSample(store)),
      ArrowRight: () => (e.shiftKey ? nav.nextEvent(store) : nav.nextSample(store)),
      ArrowDown: () => nav.prevSample(store),
      ArrowUp: () => nav.nextSample(store),
      PageDown: () => nav.prevEvent(store),
      PageUp: () => nav.nextEvent(store),
      Home: () => nav.restart(store),
      End: () => nav.jumpTo(store, store.range().hi),
    };
    if (map[e.key] && store.state.trace) {
      e.preventDefault();
      e.stopPropagation();
      map[e.key]();
    }
  });

  // ---------------- static timeline content (per trace / per chapter)
  // The x-axis spans the ACTIVE RANGE, so selecting a chapter rescales the
  // scrubber and the waveform to just that scenario.
  //
  // TAIL_PAD reserves a slice of plot width AFTER the last recorded sample.
  // Without it a chapter whose final transition lands exactly on the range end
  // draws that edge at x = width, so the completed IDLE segment and the
  // warning_light / road_stop falling edges have zero visible extent. The pad
  // is display only: it holds the final recorded values, is shaded and marked
  // with an end rule, and carries no simulation time of its own.
  const TAIL_PAD = 0.055;
  function frac(t) {
    const { lo, hi } = store.range();
    return hi > lo ? ((t - lo) / (hi - lo)) * (1 - TAIL_PAD) : 0;
  }

  function buildStatic(st) {
    const tr = st.trace;
    const markers = ref('markers');
    const seqBand = ref('seqBand');
    if (!tr) {
      markers.innerHTML = '';
      seqBand.innerHTML = '';
      return;
    }
    const { lo, hi } = store.range();
    const within = (a, b) => b >= lo && a <= hi;
    ref('total').textContent = `${groupDigits(hi)} ps`;
    const sc = st.scenario === null ? null : tr.scenarios[st.scenario];
    ref('rate').textContent =
      `${sc ? `${sc.label} · ` : 'Full run · '}` +
      `${groupDigits(lo)}–${groupDigits(hi)} ps · ${formatScaled(hi - lo)} · 1× replays ${formatRate(tr.psPerSecond)}`;
    scrub.setAttribute('aria-valuemin', String(lo));
    scrub.setAttribute('aria-valuemax', String(hi));

    markers.innerHTML = tr.events
      .filter((e) => (e.kind === 'state' || e.kind === 'fault' || e.kind === 'recovery') && within(e.t, e.t))
      .map((e) => {
        const label = `${e.title} at ${groupDigits(e.t)} ps${e.note ? ` — ${e.note}` : ''}`;
        const s = e.stateTo ?? '';
        return `<button type="button" class="marker kind-${e.kind}" data-state="${s}" data-seek="${e.t}" style="left:${(frac(e.t) * 100).toFixed(4)}%" aria-label="Jump to ${escapeHtml(label)}" title="${escapeHtml(label)}"></button>`;
      })
      .join('');

    seqBand.innerHTML = tr.sequences
      .filter((s) => within(s.tStart, s.tEnd))
      .map((s) => {
        const left = Math.max(0, frac(s.tStart)) * 100;
        const right = Math.min(1, frac(s.tEnd)) * 100;
        const label = `${s.label}${s.inferred ? ' (inferred)' : ''}: ${groupDigits(s.tStart)}–${groupDigits(s.tEnd)} ps`;
        return `<button type="button" class="seq seq-${s.kind}" data-seek="${s.tStart}" style="left:${left.toFixed(4)}%;width:${Math.max(0.6, right - left).toFixed(4)}%" aria-label="Jump to ${escapeHtml(label)}" title="${escapeHtml(label)}"><span>${escapeHtml(s.label)}</span></button>`;
      })
      .join('');
    drawWave();
  }

  // ---------------- waveform canvas
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawWave() {
    const tr = store.state.trace;
    if (!waveVisible) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, plot.clientWidth);
    const h = LANES.length * LANE_H;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!tr) return;

    const { lo: t0, hi: t1 } = store.range();
    const X = (t) => frac(t) * w;
    // Segments are clipped to the visible range so a chapter shows only its
    // own slice of each signal.
    const seg = (a, b) => (b !== null && b < t0) || a > t1 ? null : [Math.max(0, X(a)), Math.min(w, b === null ? w : X(b))];
    const colors = {
      grid: cssVar('--wave-grid'),
      input: cssVar('--steel'),
      feedback: cssVar('--feedback'),
      output: cssVar('--amber'),
      command: cssVar('--amber-soft'),
      fault: cssVar('--signal-red'),
      text: cssVar('--text-dim'),
    };
    const stateFill = [cssVar('--st-idle'), cssVar('--st-warning'), cssVar('--st-closing'), cssVar('--st-passing'), cssVar('--st-opening'), cssVar('--st-fault'), cssVar('--st-wait')];

    // Shade the display-only tail so it cannot be read as recorded time, and
    // rule the exact position of the last recorded sample.
    const xEnd = X(t1);
    ctx.fillStyle = cssVar('--wave-tail');
    ctx.fillRect(xEnd, 0, w - xEnd, h);

    // lane separators and transition gridlines
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (let k = 1; k < LANES.length; k++) {
      ctx.beginPath();
      ctx.moveTo(0, k * LANE_H + 0.5);
      ctx.lineTo(w, k * LANE_H + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([2, 3]);
    for (const e of tr.events) {
      if (e.stateTo === null || e.kind === 'start') continue;
      if (e.t < t0 || e.t > t1) continue;
      const x = Math.round(X(e.t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // state bus
    const sc = tr.changes.state;
    ctx.font = `600 10px ${cssVar('--font-mono')}`;
    ctx.textBaseline = 'middle';
    for (let k = 0; k < sc.length; k++) {
      const span = seg(sc[k].t, k + 1 < sc.length ? sc[k + 1].t : null);
      if (!span || span[1] - span[0] < 0.5) continue;
      const [x0, x1] = span;
      const y0 = 4;
      const y1 = LANE_H - 4;
      const ym = LANE_H / 2;
      const c = Math.min(3, (x1 - x0) / 2);
      ctx.beginPath();
      ctx.moveTo(x0, ym);
      ctx.lineTo(x0 + c, y0);
      ctx.lineTo(x1 - c, y0);
      ctx.lineTo(x1, ym);
      ctx.lineTo(x1 - c, y1);
      ctx.lineTo(x0 + c, y1);
      ctx.closePath();
      ctx.fillStyle = stateFill[sc[k].v] || colors.grid;
      ctx.fill();
      ctx.fillStyle = sc[k].v === 5 ? '#fff' : cssVar('--wave-bus-text');
      // Full name where it fits, else the compact label (WAIT_FOR_TRAIN is far
      // too wide for its band), else the bare encoding.
      const label = [STATE_NAMES[sc[k].v], STATE_SHORT[sc[k].v], String(sc[k].v)]
        .find((s) => s !== undefined && x1 - x0 > ctx.measureText(s).width + 10);
      if (label) ctx.fillText(label, x0 + 5, ym + 0.5);
    }

    // binary lanes
    LANES.slice(1).forEach((sig, idx) => {
      const top = (idx + 1) * LANE_H;
      const yHi = top + 4.5;
      const yLo = top + LANE_H - 4.5;
      const color = colors[SIGNAL_TONE[sig]] || colors.input;
      const list = tr.changes[sig];
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = color;
      for (let k = 0; k < list.length; k++) {
        if (!list[k].v) continue;
        const span = seg(list[k].t, k + 1 < list.length ? list[k + 1].t : null);
        if (!span) continue;
        ctx.fillRect(span[0], yHi, Math.max(1, span[1] - span[0]), yLo - yHi);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      // Start from the level already in force at the left edge of the range.
      let v = list[0].v;
      for (const c of list) if (c.t <= t0) v = c.v;
      let y = v ? yHi : yLo;
      ctx.moveTo(0, y);
      for (const c of list) {
        if (c.t <= t0 || c.t > t1) continue;
        const x = X(c.t);
        ctx.lineTo(x, y);
        y = c.v ? yHi : yLo;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    // End-of-recording rule, drawn last so it sits above every lane.
    ctx.strokeStyle = colors.text;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(xEnd) + 0.5, 0);
    ctx.lineTo(Math.round(xEnd) + 0.5, h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const ro = new ResizeObserver(() => drawWave());
  ro.observe(plot);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawWave);

  // ---------------- per-frame update
  function update(st) {
    const tr = st.trace;
    root.classList.toggle('is-empty', !tr);
    root.querySelectorAll('button, [role="slider"]').forEach((b) => {
      if (b.dataset.act === 'toggleWave') return;
      b.toggleAttribute('disabled', !tr && b.tagName === 'BUTTON');
    });
    if (!tr) {
      ref('now').textContent = '—';
      ref('total').textContent = '—';
      ref('rate').textContent = 'No trace loaded';
      return;
    }
    const pct = `${(frac(st.t) * 100).toFixed(4)}%`;
    ref('fill').style.width = pct;
    ref('thumb').style.left = pct;
    ref('cursor').style.left = pct;
    ref('now').textContent = `${groupDigits(st.t)} ps`;
    const i = indexAt(tr, st.t);
    scrub.setAttribute('aria-valuenow', String(Math.round(st.t)));
    scrub.setAttribute('aria-valuetext', `${groupDigits(st.t)} picoseconds, ${stateName(tr.rows[i].state)}`);

    // Next fault is disabled once there is no later recorded fault, rather than
    // looking live and doing nothing.
    const target = nav.nextFaultTarget(store);
    const fb = root.querySelector('[data-act="nextFault"]');
    fb.toggleAttribute('disabled', !target);
    fb.title = target
      ? `Next fault (F) — ${stateName(target.event.stateFrom)} → FAULT at ${groupDigits(target.event.t)} ps` +
        (target.scenario !== null && target.scenario !== st.scenario && st.scenario !== null
          ? `, switches to ${tr.scenarios[target.scenario].label}`
          : '')
      : 'No later recorded fault in this trace';
  }

  function updateTransport(st) {
    playBtn.innerHTML = st.playing ? ICON.pause : ICON.play;
    playBtn.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
    playBtn.classList.toggle('is-playing', st.playing);
    speedBtns.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.speed) === st.speed)));
  }

  // ---------------- playback clock
  let raf = 0;
  let last = 0;
  function tick(now) {
    const st = store.state;
    if (!st.playing || !st.trace) {
      raf = 0;
      return;
    }
    // Clamp both ends. The upper bound covers tab switches; the lower bound
    // matters because `last` is stamped with performance.now() when playback
    // starts, which can be later than the next frame's own timestamp. A
    // negative dt would walk simulation time backwards — and backwards across
    // a fault sample makes the stop-on-fault test below match again, pinning
    // playback at that frame.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const next = st.t + dt * st.speed * st.trace.psPerSecond;
    const end = store.range().hi;
    // Stop on the sample where the recorded fault bit first goes high, so the
    // failure is not played past during a demo. The test is strictly after the
    // current time, so resuming from the paused frame cannot re-trigger it.
    const hit = st.trace.faultEvents.find((e) => e.t > st.t && e.t <= Math.min(next, end));
    if (hit) {
      store.set({ t: hit.t, playing: false });
      raf = 0;
      return;
    }
    // Playback stops at the end of the active chapter and holds that frame;
    // it never runs on into the next scenario and never loops.
    if (next >= end) {
      store.set({ t: end, playing: false });
      raf = 0;
      return;
    }
    store.set({ t: next });
    raf = requestAnimationFrame(tick);
  }

  store.subscribe((st, changed) => {
    if (changed.has('trace') || changed.has('rangeStart') || changed.has('rangeEnd')) buildStatic(st);
    if (changed.has('t') || changed.has('trace') || changed.has('rangeStart')) update(st);
    if (changed.has('playing') || changed.has('speed') || changed.has('trace')) updateTransport(st);
    if (changed.has('playing') && st.playing && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  });
  buildStatic(store.state);
  update(store.state);
  updateTransport(store.state);
}
