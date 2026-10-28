// Results reported by the latest supplied RAILGUARD testbench run.
// These are NOT computed from the CSV — they are the testbench's own
// self-checks. Update this file whenever you re-run the testbench.
//
// `locate` tells the UI where in the loaded trace the matching behaviour can
// be inspected; it is only a navigation aid.

export const VERIFICATION_RUN = {
  label: 'Latest supplied testbench run',
  checksPassed: 10,
  checksTotal: 10,
  assertionFailures: 0,
};

export const VERIFICATION_CHECKS = [
  { id: 'idle', name: 'Initial IDLE outputs', result: 'pass', locate: { type: 'state', state: 0 } },
  { id: 'warning', name: 'WARNING outputs', result: 'pass', locate: { type: 'state', state: 1 } },
  { id: 'closing', name: 'CLOSING outputs', result: 'pass', locate: { type: 'state', state: 2 } },
  { id: 'wait', name: 'WAIT_FOR_TRAIN outputs', result: 'pass', locate: { type: 'state', state: 6 } },
  { id: 'passing', name: 'PASSING outputs', result: 'pass', locate: { type: 'state', state: 3 } },
  { id: 'opening', name: 'OPENING outputs', result: 'pass', locate: { type: 'state', state: 4 } },
  { id: 'return', name: 'Return to IDLE', result: 'pass', locate: { type: 'transition', from: 4, to: 0 } },
  { id: 'close-timeout', name: 'Gate-closing timeout and fault outputs', result: 'pass', locate: { type: 'sequence', kind: 'closing-timeout' } },
  { id: 'recovery', name: 'Reset recovery from FAULT', result: 'pass', locate: { type: 'transition', from: 5, to: 0 } },
  { id: 'open-timeout', name: 'Gate-opening timeout detection', result: 'pass', locate: { type: 'sequence', kind: 'opening-timeout' } },
];
