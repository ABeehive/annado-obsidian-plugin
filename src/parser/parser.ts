// Task line/file parsing and serialization — port of src-tauri/src/parser.rs.
//
// parseFile() peels recognized markers off a task line in the exact same order as
// the Rust implementation; whatever remains (including markers we don't recognize)
// stays in the title and is written back verbatim by formatTaskLine().

import { Task, ChecklistItem, WhenValue } from './types';
import * as tf from './taskformat';
import { TaskFormat } from './taskformat';
import { nextDate } from './recurrence';

const TASK_REGEX = /^(\s*)- \[([ xX])\] (.+)$/;
// Rust \w is unicode-aware; JS \w is ASCII-only, so spell it out with \p{L}\p{N}_.
// Allows nested Obsidian tags (#inbox/to-read); a trailing slash is trimmed below.
// Obsidian only recognizes a tag when `#` follows whitespace or start-of-line;
// the lookbehind keeps us out of [[Note#Heading]] anchors and URL fragments.
// (Deliberate divergence from the Rust port, which shares the old bug.)
const TAG_REGEX = /(?<=^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
const PROJECT_REGEX = /@project\(([^)]+)\)/;
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g;
const RECURRING_REGEX = /@recurring\(([^)]+)\)/;

/** Default value of the "projects folder" pattern setting, shared by parseFile's
 *  and deriveProjectName's own defaults and by settings.ts's DEFAULT_SETTINGS. */
export const DEFAULT_PROJECTS_PATTERN = 'Projects';

export interface ParsedLine {
  indent: number;
  completed: boolean;
  content: string;
}

export function parseTaskLine(line: string): ParsedLine | null {
  const m = TASK_REGEX.exec(line);
  if (!m) return null;
  return {
    indent: m[1]!.length,
    completed: m[2]!.toLowerCase() === 'x',
    content: m[3]!,
  };
}

export function extractTags(content: string): [string[], string] {
  const tags: string[] = [];
  for (const m of content.matchAll(TAG_REGEX)) {
    const t = m[1]!.replace(/\/+$/, ''); // Obsidian disallows a trailing slash
    if (t !== '') tags.push(t);
  }
  // Removing a mid-string tag can leave a double space behind; collapse it here
  // so the in-memory title (shown in the UI before the next save) matches what
  // formatTaskLine's whitespace-collapse would write to disk anyway.
  const cleaned = content.replace(TAG_REGEX, '').replace(/\s{2,}/g, ' ').trim();
  return [tags, cleaned];
}

/** Legacy @project() syntax, kept for backward compatibility. */
export function extractProject(content: string): [string | null, string] {
  const m = PROJECT_REGEX.exec(content);
  if (!m) return [null, content];
  return [m[1]!, content.replace(PROJECT_REGEX, '').trim()];
}

export function extractWikilinks(content: string): string[] {
  return [...content.matchAll(WIKILINK_REGEX)].map((m) => m[1]!);
}

function extractRecurringId(content: string): [string | null, string] {
  const m = RECURRING_REGEX.exec(content);
  if (!m) return [null, content];
  return [m[1]!, content.replace(RECURRING_REGEX, '').trim()];
}

/** Stable task id. The desktop app hashes `path:line` with sha256; the raw key is
 *  just as unique and these ids never leave the plugin's runtime. */
export function taskId(filePath: string, lineNumber: number): string {
  return `${filePath}:${lineNumber}`;
}

