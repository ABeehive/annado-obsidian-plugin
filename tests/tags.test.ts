// Ports of the tag-inheritance / excluded-tags #[cfg(test)] suite in
// src-tauri/src/vault.rs (frontmatter_tags, annado_inherit_tags_override,
// apply_inherited_tags, remove_excluded_tag_tasks).

import { describe, it, expect } from 'vitest';
import { Task, Recurrence } from '../src/parser/types';
import {
  tagMatchesFilter,
  tagsMatchFilter,
  extractFrontmatterTags,
  inheritTagsOverride,
  applyInheritedTags,
  removeExcludedTagTasks,
  allTaskTags,
  normalizeTagInput,
  validateExcludedTagInput,
} from '../src/parser/tags';

const FIXED_RECURRENCE: Recurrence = { interval: 1, unit: 'weeks', mode: 'fixed', raw: null };

/** Minimal-but-complete Task fixture; only tags/inheritedTags/completed/recurrence
 *  vary per test. */
function mkTask(tags: string[], overrides: Partial<Task> = {}): Task {
  return {
    id: 't',
    title: 't',
    notes: '',
    when: { kind: 'inbox' },
    deadline: null,
    tags,
    checklist: [],
    completed: false,
    completedDate: null,
    createdDate: null,
    filePath: 'a.md',
    lineNumber: 1,
    projects: [],
    indentLevel: 0,
    priority: null,
    persons: [],
    recurrence: null,
    durationMinutes: null,
    scheduledTime: null,
    sourceLine: '- [ ] t',
    inheritedTags: [],
    ...overrides,
  };
}

