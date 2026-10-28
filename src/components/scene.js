// Railway crossing scene: SVG drawing plus HUD overlays.
// update() is called with the shared simulation time; every visual is
// recomputed from the trace at that time (no stored animation state).

import { GEOM, roadEdges, trainAt, gateAt } from '../lib/kinematics.js';
import { indexAt, stateName } from '../lib/trace.js';

const { W, H, VH, horizon, farRail, nearRail, C0, C1, sensorX, trainLength: L } = GEOM;
const OPEN_DEG = 88;

function poly(points) {
  return points.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
}

function roadPoly(y0, y1) {
  const [a0, b0] = roadEdges(y0);
  const [a1, b1] = roadEdges(y1);
  return poly([[a0, y0], [b0, y0], [b1, y1], [a1, y1]]);
}

function centreDashes(which) {
  let out = '';
  if (which === 'far') {
    for (let y = farRail - 14; y > horizon + 8; y -= 22) {
      const f = (y - horizon) / (H - horizon);
      out += `<line x1="600" y1="${y}" x2="600" y2="${(y - 8 * f - 2).toFixed(1)}" class="road-dash-far" stroke-width="${(2 * f + 0.6).toFixed(2)}"/>`;
    }
    return out;
  }
  // Perspective-spaced centre line, near segment only.
  const ys = [];
  for (let y = VH; y > nearRail + 20; ) {
    const f = (y - horizon) / (H - horizon);
    const len = 26 * f + 4;
    ys.push([y - len, y]);
    y -= len * 2.2;
  }
  for (const [a, b] of ys) {
    const fa = (a - horizon) / (H - horizon);
    const fb = (b - horizon) / (H - horizon);
    out += `<polygon points="${poly([[600 - 1.5 * fa, a], [600 + 1.5 * fa, a], [600 + 3 * fb, b], [600 - 3 * fb, b]])}" class="road-dash"/>`;
  }
  return out;
}

function sleepers() {
  let out = '';
  for (let x = -20; x < W + 20; x += 24) {
    if (x > C0 - 6 && x < C1 + 2) continue;
    out += `<line x1="${x}" y1="${farRail - 5}" x2="${x + 7}" y2="${nearRail + 7}"/>`;
  }
  return out;
}

function lampPost(id, x, baseY, s) {
  // Crossbuck sign, twin flashing lamp heads, warning bell housing.
  const top = baseY - 210 * s;
  const lampY = baseY - 128 * s;
  const r = 13 * s;
  const arm = 34 * s;
  return `
  <g class="lamp-post" id="${id}">
    <rect x="${x - 4 * s}" y="${top}" width="${8 * s}" height="${baseY - top}" class="post"/>
    <rect x="${x - 16 * s}" y="${baseY - 6 * s}" width="${32 * s}" height="${6 * s}" class="post-foot"/>
    <g transform="translate(${x} ${top + 26 * s}) scale(${s})">
      <g transform="rotate(32)"><rect x="-58" y="-8" width="116" height="16" class="crossbuck"/></g>
      <g transform="rotate(-32)"><rect x="-58" y="-8" width="116" height="16" class="crossbuck"/></g>
      <circle r="5" class="crossbuck-bolt"/>
    </g>
    <rect x="${x - arm - r - 4 * s}" y="${lampY - 3 * s}" width="${2 * arm + 2 * r + 8 * s}" height="${6 * s}" class="lamp-bar"/>
    <g class="lamp lamp-a">
      <circle cx="${x - arm}" cy="${lampY}" r="${r * 2.6}" class="lamp-glow" fill="url(#lampGlow)"/>
      <circle cx="${x - arm}" cy="${lampY}" r="${r + 5 * s}" class="lamp-backplate"/>
      <circle cx="${x - arm}" cy="${lampY}" r="${r}" class="lamp-lens"/>
      <path d="M${x - arm - r - 3 * s},${lampY - 2 * s} a${r + 3 * s},${r + 3 * s} 0 0 1 ${2 * r + 6 * s},0" class="lamp-hood"/>
    </g>
    <g class="lamp lamp-b">
      <circle cx="${x + arm}" cy="${lampY}" r="${r * 2.6}" class="lamp-glow" fill="url(#lampGlow)"/>
      <circle cx="${x + arm}" cy="${lampY}" r="${r + 5 * s}" class="lamp-backplate"/>
      <circle cx="${x + arm}" cy="${lampY}" r="${r}" class="lamp-lens"/>
      <path d="M${x + arm - r - 3 * s},${lampY - 2 * s} a${r + 3 * s},${r + 3 * s} 0 0 1 ${2 * r + 6 * s},0" class="lamp-hood"/>
    </g>
  </g>`;
}

