// Ports of the #[cfg(test)] suite in src-tauri/src/taskformat.rs,
// plus the recurrence.rs unit tests.

import { describe, it, expect } from 'vitest';
import {
  decodeWhen,
  decodeDue,
  decodeCreated,
  decodeCompleted,
  decodePriority,
  decodeRecurrence,
  decodeDuration,
  decodeTime,
  encodeWhen,
  encodeDue,
  encodeCreated,
  encodeCompleted,
  encodePriority,
  encodeRecurrence,
  encodeTime,
  encodeDuration,
  TaskFormat,
} from '../src/parser/taskformat';
import { parseRule, formatRule, nextDate } from '../src/parser/recurrence';
import { parseDurationStr, formatDuration } from '../src/parser/duration';

const TODAY = '2026-06-17';
const FORMATS: TaskFormat[] = ['annado', 'obsidian_tasks', 'dataview'];

describe('decode across dialects', () => {
  it('decodes due in all dialects', () => {
    for (const line of [
      'Pay rent @due(2026-07-01)',
      'Pay rent 📅 2026-07-01',
      'Pay rent [due:: 2026-07-01]',
    ]) {
      const [v, cleaned] = decodeDue(line);
      expect(v, line).toBe('2026-07-01');
      expect(cleaned, line).toBe('Pay rent');
    }
  });

  it('reads scheduled and start markers into when', () => {
    for (const line of [
      'Task @when(2026-07-01)',
      'Task ⏳ 2026-07-01',
      'Task 🛫 2026-07-01',
      'Task [scheduled:: 2026-07-01]',
      'Task [start:: 2026-07-01]',
    ]) {
      const [v] = decodeWhen(line, TODAY);
      expect(v, line).toEqual({ kind: 'date', date: '2026-07-01' });
    }
  });

  it('decodes priority in all dialects with clamping', () => {
    const cases: Array<[string, number]> = [
      ['a !(1)', 1],
      ['a ⏫', 1],
      ['a 🔼', 2],
      ['a 🔽', 3],
      ['a 🔺', 1],
      ['a ⏬', 3],
      ['a [priority:: high]', 1],
      ['a [priority:: medium]', 2],
      ['a [priority:: low]', 3],
    ];
    for (const [line, expected] of cases) {
      expect(decodePriority(line)[0], line).toBe(expected);
    }
  });

  it('decodes recurrence in all dialects', () => {
    for (const line of [
      'Water @repeat(every 2 weeks)',
      'Water 🔁 every 2 weeks',
      'Water [repeat:: every 2 weeks]',
    ]) {
      const [rec] = decodeRecurrence(line);
      expect(rec!.interval, line).toBe(2);
      expect(rec!.unit, line).toBe('weeks');
      expect(rec!.mode, line).toBe('fixed');
    }
  });

  it('emoji recurrence stops at the next marker', () => {
    const [rec] = decodeRecurrence('Water 🔁 every week 📅 2026-07-01');
    expect(rec!.interval).toBe(1);
    expect(rec!.unit).toBe('weeks');
    const [due] = decodeDue('Water 🔁 every week 📅 2026-07-01');
    expect(due).toBe('2026-07-01');
  });

  it('decodes time and duration in annado and dataview', () => {
    expect(decodeTime('a @time(09:00)')[0]).toBe('09:00');
    expect(decodeTime('a [time:: 09:00]')[0]).toBe('09:00');
    expect(decodeDuration('a @duration(1h30m)')[0]).toBe(90);
    expect(decodeDuration('a [duration:: 1h30m]')[0]).toBe(90);
  });

  it('decodes created and completed dialects', () => {
    expect(decodeCreated('a ➕ 2026-01-02')[0]).toBe('2026-01-02');
    expect(decodeCreated('a [created:: 2026-01-02]')[0]).toBe('2026-01-02');
    expect(decodeCompleted('a ✅ 2026-01-03')[0]).toBe('2026-01-03');
    expect(decodeCompleted('a [completion:: 2026-01-03]')[0]).toBe('2026-01-03');
  });

  it('preserves unknown markers in the leftover content', () => {
    const [v, cleaned] = decodeDue('Task ⭐ 2026-07-01');
    expect(v).toBeNull();
    expect(cleaned).toBe('Task ⭐ 2026-07-01');
  });
});

