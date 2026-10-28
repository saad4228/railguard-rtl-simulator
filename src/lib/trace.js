// Trace analysis: sample-and-hold lookup, change history, events and
// automatically detected sequences. Everything here is a pure function of
// the parsed CSV rows, so the same file always yields the same results.

import { BINARY_SIGNALS } from './csv.js';
import { buildKinematics } from './kinematics.js';

export const STATE_NAMES = ['IDLE', 'WARNING', 'CLOSING', 'PASSING', 'OPENING', 'FAULT', 'WAIT_FOR_TRAIN'];
export const STATE = { IDLE: 0, WARNING: 1, CLOSING: 2, PASSING: 3, OPENING: 4, FAULT: 5, WAIT_FOR_TRAIN: 6 };

/** Compact labels for places too narrow for the full name (waveform bus, FSM track). */
export const STATE_SHORT = ['IDLE', 'WARN', 'CLOSE', 'PASS', 'OPEN', 'FAULT', 'WAIT'];

/** The order the controller actually visits its states, for route-style displays. */
export const STATE_ROUTE = [STATE.IDLE, STATE.WARNING, STATE.CLOSING, STATE.WAIT_FOR_TRAIN, STATE.PASSING, STATE.OPENING];

export const INPUT_SIGNALS = ['train_approach', 'train_in_crossing', 'gate_closed', 'gate_open'];
export const OUTPUT_SIGNALS = ['warning_light', 'road_stop', 'gate_close_cmd', 'gate_open_cmd', 'fault'];

export function stateName(s) {
  return STATE_NAMES[s] ?? `S${s}`;
}

/** Index of the last row whose time is <= t (sample-and-hold). */
export function indexAt(trace, t) {
  const times = trace.times;
  if (t <= times[0]) return 0;
  let lo = 0;
  let hi = times.length - 1;
  if (t >= times[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function median(values, fallback) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return fallback;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function buildChanges(rows) {
  const changes = {};
  for (const sig of ['state', ...BINARY_SIGNALS]) {
    const list = [{ t: rows[0].t, v: rows[0][sig], i: 0 }];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][sig] !== rows[i - 1][sig]) list.push({ t: rows[i].t, v: rows[i][sig], i });
    }
    changes[sig] = list;
  }
  return changes;
}

/** Time of the most recent change of `sig` at or before t. */
export function lastChangeAt(trace, sig, t) {
  const list = trace.changes[sig];
  let lo = 0;
  let hi = list.length - 1;
  if (t < list[0].t) return list[0].t;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo].t;
}

function edge(sig, from, to) {
  return { sig, from, to };
}

function buildEvents(rows) {
  const events = [];
  const first = rows[0];
  events.push({
    id: 'e0',
    i: 0,
    t: first.t,
    kind: 'start',
    title: `Trace starts in ${stateName(first.state)}`,
    stateFrom: null,
    stateTo: first.state,
    inputs: [],
    outputs: [],
    note: '',
  });

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const inputs = INPUT_SIGNALS.filter((s) => a[s] !== b[s]).map((s) => edge(s, a[s], b[s]));
    const outputs = OUTPUT_SIGNALS.filter((s) => a[s] !== b[s]).map((s) => edge(s, a[s], b[s]));
    const stateChanged = a.state !== b.state;
    if (!stateChanged && !inputs.length && !outputs.length) continue;

    let kind = 'input';
    if (!inputs.length && outputs.length) kind = 'output';
    if (stateChanged) kind = 'state';
    if (b.state === STATE.FAULT && a.state !== STATE.FAULT) kind = 'fault';
    else if (outputs.some((o) => o.sig === 'fault' && o.to === 1)) kind = 'fault';
    if (a.state === STATE.FAULT && b.state !== STATE.FAULT) kind = 'recovery';

    let title;
    if (stateChanged) title = `${stateName(a.state)} → ${stateName(b.state)}`;
    else {
      const all = [...inputs, ...outputs];
      title = all.map((c) => `${c.sig} ${c.to ? '↑' : '↓'}`).join(', ');
    }

    events.push({
      id: `e${i}`,
      i,
      t: b.t,
      kind,
      title,
      stateFrom: stateChanged ? a.state : null,
      stateTo: stateChanged ? b.state : null,
      inputs,
      outputs,
      note: '',
    });
  }
  return events;
}

