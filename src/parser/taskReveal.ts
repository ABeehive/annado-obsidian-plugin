// Which Annado view is guaranteed to render a given task — used by Quick Find's
// in-app reveal. Pure and unit-tested; no views/ import (the tab union is a subset
// of the view's AnyTab). See docs/specs/2026-07-07-mobile-find-delight-phase4-design.md.

import { Task } from './types';

export type RevealTarget = {
  tab: 'inbox' | 'today' | 'upcoming' | 'projects' | 'anytime' | 'someday' | 'logbook';
  selected?: string;
};

/** Resolve the view that contains `task`. Order matters: completed → Logbook;
 *  else a project detail (which lists every open task in that project); else by when. */
export function resolveTaskView(task: Task, todayISO: string): RevealTarget {
  if (task.completed) return { tab: 'logbook' };
  if (task.projects.length > 0) return { tab: 'projects', selected: task.projects[0]! };
  switch (task.when.kind) {
    case 'anytime':
      return { tab: 'anytime' };
    case 'someday':
      return { tab: 'someday' };
    case 'evening':
      return { tab: 'today' };
    case 'date':
      return task.when.date <= todayISO ? { tab: 'today' } : { tab: 'upcoming' };
    case 'inbox':
    default:
      return { tab: 'inbox' };
  }
}
