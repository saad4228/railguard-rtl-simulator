// Train and barrier animation, derived purely from the recorded trace.
//
// Every function here maps (trace, simulation time) -> pose with no hidden
// animation state. Seeking backwards, forwards or pausing therefore always
// reconstructs exactly the same scene for the same timestamp.
//
// Positions are an illustration of the recorded sensor and feedback edges:
//   train_approach rising   -> train front at the approach sensor
//   train_in_crossing rising -> train front reaches the crossing
//   train_in_crossing falling -> train tail clears the crossing
//   gate_open / gate_closed  -> barrier endpoint confirmed by feedback
// Between those edges the pose is interpolated. Nothing is invented between
// samples that would contradict a recorded value.

import { indexAt } from './trace.js';

/** Nose position at which the whole train is off the left edge of the scene. */
const ENTRY_X = -20;
/** Slack past the right edge before a departed train stops being drawn. */
const EXIT_MARGIN = 40;

export const GEOM = {
  W: 1200,
  H: 560, // perspective basis for the road
  VH: 640, // drawn view height (extra foreground)
  horizon: 190,
  farRail: 318,
  nearRail: 352,
  C0: 500, // crossing (road) left edge at track level
  C1: 700, // crossing right edge
  sensorX: 128, // approach sensor position along the track
  holdX: 452, // train front when approach is active but entry is never recorded
  trainLength: 500,
  nearPivot: { x: 404, y: 432 },
  nearArm: 330,
  farPivot: { x: 742, y: 262 },
  farArm: 190,
};

export function roadEdges(y) {
  const f = (y - GEOM.horizon) / (GEOM.H - GEOM.horizon);
  return [580 - 200 * f, 620 + 200 * f];
}

const lerp = (a, b, f) => a + (b - a) * f;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => {
  const f = clamp01(x);
  return f * f * (3 - 2 * f);
};

function feedbackClass(r) {
  if (r.gate_closed && !r.gate_open) return 'closed';
  if (r.gate_open && !r.gate_closed) return 'open';
  if (!r.gate_open && !r.gate_closed) return 'transit';
  return 'conflict';
}

function commandTarget(r) {
  if (r.gate_close_cmd && !r.gate_open_cmd) return 1;
  if (r.gate_open_cmd && !r.gate_close_cmd) return 0;
  if (r.gate_close_cmd && r.gate_open_cmd) return 'conflict';
  return null;
}