const SEQ_LABEL = {
  normal: 'Normal crossing',
  partial: 'Partial cycle',
  incomplete: 'Cycle still in progress at end of trace',
  'closing-timeout': 'Gate-closing timeout',
  'opening-timeout': 'Gate-opening timeout',
  fault: 'Fault',
  recovery: 'FAULT → IDLE recovery',
  'fault-exit': 'Left FAULT',
};

function buildSequences(rows, events) {
  const sequences = [];
  let cur = null;
  let faultStart = rows[0].state === STATE.FAULT ? 0 : null;
  const eventByRow = new Map(events.map((e) => [e.i, e]));

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.state === b.state) continue;
    const s0 = a.state;
    const s1 = b.state;

    if (s1 !== STATE.FAULT && s1 !== STATE.IDLE) {
      if (!cur) cur = { iStart: i, tStart: b.t, visited: new Set() };
      cur.visited.add(s1);
    }

    if (s1 === STATE.IDLE && s0 !== STATE.FAULT && cur) {
      const full = [1, 2, 3, 4].every((s) => cur.visited.has(s));
      sequences.push({
        kind: full ? 'normal' : 'partial',
        label: SEQ_LABEL[full ? 'normal' : 'partial'],
        iStart: cur.iStart,
        tStart: cur.tStart,
        iEnd: i,
        tEnd: b.t,
        inferred: false,
        // `visited` is a Set, so it is already in the order the states were
        // entered. Sorting it numerically would put WAIT_FOR_TRAIN (6) after
        // OPENING (4) instead of between CLOSING and PASSING, where it runs.
        detail: [...cur.visited].map(stateName).join(' → ') + ' → IDLE',
      });
      cur = null;
    }

    if (s1 === STATE.FAULT && s0 !== STATE.FAULT) {
      let kind = 'fault';
      let detail = `Entered FAULT from ${stateName(s0)}.`;
      // The controller's internal timer is not in the trace, so the timeout is
      // inferred from which state led to FAULT plus the recorded gate feedback.
      if (s0 === STATE.CLOSING && b.gate_closed === 0) {
        kind = 'closing-timeout';
        detail = `CLOSING → FAULT while gate_closed = 0 (gate_open = ${b.gate_open}). Closure was never confirmed.`;
      } else if (s0 === STATE.OPENING && b.gate_open === 0) {
        kind = 'opening-timeout';
        detail = `OPENING → FAULT while gate_open = 0 (gate_closed = ${b.gate_closed}). ${
          b.gate_closed === 0 ? 'Neither gate endpoint was confirmed.' : 'Opening was never confirmed.'
        }`;
      }
      sequences.push({
        kind,
        label: SEQ_LABEL[kind],
        iStart: cur ? cur.iStart : i,
        tStart: cur ? cur.tStart : b.t,
        iEnd: i,
        tEnd: b.t,
        inferred: kind !== 'fault',
        detail,
      });
      const ev = eventByRow.get(i);
      if (ev) ev.note = SEQ_LABEL[kind] + (kind !== 'fault' ? ' (inferred from state path)' : '');
      cur = null;
      faultStart = i;
    }

    if (s0 === STATE.FAULT && s1 !== STATE.FAULT) {
      const startIdx = faultStart ?? i;
      const toIdle = s1 === STATE.IDLE;
      sequences.push({
        kind: toIdle ? 'recovery' : 'fault-exit',
        label: toIdle ? SEQ_LABEL.recovery : `${SEQ_LABEL['fault-exit']} → ${stateName(s1)}`,
        iStart: startIdx,
        tStart: rows[startIdx].t,
        iEnd: i,
        tEnd: b.t,
        inferred: toIdle,
        detail: toIdle
          ? 'The trace has no reset column. A reset is inferred only because the recorded state returned from FAULT to IDLE.'
          : `Recorded transition FAULT → ${stateName(s1)}.`,
      });
      const ev = eventByRow.get(i);
      if (ev && toIdle) ev.note = 'Reset recovery (inferred — no reset signal recorded)';
      faultStart = null;
    }
  }

  if (cur) {
    const last = rows.length - 1;
    sequences.push({
      kind: 'incomplete',
      label: SEQ_LABEL.incomplete,
      iStart: cur.iStart,
      tStart: cur.tStart,
      iEnd: last,
      tEnd: rows[last].t,
      inferred: false,
      detail: [...cur.visited].map(stateName).join(' → '),
    });
  }
  sequences.sort((x, y) => x.tStart - y.tStart || x.tEnd - y.tEnd);
  sequences.forEach((s, k) => (s.id = `s${k}`));
  return sequences;
}