describe('encode/decode round-trips per format', () => {
  it('due round-trips in every format', () => {
    for (const f of FORMATS) {
      const marker = encodeDue('2026-07-01', f)!;
      expect(decodeDue(`Task ${marker}`)[0], f).toBe('2026-07-01');
    }
  });

  it('priority round-trips in every format', () => {
    for (const p of [1, 2, 3]) {
      for (const f of FORMATS) {
        const marker = encodePriority(p, f)!;
        expect(decodePriority(`Task ${marker}`)[0], `p=${p} f=${f}`).toBe(p);
      }
    }
  });

  it('recurrence round-trips in every format', () => {
    const rec = decodeRecurrence('@repeat(every 2 weeks)')[0]!;
    for (const f of FORMATS) {
      const marker = encodeRecurrence(rec, f);
      const [d] = decodeRecurrence(`Task ${marker}`);
      expect(d!.interval, f).toBe(2);
      expect(d!.unit, f).toBe('weeks');
      expect(d!.mode, f).toBe('fixed');
    }
  });

  it('when round-trips in every format', () => {
    const when = { kind: 'date', date: '2026-07-01' } as const;
    for (const f of FORMATS) {
      const marker = encodeWhen(when, f)!;
      expect(decodeWhen(`Task ${marker}`, TODAY)[0], f).toEqual(when);
    }
  });

  it('reads Tasks emoji, writes Annado', () => {
    const [due] = decodeDue('Task 📅 2026-07-01');
    const [prio] = decodePriority('Task ⏫');
    expect(encodeDue(due, 'annado')).toBe('@due(2026-07-01)');
    expect(encodePriority(prio, 'annado')).toBe('!(1)');
  });

  it('time and duration fall back to Annado markers under obsidian_tasks', () => {
    expect(encodeTime('09:00', 'obsidian_tasks')).toBe('@time(09:00)');
    expect(encodeDuration(90, 'obsidian_tasks')).toBe('@duration(1h30m)');
    expect(encodeTime('09:00', 'dataview')).toBe('[time:: 09:00]');
    expect(encodeDuration(90, 'dataview')).toBe('[duration:: 1h30m]');
  });

  it('encodes created/completed per format', () => {
    expect(encodeCreated('2026-06-17', 'annado')).toBe('@created(2026-06-17)');
    expect(encodeCreated('2026-06-17', 'obsidian_tasks')).toBe('➕ 2026-06-17');
    expect(encodeCreated('2026-06-17', 'dataview')).toBe('[created:: 2026-06-17]');
    expect(encodeCompleted('2026-06-17', 'annado')).toBe('@completed(2026-06-17)');
    expect(encodeCompleted('2026-06-17', 'obsidian_tasks')).toBe('✅ 2026-06-17');
    expect(encodeCompleted('2026-06-17', 'dataview')).toBe('[completion:: 2026-06-17]');
  });
});

describe('unparseable marker values round-trip', () => {
  it('keeps an unmodeled @when value in the content', () => {
    const [when, rest] = decodeWhen('Do it @when(next week)', '2026-07-09');
    expect(when).toEqual({ kind: 'inbox' });
    expect(rest).toBe('Do it @when(next week)');
  });
  it('keeps an invalid ⏳ date in the content', () => {
    const [when, rest] = decodeWhen('Do it ⏳ 2026-13-45', '2026-07-09');
    expect(when).toEqual({ kind: 'inbox' });
    expect(rest).toContain('2026-13-45');
  });
  it('still strips a valid @when', () => {
    const [when, rest] = decodeWhen('Do it @when(2026-07-10)', '2026-07-09');
    expect(when).toEqual({ kind: 'date', date: '2026-07-10' });
    expect(rest).toBe('Do it');
  });
  it('keeps a garbage @duration value in the content', () => {
    const [mins, rest] = decodeDuration('Do it @duration(a while)');
    expect(mins).toBeNull();
    expect(rest).toBe('Do it @duration(a while)');
  });
});

describe('recurrence rules (recurrence.rs port)', () => {
  it('parses a simple interval', () => {
    expect(parseRule('every 2 weeks')).toEqual({ interval: 2, unit: 'weeks', mode: 'fixed', raw: null });
  });

  it('parses a singular unit as interval one', () => {
    expect(parseRule('every day')).toEqual({ interval: 1, unit: 'days', mode: 'fixed', raw: null });
  });

  it('parses when-done mode', () => {
    expect(parseRule('every week when done')).toEqual({ interval: 1, unit: 'weeks', mode: 'when_done', raw: null });
  });

  it('keeps unmodeled rules raw', () => {
    expect(parseRule('every weekday').raw).toBe('every weekday');
  });

  it('formats modeled rules', () => {
    expect(formatRule(parseRule('every 2 weeks'))).toBe('every 2 weeks');
    expect(formatRule(parseRule('every day'))).toBe('every day');
    expect(formatRule(parseRule('every week when done'))).toBe('every week when done');
  });

  it('formats raw rules verbatim', () => {
    expect(formatRule(parseRule('every weekday'))).toBe('every weekday');
  });

  it('advances modeled rules', () => {
    expect(nextDate(parseRule('every 2 weeks'), '2026-06-16')).toBe('2026-06-30');
    expect(nextDate(parseRule('every month'), '2026-01-31')).toBe('2026-02-28');
    expect(nextDate(parseRule('every year'), '2024-02-29')).toBe('2025-02-28');
  });

  it('returns null for raw rules', () => {
    expect(nextDate(parseRule('every weekday'), '2026-06-16')).toBeNull();
  });
});

describe('durations (parser.rs port)', () => {
  it('parses duration strings', () => {
    expect(parseDurationStr('15m')).toBe(15);
    expect(parseDurationStr('15min')).toBe(15);
    expect(parseDurationStr('30m')).toBe(30);
    expect(parseDurationStr('1h')).toBe(60);
    expect(parseDurationStr('1h30m')).toBe(90);
    expect(parseDurationStr('1h30min')).toBe(90);
    expect(parseDurationStr('2h')).toBe(120);
    expect(parseDurationStr('2h15m')).toBe(135);
    expect(parseDurationStr('nonsense')).toBeNull();
  });

  it('formats durations compactly', () => {
    expect(formatDuration(15)).toBe('15m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h30m');
    expect(formatDuration(120)).toBe('2h');
  });
});
