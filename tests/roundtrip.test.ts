// Losslessness guarantees, the highest-risk part of the port.
//
// 1. Canonical corpus: lines already in Annado's canonical field order must
//    survive parse → formatTaskLine byte-for-byte, including markers and text
//    the parser does not recognize.
// 2. Semantic corpus: messy/dialect lines must survive parse → format → parse
//    with identical field values.
// 3. Surgical toggle: setLineCompleted may change ONLY the checkbox character
//    and the completed marker — every other byte is preserved on ANY line.

import { describe, it, expect } from 'vitest';
import { parseFile, formatTaskLine, nextOccurrence, resolveWikilinks } from '../src/parser/parser';
import { setLineCompleted } from '../src/parser/lineEdit';
import { blockEnd } from '../src/parser/contentEdit';

const TODAY = '2026-06-17';
const NO_PROJECTS = new Set<string>();

// Field order matches format_task_line: title, @when, @due, [[projects]], !(p),
// @time, @duration, #tags, @repeat, @completed, @created.
const CANONICAL_CORPUS = [
  '- [ ] Buy groceries',
  '- [x] Done task @completed(2026-02-14) @created(2026-02-10)',
  '- [ ] Pay rent @when(2026-06-20) @due(2026-07-01) !(1) @time(09:00) @duration(1h30m) #home @repeat(every 2 weeks) @created(2026-06-01)',
  '- [ ] Boodschappen doen @when(2026-02-14) @created(2026-02-14)',
  '- [ ] Bel de gemeente over de parkeervergunning @when(evening) #thuis',
  '- [ ] Read paper @when(someday) #inbox/to-read #ml/papers/2024',
  '- [ ] Task @when(2026-02-16) @time(14:00) @duration(45m)',
  '- [ ] Standup @when(2026-06-16) @repeat(every weekday)',
  '- [ ] Weekly review @when(anytime) @repeat(every week when done)',
  '  - [ ] Indented task still top-level @when(someday)',
  '- [ ] Unknown marker ⭐ stays in the title @when(2026-07-01)',
  '- [ ] Line with [unrecognized:: field] kept verbatim @due(2026-08-01)',
  '- [ ] Vergadering voorbereiden [[Alice]] @when(2026-06-20) !(2) #werk',
];

describe('canonical Annado lines round-trip byte-for-byte', () => {
  for (const line of CANONICAL_CORPUS) {
    it(JSON.stringify(line), () => {
      const tasks = parseFile(line, 'x.md', TODAY);
      expect(tasks).toHaveLength(1);
      const out = formatTaskLine(tasks[0]!, null, NO_PROJECTS, 'annado');
      expect(out).toBe(line);
    });
  }

  it('round-trips a resolved [[Project]] wikilink in place', () => {
    const line = '- [ ] Bespreek planning [[Alice]] [[Website Redesign]] @when(2026-06-20)';
    const tasks = parseFile(line, 'x.md', TODAY);
    resolveWikilinks(tasks, new Set(['Alice']), new Set(['Website Redesign']));
    expect(tasks[0]!.projects).toEqual(['Website Redesign']);
    expect(tasks[0]!.persons).toEqual(['Alice']);
    const out = formatTaskLine(tasks[0]!, null, new Set(['Website Redesign']), 'annado');
    expect(out).toBe(line);
  });
});

// Lines in other dialects / messy shapes: parse → format → parse must preserve
// every field value (the write normalizes to the chosen format by design).
const SEMANTIC_CORPUS = [
  '- [ ] Pay rent 📅 2026-07-01 ⏫ 🔁 every 2 weeks',
  '- [x] Shipped ✅ 2026-06-10 ➕ 2026-05-01',
  '- [ ] Review [scheduled:: 2026-06-20] [due:: 2026-07-01] [priority:: low]',
  '- [ ] Mixed dialects ⏳ 2026-06-20 @due(2026-07-01) [priority:: high]',
  '- [ ]   Extra   spacing   everywhere @when(2026-06-20)   #tag',
  '- [ ] Emoji in title 🎉 party planning @when(2026-06-20)',
];

describe('dialect/messy lines round-trip semantically', () => {
  for (const line of SEMANTIC_CORPUS) {
    it(JSON.stringify(line), () => {
      const first = parseFile(line, 'x.md', TODAY)[0]!;
      for (const fmt of ['annado', 'obsidian_tasks', 'dataview'] as const) {
        const out = formatTaskLine(first, null, NO_PROJECTS, fmt);
        const second = parseFile(out, 'x.md', TODAY)[0]!;
        // The writer collapses runs of whitespace inside the title (same as the
        // Rust serializer), so compare against the collapsed form.
        expect(second.title, `${fmt}: ${out}`).toBe(first.title.replace(/\s+/g, ' '));
        expect(second.when, fmt).toEqual(first.when);
        expect(second.deadline, fmt).toBe(first.deadline);
        expect(second.priority, fmt).toBe(first.priority);
        expect(second.tags, fmt).toEqual(first.tags);
        expect(second.completedDate, fmt).toBe(first.completedDate);
        expect(second.createdDate, fmt).toBe(first.createdDate);
        expect(second.durationMinutes, fmt).toBe(first.durationMinutes);
        expect(second.scheduledTime, fmt).toBe(first.scheduledTime);
        expect(second.recurrence, fmt).toEqual(first.recurrence);
      }
    });
  }
});