/** Normalize a configured import marker: strip a leading `#`, trim whitespace. */
export function normalizeMarker(marker: string): string {
  return marker.trim().replace(/^#+/, '').trim();
}

/** Case-insensitive check for whether `tags` carries the import `marker` — matching
 *  the bare marker (#task) OR a nested tag under it (#task/work), on the first
 *  path segment. */
export function tagsContain(tags: string[], marker: string): boolean {
  const target = marker.toLowerCase();
  return tags.some((t) => (t.split('/')[0] ?? t).toLowerCase() === target);
}

/** Parse a whole file's content into tasks.
 *  When `marker` is non-empty only top-level checkboxes carrying that tag are
 *  imported (the marker tag is stripped from the task's displayed tags). */
export function parseFile(
  content: string,
  filePath: string,
  todayISO: string,
  marker = '',
  projectsPattern = DEFAULT_PROJECTS_PATTERN,
): Task[] {
  const lines = content.split(/\r?\n/);
  const tasks: Task[] = [];
  let i = 0;

  const fileProject = deriveProjectName(filePath, projectsPattern);

  while (i < lines.length) {
    const line = lines[i]!;
    const parsed = parseTaskLine(line);

    if (parsed && parsed.indent < 4) {
      // Peel fields in the same order as parse_file_with_marker in parser.rs.
      const [when, afterWhen] = tf.decodeWhen(parsed.content, todayISO);
      const [deadline, afterDue] = tf.decodeDue(afterWhen);
      const [explicitProject, afterProject] = extractProject(afterDue);
      const [priority, afterPriority] = tf.decodePriority(afterProject);
      // Strip any legacy @recurring(<id>) marker so it never leaks into the title.
      const [, afterRecurring] = extractRecurringId(afterPriority);
      const [recurrence, afterRepeat] = tf.decodeRecurrence(afterRecurring);
      const [completedDate, afterCompleted] = tf.decodeCompleted(afterRepeat);
      const [createdDate, afterCreated] = tf.decodeCreated(afterCompleted);
      const [durationMinutes, afterDuration] = tf.decodeDuration(afterCreated);
      const [scheduledTime, afterTime] = tf.decodeTime(afterDuration);
      let [tags, title] = extractTags(afterTime);

      const notesParts: string[] = [];
      const checklist: ChecklistItem[] = [];

      // Look ahead for notes and checklist items.
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j]!;
        const subParsed = parseTaskLine(nextLine);
        if (subParsed) {
          if (subParsed.indent > parsed.indent) {
            checklist.push({ title: subParsed.content, completed: subParsed.completed });
            j++;
            continue;
          }
          break; // same or less indent: a new task
        }
        const trimmed = nextLine.trimStart();
        const lineIndent = nextLine.length - trimmed.length;
        if (lineIndent > parsed.indent && trimmed !== '') {
          notesParts.push(trimmed);
          j++;
        } else if (trimmed === '') {
          j++; // empty line might be part of notes
        } else {
          break;
        }
      }

      // Import-marker filter (after the look-ahead, so a skipped parent's
      // subtasks are skipped too).
      if (marker !== '') {
        if (!tagsContain(tags, marker)) {
          i = j;
          continue;
        }
        tags = tags.filter((t) => t.toLowerCase() !== marker.toLowerCase());
      }

      // Explicit @project() takes precedence over the file-path derived project.
      const taskProjects =
        explicitProject !== null ? [explicitProject] : fileProject !== null ? [fileProject] : [];

      tasks.push({
        id: taskId(filePath, i + 1),
        title: title.trim(),
        notes: notesParts.join('\n').trim(),
        when,
        deadline,
        tags,
        inheritedTags: [],
        checklist,
        completed: parsed.completed,
        completedDate,
        createdDate,
        filePath,
        lineNumber: i + 1,
        projects: taskProjects,
        indentLevel: parsed.indent,
        priority,
        persons: [], // populated later by resolveWikilinks
        recurrence,
        durationMinutes,
        scheduledTime,
        sourceLine: line,
      });

      i = j;
      continue;
    }
    i++;
  }

  return tasks;
}

export function deriveProjectName(
  filePath: string,
  projectsPattern = DEFAULT_PROJECTS_PATTERN,
): string | null {
  const parts = filePath.split('/');
  const projectsIdx = parts.findIndex(
    (part) => part.includes(projectsPattern) && !part.endsWith('.md'),
  );
  if (projectsIdx === -1) return null;

  const after = parts.slice(projectsIdx + 1);
  const last = after[after.length - 1];
  if (last === undefined) return null;

  if (last.endsWith('.md')) {
    const stem = last.slice(0, -'.md'.length);
    if (after.length === 1) return stem;

    const parent = after[after.length - 2]!;
    // Projects/MyProject/MyProject.md → "MyProject"
    if (parent === stem) return stem;

    // Generic filenames use the parent folder as the project name.
    const genericNames = ['tasks', 'notes', 'todo', 'index', 'readme', 'task', 'note'];
    if (genericNames.includes(stem.toLowerCase())) return parent;

    // Otherwise the .md file IS the project ("Bastion 2026.md" → "Bastion 2026").
    return stem;
  }

  return last;
}

/** Resolve [[wikilinks]] into task.projects / task.persons the way vault.rs does.
 *  Title links resolve both; checklist links resolve persons only (a subtask's
 *  [[Project]] would otherwise get hoisted into the title line on save). */