const SCENARIO_LABEL = {
  normal: 'Normal crossing',
  'closing-failure': 'Gate-closing failure',
  'opening-failure': 'Gate-opening failure',
  fault: 'Fault',
  partial: 'Partial cycle',
};

/**
 * Split the trace into the separate test scenarios the testbench ran back to
 * back. A scenario opens at a rising edge of train_approach that the controller
 * met while still idle. The row carrying that edge usually already reads
 * WARNING — the FSM moved on the same clock edge the sensor was sampled — so
 * the idle test looks at the PREVIOUS row, not the current one.
 *
 * The CSV has no scenario column, so every boundary here is inferred from the
 * recorded sensor and state path. Callers must present them as such.
 */
function buildScenarios(rows) {
  const starts = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].train_approach === 1 && rows[i - 1].train_approach === 0 && rows[i - 1].state === STATE.IDLE) {
      starts.push(i);
    }
  }
  if (!starts.length) return [];
  // The first scenario absorbs whatever idle lead-in precedes its approach.
  starts[0] = 0;

  return starts.map((i0, k) => {
    const i1 = (k + 1 < starts.length ? starts[k + 1] : rows.length) - 1;
    const slice = rows.slice(i0, i1 + 1);
    const occupied = slice.some((r) => r.train_in_crossing === 1);
    let faultFrom = null;
    for (let i = Math.max(i0, 1); i <= i1; i++) {
      if (rows[i].state === STATE.FAULT && rows[i - 1].state !== STATE.FAULT) {
        faultFrom = rows[i - 1].state;
        break;
      }
    }
    let kind = 'partial';
    if (faultFrom === STATE.CLOSING) kind = 'closing-failure';
    else if (faultFrom === STATE.OPENING) kind = 'opening-failure';
    else if (faultFrom !== null) kind = 'fault';
    else if (occupied) kind = 'normal';

    const approach = slice.find((r) => r.train_approach === 1);
    const at = approach ? approach.t : rows[i0].t;
    const detail = {
      normal: `Approach recorded at ${at} ps. Closure was confirmed by gate_closed before the train occupied the crossing, and gate_open confirmed the reopening.`,
      'closing-failure': `Approach recorded at ${at} ps. gate_closed never confirmed, so the controller latched FAULT. train_in_crossing stayed 0 — nothing in the trace says a train entered the crossing.`,
      'opening-failure': `Approach recorded at ${at} ps. The crossing completed, but gate_open never confirmed the reopening and the controller latched FAULT.`,
      fault: `Approach recorded at ${at} ps. The controller reached FAULT from ${stateName(faultFrom)}.`,
      partial: `Approach recorded at ${at} ps. The recorded states do not complete a crossing.`,
    }[kind];

    return {
      id: `sc${k}`,
      index: k,
      kind,
      label: SCENARIO_LABEL[kind],
      i0,
      i1,
      tStart: rows[i0].t,
      tEnd: rows[i1].t,
      occupied,
      inferred: true,
      detail,
    };
  });
}