export function buildKinematics(trace, median) {
  const { rows, duration } = trace;

  // --- Train journeys.
  //
  // The sensors are detectors, not a picture of the train. train_approach is a
  // short pulse as the train passes the approach detector and falls again long
  // before train_in_crossing rises, so both sensors read 0 for part of a single
  // crossing. A journey therefore spans those gaps instead of ending at them:
  // it opens on a rising edge of train_approach (or of train_in_crossing when
  // no approach was recorded for it) and stays open until the next journey
  // opens, so the train keeps its position while neither detector sees it.
  const episodes = [];
  let ep = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prev = i > 0 ? rows[i - 1] : null;
    const approachRise = r.train_approach === 1 && (!prev || prev.train_approach === 0);
    const crossingRise = r.train_in_crossing === 1 && (!prev || prev.train_in_crossing === 0);

    if (approachRise) {
      ep = { tStart: r.t, enterRise: null, enterFall: null, tNext: null };
      episodes.push(ep);
    }
    if (crossingRise) {
      if (!ep || ep.enterRise !== null) {
        // Occupancy with no approach of its own (or after this journey already
        // crossed): a separate journey that starts at the crossing.
        ep = { tStart: r.t, enterRise: r.t, enterFall: null, tNext: null };
        episodes.push(ep);
      } else {
        ep.enterRise = r.t;
      }
    }
    if (ep && ep.enterRise !== null && ep.enterFall === null && r.t > ep.enterRise && r.train_in_crossing === 0) {
      ep.enterFall = r.t;
    }
  }
  // Each journey hands over to the next; the last one has no successor.
  for (let k = 0; k < episodes.length - 1; k++) episodes[k].tNext = episodes[k + 1].tStart;

  const Dapp = median(
    episodes.filter((e) => e.enterRise !== null).map((e) => e.enterRise - e.tStart),
    Math.max(duration * 0.06, 1)
  );
  const crossSpan = GEOM.C1 + GEOM.trainLength - GEOM.C0;
  const vTypical =
    crossSpan /
    median(
      episodes.filter((e) => e.enterFall !== null).map((e) => e.enterFall - e.enterRise),
      Math.max(duration * 0.08, 1)
    );

  // --- Gate: per-row feedback class and command, plus transit spans.
  const gate = rows.map((r) => ({ cls: feedbackClass(r), cmd: commandTarget(r), span: -1, lastConfirmed: 0 }));
  let lastConfirmed = 0;
  for (let i = 0; i < rows.length; i++) {
    const g = gate[i];
    if (g.cls === 'closed') lastConfirmed = 1;
    else if (g.cls === 'open') lastConfirmed = 0;
    g.lastConfirmed = lastConfirmed;
  }
  const spans = [];
  for (let i = 0; i < rows.length; i++) {
    if (gate[i].cls !== 'transit') continue;
    if (i > 0 && gate[i - 1].cls === 'transit') {
      gate[i].span = gate[i - 1].span;
      continue;
    }
    let j = i;
    while (j < rows.length && gate[j].cls === 'transit') j++;
    const from = i > 0 ? gate[i - 1].lastConfirmed : 0;
    let to = null;
    let tEnd = null;
    if (j < rows.length) {
      tEnd = rows[j].t;
      if (gate[j].cls === 'closed') to = 1;
      else if (gate[j].cls === 'open') to = 0;
    }
    spans.push({ tStart: rows[i].t, tEnd, from, to });
    gate[i].span = spans.length - 1;
  }
  const Dg = median(
    spans.filter((s) => s.to !== null && s.tEnd !== null).map((s) => s.tEnd - s.tStart),
    Math.max(duration * 0.03, 1)
  );

  const fadeW = Math.max(Dapp * 0.12, trace.medianGap * 0.5, 1);

  // --- Entrance and exit windows.
  //
  // A train does not blink into existence at the detector: it runs in from off
  // the left and the recorded approach edge is the moment its nose reaches the
  // detector. The lead-in is pure illustration — nothing is recorded before
  // that edge — so it is clamped to whatever room is left after the previous
  // train has gone, and a journey that begins at the crossing gets none.
  const entryW = Math.max(Dapp * 0.3, 1);
  const gap = Math.max(trace.medianGap * 0.5, 1);
  const EXIT_D = GEOM.W + EXIT_MARGIN - GEOM.C1; // nose travel from C1+L until the tail clears

  let prevGone = rows[0].t;
  for (const ep of episodes) {
    const room = ep.tStart - prevGone - gap;
    ep.entry = ep.enterRise === ep.tStart ? 0 : Math.max(0, Math.min(entryW, room));
    ep.tLead = ep.tStart - ep.entry;

    if (ep.enterFall !== null) {
      // Run-out. Once the tail has cleared the crossing both detectors are
      // silent, so this leg is illustration only. Start at the speed the train
      // was recorded crossing at and let it accelerate away, sized so it is
      // clear of the frame by the sample where the controller records its
      // return to IDLE — otherwise a carriage is still in shot on the final
      // frame of a completed crossing. Never slows the train down.
      ep.exitV = (GEOM.C1 + GEOM.trainLength - GEOM.C0) / Math.max(ep.enterFall - ep.enterRise, 1);
      const back = rows.find((r) => r.t >= ep.enterFall && r.state === 0);
      const T = back ? back.t - ep.enterFall : 0;
      ep.exitA = T > 0 ? Math.max(0, (2 * (EXIT_D - ep.exitV * T)) / (T * T)) : 0;
      ep.tGone =
        ep.enterFall +
        (ep.exitA > 0
          ? (Math.sqrt(ep.exitV * ep.exitV + 2 * ep.exitA * EXIT_D) - ep.exitV) / ep.exitA
          : EXIT_D / ep.exitV);
    } else if (ep.tNext !== null) {
      ep.tGone = ep.tNext - entryW; // leave room for the next entrance
    } else {
      ep.tGone = Infinity;
    }
    prevGone = ep.tGone;
  }

  return {
    episodes,
    Dapp,
    vTypical,
    gate,
    spans,
    Dg,
    entryW,
    fadeW,
    blendW: Math.max(Dg * 0.35, 1),
  };
}