function fanPath(len, dir) {
  // Sector between the closed (0°) and open (88°) arm angles.
  const a = (OPEN_DEG * Math.PI) / 180;
  if (dir > 0) {
    return `M0,0 L${len},0 A${len},${len} 0 0 0 ${(len * Math.cos(a)).toFixed(1)},${(-len * Math.sin(a)).toFixed(1)} Z`;
  }
  return `M0,0 L${-len},0 A${len},${len} 0 0 1 ${(-len * Math.cos(a)).toFixed(1)},${(-len * Math.sin(a)).toFixed(1)} Z`;
}

function barrier(id, pivot, len, dir, s) {
  // dir = +1 arm extends to the right when closed, -1 to the left.
  const h = 11 * s;
  const x0 = dir > 0 ? 8 * s : -len;
  const lights = [0.35, 0.65, 0.94]
    .map((f, k) => `<circle cx="${dir * len * f}" cy="0" r="${3.2 * s}" class="arm-light arm-light-${k % 2 ? 'b' : 'a'}"/>`)
    .join('');
  const cwX = dir > 0 ? -46 * s : 10 * s;
  return `
  <g class="barrier" id="${id}" transform="translate(${pivot.x} ${pivot.y})">
    <path class="gate-fan" d="${fanPath(len, dir)}"/>
    <rect x="${-9 * s}" y="0" width="${18 * s}" height="${(id === 'barrier-near' ? 46 : 32) * s}" class="barrier-mech"/>
    <g class="arm-ghost">
      <rect x="${x0}" y="${-h / 2}" width="${len - 8 * s}" height="${h}" rx="${2 * s}"/>
    </g>
    <g class="arm">
      <rect x="${cwX}" y="${-9 * s}" width="${36 * s}" height="${18 * s}" class="counterweight"/>
      <rect x="${x0}" y="${-h / 2}" width="${len - 8 * s}" height="${h}" rx="${2 * s}" fill="url(#armStripe${dir > 0 ? 'R' : 'L'})" class="arm-body"/>
      ${lights}
    </g>
    <circle r="${7 * s}" class="pivot"/>
  </g>`;
}

