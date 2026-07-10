import { Task } from './types';
import { formatTaskLine, parseTaskLine } from './parser';
import { TaskFormat } from './taskformat';
import { setLineCompleted } from './lineEdit';

export function stripCR(s: string): string {
  return s.endsWith('\r') ? s.slice(0, -1) : s;
}

/** End (exclusive) of the task's block: the task line plus following lines more
 *  indented than it (notes + checklist), including blank lines *between* deeper
 *  lines but NOT trailing blank lines after the last deeper line. */
export function blockEnd(lines: string[], idx: number, taskIndent: number): number {
  let end = idx + 1;
  let lastContentEnd = idx + 1;
  while (end < lines.length) {
    const l = stripCR(lines[end]!);
    const trimmed = l.trimStart();
    if (trimmed === '') {
      end++;
      continue; // tentatively inside the block; only kept if deeper content follows
    }
    const indent = l.length - trimmed.length;
    if (indent > taskIndent) {
      end++;
      lastContentEnd = end;
      continue;
    }
    break;
  }
  return lastContentEnd;
}

export function deleteTaskFromContent(
  content: string,
  task: Task,
): { content: string; ok: boolean } {
  const lines = content.split('\n');
  const idx = task.lineNumber - 1;
  const raw = lines[idx];
  if (raw === undefined) return { content, ok: false };
  const parsed = parseTaskLine(stripCR(raw));
  if (!parsed || parsed.indent !== task.indentLevel) return { content, ok: false };
  if (stripCR(raw) !== task.sourceLine) return { content, ok: false };
  const end = blockEnd(lines, idx, task.indentLevel);
  lines.splice(idx, end - idx);
  // A lone trailing '\r' can only be an orphaned '\r\n' terminator left behind
  // when the deleted block was the file's last line (a well-formed file never
  // ends in a bare '\r'). Strip it so CRLF files with no trailing newline stay valid.
  const out = lines.join('\n');
  return { content: out.endsWith('\r') ? out.slice(0, -1) : out, ok: true };
}

/** The notes parseFile would extract from this block — trimmed lines, blanks
 *  skipped, strict checklist lines excluded. Must mirror parseFile's loop. */
function blockNotes(lines: string[], from: number, to: number): string {
  const parts: string[] = [];
  for (let i = from; i < to; i++) {
    const l = stripCR(lines[i]!);
    if (parseTaskLine(l) !== null) continue;
    const trimmed = l.trimStart();
    if (trimmed !== '') parts.push(trimmed);
  }
  return parts.join('\n').trim();
}

export function updateTaskInContent(
  content: string,
  updated: Task,
  opts: { fileProject: string | null; projectNames: ReadonlySet<string>; format: TaskFormat; marker: string },
): { content: string; ok: boolean } {
  const lines = content.split('\n');
  const idx = updated.lineNumber - 1;
  const raw = lines[idx];
  if (raw === undefined) return { content, ok: false };
  const hadCR = raw.endsWith('\r');
  const parsed = parseTaskLine(stripCR(raw));
  if (!parsed || parsed.indent !== updated.indentLevel) return { content, ok: false };
  if (stripCR(raw) !== updated.sourceLine) return { content, ok: false };

  // Re-serialize the checkbox line.
  const newLine = formatTaskLine(updated, opts.fileProject, opts.projectNames, opts.format, opts.marker);
  lines[idx] = hadCR ? `${newLine}\r` : newLine;

  // Find the indented block below (notes + checklist), ignoring trailing blanks.
  const taskIndent = updated.indentLevel;
  const lastContentEnd = blockEnd(lines, idx, taskIndent);

  // Notes unchanged → leave the whole block byte-for-byte alone. We can't
  // reconstruct blank lines / nesting from the flattened edit-sheet string,
  // so rewriting is reserved for edits that actually touched the notes.
  if (blockNotes(lines, idx + 1, lastContentEnd) !== updated.notes) {
    // Remove note lines in [idx+1, lastContentEnd) — keep checklist lines.
    // Keep checklist lines — using the SAME classifier as parseFile (strict
    // `- [ ]`/`- [x]`), so a `- [-]` or `- [text](url)` line is a note on both
    // sides and never gets kept AND re-emitted (which duplicated it).
    const kept: string[] = [];
    // Was the block originally checklist-first? Only the FIRST non-blank line
    // decides — a fully interleaved block still flattens to two groups, but the
    // dominant (first) order is preserved instead of always forcing notes first.
    let checklistFirst = false;
    for (let i = idx + 1; i < lastContentEnd; i++) {
      const trimmed = stripCR(lines[i]!).trimStart();
      if (trimmed === '') continue;
      checklistFirst = parseTaskLine(stripCR(lines[i]!)) !== null;
      break;
    }
    for (let i = idx + 1; i < lastContentEnd; i++) {
      if (parseTaskLine(stripCR(lines[i]!)) !== null) kept.push(lines[i]!);
    }
    lines.splice(idx + 1, lastContentEnd - (idx + 1));

    // Insert new notes (4-space indented) and the preserved checklist lines,
    // in whichever order the original block led with.
    const nl = hadCR ? '\r' : '';
    const noteLines =
      updated.notes.trim() === ''
        ? []
        : updated.notes.split('\n').map((n) => `${' '.repeat(taskIndent + 4)}${n}${nl}`);
    lines.splice(idx + 1, 0, ...(checklistFirst ? [...kept, ...noteLines] : [...noteLines, ...kept]));
  }

  // A lone trailing '\r' can only be an orphaned '\r\n' terminator left behind
  // when the task's notes block was cleared on the file's last line (a well-formed
  // file never ends in a bare '\r'). Strip it so CRLF files with no trailing newline
  // stay valid.
  const out = lines.join('\n');
  return { content: out.endsWith('\r') ? out.slice(0, -1) : out, ok: true };
}

/** Toggle a checklist sub-item of a task, byte-preserving except for the flipped
 *  checkbox character. Pure — no App/Vault; callers write the returned content. */
export function toggleChecklistItemInContent(
  content: string,
  task: Task,
  itemIndex: number,
  format: TaskFormat,
  todayISO: string,
): { content: string; ok: boolean } {
  const item = task.checklist[itemIndex];
  if (item === undefined) return { content, ok: false };

  const lines = content.split('\n');
  if (stripCR(lines[task.lineNumber - 1] ?? '') !== task.sourceLine) return { content, ok: false };
  // Sub-items sit between the task line and the next top-level line; find the
  // (itemIndex+1)-th checkbox below the task that is indented deeper.
  let seen = -1;
  for (let i = task.lineNumber; i < lines.length; i++) {
    const raw = lines[i]!;
    const hadCR = raw.endsWith('\r');
    const line = hadCR ? raw.slice(0, -1) : raw;
    const parsed = parseTaskLine(line);
    if (parsed) {
      if (parsed.indent <= task.indentLevel) break; // next task
      seen++;
      if (seen === itemIndex) {
        if (parsed.completed !== item.completed || parsed.content !== item.title) break; // stale
        // stamp:false — checklist items carry no completion dates.
        const newLine = setLineCompleted(line, !item.completed, format, todayISO, false);
        if (newLine === null) break;
        lines[i] = hadCR ? `${newLine}\r` : newLine;
        return { content: lines.join('\n'), ok: true };
      }
    } else {
      const trimmed = line.trimStart();
      const indent = line.length - trimmed.length;
      if (trimmed !== '' && indent <= task.indentLevel) break; // end of block
    }
  }
  return { content, ok: false };
}