describe('tagMatchesFilter (moved from ui.ts)', () => {
  it('matches an exact tag', () => {
    expect(tagMatchesFilter('inbox', 'inbox')).toBe(true);
  });

  it('matches a nested descendant', () => {
    expect(tagMatchesFilter('inbox/to-read', 'inbox')).toBe(true);
  });

  it('does not match a tag that merely shares a prefix', () => {
    expect(tagMatchesFilter('inboxed', 'inbox')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(tagMatchesFilter('INBOX/Read', 'inbox')).toBe(true);
  });

  it('does not match the other direction (child does not match as a filter for its parent)', () => {
    expect(tagMatchesFilter('inbox', 'inbox/to-read')).toBe(false);
  });
});

describe('tagsMatchFilter (moved from ui.ts)', () => {
  it('true when any tag in the list matches', () => {
    expect(tagsMatchFilter(['werk', 'thuis'], 'werk')).toBe(true);
  });

  it('false when none match', () => {
    expect(tagsMatchFilter(['werk', 'thuis'], 'projectx')).toBe(false);
  });
});

describe('extractFrontmatterTags', () => {
  it('reads a YAML list', () => {
    expect(extractFrontmatterTags({ tags: ['werk', 'thuis'] })).toEqual(['werk', 'thuis']);
  });

  it('reads a comma-separated string', () => {
    expect(extractFrontmatterTags({ tags: 'werk, thuis' })).toEqual(['werk', 'thuis']);
  });

  it('strips leading # from list entries', () => {
    expect(extractFrontmatterTags({ tags: ['#werk'] })).toEqual(['werk']);
  });

  it('strips leading # from comma-separated parts', () => {
    expect(extractFrontmatterTags({ tags: '#werk, #thuis' })).toEqual(['werk', 'thuis']);
  });

  it('strips ALL leading #s (Rust trim_start_matches parity; contrast normalizeTagInput)', () => {
    expect(extractFrontmatterTags({ tags: ['##x'] })).toEqual(['x']);
    expect(extractFrontmatterTags({ tags: '##x' })).toEqual(['x']);
  });

  it('drops empty/whitespace-only entries', () => {
    expect(extractFrontmatterTags({ tags: ['werk', '', '   ', '#'] })).toEqual(['werk']);
    expect(extractFrontmatterTags({ tags: 'werk, , #' })).toEqual(['werk']);
  });

  it('drops non-string list items', () => {
    expect(extractFrontmatterTags({ tags: ['werk', 42, null, true, { a: 1 }] })).toEqual(['werk']);
  });

  it('returns [] when the tags key is missing', () => {
    expect(extractFrontmatterTags({ other: 'x' })).toEqual([]);
  });

  it('returns [] for null/undefined/non-object frontmatter', () => {
    expect(extractFrontmatterTags(null)).toEqual([]);
    expect(extractFrontmatterTags(undefined)).toEqual([]);
    expect(extractFrontmatterTags('not an object')).toEqual([]);
    expect(extractFrontmatterTags(42)).toEqual([]);
    expect(extractFrontmatterTags(['a', 'b'])).toEqual([]);
  });

  it('returns [] when tags is a number', () => {
    expect(extractFrontmatterTags({ tags: 42 })).toEqual([]);
  });
});

describe('inheritTagsOverride', () => {
  it('true', () => {
    expect(inheritTagsOverride({ annado_inherit_tags: true })).toBe(true);
  });

  it('false', () => {
    expect(inheritTagsOverride({ annado_inherit_tags: false })).toBe(false);
  });

  it('absent key -> null', () => {
    expect(inheritTagsOverride({ tags: ['a'] })).toBeNull();
  });

  it('non-boolean values -> null', () => {
    expect(inheritTagsOverride({ annado_inherit_tags: 'false' })).toBeNull();
    expect(inheritTagsOverride({ annado_inherit_tags: 1 })).toBeNull();
  });

  it('no frontmatter -> null', () => {
    expect(inheritTagsOverride(null)).toBeNull();
    expect(inheritTagsOverride(undefined)).toBeNull();
  });
});

describe('applyInheritedTags — override matrix (per-note override ?? globalEnabled)', () => {
  const cases: Array<[boolean | null, boolean, boolean]> = [
    [true, true, true],
    [true, false, true],
    [false, true, false],
    [false, false, false],
    [null, true, true],
    [null, false, false],
  ];

  it.each(cases)('override=%s global=%s -> applies=%s', (override, global, applies) => {
    const fm: Record<string, unknown> = { tags: ['projectx'] };
    if (override !== null) fm['annado_inherit_tags'] = override;
    const task = mkTask([]);
    applyInheritedTags([task], fm, global);
    expect(task.inheritedTags).toEqual(applies ? ['projectx'] : []);
  });

  it('mirrors the desktop Meeting.md/OptOut.md scenario', () => {
    const alpha = mkTask([]);
    const beta = mkTask(['werk']);
    applyInheritedTags([alpha, beta], { tags: ['projectx', 'werk'] }, true);
    expect(alpha.inheritedTags).toEqual(['projectx', 'werk']);
    // Own tag wins: the inherited duplicate is dropped (case-insensitive).
    expect(beta.inheritedTags).toEqual(['projectx']);

    const gamma = mkTask([]);
    applyInheritedTags([gamma], { tags: ['uit'], annado_inherit_tags: false }, true);
    expect(gamma.inheritedTags).toEqual([]);
  });
});

describe('applyInheritedTags — dedupe / leave-as-is semantics', () => {
  it('drops an inherited tag that duplicates an own tag case-insensitively (Unicode)', () => {
    const task = mkTask(['ärger']);
    applyInheritedTags([task], { tags: ['Ärger'] }, true);
    expect(task.inheritedTags).toEqual([]);
  });

  it('does NOT dedupe duplicates within the frontmatter itself', () => {
    const task = mkTask([]);
    applyInheritedTags([task], { tags: ['Werk', 'werk'] }, true);
    expect(task.inheritedTags).toEqual(['Werk', 'werk']);
  });

  it('leaves inheritedTags untouched when inheritance is off', () => {
    const task = mkTask([], { inheritedTags: ['sentinel'] });
    applyInheritedTags([task], { tags: ['x'] }, false);
    expect(task.inheritedTags).toEqual(['sentinel']);
  });

  it('leaves inheritedTags untouched when the per-note override is false', () => {
    const task = mkTask([], { inheritedTags: ['sentinel'] });
    applyInheritedTags([task], { tags: ['x'], annado_inherit_tags: false }, true);
    expect(task.inheritedTags).toEqual(['sentinel']);
  });

  it('leaves inheritedTags untouched when frontmatter has no tags', () => {
    const task = mkTask([], { inheritedTags: ['sentinel'] });
    applyInheritedTags([task], {}, true);
    expect(task.inheritedTags).toEqual(['sentinel']);
  });

  it('leaves inheritedTags untouched when there is no frontmatter at all', () => {
    const task = mkTask([], { inheritedTags: ['sentinel'] });
    applyInheritedTags([task], undefined, true);
    expect(task.inheritedTags).toEqual(['sentinel']);
  });
});

describe('removeExcludedTagTasks', () => {
  it('excludes an own tag exactly and its subtree, never a look-alike sibling', () => {
    const exact = mkTask(['werk']);
    const subtag = mkTask(['werk/admin']);
    const sibling = mkTask(['werkplaats']);
    const kept = removeExcludedTagTasks([exact, subtag, sibling], ['werk']);
    expect(kept).toEqual([sibling]);
  });

  it('is case-insensitive, full Unicode', () => {
    const task = mkTask(['WERK']);
    expect(removeExcludedTagTasks([task], ['werk'])).toEqual([]);
  });

  it('excludes by inherited tag alone (own tags clean)', () => {
    const task = mkTask([], { inheritedTags: ['template'] });
    expect(removeExcludedTagTasks([task], ['template'])).toEqual([]);
  });

  it('drops a completed task carrying an excluded tag', () => {
    const task = mkTask(['wachten'], { completed: true, completedDate: '2026-07-01' });
    expect(removeExcludedTagTasks([task], ['wachten'])).toEqual([]);
  });

  it('drops a recurring task carrying an excluded tag', () => {
    const task = mkTask(['wachten'], { recurrence: FIXED_RECURRENCE });
    expect(removeExcludedTagTasks([task], ['wachten'])).toEqual([]);
  });

  it('returns the same array reference, unchanged, when excludedTags is empty', () => {
    const tasks = [mkTask(['werk']), mkTask(['thuis'])];
    expect(removeExcludedTagTasks(tasks, [])).toBe(tasks);
  });

  it('applies multiple excluded tags', () => {
    const a = mkTask(['werk']);
    const b = mkTask(['thuis']);
    const c = mkTask(['prive']);
    expect(removeExcludedTagTasks([a, b, c], ['werk', 'thuis'])).toEqual([c]);
  });
});

describe('allTaskTags', () => {
  it('concatenates own and inherited tags', () => {
    expect(allTaskTags(mkTask(['werk'], { inheritedTags: ['projectx'] }))).toEqual(['werk', 'projectx']);
  });

  it('handles both empty', () => {
    expect(allTaskTags(mkTask([]))).toEqual([]);
  });
});

describe('normalizeTagInput', () => {
  it('trims whitespace', () => {
    expect(normalizeTagInput('  werk  ')).toBe('werk');
  });

  it('strips one leading #', () => {
    expect(normalizeTagInput('#werk')).toBe('werk');
  });

  it('strips exactly ONE leading # (desktop TS parity; contrast extractFrontmatterTags)', () => {
    expect(normalizeTagInput('##x')).toBe('#x');
  });

  it('leaves a bare word untouched', () => {
    expect(normalizeTagInput('werk')).toBe('werk');
  });
});

describe('validateExcludedTagInput (settings UI guard, Task 4)', () => {
  it('ok: normalizes and returns the tag, original casing preserved', () => {
    expect(validateExcludedTagInput(' #Werk ', [], '')).toEqual({ outcome: 'ok', tag: 'Werk' });
  });

  it('empty: blank input', () => {
    expect(validateExcludedTagInput('   ', [], '')).toEqual({ outcome: 'empty' });
  });

  it('empty: a bare "#" normalizes to empty', () => {
    expect(validateExcludedTagInput('#', [], '')).toEqual({ outcome: 'empty' });
  });

  it('duplicate: case-insensitive match against the current list', () => {
    expect(validateExcludedTagInput('WERK', ['werk'], '')).toEqual({ outcome: 'duplicate' });
  });

  it('duplicate check runs before the marker check', () => {
    expect(validateExcludedTagInput('task', ['task'], 'task')).toEqual({ outcome: 'duplicate' });
  });

  it('marker: matches a bare marker case-insensitively', () => {
    expect(validateExcludedTagInput('TASK', [], 'task')).toEqual({ outcome: 'marker', marker: 'task' });
  });

  it('marker: matches when the marker setting is stored with a leading #', () => {
    expect(validateExcludedTagInput('task', [], '#task')).toEqual({ outcome: 'marker', marker: 'task' });
  });

  it('marker: matches when the input carries a leading # too', () => {
    expect(validateExcludedTagInput('#task', [], '#task')).toEqual({ outcome: 'marker', marker: 'task' });
  });

  it('marker: an empty marker setting never triggers the guard', () => {
    expect(validateExcludedTagInput('task', [], '')).toEqual({ outcome: 'ok', tag: 'task' });
    expect(validateExcludedTagInput('task', [], '   ')).toEqual({ outcome: 'ok', tag: 'task' });
  });

  it('ok: a tag that is neither a duplicate nor the marker', () => {
    expect(validateExcludedTagInput('personal', ['werk'], 'task')).toEqual({
      outcome: 'ok',
      tag: 'personal',
    });
  });

  it('ok: a subtree of an already-excluded tag is not a duplicate', () => {
    expect(validateExcludedTagInput('werk/admin', ['werk'], '')).toEqual({
      outcome: 'ok',
      tag: 'werk/admin',
    });
  });
});
