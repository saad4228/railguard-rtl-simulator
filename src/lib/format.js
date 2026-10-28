export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** 1250000 -> "1 250 000" (thin-space grouping, as on instrument readouts). */
export function groupDigits(n) {
  const neg = n < 0;
  const s = Math.round(Math.abs(n)).toString();
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return neg ? `−${out}` : out;
}

export function formatPs(ps) {
  return `${groupDigits(ps)} ps`;
}

/** Human-scale duration: 1250000 ps -> "1.250 µs". */
export function formatScaled(ps) {
  const a = Math.abs(ps);
  if (a >= 1e12) return `${(ps / 1e12).toFixed(3)} s`;
  if (a >= 1e9) return `${(ps / 1e9).toFixed(3)} ms`;
  if (a >= 1e6) return `${(ps / 1e6).toFixed(3)} µs`;
  if (a >= 1e3) return `${(ps / 1e3).toFixed(1)} ns`;
  return `${Math.round(ps)} ps`;
}

export function formatRate(psPerSecond) {
  return `${formatScaled(psPerSecond)} of simulated time per second`;
}