// ---------------------------------------------------------------- train

export function trainAt(trace, t) {
  const { episodes, Dapp, vTypical, fadeW } = trace.kin;
  const { C0, C1, sensorX, holdX, trainLength: L, W } = GEOM;
  let ep = null;
  for (let k = episodes.length - 1; k >= 0; k--) {
    if (episodes[k].tLead <= t) {
      ep = episodes[k];
      break;
    }
  }
  const hidden = { visible: false, front: -L, opacity: 0, phase: 'none', wheel: 0 };
  if (!ep) return hidden;

  let front;
  let phase;
  let opacity = 1;
  // Only a journey with no room to run in still needs a fade to avoid popping.
  if (ep.entry <= 0 && ep.enterRise !== ep.tStart) opacity = clamp01((t - ep.tStart) / fadeW);

  if (t < ep.tStart) {
    // Running in from off-screen. Decelerates to rest exactly as the approach
    // edge is recorded, which is where the approach profile below takes over,
    // so position and speed are both continuous at the hand-over.
    const u = clamp01((t - ep.tLead) / Math.max(ep.entry, 1));
    front = ENTRY_X + (sensorX - ENTRY_X) * (2 * u - u * u);
    phase = 'entering';
  } else if (ep.enterRise !== null && t >= ep.enterRise) {
    if (ep.enterFall === null || t < ep.enterFall) {
      if (ep.enterFall !== null) front = lerp(C0, C1 + L, (t - ep.enterRise) / (ep.enterFall - ep.enterRise));
      else front = Math.min(C0 + vTypical * (t - ep.enterRise), C1 + L * 0.55);
      phase = 'crossing';
    } else {
      const dt = t - ep.enterFall;
      front = C1 + L + ep.exitV * dt + 0.5 * ep.exitA * dt * dt;
      phase = 'departing';
      if (front - L > W + EXIT_MARGIN) return hidden;
    }
  } else if (ep.enterRise !== null) {
    // Quadratic profile so the train arrives at the crossing at the same speed
    // it then crosses with (no visible speed jump at the edge).
    const T = Math.max(ep.enterRise - ep.tStart, 1);
    const D = C0 - sensorX;
    const vCross = ep.enterFall !== null ? (C1 + L - C0) / Math.max(ep.enterFall - ep.enterRise, 1) : vTypical;
    const a = Math.min(2, Math.max(0, 2 - (vCross * T) / D));
    const f = clamp01((t - ep.tStart) / T);
    front = sensorX + D * (a * f + (1 - a) * f * f);
    phase = 'approaching';
  } else {
    // Approach recorded, but no occupancy was ever recorded for this journey
    // (a gate-closing timeout looks like this). Nothing in the trace says the
    // train reached the crossing, so it eases to a stop short of it and holds
    // there rather than being driven in. It leaves only when the next recorded
    // approach supersedes it, fading out as that journey takes over.
    front = sensorX + (holdX - sensorX) * (1 - Math.exp(-(t - ep.tStart) / (Dapp * 0.55)));
    phase = 'approaching-no-entry';
    if (Number.isFinite(ep.tGone) && t > ep.tGone - fadeW) {
      opacity = Math.min(opacity, clamp01((ep.tGone - t) / fadeW));
      phase = 'cleared-no-entry';
    }
  }
  // A fully transparent train is not on screen, so report it as hidden rather
  // than as a visible element nobody can see.
  if (opacity <= 0) return hidden;
  // Wheel rotation follows distance travelled, so it is deterministic too.
  return { visible: true, front, opacity, phase, wheel: (front / 14) * (180 / Math.PI) };
}

// ---------------------------------------------------------------- gate

