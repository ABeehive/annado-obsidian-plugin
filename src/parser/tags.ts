// Tag inheritance & exclusion — port of Vault::frontmatter_tags,
// Vault::annado_inherit_tags_override, apply_inherited_tags and
// remove_excluded_tag_tasks in src-tauri/src/vault.rs (~lines 197-232, 590-629).
// tagMatchesFilter/tagsMatchFilter also live here (moved from views/ui.ts,
// which now just re-exports them) since exclusion reuses the same
// case-insensitive subtree-match rule.

import { Task } from './types';
import { asRecord } from './noteMetadata';
import { normalizeMarker } from './parser';

/** A task tag matches a (possibly parent) filter tag if it IS that tag or a nested
 *  descendant (`filter/…`). Case-insensitive. `#inbox` matches `#inbox/to-read`
 *  but not `#inboxed`. */
export function tagMatchesFilter(taskTag: string, filterTag: string): boolean {
  const t = taskTag.toLowerCase();
  const f = filterTag.toLowerCase();
  return t === f || t.startsWith(f + '/');
}

export function tagsMatchFilter(tags: string[], filterTag: string): boolean {
  return tags.some((t) => tagMatchesFilter(t, filterTag));
}

/** Trim, strip ONE leading '#' — port of the desktop TS normalizeTagInput
 *  (src/utils/tags.ts), which strips exactly one. (Used by the settings UI in
 *  a later task.) NB: deliberately differs from cleanTagEntry below, whose
 *  Rust source strips ALL leading '#'s. */
export function normalizeTagInput(s: string): string {
  return s.trim().replace(/^#/, '');
}

/** Outcome of validating a candidate excluded-tag add (settings UI, Task 4).
 *  `marker` on the 'marker' branch is the already-normalized marker, ready to
 *  drop straight into the desktop's guard message. */
export type ExcludedTagValidation =
  | { outcome: 'ok'; tag: string }
  | { outcome: 'empty' }
  | { outcome: 'duplicate' }
  | { outcome: 'marker'; marker: string };

/** Port of the desktop's submitExcludedTag guard (SettingsModal.tsx): normalize
 *  the input, refuse empty, refuse a case-insensitive duplicate of `current`,
 *  refuse the import marker (case-insensitive; `marker` is the raw taskMarker
 *  setting value, possibly '#'-prefixed — normalized the same way normalizeMarker
 *  normalizes it for matching elsewhere). Pure decision only — callers own the
 *  write and any Notice text. */
export function validateExcludedTagInput(
  input: string,
  current: readonly string[],
  marker: string,
): ExcludedTagValidation {
  const tag = normalizeTagInput(input);
  if (tag === '') return { outcome: 'empty' };
  if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) return { outcome: 'duplicate' };
  const normalizedMarker = normalizeMarker(marker);
  if (normalizedMarker !== '' && tag.toLowerCase() === normalizedMarker.toLowerCase()) {
    return { outcome: 'marker', marker: normalizedMarker };
  }
  return { outcome: 'ok', tag };
}

/** Trim + strip ALL leading '#'s (Rust trim_start_matches('#') in
 *  frontmatter_tags); empty → null so callers can drop it. */
function cleanTagEntry(s: string): string | null {
  const t = s.trim().replace(/^#+/, '');
  return t === '' ? null : t;
}

/** Port of Vault::frontmatter_tags (vault.rs:590): frontmatter `tags` may be a
 *  list of strings or one comma-separated string; trim each entry, strip all
 *  leading '#'s (trim_start_matches), drop empties and non-strings. Any other
 *  shape → []. */
export function extractFrontmatterTags(fm: unknown): string[] {
  const record = asRecord(fm);
  if (record === null) return [];
  const value = record['tags'];
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const cleaned = cleanTagEntry(item);
      if (cleaned !== null) out.push(cleaned);
    }
  } else if (typeof value === 'string') {
    for (const part of value.split(',')) {
      const cleaned = cleanTagEntry(part);
      if (cleaned !== null) out.push(cleaned);
    }
  }
  return out;
}

/** Port of Vault::annado_inherit_tags_override (vault.rs:624): reads the
 *  per-note `annado_inherit_tags` frontmatter key; strict boolean or null
 *  (absent / non-boolean / no frontmatter). */
export function inheritTagsOverride(fm: unknown): boolean | null {
  const record = asRecord(fm);
  if (record === null) return null;
  const value = record['annado_inherit_tags'];
  return typeof value === 'boolean' ? value : null;
}

/** Port of apply_inherited_tags (vault.rs:197). Mutates tasks in place:
 *  when inheritance applies (per-note override ?? globalEnabled) and the
 *  frontmatter has tags, set task.inheritedTags to the frontmatter tags
 *  minus any that duplicate an own line-tag (case-insensitive, full Unicode
 *  toLowerCase — deliberate: desktop uses eq_ignore_ascii_case here; full
 *  Unicode is strictly better and matches the exclusion rule; a sync-ledger
 *  note covers the divergence, do NOT "fix" this back to ASCII).
 *  When inheritance is off or there are no frontmatter tags: leave
 *  inheritedTags as-is ([] from construction). Duplicates *within* the
 *  frontmatter are NOT deduped (desktop parity). */
export function applyInheritedTags(tasks: Task[], fm: unknown, globalEnabled: boolean): void {
  const inherit = inheritTagsOverride(fm) ?? globalEnabled;
  if (!inherit) return;
  const fmTags = extractFrontmatterTags(fm);
  if (fmTags.length === 0) return;
  for (const task of tasks) {
    task.inheritedTags = fmTags.filter(
      (ft) => !task.tags.some((t) => t.toLowerCase() === ft.toLowerCase()),
    );
  }
}

/** Port of remove_excluded_tag_tasks (vault.rs:225). Returns the tasks whose
 *  own AND inherited tags all miss every excluded tag (match rule =
 *  tagMatchesFilter: case-insensitive subtree — excluding 'werk' drops
 *  'werk' and 'werk/admin', never 'werkplaats'). Exclusion is total:
 *  completed and recurring tasks are dropped too (no special-casing).
 *  Empty excluded list → return the input array unchanged (same reference is fine). */
export function removeExcludedTagTasks(tasks: Task[], excludedTags: readonly string[]): Task[] {
  if (excludedTags.length === 0) return tasks;
  return tasks.filter(
    (task) => !allTaskTags(task).some((t) => excludedTags.some((ex) => tagMatchesFilter(t, ex))),
  );
}

/** Own + inherited tags, for filtering/counting call-sites. */
export function allTaskTags(task: Pick<Task, 'tags' | 'inheritedTags'>): string[] {
  return [...task.tags, ...task.inheritedTags];
}
