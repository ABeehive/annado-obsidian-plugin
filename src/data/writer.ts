// Write-back operations. All edits go through Vault.process() for atomic,
// editor-coordinated writes (safe alongside an open editor pane, mobile-safe).

import { App, TFile } from 'obsidian';
import { Task, WhenValue } from '../parser/types';
import {
  parseTaskLine,
  formatTaskLine,
  nextOccurrence,
  deriveProjectName,
  normalizeMarker,
  resolveWikilinks,
  taskId,
} from '../parser/parser';
import { setLineCompleted } from '../parser/lineEdit';
import { todayISO } from '../parser/dates';
import {
  updateTaskInContent,
  deleteTaskFromContent,
  toggleChecklistItemInContent,
  blockEnd,
} from '../parser/contentEdit';
import { AnnadoSettings } from '../settings';
import { TaskIndex } from './index';
import { getDailyNotePath, ensureDailyNote } from './dailyNote';

export type WriteResult = 'ok' | 'stale';

/** Toggle a task's completion by flipping the exact source line in place.
 *
 *  Byte-preserving: only the checkbox character and the completed marker change.
 *  If the file shifted underneath us (the line is no longer the task we think it
 *  is), nothing is written and 'stale' is returned — caller should rescan.
 *  Completing a task with a modeled recurrence inserts the next occurrence
 *  right below, exactly like the desktop app.
 */
export async function toggleTask(
  app: App,
  index: TaskIndex,
  settings: AnnadoSettings,
  task: Task,
  complete: boolean,
): Promise<WriteResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return 'stale';

  const today = todayISO();
  const marker = normalizeMarker(settings.taskMarker);
  let stale = false;

  await app.vault.process(file, (content) => {
    const lines = content.split('\n');
    const idx = task.lineNumber - 1;
    const raw = lines[idx];
    if (raw === undefined) {
      stale = true;
      return content;
    }
    // Keep CRLF files intact: edit without the \r, re-attach after.
    const hadCR = raw.endsWith('\r');
    const line = hadCR ? raw.slice(0, -1) : raw;

    const parsed = parseTaskLine(line);
    if (!parsed) {
      stale = true;
      return content;
    }
    if (line !== task.sourceLine) {
      stale = true;
      return content;
    }

    const newLine = setLineCompleted(line, complete, settings.taskFormat, today);
    if (newLine === null) {
      stale = true;
      return content;
    }
    lines[idx] = hadCR ? `${newLine}\r` : newLine;

    // Roll a modeled recurrence forward on completion.
    if (complete && task.recurrence !== null && task.recurrence.raw === null) {
      const next = nextOccurrence(task, today);
      if (next !== null) {
        const fileProject = deriveProjectName(task.filePath, settings.projectsPattern);
        const nextLine = formatTaskLine(
          next,
          fileProject,
          index.projectNames,
          settings.taskFormat,
          marker,
        );
        // Below the task's whole block, so notes/checklist stay attached to
        // the completed occurrence rather than the new one.
        const insertAt = blockEnd(lines, idx, task.indentLevel);
        lines.splice(insertAt, 0, hadCR ? `${nextLine}\r` : nextLine);
      }
    }

    return lines.join('\n');
  });

  if (stale) {
    await index.rescanFile(task.filePath);
    return 'stale';
  }
  await index.rescanFile(task.filePath);
  return 'ok';
}

/** Toggle a checklist sub-item of a task, also byte-preserving. */
export async function toggleChecklistItem(
  app: App,
  index: TaskIndex,
  settings: AnnadoSettings,
  task: Task,
  itemIndex: number,
): Promise<WriteResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return 'stale';
  // Cheap pre-check so an out-of-range index skips the write (and its mtime
  // bump) entirely, instead of entering vault.process only to have the pure
  // function's own guard (defense in depth) no-op the content.
  if (task.checklist[itemIndex] === undefined) return 'stale';

  let ok = false;
  await app.vault.process(file, (content) => {
    const res = toggleChecklistItemInContent(content, task, itemIndex, settings.taskFormat, todayISO());
    ok = res.ok;
    return res.content;
  });

  await index.rescanFile(task.filePath);
  return ok ? 'ok' : 'stale';
}