function trainSvg() {
  const loco = 236;
  const y0 = 250;
  const y1 = 336;
  const coachEnd = L - loco - 10;
  let coachWindows = '';
  for (let x = 22; x < coachEnd - 30; x += 38) {
    coachWindows += `<rect x="${x}" y="${y0 + 18}" width="26" height="22" rx="2" class="train-window"/>`;
  }
  const wheels = [26, 62, coachEnd - 62, coachEnd - 26, L - loco + 30, L - loco + 66, L - 92, L - 56]
    .map(
      (x) => `<g class="wheel" transform="translate(${x} 344)"><g class="wheel-spin"><circle r="10"/><line x1="-8" y1="0" x2="8" y2="0"/><line x1="0" y1="-8" x2="0" y2="8"/></g></g>`
    )
    .join('');
  return `
  <g id="train" class="train" clip-path="url(#sceneClip)">
    <g class="train-body">
      <polygon class="headlight-beam" points="${L},318 ${L + 260},300 ${L + 260},342"/>
      <!-- coach -->
      <rect x="0" y="${y0 + 4}" width="${coachEnd}" height="${y1 - y0 - 4}" rx="6" class="train-shell"/>
      <rect x="0" y="${y0 + 4}" width="${coachEnd}" height="9" rx="4" class="train-roof"/>
      ${coachWindows}
      <rect x="0" y="${y1 - 20}" width="${coachEnd}" height="6" class="train-stripe"/>
      <rect x="0" y="${y1 - 8}" width="${coachEnd}" height="8" class="train-skirt"/>
      <circle cx="5" cy="${y1 - 30}" r="3" class="tail-light"/>
      <!-- coupler -->
      <rect x="${coachEnd}" y="${y1 - 24}" width="12" height="7" class="train-skirt"/>
      <!-- locomotive -->
      <path class="train-shell" d="M${L - loco},${y0} H${L - 34} Q${L - 8},${y0 + 4} ${L},${y0 + 46} V${y1} H${L - loco} Z"/>
      <rect x="${L - loco}" y="${y0}" width="${loco - 40}" height="9" class="train-roof"/>
      <path class="train-windshield" d="M${L - 52},${y0 + 10} H${L - 30} Q${L - 12},${y0 + 14} ${L - 6},${y0 + 40} H${L - 52} Z"/>
      <rect x="${L - loco + 22}" y="${y0 + 18}" width="34" height="22" rx="2" class="train-window"/>
      <rect x="${L - loco + 70}" y="${y0 + 24}" width="96" height="12" rx="2" class="train-grille"/>
      <rect x="${L - loco}" y="${y1 - 20}" width="${loco}" height="6" class="train-stripe"/>
      <rect x="${L - loco}" y="${y1 - 8}" width="${loco}" height="8" class="train-skirt"/>
      <text x="${L - loco + 70}" y="${y0 + 64}" class="train-number">RG 0425</text>
      <circle cx="${L - 4}" cy="${y1 - 30}" r="3.5" class="head-light"/>
    </g>
    ${wheels}
  </g>`;
}