export function resolveWikilinks(
  tasks: Task[],
  personNames: ReadonlySet<string>,
  projectNames: ReadonlySet<string>,
): void {
  for (const task of tasks) {
    for (const link of extractWikilinks(task.title)) {
      if (personNames.has(link)) {
        if (!task.persons.includes(link)) task.persons.push(link);
      } else if (projectNames.has(link)) {
        if (!task.projects.includes(link)) task.projects.push(link);
      }
    }
    for (const item of task.checklist) {
      for (const link of extractWikilinks(item.title)) {
        if (personNames.has(link) && !task.persons.includes(link)) task.persons.push(link);
      }
    }
  }
}

/** Serialize a task back to a markdown line — port of format_task_line_with_marker.
 *  Unrecognized content stays inside `title` and is emitted verbatim. */
export function formatTaskLine(
  task: Task,
  fileProject: string | null,
  projectNames: ReadonlySet<string>,
  format: TaskFormat,
  marker = '',
): string {
  const checkbox = task.completed ? '[x]' : '[ ]';
  const indent = ' '.repeat(task.indentLevel);

  // Remove project wiki-links from the title that are no longer in task.projects.
  let cleanedTitle = task.title;
  for (const link of extractWikilinks(task.title)) {
    if (projectNames.has(link)) {
      const isCurrentProject = task.projects.includes(link);
      const isFileProject = fileProject === link;
      if (!isCurrentProject && !isFileProject) {
        cleanedTitle = cleanedTitle.split(`[[${link}]]`).join('');
      }
    }
  }
  // A raw @when(...)/@duration(...) marker still in the title is one we
  // couldn't parse (see decodeWhen/decodeDuration). Once the user has
  // explicitly set that field to something we *can* encode, the stale raw
  // marker is superseded — strip it so encodeWhen/encodeDuration's fresh
  // marker doesn't sit alongside dead text the decoder would match first on
  // the next parse. Leave it alone while the field is still unset (inbox /
  // null duration): that's the never-destroy-what-we-can't-parse invariant.
  if (task.when.kind !== 'inbox') {
    cleanedTitle = tf.stripWhenMarkers(cleanedTitle);
  }
  if (task.durationMinutes !== null) {
    cleanedTitle = tf.stripDurationMarkers(cleanedTitle);
  }

  cleanedTitle = cleanedTitle.split(/\s+/).filter((s) => s !== '').join(' ');

  const parts: string[] = [cleanedTitle];
  const push = (s: string | null) => {
    if (s !== null) parts.push(s);
  };

  push(tf.encodeWhen(task.when, format));
  push(tf.encodeDue(task.deadline, format));

  // Explicit [[Project]] links for projects not implied by the file path
  // and not already present in the title.
  for (const project of task.projects) {
    const wikilink = `[[${project}]]`;
    if (fileProject !== project && !cleanedTitle.includes(wikilink)) {
      parts.push(wikilink);
    }
  }

  push(tf.encodePriority(task.priority, format));
  push(tf.encodeTime(task.scheduledTime, format));
  push(tf.encodeDuration(task.durationMinutes, format));

  for (const tag of task.tags) {
    parts.push(`#${tag}`);
  }
  // Re-add the import marker tag if configured and not already present.
  if (marker !== '' && !tagsContain(task.tags, marker)) {
    parts.push(`#${marker}`);
  }

  if (task.recurrence !== null) {
    parts.push(tf.encodeRecurrence(task.recurrence, format));
  }
  push(tf.encodeCompleted(task.completedDate, format));
  push(tf.encodeCreated(task.createdDate, format));

  return `${indent}- ${checkbox} ${parts.join(' ')}`;
}

/** The next occurrence of a recurring task — port of next_occurrence in parser.rs.
 *  Returns null for non-recurring tasks or raw (unmodeled) rules. */
export function nextOccurrence(task: Task, todayISO: string): Task | null {
  const rec = task.recurrence;
  if (rec === null) return null;
  const base =
    rec.mode === 'when_done'
      ? todayISO
      : task.when.kind === 'date'
        ? task.when.date
        : todayISO;
  const next = nextDate(rec, base);
  if (next === null) return null;

  const t: Task = structuredClone(task);
  t.completed = false;
  t.completedDate = null;
  t.when = { kind: 'date', date: next } satisfies WhenValue;
  // The clone has no line of its own yet (it hasn't been formatted/inserted);
  // an accidental edit/delete against it must read as stale.
  t.sourceLine = '';
  // Advance the deadline too, if present, by the same rule.
  if (task.deadline !== null) {
    const nd = nextDate(rec, task.deadline);
    if (nd !== null) t.deadline = nd;
  }
  return t;
}