export interface NewTaskInput {
  title: string;
  when: WhenValue;
  notes?: string;
  deadline?: string | null;
  projects?: string[];
  tags?: string[];
  priority?: number | null;
  durationMinutes?: number | null;
}

/** Create a task in today's daily note — port of Vault::create_task, extended to
 *  carry the full field set the add-task modal captures. Notes are appended as
 *  4-space-indented lines below the task line so parseFile reads them back. */
export async function createTask(
  app: App,
  index: TaskIndex,
  settings: AnnadoSettings,
  input: NewTaskInput,
): Promise<Task> {
  const now = new Date();
  const today = todayISO(now);
  const path = await getDailyNotePath(app, settings, now);
  const file = await ensureDailyNote(app, path, now);
  const marker = normalizeMarker(settings.taskMarker);
  const notes = (input.notes ?? '').trim();

  const task: Task = {
    id: taskId(path, 0),
    title: input.title.trim(),
    notes,
    when: input.when,
    deadline: input.deadline ?? null,
    tags: input.tags ?? [],
    inheritedTags: [],
    checklist: [],
    completed: false,
    completedDate: null,
    createdDate: today,
    filePath: path,
    lineNumber: 0,
    projects: input.projects ?? [],
    indentLevel: 0,
    priority: input.priority ?? null,
    persons: [],
    recurrence: null,
    durationMinutes: input.durationMinutes ?? null,
    scheduledTime: null,
    sourceLine: '',
  };
  // Resolve typed [[wikilinks]] before formatting, like the desktop app, so an
  // existing [[Project]] in the title isn't stripped by the serializer.
  resolveWikilinks([task], index.personNames, index.projectNames);

  const fileProject = deriveProjectName(path, settings.projectsPattern);
  const line = formatTaskLine(task, fileProject, index.projectNames, settings.taskFormat, marker);
  task.sourceLine = line;

  let insertedAt = 0;
  await app.vault.process(file, (content) => {
    const nl = content.includes('\r\n') ? '\r\n' : '\n';
    const noteLines = notes === '' ? '' : notes.split('\n').map((l) => `    ${l}`).join(nl) + nl;
    const block = `${line}${nl}${noteLines}`;
    // Line number the task line will land on once inserted.
    insertedAt = content === '' ? 1 : content.split('\n').length + (content.endsWith('\n') ? 0 : 1);
    if (content === '' || content.endsWith('\n')) return `${content}${block}`;
    return `${content}${nl}${block}`;
  });

  task.lineNumber = insertedAt;
  task.id = taskId(path, insertedAt);

  await index.rescanFile(path);
  return task;
}

/** Re-serialize a task's line + notes in place (edit). Returns 'stale' if the
 *  file shifted underneath us (line no longer the expected task). */
export async function updateTask(
  app: App,
  index: TaskIndex,
  settings: AnnadoSettings,
  task: Task,
): Promise<WriteResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return 'stale';
  const fileProject = deriveProjectName(task.filePath, settings.projectsPattern);
  const marker = normalizeMarker(settings.taskMarker);
  let ok = false;
  await app.vault.process(file, (content) => {
    const res = updateTaskInContent(content, task, {
      fileProject,
      projectNames: index.projectNames,
      format: settings.taskFormat,
      marker,
    });
    ok = res.ok;
    return res.content;
  });
  await index.rescanFile(task.filePath);
  return ok ? 'ok' : 'stale';
}

/** Delete a task's line + its notes/checklist block. */
export async function deleteTask(
  app: App,
  index: TaskIndex,
  settings: AnnadoSettings,
  task: Task,
): Promise<WriteResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return 'stale';
  let ok = false;
  await app.vault.process(file, (content) => {
    const res = deleteTaskFromContent(content, task);
    ok = res.ok;
    return res.content;
  });
  await index.rescanFile(task.filePath);
  return ok ? 'ok' : 'stale';
}