function rawPose(trace, i, t) {
  const { gate, spans, Dg } = trace.kin;
  const g = gate[i];
  if (g.cls === 'closed') return 1;
  if (g.cls === 'open') return 0;
  if (g.cls === 'conflict') return g.lastConfirmed;
  const s = spans[g.span];
  if (s.to !== null && s.tEnd !== null) {
    const f = (t - s.tStart) / Math.max(s.tEnd - s.tStart, 1);
    if (s.to === s.from) return s.from + (1 - 2 * s.from) * 0.35 * Math.sin(Math.PI * clamp01(f));
    return lerp(s.from, s.to, smooth(f));
  }
  // Transit that never confirms an endpoint: drift toward the command but
  // stop halfway — the true position is unknown.
  const target = typeof g.cmd === 'number' ? g.cmd : 1 - s.from;
  const pose = s.from + (target - s.from) * 0.5 * (1 - Math.exp(-(t - s.tStart) / Dg));
  // Both feedback bits are low here, so the arm is by definition not at either
  // endpoint. Hold it off both ends once the span is under way, easing the
  // limits in from the confirmed position it started at. Without this a command
  // that reverses mid-span (FAULT re-commanding close after an opening
  // timeout) would park the arm back on an endpoint nothing has confirmed.
  const lead = clamp01((t - s.tStart) / Math.max(Dg * 0.5, 1));
  return Math.min(lerp(1, 0.94, lead), Math.max(lerp(0, 0.06, lead), pose));
}

export function gateAt(trace, t, iHint) {
  const i = iHint ?? indexAt(trace, t);
  const rows = trace.rows;
  const g = trace.kin.gate[i];
  let pose = rawPose(trace, i, t);
  // Where the gate jumps between two confirmed endpoints with no in-transit
  // sample between them, the arm has to be animated across the gap. Draw that
  // travel in the interval *leading up to* the confirming sample, so the arm
  // reaches a confirmed position exactly when the feedback confirms it and
  // never sits at the opposite endpoint afterwards.
  if (i + 1 < rows.length) {
    const tn = rows[i + 1].t;
    const pNext = rawPose(trace, i + 1, tn);
    if (Math.abs(pNext - rawPose(trace, i, tn)) > 0.02) {
      const w = Math.min(trace.kin.blendW, tn - rows[i].t);
      if (t > tn - w) pose = lerp(pose, pNext, smooth((t - (tn - w)) / w));
    }
  }

  const state = rows[i].state;
  const fault = state === 5;
  let level = 'ok';
  let text;
  if (g.cls === 'conflict') {
    level = 'fault';
    text = 'Feedback conflict: gate_open and gate_closed are both high';
  } else if (g.cmd === 'conflict') {
    level = 'fault';
    text = 'Both gate commands asserted at once';
  } else if (g.cls === 'transit' && fault) {
    level = 'fault';
    text = 'Gate position unknown — neither endpoint confirmed';
  } else if (g.cmd === 1) {
    if (g.cls === 'closed') text = 'Closed — confirmed by gate_closed';
    else if (g.cls === 'transit') (level = 'warn'), (text = 'Closing — position not yet confirmed');
    else (level = fault ? 'fault' : 'warn'), (text = 'Close commanded — feedback still reports open');
  } else if (g.cmd === 0) {
    if (g.cls === 'open') text = 'Open — confirmed by gate_open';
    else if (g.cls === 'transit') (level = 'warn'), (text = 'Opening — position not yet confirmed');
    else (level = fault ? 'fault' : 'warn'), (text = 'Open commanded — feedback still reports closed');
  } else {
    if (g.cls === 'closed') (level = 'neutral'), (text = 'Closed — no gate command active');
    else if (g.cls === 'open') (level = 'neutral'), (text = 'Open — no gate command active');
    else (level = 'warn'), (text = 'Gate position unconfirmed');
  }

  const ghost = typeof g.cmd === 'number' && Math.abs(g.cmd - pose) > 0.06 ? g.cmd : null;
  return {
    pose,
    cls: g.cls,
    cmd: g.cmd,
    ghost,
    level,
    text,
    uncertain: g.cls === 'transit' || g.cls === 'conflict',
  };
}