const SCENE_SVG = `
<svg viewBox="0 0 ${W} ${VH}" class="scene-svg" role="img" aria-labelledby="scene-title scene-desc" preserveAspectRatio="xMidYMid slice">
  <title id="scene-title">Railway level crossing</title>
  <desc id="scene-desc">Side view of a two-rail track crossing a road, with barrier arms, flashing warning lamps and a road stop signal. Every element is driven by the recorded simulation trace.</desc>
  <defs>
    <clipPath id="sceneClip"><rect width="${W}" height="${VH}"/></clipPath>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--sky-top)"/>
      <stop offset="1" stop-color="var(--sky-horizon)"/>
    </linearGradient>
    <linearGradient id="groundFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--ground-far)"/>
      <stop offset="1" stop-color="var(--ground-near)"/>
    </linearGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--haze)" stop-opacity="0"/>
      <stop offset="1" stop-color="var(--haze)" stop-opacity=".28"/>
    </linearGradient>
    <radialGradient id="spillGlow">
      <stop offset="0" stop-color="#ff4a35" stop-opacity=".2"/>
      <stop offset="1" stop-color="#ff4a35" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lampGlow">
      <stop offset="0" stop-color="var(--signal-red)" stop-opacity=".55"/>
      <stop offset=".45" stop-color="var(--signal-red)" stop-opacity=".16"/>
      <stop offset="1" stop-color="var(--signal-red)" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff4d6" stop-opacity=".32"/>
      <stop offset="1" stop-color="#fff4d6" stop-opacity="0"/>
    </linearGradient>
    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" stroke-width="2"/>
    </pattern>
    <pattern id="armStripeR" width="48" height="20" patternUnits="userSpaceOnUse" x="8">
      <rect width="24" height="20" fill="var(--arm-red)"/><rect x="24" width="24" height="20" fill="var(--arm-white)"/>
    </pattern>
    <pattern id="armStripeL" width="48" height="20" patternUnits="userSpaceOnUse" x="-8">
      <rect width="24" height="20" fill="var(--arm-white)"/><rect x="24" width="24" height="20" fill="var(--arm-red)"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${horizon}" fill="url(#sky)"/>
  <rect y="${horizon - 80}" width="${W}" height="80" fill="url(#haze)"/>
  <path class="treeline" d="M0,${horizon} L0,172 C40,160 70,168 110,158 C150,150 170,166 220,160 C270,152 300,140 350,150 C400,160 430,170 470,166 C520,162 545,176 580,182 L620,182 C660,170 700,160 760,164 C820,168 850,150 900,148 C950,146 990,164 1040,160 C1090,156 1130,146 1200,150 L1200,${horizon} Z"/>
  <rect y="${horizon}" width="${W}" height="${VH - horizon}" fill="url(#groundFade)"/>
  <line x1="0" y1="${horizon}" x2="${W}" y2="${horizon}" class="horizon"/>

  <!-- signal box, far side -->
  <g class="signal-box">
    <rect x="182" y="232" width="118" height="66" class="box-wall"/>
    <polygon points="172,234 241,206 310,234" class="box-roof"/>
    <rect x="196" y="248" width="26" height="18" class="box-window"/>
    <rect x="230" y="248" width="26" height="18" class="box-window"/>
    <rect x="264" y="248" width="26" height="18" class="box-window lit"/>
  </g>
  <g class="catenary">
    <line x1="0" y1="226" x2="${W}" y2="222"/>
    <rect x="958" y="210" width="6" height="96"/><rect x="928" y="212" width="66" height="4"/>
  </g>

  <polygon points="${roadPoly(horizon, farRail - 6)}" class="road"/>
  ${centreDashes('far')}

  <!-- far-side barrier and lamps (behind the train) -->
  ${barrier('barrier-far', GEOM.farPivot, GEOM.farArm, -1, 0.62)}
  ${lampPost('lamps-far', 790, 292, 0.6)}

  <!-- track bed -->
  <polygon points="${poly([[0, farRail - 10], [W, farRail - 10], [W, nearRail + 12], [0, nearRail + 12]])}" class="ballast"/>
  <g class="sleepers">${sleepers()}</g>
  <polygon points="${roadPoly(farRail - 10, nearRail + 12)}" class="crossing-deck"/>
  <g class="deck-joints">
    ${[0.25, 0.5, 0.75].map((f) => {
      const y = farRail - 10 + (nearRail + 22 - farRail) * f;
      const [a, b] = roadEdges(y);
      return `<line x1="${a.toFixed(1)}" y1="${y.toFixed(1)}" x2="${b.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    }).join('')}
  </g>

  <!-- sensor zones: lit directly from the recorded sensor bits -->
  <rect id="zone-approach" x="${sensorX}" y="${farRail - 4}" width="${C0 - sensorX}" height="${nearRail - farRail + 8}" class="zone zone-approach"/>
  <rect id="zone-crossing" x="${C0}" y="${farRail - 4}" width="${C1 - C0}" height="${nearRail - farRail + 8}" class="zone zone-crossing"/>

  <g class="rails">
    <line x1="0" y1="${farRail}" x2="${W}" y2="${farRail}"/>
    <line x1="0" y1="${nearRail}" x2="${W}" y2="${nearRail}"/>
  </g>
  <g class="rail-shine">
    <line x1="0" y1="${farRail - 1}" x2="${W}" y2="${farRail - 1}"/>
    <line x1="0" y1="${nearRail - 1}" x2="${W}" y2="${nearRail - 1}"/>
  </g>

  ${trainSvg()}

  <!-- near side -->
  <polygon points="${roadPoly(nearRail + 12, VH)}" class="road"/>
  <g class="kerbs">${(() => {
    const [a0, b0] = roadEdges(nearRail + 14);
    const [a1, b1] = roadEdges(VH);
    return `<line x1="${a0}" y1="${nearRail + 14}" x2="${a1}" y2="${VH}"/><line x1="${b0}" y1="${nearRail + 14}" x2="${b1}" y2="${VH}"/>`;
  })()}</g>
  ${centreDashes('near')}

  <!-- red light from the two alternating lamp heads, cast on the road -->
  <g aria-hidden="true">
    <ellipse class="spill spill-a" cx="540" cy="478" rx="270" ry="62" fill="url(#spillGlow)"/>
    <ellipse class="spill spill-b" cx="660" cy="478" rx="270" ry="62" fill="url(#spillGlow)"/>
  </g>

  <!-- approach sensor cabinet -->
  <g id="sensor-approach" class="sensor-cab" transform="translate(${sensorX} ${nearRail + 14})">
    <line x1="0" y1="-14" x2="0" y2="0" class="sensor-lead"/>
    <rect x="-14" y="0" width="28" height="26" rx="2" class="cab"/>
    <circle cx="0" cy="13" r="4.5" class="sensor-led"/>
    <text x="22" y="18" class="scene-label">train_approach</text>
  </g>
  <g id="sensor-crossing" class="sensor-cab" transform="translate(${C1 + 34} ${nearRail + 14})">
    <line x1="0" y1="-14" x2="0" y2="0" class="sensor-lead"/>
    <rect x="-14" y="0" width="28" height="26" rx="2" class="cab"/>
    <circle cx="0" cy="13" r="4.5" class="sensor-led"/>
    <text x="22" y="18" class="scene-label">train_in_crossing</text>
  </g>

  <!-- road stop line: on the road side of the barrier, where traffic waits -->
  <polygon id="stop-line" points="${(() => {
    const [a, b] = roadEdges(546);
    const [c, d] = roadEdges(559);
    return poly([[a + 10, 546], [b - 10, 546], [d - 10, 559], [c + 10, 559]]);
  })()}" class="stop-line"/>
  <g id="road-signal" class="road-signal" transform="translate(872 404)">
    <rect x="-3" y="40" width="6" height="${VH - 404 - 40}" class="post"/>
    <rect x="-17" y="0" width="34" height="62" rx="4" class="signal-head"/>
    <circle cx="0" cy="20" r="10" class="road-lens"/>
    <circle cx="0" cy="20" r="26" class="road-glow" fill="url(#lampGlow)"/>
    <text x="0" y="51" class="road-signal-text" text-anchor="middle">STOP</text>
    <text x="24" y="16" class="scene-label">road_stop</text>
  </g>

  ${barrier('barrier-near', GEOM.nearPivot, GEOM.nearArm, 1, 1)}
  ${lampPost('lamps-near', 318, 590, 1)}

  <rect id="fault-frame" x="3" y="3" width="${W - 6}" height="${VH - 6}" class="fault-frame"/>
