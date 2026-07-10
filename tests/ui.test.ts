import { describe, it, expect } from 'vitest';
import {
  metaFor,
  formatLogDate,
  projectColor,
  setColorOverrides,
  tagColor,
  DEFAULT_TAG_COLOR,
  PROJECT_COLORS,
  formatWhenLabel,
  deadlineDisplay,
  upcomingDayHeading,
  tagMatchesFilter,
  buildTagTree,
} from '../src/views/ui';

describe('metaFor', () => {
  it('resolves a main view', () => {
    expect(metaFor('today').label).toBe('Today');
  });
  it('resolves a more view', () => {
    expect(metaFor('logbook').label).toBe('Logbook');
    expect(metaFor('anytime').label).toBe('Anytime');
  });
});

describe('formatLogDate', () => {
  it('omits the year in the current year', () => {
    expect(formatLogDate('2026-06-22', '2026-07-07')).toBe('22 Jun');
  });
  it('includes the year for other years', () => {
    expect(formatLogDate('2025-12-31', '2026-07-07')).toBe('31 Dec 2025');
  });
});

describe('color overrides', () => {
  it('projectColor prefers the override and falls back to the hash palette', () => {
    setColorOverrides({}, {});
    const fallback = projectColor('Website Redesign');
    expect(PROJECT_COLORS).toContain(fallback);
    setColorOverrides({ 'Website Redesign': '#e84545' }, {});
    expect(projectColor('Website Redesign')).toBe('#e84545');
    expect(projectColor('Other Project')).not.toBe('#e84545');
    setColorOverrides({}, {});
    expect(projectColor('Website Redesign')).toBe(fallback);
  });

  it('tagColor is a case-insensitive lookup', () => {
    setColorOverrides({}, { design: '#5aa9e6' });
    expect(tagColor('design')).toBe('#5aa9e6');
    expect(tagColor('Design')).toBe('#5aa9e6');
  });

  it('nested tags inherit the nearest ancestor color', () => {
    setColorOverrides({}, { inbox: '#e53935' });
    expect(tagColor('Inbox/To-Read')).toBe('#e53935');
    setColorOverrides({}, { a: '#111111', 'a/b': '#222222' });
    expect(tagColor('a/b/c')).toBe('#222222');
  });

  it('falls back to the exact key for legacy pre-lowercase entries', () => {
    setColorOverrides({}, { Design: '#333333' });
    expect(tagColor('Design')).toBe('#333333');
  });

  it('defaults to indigo without an override, like the desktop', () => {
    setColorOverrides({}, {});
    expect(tagColor('anything')).toBe(DEFAULT_TAG_COLOR);
    expect(DEFAULT_TAG_COLOR).toBe('#5C6BC0');
  });
});

describe('formatWhenLabel', () => {
  const today = '2026-07-09'; // Thursday

  it('renders "Today" and "Tomorrow"', () => {
    expect(formatWhenLabel('2026-07-09', today)).toBe('Today');
    expect(formatWhenLabel('2026-07-10', today)).toBe('Tomorrow');
  });

  it('renders a short weekday name for the next 2-6 days', () => {
    expect(formatWhenLabel('2026-07-11', today)).toBe('Sat'); // diff 2
    expect(formatWhenLabel('2026-07-15', today)).toBe('Wed'); // diff 6
  });

  it('renders "d Mon" (no year) for same-year dates outside the weekday window', () => {
    expect(formatWhenLabel('2026-07-29', today)).toBe('29 Jul'); // diff 20, future
    expect(formatWhenLabel('2026-06-01', '2026-06-30')).toBe('1 Jun'); // past, same year
  });

  it('includes the year once a date crosses into a different calendar year', () => {
    // diff = -65 days: within the ±90-day window, but Nov 2025 vs today's 2026.
    expect(formatWhenLabel('2025-11-01', '2026-01-05')).toBe('1 Nov 2025');
  });

  it('the old ±90-day window no longer gates the year — only the calendar year does', () => {
    expect(formatWhenLabel('2026-10-07', today)).toBe('7 Oct'); // diff = +90, same year
    expect(formatWhenLabel('2026-10-08', today)).toBe('8 Oct'); // diff = +91, still same year: no year
    // Symmetric on the past side, still same calendar year.
    const laterToday = '2026-10-07';
    expect(formatWhenLabel('2026-07-09', laterToday)).toBe('9 Jul'); // diff = -90
    // diff = -91 is still the SAME calendar year (2026), so no year is appended —
    // the year only shows up once the calendar year actually differs.
    expect(formatWhenLabel('2026-07-08', laterToday)).toBe('8 Jul'); // diff = -91
  });

  it('still shows the year for a cross-year date within the ±90-day window (diff = 8, outside the 2-6 day weekday branch)', () => {
    expect(formatWhenLabel('2027-01-05', '2026-12-28')).toContain('2027');
  });
});

