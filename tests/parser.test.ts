// Ports of the #[cfg(test)] suite in src-tauri/src/parser.rs.

import { describe, it, expect } from 'vitest';
import {
  parseFile,
  formatTaskLine,
  nextOccurrence,
  deriveProjectName,
  normalizeMarker,
  tagsContain,
  extractTags,
} from '../src/parser/parser';
import { parseRule } from '../src/parser/recurrence';

const TODAY = '2026-06-17';
const NO_PROJECTS = new Set<string>();

describe('parseFile dialect reading', () => {
  it('reads Obsidian Tasks and Dataview lines', () => {
    const t = parseFile('- [ ] Pay rent 📅 2026-07-01 ⏫ 🔁 every 2 weeks', 'x.md', TODAY);
    expect(t[0]!.title).toBe('Pay rent');
    expect(t[0]!.deadline).toBe('2026-07-01');
    expect(t[0]!.priority).toBe(1);
    expect(t[0]!.recurrence!.interval).toBe(2);

    const d = parseFile('- [ ] Review [due:: 2026-07-02] [priority:: low]', 'x.md', TODAY);
    expect(d[0]!.title).toBe('Review');
    expect(d[0]!.deadline).toBe('2026-07-02');
    expect(d[0]!.priority).toBe(3);
  });

  it('decodes identical field values across all three formats', () => {
    const lines = [
      '- [ ] Pay rent @when(2026-06-20) @due(2026-07-01) !(1) @created(2026-06-01)',
      '- [ ] Pay rent ⏳ 2026-06-20 📅 2026-07-01 ⏫ ➕ 2026-06-01',
      '- [ ] Pay rent [scheduled:: 2026-06-20] [due:: 2026-07-01] [priority:: high] [created:: 2026-06-01]',
    ];
    for (const line of lines) {
      const t = parseFile(line, 'x.md', TODAY)[0]!;
      expect(t.title, line).toBe('Pay rent');
      expect(t.when, line).toEqual({ kind: 'date', date: '2026-06-20' });
      expect(t.deadline, line).toBe('2026-07-01');
      expect(t.priority, line).toBe(1);
      expect(t.createdDate, line).toBe('2026-06-01');
    }
  });

  it('round-trips structured values through every write format', () => {
    const src = '- [ ] Pay rent @when(2026-06-20) @due(2026-07-01) !(1) @repeat(every 2 weeks)';
    const task = parseFile(src, 'x.md', TODAY)[0]!;
    for (const fmt of ['annado', 'obsidian_tasks', 'dataview'] as const) {
      const line = formatTaskLine(task, null, NO_PROJECTS, fmt);
      const back = parseFile(line, 'x.md', TODAY)[0]!;
      expect(back.title, `${fmt}: ${line}`).toBe('Pay rent');
      expect(back.deadline, fmt).toBe('2026-07-01');
      expect(back.when, fmt).toEqual({ kind: 'date', date: '2026-06-20' });
      expect(back.priority, fmt).toBe(1);
      expect(back.recurrence!.interval, fmt).toBe(2);
    }
  });
});

describe('import marker', () => {
  it('filters unmarked tasks and strips the marker tag', () => {
    const content = '- [ ] A #task #home\n- [ ] B #home';
    const marked = parseFile(content, 'x.md', TODAY, 'task');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.title).toBe('A');
    expect(marked[0]!.tags).toContain('home');
    expect(marked[0]!.tags.some((t) => t.toLowerCase() === 'task')).toBe(false);
    expect(parseFile(content, 'x.md', TODAY)).toHaveLength(2);
  });

  it('matches case-insensitively', () => {
    expect(parseFile('- [ ] A #Task', 'x.md', TODAY, 'task')).toHaveLength(1);
  });

  it('matches nested tags on the first path segment only', () => {
    const t = parseFile('- [ ] A #task/work', 'x.md', TODAY, 'task');
    expect(t).toHaveLength(1);
    expect(t[0]!.tags).toEqual(['task/work']);
    expect(parseFile('- [ ] B #work/task', 'x.md', TODAY, 'task')).toHaveLength(0);
    expect(parseFile('- [ ] C #taskforce', 'x.md', TODAY, 'task')).toHaveLength(0);
  });

  it('round-trips on write without duplicating the marker', () => {
    const task = parseFile('- [ ] A #task #home', 'x.md', TODAY, 'task')[0]!;
    const line = formatTaskLine(task, null, NO_PROJECTS, 'annado', 'task');
    expect(line.split('#task').length - 1).toBe(1);
    expect(parseFile(line, 'x.md', TODAY, 'task')).toHaveLength(1);
  });

  it('skips subtasks of an unmarked parent', () => {
    const content = '- [ ] Parent\n    - [ ] Child';
    expect(parseFile(content, 'x.md', TODAY, 'task')).toHaveLength(0);
  });

  it('normalizeMarker strips leading # and whitespace', () => {
    expect(normalizeMarker(' #task ')).toBe('task');
    expect(normalizeMarker('task')).toBe('task');
  });

  it('tagsContain matches first segment case-insensitively', () => {
    expect(tagsContain(['Task/work'], 'task')).toBe(true);
    expect(tagsContain(['work/task'], 'task')).toBe(false);
  });
});

