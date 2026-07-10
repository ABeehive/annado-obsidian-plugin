// Logbook grouping — a port of the desktop groupTasksByCompletionDate /
// limitGroupedTasks (src/utils/taskGrouping.ts), parameterised on todayISO and a
// date formatter so it stays pure and unit-testable. See
// docs/specs/2026-07-07-mobile-more-views-phase3-design.md.

import { Task } from './types';
import { addDaysISO } from './dates';

export interface TaskGroup {
  label: string;
  tasks: Task[];
}

/** Group completed tasks by completion date, newest first. Labels: "Today"
 *  (== todayISO), "Yesterday" (== todayISO − 1), else `formatDate(dateISO)`.
 *  Tasks without a completedDate collect in a trailing "Earlier" group. */
export function groupTasksByCompletionDate(
  tasks: Task[],
  todayISO: string,
  formatDate: (iso: string) => string,
): TaskGroup[] {
  const yesterday = addDaysISO(todayISO, -1);
  const dated: Task[] = [];
  const undated: Task[] = [];
  for (const t of tasks) {
    if (t.completedDate) dated.push(t);
    else undated.push(t);
  }
  dated.sort((a, b) => b.completedDate!.localeCompare(a.completedDate!));

  const byDate = new Map<string, Task[]>();
  for (const t of dated) {
    const list = byDate.get(t.completedDate!) ?? [];
    list.push(t);
    byDate.set(t.completedDate!, list);
  }

  const groups: TaskGroup[] = [];
  for (const [dateISO, groupTasks] of byDate) {
    const label =
      dateISO === todayISO ? 'Today' : dateISO === yesterday ? 'Yesterday' : formatDate(dateISO);
    groups.push({ label, tasks: groupTasks });
  }
  if (undated.length > 0) groups.push({ label: 'Earlier', tasks: undated });
  return groups;
}

/** Cap total rows across groups: truncate the group that crosses `limit` and drop
 *  any later groups. */
export function limitGroupedTasks(groups: TaskGroup[], limit: number): TaskGroup[] {
  const out: TaskGroup[] = [];
  let count = 0;
  for (const group of groups) {
    if (count >= limit) break;
    const remaining = limit - count;
    out.push(
      remaining >= group.tasks.length
        ? group
        : { label: group.label, tasks: group.tasks.slice(0, remaining) },
    );
    count += group.tasks.length;
  }
  return out;
}