describe('deadlineDisplay', () => {
  const today = '2026-07-09';

  it('overdue: negative diff', () => {
    const d = deadlineDisplay('2026-07-08', today);
    expect(d.label).toBe('Overdue');
    expect(d.color).toBe('#e84545');
  });

  it('today: diff 0 is urgent-colored with the "Today" label', () => {
    const d = deadlineDisplay('2026-07-09', today);
    expect(d.label).toBe('Today');
    expect(d.color).toBe('#e84545');
  });

  it('tomorrow: diff 1', () => {
    const d = deadlineDisplay('2026-07-10', today);
    expect(d.label).toBe('Tomorrow');
    expect(d.color).toBe('#e84545');
  });

  it('urgent boundary: diff 2 is still urgent-colored', () => {
    const d = deadlineDisplay('2026-07-11', today);
    expect(d.label).toBe('2 days left');
    expect(d.color).toBe('#e84545');
  });

  it('approaching: diff 3 through 7', () => {
    expect(deadlineDisplay('2026-07-12', today)).toEqual({ label: '3 days left', color: '#e89b45' });
    expect(deadlineDisplay('2026-07-16', today)).toEqual({ label: '7 days left', color: '#e89b45' });
  });

  it('normal (future): diff 8+', () => {
    const d = deadlineDisplay('2026-07-17', today);
    expect(d.label).toBe('8 days left');
    expect(d.color).toBe('#8b8fa3');
  });
});

describe('upcomingDayHeading', () => {
  const today = '2026-07-09'; // Thursday

  it('tomorrow renders the word "Tomorrow"', () => {
    const h = upcomingDayHeading('2026-07-10', today);
    expect(h).toEqual({ dayNumber: 10, dayName: 'Tomorrow', monthIndex: 6 });
  });

  // Consistent with formatWhenLabel's sibling behavior, which special-cases diff === 0.
  it('today (diff 0) renders "Today"', () => {
    const h = upcomingDayHeading('2026-07-09', today);
    expect(h).toEqual({ dayNumber: 9, dayName: 'Today', monthIndex: 6 });
  });

  it('other days render the full weekday name', () => {
    const h = upcomingDayHeading('2026-07-12', today); // Sunday
    expect(h).toEqual({ dayNumber: 12, dayName: 'Sunday', monthIndex: 6 });
  });

  it('carries the correct monthIndex across a month change', () => {
    const h = upcomingDayHeading('2026-08-01', today); // Saturday
    expect(h).toEqual({ dayNumber: 1, dayName: 'Saturday', monthIndex: 7 });
  });
});

describe('tagMatchesFilter', () => {
  it('matches the exact same tag', () => {
    expect(tagMatchesFilter('inbox', 'inbox')).toBe(true);
  });

  it('does NOT match a tag that merely starts with the filter name', () => {
    expect(tagMatchesFilter('inboxed', 'inbox')).toBe(false);
  });

  it('matches a nested descendant of the filter', () => {
    expect(tagMatchesFilter('inbox/to-read', 'inbox')).toBe(true);
    expect(tagMatchesFilter('inbox/read', 'inbox')).toBe(true);
  });

  it('does not match the other direction (child filter, parent tag)', () => {
    expect(tagMatchesFilter('inbox', 'inbox/to-read')).toBe(false);
  });

  it('is case-insensitive on both sides', () => {
    expect(tagMatchesFilter('INBOX', 'inbox')).toBe(true);
    expect(tagMatchesFilter('Inbox/Read', 'INBOX')).toBe(true);
    expect(tagMatchesFilter('INBOXED', 'inbox')).toBe(false);
  });
});

describe('buildTagTree', () => {
  it('synthesizes an intermediate parent node when only the child tag is registered', () => {
    const tree = buildTagTree(['x/y'], [['x/y'], ['x']]);
    expect(tree).toHaveLength(1);
    const x = tree[0]!;
    expect(x.name).toBe('x');
    expect(x.label).toBe('x');
    expect(x.count).toBe(2); // one task tagged "x/y", one tagged "x" — both count toward "x"
    expect(x.children).toHaveLength(1);
    expect(x.children[0]!.name).toBe('x/y');
    expect(x.children[0]!.label).toBe('y');
    expect(x.children[0]!.count).toBe(1);
  });

  it('subtree counts sum descendants without double-counting a task per level', () => {
    const tree = buildTagTree(
      ['a', 'a/b', 'a/b/c'],
      [['a/b/c'], ['a/b'], ['a'], ['a/b/c']],
    );
    const a = tree.find((n) => n.name === 'a')!;
    expect(a.count).toBe(4);
    const ab = a.children.find((n) => n.name === 'a/b')!;
    expect(ab.count).toBe(3);
    const abc = ab.children.find((n) => n.name === 'a/b/c')!;
    expect(abc.count).toBe(2);
  });

  it('case-folds tag names, keeping the first-seen casing for each path segment', () => {
    const tree = buildTagTree(['Work', 'work/Urgent'], []);
    expect(tree).toHaveLength(1);
    const work = tree[0]!;
    expect(work.name).toBe('Work'); // first-seen casing wins
    expect(work.label).toBe('Work');
    expect(work.children).toHaveLength(1);
    expect(work.children[0]!.name).toBe('work/Urgent');
    expect(work.children[0]!.label).toBe('Urgent');
  });

  it('sorts siblings case-insensitively by label', () => {
    const tree = buildTagTree(['banana', 'Apple', 'cherry'], []);
    expect(tree.map((n) => n.name)).toEqual(['Apple', 'banana', 'cherry']);
  });
});