describe('mutating a field that carries a stale raw marker', () => {
  it('strips the raw @when(...) marker once when is explicitly set to a new date', () => {
    const task = parseFile('- [ ] Fix sink @when(next week)\n', 'x.md', TODAY)[0]!;
    expect(task.when).toEqual({ kind: 'inbox' });
    expect(task.title).toContain('@when(next week)');

    task.when = { kind: 'date', date: '2026-07-15' };
    const line = formatTaskLine(task, null, NO_PROJECTS, 'annado');
    expect(line.split('@when(2026-07-15)').length - 1).toBe(1);
    expect(line).not.toContain('next week');

    const back = parseFile(line, 'x.md', TODAY)[0]!;
    expect(back.when).toEqual({ kind: 'date', date: '2026-07-15' });
  });

  it('strips ALL stale when-markers when the field is set', () => {
    const tasks = parseFile('- [ ] Fix sink @when(next week) @when(also broken)\n', 'a.md', '2026-07-09');
    const t = { ...tasks[0]!, when: { kind: 'date', date: '2026-07-15' } as const };
    const line = formatTaskLine(t, null, new Set(), 'annado');
    expect(line).not.toContain('next week');
    expect(line).not.toContain('also broken');
    expect(line.match(/@when\(/g)).toHaveLength(1);
    const reparsed = parseFile(line + '\n', 'a.md', '2026-07-09')[0]!;
    expect(reparsed.when).toEqual({ kind: 'date', date: '2026-07-15' });
  });

  it('strips the raw @duration(...) marker once durationMinutes is explicitly set', () => {
    const task = parseFile('- [ ] Fix sink @duration(a while)\n', 'x.md', TODAY)[0]!;
    expect(task.durationMinutes).toBeNull();
    expect(task.title).toContain('@duration(a while)');

    task.durationMinutes = 30;
    const line = formatTaskLine(task, null, NO_PROJECTS, 'annado');
    expect(line.split('@duration(30m)').length - 1).toBe(1);
    expect(line).not.toContain('a while');

    const back = parseFile(line, 'x.md', TODAY)[0]!;
    expect(back.durationMinutes).toBe(30);
  });

  it('strips ALL stale duration-markers when the field is set', () => {
    const tasks = parseFile('- [ ] Fix sink @duration(a while) @duration(ages)\n', 'a.md', '2026-07-09');
    const t = tasks[0]!;
    expect(t.durationMinutes).toBeNull();
    expect(t.title).toContain('@duration(a while)');
    expect(t.title).toContain('@duration(ages)');

    const t2 = { ...t, durationMinutes: 30 };
    const line = formatTaskLine(t2, null, new Set(), 'annado');
    expect(line).not.toContain('a while');
    expect(line).not.toContain('ages');
    expect(line).toContain('@duration(30m)');
    expect(line.match(/@duration\(/g)).toHaveLength(1);

    const reparsed = parseFile(line + '\n', 'a.md', '2026-07-09')[0]!;
    expect(reparsed.durationMinutes).toBe(30);
  });

  it('leaves the raw marker verbatim when the field is left untouched', () => {
    const task = parseFile('- [ ] Fix sink @when(next week)\n', 'x.md', TODAY)[0]!;
    const line = formatTaskLine(task, null, NO_PROJECTS, 'annado');
    expect(line).toContain('@when(next week)');
  });
});

describe('recurrence round-trip and roll-forward', () => {
  it('round-trips @repeat rules', () => {
    const tasks = parseFile('- [ ] Water plants @when(2026-06-16) @repeat(every 2 weeks)', 'test.md', '2026-06-16');
    expect(tasks).toHaveLength(1);
    const rec = tasks[0]!.recurrence!;
    expect(rec.interval).toBe(2);
    expect(rec.unit).toBe('weeks');
    expect(rec.mode).toBe('fixed');
    const line = formatTaskLine(tasks[0]!, null, NO_PROJECTS, 'annado');
    expect(line).toContain('@repeat(every 2 weeks)');
  });

  it('advances the scheduled date for fixed mode', () => {
    const tasks = parseFile('- [ ] Pay rent @when(2026-06-16) @repeat(every 2 weeks)', 'test.md', '2026-06-16');
    const next = nextOccurrence(tasks[0]!, '2026-06-16')!;
    expect(next.when).toEqual({ kind: 'date', date: '2026-06-30' });
    expect(next.completed).toBe(false);
    expect(next.completedDate).toBeNull();
  });

  it('uses the completion date for when-done mode', () => {
    const tasks = parseFile('- [ ] Clean @when(2026-06-16) @repeat(every week when done)', 'test.md', '2026-06-20');
    const next = nextOccurrence(tasks[0]!, '2026-06-20')!;
    expect(next.when).toEqual({ kind: 'date', date: '2026-06-27' });
  });

  it('returns null for raw or non-recurring tasks', () => {
    const plain = parseFile('- [ ] Just a task @when(2026-06-16)', 'test.md', '2026-06-16');
    expect(nextOccurrence(plain[0]!, '2026-06-16')).toBeNull();
    const raw = parseFile('- [ ] Standup @when(2026-06-16) @repeat(every weekday)', 'test.md', '2026-06-16');
    expect(nextOccurrence(raw[0]!, '2026-06-16')).toBeNull();
  });

  it('treats "every 0 days" as a raw (unmodeled) rule', () => {
    const r = parseRule('every 0 days');
    expect(r.raw).toBe('every 0 days');
  });
});

describe('basic parsing', () => {
  it('parses a simple task', () => {
    const tasks = parseFile('- [ ] Buy groceries', 'test.md', '2024-01-28');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('Buy groceries');
    expect(tasks[0]!.when).toEqual({ kind: 'inbox' });
    expect(tasks[0]!.completed).toBe(false);
  });

  it('converts @when(today) to an actual date', () => {
    const tasks = parseFile('- [ ] Buy groceries @when(today)', 'test.md', '2024-01-28');
    expect(tasks[0]!.when).toEqual({ kind: 'date', date: '2024-01-28' });
  });

  it('converts @when(tomorrow) to an actual date', () => {
    const tasks = parseFile('- [ ] Buy groceries @when(tomorrow)', 'test.md', '2024-01-28');
    expect(tasks[0]!.when).toEqual({ kind: 'date', date: '2024-01-29' });
  });

  it('parses tags', () => {
    const tasks = parseFile('- [ ] Buy groceries #errands #shopping', 'test.md', '2024-01-28');
    expect(tasks[0]!.tags).toEqual(['errands', 'shopping']);
  });

  it('parses nested tags and strips them fully from the title', () => {
    const tasks = parseFile('- [ ] Read paper #inbox/to-read #inbox #ml/papers/2024', 'test.md', '2024-01-28');
    expect(tasks[0]!.tags).toEqual(['inbox/to-read', 'inbox', 'ml/papers/2024']);
    expect(tasks[0]!.title).toBe('Read paper');
  });

  it('trims a trailing slash from tags', () => {
    const tasks = parseFile('- [ ] Task #inbox/', 'test.md', '2024-01-28');
    expect(tasks[0]!.tags).toEqual(['inbox']);
  });

  it('collapses the double space left by removing a mid-string tag', () => {
    const [tags, cleaned] = extractTags('Buy #x groceries');
    expect(tags).toEqual(['x']);
    expect(cleaned).toBe('Buy groceries');
  });

  describe('tags never match inside wikilinks or URLs', () => {
    it('leaves [[Note#Heading]] and URL anchors alone', () => {
      const [tags, cleaned] = extractTags('See [[Note#Heading]] and https://ex.com/a#sec #real');
      expect(tags).toEqual(['real']);
      expect(cleaned).toBe('See [[Note#Heading]] and https://ex.com/a#sec');
    });
  });

  it('parses completed tasks', () => {
    const tasks = parseFile('- [x] Completed task', 'test.md', '2024-01-28');
    expect(tasks[0]!.completed).toBe(true);
  });

  it('parses priorities', () => {
    const tasks = parseFile('- [ ] Task one !(1)\n- [ ] Task two !(2)\n- [ ] Task three !(3)', 'test.md', '2024-01-28');
    expect(tasks.map((t) => t.priority)).toEqual([1, 2, 3]);
    expect(tasks[0]!.title).toBe('Task one');
  });

  it('leaves priority null when absent', () => {
    expect(parseFile('- [ ] Normal task', 'test.md', '2024-01-28')[0]!.priority).toBeNull();
  });

  it('parses created and completed dates', () => {
    const tasks = parseFile('- [x] Done task @completed(2026-02-14) @created(2026-02-10)', 'test.md', '2026-02-14');
    expect(tasks[0]!.title).toBe('Done task');
    expect(tasks[0]!.completedDate).toBe('2026-02-14');
    expect(tasks[0]!.createdDate).toBe('2026-02-10');
    expect(tasks[0]!.completed).toBe(true);
  });

  it('leaves created date null when absent', () => {
    expect(parseFile('- [ ] Buy groceries', 'test.md', '2026-02-14')[0]!.createdDate).toBeNull();
  });

  it('parses notes and checklist items below the task', () => {
    const content = [
      '- [ ] Plan trip @when(someday)',
      '    Check the ferry timetable first',
      '    - [x] Book hotel',
      '    - [ ] Pack bags',
      '- [ ] Unrelated next task',
    ].join('\n');
    const tasks = parseFile(content, 'test.md', TODAY);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.notes).toBe('Check the ferry timetable first');
    expect(tasks[0]!.checklist).toEqual([
      { title: 'Book hotel', completed: true },
      { title: 'Pack bags', completed: false },
    ]);
  });

  it('parses duration and scheduled time', () => {
    const tasks = parseFile('- [ ] Meeting prep @when(2026-02-16) @time(09:00) @duration(1h30m)', 'test.md', '2026-02-16');
    expect(tasks[0]!.title).toBe('Meeting prep');
    expect(tasks[0]!.durationMinutes).toBe(90);
    expect(tasks[0]!.scheduledTime).toBe('09:00');
  });

  it('leaves duration and time null when absent', () => {
    const tasks = parseFile('- [ ] Simple task @when(anytime)', 'test.md', '2026-02-16');
    expect(tasks[0]!.durationMinutes).toBeNull();
    expect(tasks[0]!.scheduledTime).toBeNull();
  });
});

describe('deriveProjectName', () => {
  it('derives from Projects folder structure', () => {
    expect(deriveProjectName('Projects/MyProject.md')).toBe('MyProject');
    expect(deriveProjectName('02. Projects/Work/Website Redesign.md')).toBe('Website Redesign');
    expect(deriveProjectName('Projects/MyProject/MyProject.md')).toBe('MyProject');
    expect(deriveProjectName('Projects/MyProject/tasks.md')).toBe('MyProject');
    expect(deriveProjectName('Daily Notes/2026-02-16.md')).toBeNull();
  });
});

describe('parseFile projectsPattern threading', () => {
  it('derives the file project using a custom pattern', () => {
    const tasks = parseFile('- [ ] Taak\n', 'Projecten/Verbouwing/Verbouwing.md', '2026-07-09', '', 'Projecten');
    expect(tasks[0]!.projects).toEqual(['Verbouwing']);
  });
  it('default pattern still works when the argument is omitted', () => {
    const tasks = parseFile('- [ ] Task\n', 'Projects/Alpha/Alpha.md', '2026-07-09');
    expect(tasks[0]!.projects).toEqual(['Alpha']);
  });
});
