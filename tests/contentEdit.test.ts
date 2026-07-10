import { describe, it, expect } from 'vitest';
import {
  deleteTaskFromContent,
  updateTaskInContent,
  toggleChecklistItemInContent,
} from '../src/parser/contentEdit';
import { parseFile } from '../src/parser/parser';

const TODAY = '2026-07-07';
const taskAt = (content: string, line: number) =>
  parseFile(content, 'x.md', TODAY).find((t) => t.lineNumber === line)!;

describe('deleteTaskFromContent', () => {
  it('removes a plain task line, keeps the rest', () => {
    const content = ['# Notes', '', '- [ ] A', '- [ ] B'].join('\n');
    const task = taskAt(content, 3);
    const { content: out, ok } = deleteTaskFromContent(content, task);
    expect(ok).toBe(true);
    expect(out).toBe(['# Notes', '', '- [ ] B'].join('\n'));
  });

  it('removes the task with its notes + checklist block, keeps a trailing blank + next line', () => {
    const content = [
      '- [ ] A @when(2026-07-07)',
      '    some note',
      '    - [ ] sub item',
      '',
      '- [ ] B',
    ].join('\n');
    const task = taskAt(content, 1);
    const { content: out, ok } = deleteTaskFromContent(content, task);
    expect(ok).toBe(true);
    expect(out).toBe(['', '- [ ] B'].join('\n'));
  });

  it('is stale (no change) when the line is no longer a task', () => {
    const content = ['- [ ] A'].join('\n');
    const task = taskAt(content, 1);
    const mutated = '# heading now';
    const { content: out, ok } = deleteTaskFromContent(mutated, task);
    expect(ok).toBe(false);
    expect(out).toBe(mutated);
  });

  it('preserves CRLF line endings', () => {
    const content = ['- [ ] A', '- [ ] B'].join('\r\n');
    const task = taskAt(content.replace(/\r/g, ''), 1);
    const { content: out } = deleteTaskFromContent(content, task);
    expect(out).toBe('- [ ] B');
  });

  it('does not leave a dangling CR when deleting the last task of a CRLF file (no trailing newline)', () => {
    const content = '- [ ] A\r\n- [ ] B';
    const task = taskAt(content.replace(/\r/g, ''), 2);
    const { content: out, ok } = deleteTaskFromContent(content, task);
    expect(ok).toBe(true);
    expect(out).toBe('- [ ] A');
  });
});

const OPTS = { fileProject: null, projectNames: new Set<string>(), format: 'annado' as const, marker: '' };

describe('updateTaskInContent', () => {
  it('re-serializes the task line with the changed fields', () => {
    const content = '- [ ] A @when(2026-07-07)';
    const task = taskAt(content, 1);
    const updated = { ...task, when: { kind: 'date' as const, date: '2026-07-08' }, priority: 2 };
    const { content: out, ok } = updateTaskInContent(content, updated, OPTS);
    expect(ok).toBe(true);
    expect(out).toBe('- [ ] A @when(2026-07-08) !(2)');
  });

  it('replaces notes, keeps checklist items', () => {
    const content = [
      '- [ ] A',
      '    old note',
      '    - [ ] keep me',
    ].join('\n');
    const task = taskAt(content, 1);
    const updated = { ...task, notes: 'new note' };
    const { content: out } = updateTaskInContent(content, updated, OPTS);
    expect(out).toBe(['- [ ] A', '    new note', '    - [ ] keep me'].join('\n'));
  });

  it('adds notes to a task that had none', () => {
    const content = ['- [ ] A', '- [ ] B'].join('\n');
    const task = taskAt(content, 1);
    const updated = { ...task, notes: 'hello' };
    const { content: out } = updateTaskInContent(content, updated, OPTS);
    expect(out).toBe(['- [ ] A', '    hello', '- [ ] B'].join('\n'));
  });

  it('removes notes when cleared', () => {
    const content = ['- [ ] A', '    a note', '- [ ] B'].join('\n');
    const task = taskAt(content, 1);
    const updated = { ...task, notes: '' };
    const { content: out } = updateTaskInContent(content, updated, OPTS);
    expect(out).toBe(['- [ ] A', '- [ ] B'].join('\n'));
  });

  it('is stale when the line is no longer a matching task', () => {
    const content = '- [ ] A';
    const task = taskAt(content, 1);
    const { ok } = updateTaskInContent('plain text', { ...task, priority: 1 }, OPTS);
    expect(ok).toBe(false);
  });

  it('does not leave a dangling CR when clearing notes on the last CRLF task', () => {
    const content = '- [ ] A\r\n    a note';
    const task = taskAt(content.replace(/\r/g, ''), 1);
    const { content: out } = updateTaskInContent(content, { ...task, notes: '' }, OPTS);
    expect(out).toBe('- [ ] A');
  });

  it('rewrites the block when notes actually changed, keeping checklist lines', () => {
    const content = [
      '- [ ] A',
      '    First paragraph',
      '',
      '    Second paragraph',
      '    - [ ] keep me',
    ].join('\n');
    const task = taskAt(content, 1);
    const updated = { ...task, notes: 'edited' };
    const { content: out, ok } = updateTaskInContent(content, updated, OPTS);
    expect(ok).toBe(true);
    expect(out).toBe(['- [ ] A', '    edited', '    - [ ] keep me'].join('\n'));
  });

  it('keeps a checklist-first block checklist-first when notes are rewritten', () => {
    const content = [
      '- [ ] A',
      '    - [ ] sub',
      '    old note',
    ].join('\n');
    const task = taskAt(content, 1);
    const updated = { ...task, notes: 'new note' };
    const { content: out, ok } = updateTaskInContent(content, updated, OPTS);
    expect(ok).toBe(true);
    expect(out).toBe(['- [ ] A', '    - [ ] sub', '    new note'].join('\n'));
  });

  it('keeps a notes-first block notes-first when notes are rewritten (current behavior)', () => {
    const content = [
      '- [ ] A',
      '    old note',
      '    - [ ] sub',
    ].join('\n');
    const task = taskAt(content, 1);
    const updated = { ...task, notes: 'new note' };
    const { content: out, ok } = updateTaskInContent(content, updated, OPTS);
    expect(ok).toBe(true);
    expect(out).toBe(['- [ ] A', '    new note', '    - [ ] sub'].join('\n'));
  });

  it('preserves CRLF on the note line when editing a CRLF task that has notes', () => {
    const content = '- [ ] A\r\n    keep note\r\n- [ ] B';
    const task = taskAt(content.replace(/\r/g, ''), 1);
    const updated = { ...task, when: { kind: 'date' as const, date: '2026-07-08' } };
    const { content: out } = updateTaskInContent(content, updated, OPTS);
    expect(out).toBe('- [ ] A @when(2026-07-08)\r\n    keep note\r\n- [ ] B');
  });
});