// The toggle path never re-serializes: only the checkbox char and the completed
// marker may change. This must hold for ANY line, however messy.
const TOGGLE_CORPUS = [
  '- [ ] Buy groceries',
  '- [ ] Pay rent 📅 2026-07-01 ⏫ 🔁 every 2 weeks',
  '- [ ] Review [due:: 2026-07-02] [priority:: low]',
  '- [ ]  double  spaces   preserved @when(2026-01-01)  trailing  ',
  '\t- [ ] tab-indented checklist item',
  '    - [ ] four-space checklist item with [[Link]] and #tag',
  '- [ ] Unknown ⭐ markers ⭐⭐ everywhere [weird:: stuff] %%comment%%',
  '- [ ] Odd one @when(next week) @duration(a while)',
];

describe('setLineCompleted is byte-preserving', () => {
  for (const line of TOGGLE_CORPUS) {
    it(JSON.stringify(line), () => {
      const completed = setLineCompleted(line, true, 'annado', TODAY)!;
      // Completing = checkbox flip + exactly one appended marker.
      expect(completed).toBe(
        line.replace('- [ ]', '- [x]') + ' @completed(2026-06-17)',
      );
      // Un-completing returns the original bytes exactly.
      expect(setLineCompleted(completed, false, 'annado', TODAY)).toBe(line);
    });
  }

  it('does not duplicate an existing completed marker', () => {
    const line = '- [ ] Almost done ✅ 2026-06-01';
    const completed = setLineCompleted(line, true, 'annado', TODAY)!;
    expect(completed).toBe('- [x] Almost done ✅ 2026-06-01');
  });

  it('removes an existing completed marker on un-complete', () => {
    expect(setLineCompleted('- [x] Shipped ✅ 2026-06-10 #tag', false, 'annado', TODAY)).toBe(
      '- [ ] Shipped #tag',
    );
    expect(
      setLineCompleted('- [x] Shipped @completed(2026-06-10)', false, 'annado', TODAY),
    ).toBe('- [ ] Shipped');
  });

  it('stamps the marker in the chosen write format', () => {
    expect(setLineCompleted('- [ ] A', true, 'obsidian_tasks', TODAY)).toBe('- [x] A ✅ 2026-06-17');
    expect(setLineCompleted('- [ ] A', true, 'dataview', TODAY)).toBe(
      '- [x] A [completion:: 2026-06-17]',
    );
  });

  it('rejects non-task lines (stale index guard)', () => {
    expect(setLineCompleted('# A heading', true, 'annado', TODAY)).toBeNull();
    expect(setLineCompleted('plain text', true, 'annado', TODAY)).toBeNull();
    expect(setLineCompleted('- a plain list item', true, 'annado', TODAY)).toBeNull();
  });

  it('handles uppercase X checkboxes', () => {
    expect(setLineCompleted('- [X] Done @completed(2026-06-01)', false, 'annado', TODAY)).toBe('- [ ] Done');
  });
});

describe('recurring completion insert position', () => {
  it('the next occurrence lands below the notes/checklist block', () => {
    const content = '- [ ] Water plants @when(2026-07-09) @repeat(every week)\n    remember the balcony\n    - [ ] refill can\n';
    const task = parseFile(content, 'a.md', '2026-07-09')[0]!;
    const next = nextOccurrence(task, '2026-07-09')!;
    const lines = content.split('\n');
    const insertAt = blockEnd(lines, 0, task.indentLevel);
    expect(insertAt).toBe(3); // after both block lines, not at 1
    lines.splice(insertAt, 0, formatTaskLine(next, null, new Set(), 'annado'));
    const reparsed = parseFile(lines.join('\n'), 'a.md', '2026-07-09');
    expect(reparsed[0]!.notes).toBe('remember the balcony'); // block stays with the original
    expect(reparsed[1]!.notes).toBe('');
  });

  it('preserves \\r discipline when splicing the next occurrence into CRLF content', () => {
    const content = '- [ ] Water plants @when(2026-07-09) @repeat(every week)\r\n    note\r\n';
    const task = parseFile(content, 'a.md', '2026-07-09')[0]!;
    const next = nextOccurrence(task, '2026-07-09')!;
    const lines = content.split('\n');
    const insertAt = blockEnd(lines, 0, task.indentLevel);
    expect(insertAt).toBe(2); // after the note line, before the trailing blank

    // Same \r re-attachment writer.toggleTask uses: hadCR ? line + '\r' : line.
    const raw = lines[0]!;
    const hadCR = raw.endsWith('\r');
    const nextLine = formatTaskLine(next, null, new Set(), 'annado');
    lines.splice(insertAt, 0, hadCR ? `${nextLine}\r` : nextLine);

    const reparsed = parseFile(lines.join('\n'), 'a.md', '2026-07-09');
    expect(reparsed[0]!.notes).toBe('note'); // block stays with the original
    expect(reparsed[1]!.notes).toBe('');
  });
});
