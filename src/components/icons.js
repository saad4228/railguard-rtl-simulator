// Small inline SVG icon set (stroke icons, 20px grid).
const wrap = (d, extra = '') =>
  `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false" ${extra}>${d}</svg>`;

export const ICON = {
  play: wrap('<path d="M6 4.5v11l9-5.5z" fill="currentColor"/>'),
  pause: wrap('<rect x="5" y="4.5" width="3.4" height="11" rx=".6" fill="currentColor"/><rect x="11.6" y="4.5" width="3.4" height="11" rx=".6" fill="currentColor"/>'),
  restart: wrap('<path d="M4 4.5v11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.5 4.5v11L7 10z" fill="currentColor"/>'),
  stepBack: wrap('<path d="M13.5 5.5 8.5 10l5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  stepFwd: wrap('<path d="M6.5 5.5 11.5 10l-5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  eventPrev: wrap('<path d="M15 5.5 10 10l5 4.5M10 5.5 5 10l5 4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  eventNext: wrap('<path d="M5 5.5 10 10l-5 4.5M10 5.5l5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  fault: wrap('<path d="M10 3.2 17.6 16.5H2.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="14.2" r="1" fill="currentColor"/>'),
  upload: wrap('<path d="M10 13V3.8M6.2 7.4 10 3.6l3.8 3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 12.5v3.2h13v-3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  wave: wrap('<path d="M2.5 13h3V7h4v6h3V7h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
};

/** RAILGUARD mark: a crossbuck inside a signal roundel. */
export const MARK = `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false" class="mark">
  <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".45"/>
  <g transform="translate(16 16)">
    <rect x="-11" y="-2.3" width="22" height="4.6" rx=".8" transform="rotate(35)" fill="var(--signal-red)"/>
    <rect x="-11" y="-2.3" width="22" height="4.6" rx=".8" transform="rotate(-35)" fill="var(--text)"/>
  </g>
</svg>`;
