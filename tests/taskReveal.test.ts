import { describe, it, expect } from 'vitest';
import { resolveTaskView } from '../src/parser/taskReveal';
import { Task, WhenValue } from '../src/parser/types';

const TODAY = '2026-07-07';

const mk = (over: Partial<Task>): Task =>
  ({ id: 'x', completed: false, projects: [], when: { kind: 'inbox' } as WhenValue, ...over } as Task);

describe('resolveTaskView', () => {
  it('sends completed tasks to Logbook (before any other branch)', () => {
    expect(resolveTaskView(mk({ completed: true, projects: ['P'] }), TODAY)).toEqual({ tab: 'logbook' });
  });

  it('sends a project task to that project detail', () => {
    expect(resolveTaskView(mk({ projects: ['P', 'Q'] }), TODAY)).toEqual({ tab: 'projects', selected: 'P' });
  });

  it('maps when-kinds to their tab for project-less tasks', () => {
    expect(resolveTaskView(mk({ when: { kind: 'inbox' } }), TODAY)).toEqual({ tab: 'inbox' });
    expect(resolveTaskView(mk({ when: { kind: 'anytime' } }), TODAY)).toEqual({ tab: 'anytime' });
    expect(resolveTaskView(mk({ when: { kind: 'someday' } }), TODAY)).toEqual({ tab: 'someday' });
    expect(resolveTaskView(mk({ when: { kind: 'evening' } }), TODAY)).toEqual({ tab: 'today' });
  });

  it('splits scheduled dates into today vs upcoming', () => {
    expect(resolveTaskView(mk({ when: { kind: 'date', date: '2026-07-07' } }), TODAY)).toEqual({ tab: 'today' });
    expect(resolveTaskView(mk({ when: { kind: 'date', date: '2026-07-01' } }), TODAY)).toEqual({ tab: 'today' });
    expect(resolveTaskView(mk({ when: { kind: 'date', date: '2026-07-20' } }), TODAY)).toEqual({ tab: 'upcoming' });
  });
});