describe('toggleChecklistItemInContent', () => {
  const content = '- [ ] Parent\n    - [ ] first\n    - [x] second\n- [ ] Next task\n';
  const task = parseFile(content, 'a.md', '2026-07-09')[0]!;

  it('toggles exactly the addressed sub-item', () => {
    const res = toggleChecklistItemInContent(content, task, 0, 'annado', '2026-07-09');
    expect(res.ok).toBe(true);
    expect(res.content).toBe('- [ ] Parent\n    - [x] first\n    - [x] second\n- [ ] Next task\n');
  });
  it('reports stale when the item state already changed', () => {
    const shifted = content.replace('- [ ] first', '- [x] first');
    const res = toggleChecklistItemInContent(shifted, task, 0, 'annado', '2026-07-09');
    expect(res.ok).toBe(false);
    expect(res.content).toBe(shifted);
  });
  it('refuses when the task line itself shifted (different task text at task.lineNumber)', () => {
    const shifted = content.replace('- [ ] Parent', '- [ ] Renamed parent');
    const res = toggleChecklistItemInContent(shifted, task, 0, 'annado', '2026-07-09');
    expect(res.ok).toBe(false);
    expect(res.content).toBe(shifted);
  });
  it('refuses when a sibling is inserted above item 0, leaving a same-state different-title line at the scan position', () => {
    // Insert a new unchecked sub-item above "first" — the scan position that used
    // to be "first" (unchecked) is now this new item, same state but different title.
    const shifted = content.replace(
      '    - [ ] first',
      '    - [ ] inserted\n    - [ ] first',
    );
    const res = toggleChecklistItemInContent(shifted, task, 0, 'annado', '2026-07-09');
    expect(res.ok).toBe(false);
    expect(res.content).toBe(shifted);
  });
});

describe('sourceLine stale-guard', () => {
  it('refuses to delete when a different task now sits at the line', () => {
    const content = '- [ ] Original task\n';
    const task = parseFile(content, 'a.md', '2026-07-09')[0]!;
    const shifted = '- [ ] Completely different task\n';
    const res = deleteTaskFromContent(shifted, task);
    expect(res.ok).toBe(false);
    expect(res.content).toBe(shifted);
  });
  it('refuses to update when the line content changed', () => {
    const content = '- [ ] Original task\n';
    const task = parseFile(content, 'a.md', '2026-07-09')[0]!;
    const shifted = '- [ ] Renamed elsewhere\n';
    const res = updateTaskInContent(shifted, task, OPTS);
    expect(res.ok).toBe(false);
    expect(res.content).toBe(shifted);
  });
});
