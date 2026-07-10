import { describe, it, expect } from 'vitest';
import { groupTasksByCompletionDate, limitGroupedTasks } from '../src/parser/taskGrouping';
import { Task } from '../src/parser/types';

const TODAY = '2026-07-07';

// Minimal Task with just the fields the grouping reads.
const mk = (id: string, completedDate: string | null): Task =>
  ({ id, title: id, completed: true, completedDate } as unknown as Task);

const ident = (iso: string) => iso;

describe('groupTasksByCompletionDate', () => {
  it('labels today / yesterday / older and orders newest first', () => {
    const groups = groupTasksByCompletionDate(
      [mk('a', '2026-07-05'), mk('b', '2026-07-07'), mk('c', '2026-07-06')],
      TODAY,
      ident,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', '2026-07-05']);
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual(['b']);
  });

  it('groups multiple tasks completed on the same date', () => {
    const groups = groupTasksByCompletionDate(
      [mk('a', '2026-07-07'), mk('b', '2026-07-07')],
      TODAY,
      ident,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('puts tasks without a completedDate in a trailing Earlier group', () => {
    const groups = groupTasksByCompletionDate(
      [mk('a', '2026-07-07'), mk('b', null)],
      TODAY,
      ident,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Earlier']);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual(['b']);
  });

  it('runs the formatter only for non-today/yesterday dates', () => {
    const groups = groupTasksByCompletionDate([mk('a', '2026-06-01')], TODAY, (iso) => `fmt:${iso}`);
    expect(groups[0]!.label).toBe('fmt:2026-06-01');
  });
});

describe('limitGroupedTasks', () => {
  const groups = [
    { label: 'A', tasks: [mk('a1', '1'), mk('a2', '1'), mk('a3', '1')] },
    { label: 'B', tasks: [mk('b1', '1'), mk('b2', '1')] },
  ];

  it('returns all groups when under the limit', () => {
    expect(limitGroupedTasks(groups, 10)).toEqual(groups);
  });

  it('truncates the group that crosses the limit and drops later groups', () => {
    const out = limitGroupedTasks(groups, 2);
    expect(out).toHaveLength(1);
    expect(out[0]!.tasks.map((t) => t.id)).toEqual(['a1', 'a2']);
  });

  it('keeps a whole group then stops at the boundary', () => {
    const out = limitGroupedTasks(groups, 3);
    expect(out.map((g) => g.label)).toEqual(['A']);
    expect(out[0]!.tasks).toHaveLength(3);
  });
});