</svg>`;

export function mountScene(root, store) {
  root.innerHTML = `
    <div class="scene-wrap" data-state="none">
      ${SCENE_SVG}
      <div class="hud hud-tl">
        <div class="hud-state"><span class="hud-state-name" data-ref="stateName">—</span><span class="hud-state-code" data-ref="stateCode"></span></div>
        <div class="hud-time" data-ref="hudTime"></div>
      </div>
      <div class="hud hud-banner" data-ref="banner" hidden>
        <strong>Controller fault</strong><span data-ref="bannerText"></span>
      </div>
      <div class="hud hud-bl">
        <div class="hud-line" data-ref="trainLine"><span class="hud-key">Train</span><span data-ref="trainText"></span></div>
        <div class="hud-line" data-ref="gateLine"><span class="hud-key">Gate</span><span data-ref="gateText"></span></div>
      </div>
      <p class="hud hud-note">Lamp flashing and arm/train motion are drawn for readability. <code>warning_light</code> is recorded as a steady level, and positions are interpolated between recorded sensor and feedback edges.</p>
    </div>`;

  const wrap = root.querySelector('.scene-wrap');
  const $ = (sel) => root.querySelector(sel);
  const ref = (name) => root.querySelector(`[data-ref="${name}"]`);
  const refs = {
    train: $('#train'),
    wheels: [...root.querySelectorAll('.wheel-spin')],
    near: $('#barrier-near'),
    far: $('#barrier-far'),
    zoneA: $('#zone-approach'),
    zoneC: $('#zone-crossing'),
    sensA: $('#sensor-approach'),
    sensC: $('#sensor-crossing'),
  };
  const nearArm = refs.near.querySelector('.arm');
  const nearGhost = refs.near.querySelector('.arm-ghost');
  const farArm = refs.far.querySelector('.arm');
  const farGhost = refs.far.querySelector('.arm-ghost');

  const TRAIN_TEXT = {
    none: 'Not detected — both train sensors low',
    entering: 'Running in — not yet at the approach sensor',
    // The approach sensor is a short pulse, so it is usually back to 0 by the
    // time the train is part-way in. The label states what was detected, not
    // the live bit — the telemetry panel shows the bit itself.
    approaching: 'Approaching — detected at the approach sensor',
    'approaching-no-entry': 'Approaching — train_in_crossing not recorded',
    crossing: 'In crossing — train_in_crossing = 1',
    departing: 'Clearing — train sensors low',
    'cleared-no-entry': 'Sensors cleared without entering the crossing',
  };

  function update(st) {
    const tr = st.trace;
    if (!tr) {
      wrap.dataset.state = 'none';
      return;
    }
    const t = st.t;
    const i = indexAt(tr, t);
    const r = tr.rows[i];

    wrap.dataset.state = stateName(r.state).toLowerCase();
    wrap.classList.toggle('is-warning', r.warning_light === 1);
    wrap.classList.toggle('is-roadstop', r.road_stop === 1);
    wrap.classList.toggle('is-fault', r.state === 5 || r.fault === 1);
    wrap.classList.toggle('is-approach', r.train_approach === 1);
    wrap.classList.toggle('is-occupied', r.train_in_crossing === 1);

    ref('stateName').textContent = stateName(r.state);
    ref('stateCode').textContent = `state = ${r.state}`;
    ref('hudTime').textContent = `t = ${Math.round(t).toLocaleString('en-US').replace(/,/g, ' ')} ps`;

    // Train
    const tp = trainAt(tr, t);
    refs.train.style.display = tp.visible ? '' : 'none';
    if (tp.visible) {
      refs.train.setAttribute('transform', `translate(${(tp.front - L).toFixed(2)} 0)`);
      refs.train.style.opacity = tp.opacity.toFixed(3);
      refs.train.classList.toggle('moving', tp.phase !== 'cleared-no-entry' && tp.phase !== 'none');
      const rot = `rotate(${(tp.wheel % 360).toFixed(1)})`;
      for (const w of refs.wheels) w.setAttribute('transform', rot);
    }
    ref('trainText').textContent = TRAIN_TEXT[tp.visible ? tp.phase : 'none'];

    // Gate
    const g = gateAt(tr, t, i);
    const nearDeg = -OPEN_DEG * (1 - g.pose);
    nearArm.setAttribute('transform', `rotate(${nearDeg.toFixed(2)})`);
    farArm.setAttribute('transform', `rotate(${(-nearDeg).toFixed(2)})`);
    const showGhost = g.ghost !== null;
    for (const [ghost, sign] of [[nearGhost, 1], [farGhost, -1]]) {
      ghost.style.display = showGhost ? '' : 'none';
      if (showGhost) ghost.setAttribute('transform', `rotate(${(sign * -OPEN_DEG * (1 - g.ghost)).toFixed(2)})`);
    }
    wrap.dataset.gate = g.level;
    wrap.classList.toggle('gate-uncertain', g.uncertain);
    ref('gateText').textContent = g.text;
    ref('gateLine').dataset.level = g.level;
    ref('trainLine').dataset.level = r.train_in_crossing ? 'warn' : 'neutral';

    const faultActive = r.state === 5 || r.fault === 1;
    const banner = ref('banner');
    banner.hidden = !faultActive;
    if (faultActive) {
      const seq = tr.sequences.find((s) => s.iEnd <= i && (s.kind === 'closing-timeout' || s.kind === 'opening-timeout' || s.kind === 'fault') && s.iEnd === lastFaultEntry(tr, i));
      ref('bannerText').textContent = seq ? `${seq.label}${seq.inferred ? ' (inferred)' : ''} · fault = ${r.fault}` : `state = ${r.state} · fault = ${r.fault}`;
    }
  }

  function lastFaultEntry(tr, i) {
    for (let k = i; k > 0; k--) {
      if (tr.rows[k].state === 5 && tr.rows[k - 1].state !== 5) return k;
      if (tr.rows[k].state !== 5) return -1;
    }
    return -1;
  }

  store.subscribe((st, changed) => {
    if (changed.has('t') || changed.has('trace')) update(st);
  });
  update(store.state);
}
