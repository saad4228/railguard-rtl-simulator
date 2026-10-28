// Single shared simulation state. Playback, seeking, the scene, telemetry,
// the timeline and the event log all read the one `t` value held here.

const listeners = new Set();

export const store = {
  state: {
    status: 'loading', // loading | ready | empty | error
    trace: null,
    t: 0,
    playing: false,
    speed: 1,
    message: 'Loading default trace…',
    error: null, // { message, details, hint } of the last failed import
    source: null, // 'default' | 'imported'
    reducedMotion: false,
    // Active scenario chapter: an index into trace.scenarios, or null for the
    // full verification run. rangeStart/rangeEnd bound playback and seeking.
    scenario: null,
    rangeStart: 0,
    rangeEnd: 0,
  },

  /** Time bounds playback is currently confined to. */
  range() {
    const tr = this.state.trace;
    if (!tr) return { lo: 0, hi: 0 };
    return { lo: this.state.rangeStart, hi: this.state.rangeEnd };
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  set(patch) {
    const changed = new Set();
    for (const [k, v] of Object.entries(patch)) {
      if (this.state[k] !== v) {
        this.state[k] = v;
        changed.add(k);
      }
    }
    if (changed.size) for (const fn of listeners) fn(this.state, changed);
  },

  seek(t) {
    if (!this.state.trace) return;
    const { lo, hi } = this.range();
    this.set({ t: Math.min(hi, Math.max(lo, t)) });
  },

  play() {
    if (!this.state.trace) return;
    const { lo, hi } = this.range();
    if (this.state.t >= hi) this.set({ t: lo });
    this.set({ playing: true });
  },

  pause() {
    this.set({ playing: false });
  },

  toggle() {
    this.state.playing ? this.pause() : this.play();
  },

  /** Confine playback to one scenario chapter, or to the whole trace (null). */
  setScenario(k) {
    const tr = this.state.trace;
    if (!tr) return;
    const s = k === null ? null : tr.scenarios[k];
    this.set({
      scenario: s ? k : null,
      rangeStart: s ? s.tStart : tr.start,
      rangeEnd: s ? s.tEnd : tr.end,
      playing: false,
    });
    this.set({ t: this.state.rangeStart });
  },

  loadTrace(trace, source) {
    // Open on the first scenario so the app shows one complete crossing
    // rather than every test case run back to back.
    const first = trace.scenarios.length ? trace.scenarios[0] : null;
    this.set({
      trace,
      source,
      status: 'ready',
      scenario: first ? 0 : null,
      rangeStart: first ? first.tStart : trace.start,
      rangeEnd: first ? first.tEnd : trace.end,
      t: first ? first.tStart : trace.start,
      playing: false,
      error: null,
      message: '',
    });
  },
};
