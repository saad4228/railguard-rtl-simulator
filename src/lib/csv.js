// CSV import and validation for RAILGUARD simulation traces.
// Parses the real rows of the file; never substitutes or synthesises data.

export const REQUIRED_COLUMNS = [
  'time_ps',
  'state',
  'train_approach',
  'train_in_crossing',
  'gate_closed',
  'gate_open',
  'warning_light',
  'road_stop',
  'gate_close_cmd',
  'gate_open_cmd',
  'fault',
];

export const BINARY_SIGNALS = REQUIRED_COLUMNS.slice(2);
// Highest FSM state encoding the controller can report (WAIT_FOR_TRAIN = 6).
export const STATE_MAX = 6;

const MAX_REPORTED_ERRORS = 8;

export class TraceParseError extends Error {
  constructor(message, details = [], hint = '') {
    super(message);
    this.name = 'TraceParseError';
    this.details = details;
    this.hint = hint;
  }
}

function detectDelimiter(headerLine) {
  const counts = [',', ';', '\t'].map((d) => [d, headerLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function clean(cell) {
  let c = cell.trim();
  if (c.length >= 2 && ((c[0] === '"' && c.at(-1) === '"') || (c[0] === "'" && c.at(-1) === "'"))) {
    c = c.slice(1, -1).trim();
  }
  return c;
}

function isSkippable(line) {
  const s = line.trim();
  return s === '' || s.startsWith('#') || s.startsWith('//');
}

// Accepts "0", "1", and Verilog-style "1'b0" / "1'b1".
function parseBit(raw) {
  const v = raw.toLowerCase().replace(/^1'b/, '');
  if (v === '0') return 0;
  if (v === '1') return 1;
  return null;
}

function describeBadValue(raw) {
  const v = raw.toLowerCase().replace(/^\d*'[bdh]/, '');
  if (v === 'x' || v === 'z') {
    return `'${raw}' is an unknown/high-impedance Verilog value`;
  }
  if (raw === '') return 'the value is empty';
  return `'${raw}' is not 0 or 1`;
}

/**
 * Parse and validate a RAILGUARD trace CSV.
 * @returns {{rows: object[], meta: object}}
 * @throws {TraceParseError}
 */
export function parseTraceCsv(text, fileName = 'trace.csv') {
  if (typeof text !== 'string') {
    throw new TraceParseError('The file could not be read as text.');
  }
  const body = text.replace(/^﻿/, '');
  if (/^\s*<(!doctype|html|\?xml)/i.test(body)) {
    throw new TraceParseError(
      `${fileName} contains HTML or XML, not CSV.`,
      [],
      'Export the trace from the testbench with $fdisplay/$fwrite as comma-separated values.'
    );
  }
  if (body.trim() === '') {
    throw new TraceParseError(`${fileName} is empty.`, [], 'Re-run the simulation so the testbench writes the trace rows.');
  }

  const lines = body.split(/\r\n|\n|\r/);
  let headerLineNo = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isSkippable(lines[i])) {
      headerLineNo = i;
      break;
    }
  }
  if (headerLineNo < 0) {
    throw new TraceParseError(`${fileName} has no header row.`);
  }

  const delimiter = detectDelimiter(lines[headerLineNo]);
  const header = lines[headerLineNo].split(delimiter).map((h) => clean(h).toLowerCase());

  const seen = new Map();
  const duplicateHeaders = [];
  header.forEach((h, i) => {
    if (seen.has(h) && h !== '') duplicateHeaders.push(h);
    else seen.set(h, i);
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !seen.has(c));
  if (missing.length) {
    const looksLikeData = header.every((h) => /^[\d.\s'bxz]*$/i.test(h));
    throw new TraceParseError(
      looksLikeData
        ? `${fileName} does not start with a header row.`
        : `${fileName} is missing ${missing.length === 1 ? 'a required column' : `${missing.length} required columns`}.`,
      [
        `Missing: ${missing.join(', ')}`,
        `Found: ${header.filter(Boolean).join(', ') || '(no column names)'}`,
      ],
      `The first line must be: ${REQUIRED_COLUMNS.join(',')}`
    );
  }
  if (duplicateHeaders.length) {
    throw new TraceParseError(`${fileName} repeats column names.`, [`Duplicated: ${[...new Set(duplicateHeaders)].join(', ')}`]);
  }

  const col = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, seen.get(c)]));
  const extraColumns = header.filter((h) => h && !REQUIRED_COLUMNS.includes(h));

  const errors = [];
  let errorCount = 0;
  const pushError = (msg) => {
    errorCount++;
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(msg);
  };

  const rows = [];
  let rawRowCount = 0;
  let mergedDuplicates = 0;
  let prevTime = -Infinity;

  for (let li = headerLineNo + 1; li < lines.length; li++) {
    const line = lines[li];
    if (isSkippable(line)) continue;
    rawRowCount++;
    const lineNo = li + 1;
    const cells = line.split(delimiter).map(clean);
    if (cells.length < header.length) {
      pushError(`Line ${lineNo}: expected ${header.length} values, found ${cells.length}.`);
      continue;
    }

    const rawTime = cells[col.time_ps];
    if (!/^\d+(\.\d+)?$/.test(rawTime)) {
      pushError(`Line ${lineNo}: time_ps '${rawTime}' is not a non-negative number.`);
      continue;
    }
    const t = Number(rawTime);

    const rawState = cells[col.state].toLowerCase().replace(/^\d*'d/, '');
    let state = null;
    if (/^\d+$/.test(rawState) && Number(rawState) <= STATE_MAX) state = Number(rawState);
    else {
      pushError(
        `Line ${lineNo}: state '${cells[col.state]}' is not a valid encoding (0–${STATE_MAX}).` +
          (/^[xz]+$/.test(rawState) ? ' The FSM was undefined — check the reset at the start of the testbench.' : '')
      );
      continue;
    }

    const row = { t, state, line: lineNo };
    let rowOk = true;
    for (const sig of BINARY_SIGNALS) {
      const v = parseBit(cells[col[sig]]);
      if (v === null) {
        pushError(`Line ${lineNo}: ${sig} — ${describeBadValue(cells[col[sig]])}.`);
        rowOk = false;
        break;
      }
      row[sig] = v;
    }
    if (!rowOk) continue;

    if (t < prevTime) {
      pushError(`Line ${lineNo}: time_ps ${rawTime} is earlier than the previous row (${prevTime}). Rows must be in time order.`);
      continue;
    }
    if (t === prevTime && rows.length) {
      // Several rows at one timestamp (e.g. delta cycles): the last one is the settled value.
      rows[rows.length - 1] = row;
      mergedDuplicates++;
    } else {
      rows.push(row);
    }
    prevTime = t;
  }

  if (errorCount) {
    const more = errorCount > errors.length ? [`…and ${errorCount - errors.length} more.`] : [];
    throw new TraceParseError(
      `${fileName} has ${errorCount} invalid row${errorCount === 1 ? '' : 's'}.`,
      [...errors, ...more],
      'Binary signals must be 0 or 1, state must be 0–5, and time_ps must increase down the file.'
    );
  }
  if (!rows.length) {
    throw new TraceParseError(`${fileName} has a header but no data rows.`, [], 'Check that the testbench writes a row on every change or clock edge.');
  }

  const startPs = rows[0].t;
  const endPs = rows[rows.length - 1].t;
  return {
    rows,
    meta: {
      fileName,
      sampleCount: rows.length,
      rawRowCount,
      mergedDuplicates,
      extraColumns,
      startPs,
      endPs,
      durationPs: endPs - startPs,
      delimiter,
    },
  };
}
