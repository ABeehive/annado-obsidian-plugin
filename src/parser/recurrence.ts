// Recurrence rules — port of src-tauri/src/recurrence.rs.
// Modeled subset: "every [N] day|week|month|year[s]" with optional " when done".
// Anything else is kept raw, round-trips verbatim, and is never advanced.

import { Recurrence, IntervalUnit } from './types';
import { addDaysISO, addMonthsISO } from './dates';

export function parseRule(input: string): Recurrence {
  const s = input.trim();
  const lower = s.toLowerCase();
  let body = lower;
  let mode: Recurrence['mode'] = 'fixed';
  if (lower.endsWith(' when done')) {
    body = lower.slice(0, -' when done'.length).trim();
    mode = 'when_done';
  }
  if (body.startsWith('every ')) {
    const toks = body.slice('every '.length).split(/\s+/).filter((t) => t !== '');
    let interval: number | null = null;
    let unitTok: string | null = null;
    if (toks.length === 2) {
      interval = /^\d+$/.test(toks[0]!) ? Number(toks[0]) : null;
      unitTok = toks[1]!;
    } else if (toks.length === 1) {
      interval = 1;
      unitTok = toks[0]!;
    }
    if (interval !== null && interval >= 1 && unitTok !== null) {
      const unit = unitFromWord(unitTok);
      if (unit !== null) {
        return { interval, unit, mode, raw: null };
      }
    }
  }
  // Unmodeled rule: keep verbatim.
  return { interval: 1, unit: 'days', mode, raw: s };
}

function unitFromWord(w: string): IntervalUnit | null {
  const base = w.endsWith('s') ? w.replace(/s+$/, '') : w;
  switch (base) {
    case 'day':
      return 'days';
    case 'week':
      return 'weeks';
    case 'month':
      return 'months';
    case 'year':
      return 'years';
    default:
      return null;
  }
}

export function formatRule(r: Recurrence): string {
  if (r.raw !== null) return r.raw;
  const unit = r.unit.slice(0, -1); // 'days' → 'day'
  const base = r.interval === 1 ? `every ${unit}` : `every ${r.interval} ${unit}s`;
  return r.mode === 'when_done' ? `${base} when done` : base;
}

/** Next occurrence date from `fromISO`, or null for raw (unmodeled) rules. */
export function nextDate(r: Recurrence, fromISO: string): string | null {
  if (r.raw !== null) return null;
  switch (r.unit) {
    case 'days':
      return addDaysISO(fromISO, r.interval);
    case 'weeks':
      return addDaysISO(fromISO, r.interval * 7);
    case 'months':
      return addMonthsISO(fromISO, r.interval);
    case 'years':
      return addMonthsISO(fromISO, r.interval * 12);
  }
}
