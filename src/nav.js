// Navigation helpers shared by the player, keyboard shortcuts and panels.
import { indexAt } from './lib/trace.js';

const EPS = 1e-6;

// Every helper stays inside the active scenario chapter, so stepping and
// event jumps cannot wander into a different test case.
const inRange = (store, time) => {
  const { lo, hi } = store.range();
  return time >= lo - EPS && time <= hi + EPS;
};

export function prevSample(store) {
  const { trace: tr, t } = store.state;
  if (!tr) return;
  const i = indexAt(tr, t);
  // If between samples, snap back to the start of the current one first.
  const target = t - tr.times[i] > EPS ? tr.times[i] : tr.times[Math.max(0, i - 1)];
  store.pause();
  store.seek(target);
}

export function nextSample(store) {
  const { trace: tr, t } = store.state;
  if (!tr) return;
  const i = indexAt(tr, t);
  store.pause();
  store.seek(tr.times[Math.min(tr.times.length - 1, i + 1)]);
}

export function nextEvent(store, filter = () => true) {
  const { trace: tr, t } = store.state;
  if (!tr) return false;
  const ev = tr.events.find((e) => e.t > t + EPS && inRange(store, e.t) && filter(e));
  if (!ev) return false;
  store.pause();
  store.seek(ev.t);
  return true;
}

export function prevEvent(store, filter = () => true) {
  const { trace: tr, t } = store.state;
  if (!tr) return false;
  let found = null;
  for (const e of tr.events) {
    if (e.t < t - EPS && inRange(store, e.t) && filter(e)) found = e;
  }
  if (!found) return false;
  store.pause();
  store.seek(found.t);
  return true;
}

/**
 * The next recorded FAULT after the current time, anywhere in the trace, plus
 * the chapter it belongs to. Returns null at the last fault — the caller is
 * expected to disable its control rather than silently wrap.
 */
export function nextFaultTarget(store) {
  const { trace: tr, t } = store.state;
  if (!tr) return null;
  const ev = tr.events.find((e) => e.kind === 'fault' && e.t > t + EPS);
  if (!ev) return null;
  const k = tr.scenarios.findIndex((s) => ev.t >= s.tStart && ev.t <= s.tEnd);
  return { event: ev, scenario: k < 0 ? null : k };
}

/**
 * Jump to the next recorded fault, switching chapter when it lives in another
 * one so a demo can reach both failures without hunting through the trace.
 */
export function nextFault(store) {
  const target = nextFaultTarget(store);
  if (!target) return false;
  store.pause();
  const cur = store.state.scenario;
  // Only re-scope when the fault is outside the active range; Full run already
  // covers the whole trace and must not be switched away from.
  if (cur !== null && !inRange(store, target.event.t)) store.setScenario(target.scenario);
  store.seek(target.event.t);
  return true;
}

export function restart(store) {
  if (!store.state.trace) return;
  store.pause();
  store.seek(store.range().lo);
}

export function jumpTo(store, t) {
  store.pause();
  store.seek(t);
}
