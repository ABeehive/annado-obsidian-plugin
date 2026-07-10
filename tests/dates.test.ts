import { describe, it, expect } from 'vitest';
import { thisWeekendISO, nextMondayISO } from '../src/parser/dates';

describe('thisWeekendISO', () => {
  it.each([
    ['2026-07-06', '2026-07-11'], // Mon → this Sat
    ['2026-07-07', '2026-07-11'],
    ['2026-07-08', '2026-07-11'],
    ['2026-07-09', '2026-07-11'],
    ['2026-07-10', '2026-07-11'], // Fri → next day
    ['2026-07-11', '2026-07-18'], // Sat → NEXT Sat
    ['2026-07-12', '2026-07-18'], // Sun → next Sat
  ])('%s → %s', (today, expected) => {
    expect(thisWeekendISO(today)).toBe(expected);
  });
});

describe('nextMondayISO', () => {
  it.each([
    ['2026-07-06', '2026-07-13'], // Mon → next Mon, not today
    ['2026-07-09', '2026-07-13'],
    ['2026-07-11', '2026-07-13'],
    ['2026-07-12', '2026-07-13'], // Sun → tomorrow
  ])('%s → %s', (today, expected) => {
    expect(nextMondayISO(today)).toBe(expected);
  });
});