/** Build the complete, immutable analysis of a parsed trace. */
export function buildTrace(parsed) {
  const rows = parsed.rows;
  const times = Float64Array.from(rows, (r) => r.t);
  const start = times[0];
  const end = times[times.length - 1];
  const duration = end - start;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const medianGap = median(gaps, Math.max(1, duration / 100));

  const changes = buildChanges(rows);
  const events = buildEvents(rows);
  const sequences = buildSequences(rows, events);
  const trace = {
    meta: parsed.meta,
    rows,
    times,
    start,
    end,
    duration,
    medianGap,
    changes,
    events,
    sequences,
    scenarios: buildScenarios(rows),
    faultEvents: events.filter((e) => e.kind === 'fault'),
  };
  trace.kin = buildKinematics(trace, median);
  // Wall-clock rate: at 1x the full trace replays in roughly 40 seconds.
  trace.psPerSecond = duration > 0 ? duration / 40 : 1;
  return trace;
}

/**
 * Explain the FAULT recorded inside [lo, hi], as seen from time t.
 *
 * Everything returned is read straight out of the trace: the sample that first
 * reads FAULT, the state it came from, the command that was asserted and the
 * feedback bit that stayed 0 while the controller waited. Nothing about motors,
 * timers or sensors is invented — the CSV has no timer or reset column, so the
 * classification and the recovery reading are marked inferred for the UI.
 *
 * `status` is 'active' only when the sample at t actually reads fault = 1, so a
 * historical fault is never presented as a live one.
 */
export function faultDiagnosis(trace, t, lo, hi) {
  const rows = trace.rows;
  let i = -1;
  for (let k = 1; k < rows.length; k++) {
    if (rows[k].t < lo || rows[k].t > hi) continue;
    if (rows[k].state === STATE.FAULT && rows[k - 1].state !== STATE.FAULT) {
      i = k;
      break;
    }
  }
  const now = rows[indexAt(trace, t)];
  if (i < 0) return { status: 'none', faultBit: now.fault, inferred: true };

  const entry = rows[i];
  const waiting = rows[i - 1];
  const from = waiting.state;
  // Which command was in force, and which feedback never answered it.
  const closing = from === STATE.CLOSING;
  const opening = from === STATE.OPENING;
  const kind = closing ? 'closing-failure' : opening ? 'opening-failure' : 'fault';

  // How long that command went unanswered, counted in recorded samples only.
  let sinceIdx = i - 1;
  while (sinceIdx > 0 && rows[sinceIdx - 1].state === from) sinceIdx--;
  const waitFrom = rows[sinceIdx].t;

  // Did the state leave FAULT later? The FSM has no other exit than reset.
  let recovery = null;
  for (let k = i + 1; k < rows.length; k++) {
    if (rows[k].state !== STATE.FAULT) {
      recovery = { t: rows[k].t, state: rows[k].state, inRange: rows[k].t <= hi };
      break;
    }
    if (rows[k].t > hi) break;
  }

  const last = rows[indexAt(trace, hi)];
  return {
    status: now.fault === 1 ? 'active' : now.t < entry.t ? 'upcoming' : 'past',
    kind,
    label: closing ? 'Gate-closing failure' : opening ? 'Gate-opening failure' : 'Fault',
    inferred: true,
    tFault: entry.t,
    fromState: from,
    command: closing ? 'gate_close_cmd' : opening ? 'gate_open_cmd' : null,
    commandValue: closing ? waiting.gate_close_cmd : opening ? waiting.gate_open_cmd : null,
    missing: closing ? 'gate_closed' : opening ? 'gate_open' : null,
    missingValue: closing ? waiting.gate_closed : opening ? waiting.gate_open : null,
    waitFrom,
    waitSamples: i - sinceIdx,
    faultBit: now.fault,
    occupied: rows.slice(0, i).some((r) => r.t >= lo && r.train_in_crossing === 1),
    recovery,
    finalState: last.state,
    finalGate: { gate_closed: last.gate_closed, gate_open: last.gate_open },
  };
}

/** First time a state is entered (used to locate testbench checks). */
export function firstEntry(trace, state) {
  if (trace.rows[0].state === state) return trace.rows[0].t;
  const e = trace.events.find((ev) => ev.stateTo === state && ev.stateFrom !== null);
  return e ? e.t : null;
}

export function firstTransition(trace, from, to) {
  const e = trace.events.find((ev) => ev.stateFrom === from && ev.stateTo === to);
  return e ? e.t : null;
}
