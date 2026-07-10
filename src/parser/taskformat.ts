// Task-format dialect layer — port of src-tauri/src/taskformat.rs.
//
// **Read any, write chosen:** each decode* recognizes a field in *all* dialects
// (Annado @markers, Obsidian Tasks emoji, Dataview inline-fields) via one
// alternation regex; each encode* writes the one chosen TaskFormat, falling back
// to the Annado marker where the chosen format can't express a field
// (Obsidian Tasks has no time/duration concept).

import { WhenValue, Recurrence } from './types';
import { parseDurationStr, formatDuration } from './duration';
import { parseRule, formatRule } from './recurrence';
import { addDaysISO, isValidISODate } from './dates';

export type TaskFormat = 'annado' | 'obsidian_tasks' | 'dataview';

// ---- Decode regexes: Annado | Obsidian-Tasks emoji | Dataview, one per field ----
// Non-global on purpose: like Rust's Regex::replace, only the first match is consumed.

const WHEN_DECODE =
  /@when\(([^)]+)\)|[⏳🛫]\s*(\d{4}-\d{2}-\d{2})|\[(?:scheduled|start)::\s*([^\]]+)\]/u;
const DUE_DECODE = /@due\(([^)]+)\)|📅\s*(\d{4}-\d{2}-\d{2})|\[due::\s*([^\]]+)\]/u;
const CREATED_DECODE = /@created\(([^)]+)\)|➕\s*(\d{4}-\d{2}-\d{2})|\[created::\s*([^\]]+)\]/u;
const COMPLETED_DECODE =
  /@completed\(([^)]+)\)|✅\s*(\d{4}-\d{2}-\d{2})|\[completion::\s*([^\]]+)\]/u;
const PRIORITY_DECODE = /!\(([1-3])\)|(⏫|🔼|🔽|🔺|⏬)|\[priority::\s*(high|medium|low)\]/u;
// The emoji rule runs until the next marker/special char (no closing delimiter).
const REPEAT_DECODE =
  /@repeat\(([^)]+)\)|🔁\s*([^📅⏳🛫➕✅🔁⏫🔼🔽🔺⏬[\]#@\n]+)|\[repeat::\s*([^\]]+)\]/u;
// No emoji for time/duration (Obsidian Tasks has no concept); Annado + Dataview only.
const DURATION_DECODE = /@duration\(([^)]+)\)|\[duration::\s*([^\]]+)\]/u;
const TIME_DECODE = /@time\(([^)]+)\)|\[time::\s*([^\]]+)\]/u;

export { COMPLETED_DECODE };

function firstGroup(m: RegExpExecArray): string {
  for (let i = 1; i < m.length; i++) {
    const g = m[i];
    if (g !== undefined) return g;
  }
  return '';
}

/** Remove the first regex match from content and trim, like Rust's replace + trim. */
function stripFirst(content: string, re: RegExp): string {
  return content.replace(re, '').trim();
}

// ---- WhenValue helpers (WhenValue::from_str / to_string_value in parser.rs) ----

/** Strict core: null for anything unrecognized (not a keyword, not a valid ISO
 *  date) instead of silently falling back to inbox — callers that need to
 *  distinguish "explicitly inbox" from "unparseable" use this directly. */
export function whenFromStringStrict(s: string, todayISO: string): WhenValue | null {
  switch (s.toLowerCase()) {
    case 'inbox':
      return { kind: 'inbox' };
    case 'today':
      // Convert "today" to an actual date so it doesn't stay "today" forever.
      return { kind: 'date', date: todayISO };
    case 'evening':
      return { kind: 'evening' };
    case 'tomorrow':
      return { kind: 'date', date: addDaysISO(todayISO, 1) };
    case 'anytime':
      return { kind: 'anytime' };
    case 'someday':
      return { kind: 'someday' };
    default:
      return isValidISODate(s) ? { kind: 'date', date: s } : null;
  }
}

export function whenToStringValue(when: WhenValue): string {
  switch (when.kind) {
    case 'inbox':
      return ''; // no @when for inbox
    case 'evening':
      return 'evening';
    case 'anytime':
      return 'anytime';
    case 'someday':
      return 'someday';
    case 'date':
      return when.date;
  }
}

// ---- Decode ----

/** Strip a leftover raw `@when(...)`/emoji/dataview marker from `content`.
 *  Used when the caller has just explicitly set `when` to something other than
 *  inbox: a marker still sitting in the title at that point is by definition one
 *  we couldn't parse, and the user's new value supersedes it — removing the
 *  stale marker here is the user touching that field, so the never-destroy
 *  invariant (leave what we can't parse alone) still holds. */
export function stripWhenMarkers(content: string): string {
  // A title can carry several stale markers (hand-edited markdown); strip them all.
  let out = content;
  while (WHEN_DECODE.test(out)) out = stripFirst(out, WHEN_DECODE);
  return out;
}

/** Strip a leftover raw `@duration(...)`/dataview marker from `content`, for the
 *  same reason as stripWhenMarkers: once durationMinutes is explicitly set, a
 *  stale unparseable marker left in the title is superseded, not preserved. */
export function stripDurationMarkers(content: string): string {
  // A title can carry several stale markers (hand-edited markdown); strip them all.
  let out = content;
  while (DURATION_DECODE.test(out)) out = stripFirst(out, DURATION_DECODE);
  return out;
}

export function decodeWhen(content: string, todayISO: string): [WhenValue, string] {
  const m = WHEN_DECODE.exec(content);
  if (!m) return [{ kind: 'inbox' }, content];
  const when = whenFromStringStrict(firstGroup(m).trim(), todayISO);
  // Unmodeled value: leave the marker in the content so it round-trips verbatim
  // (same invariant as recurrence's raw rules — never destroy what we can't parse).
  if (when === null) return [{ kind: 'inbox' }, content];
  return [when, stripFirst(content, WHEN_DECODE)];
}

function decodeDate(re: RegExp, content: string): [string | null, string] {
  const m = re.exec(content);
  if (!m) return [null, content];
  return [firstGroup(m).trim(), stripFirst(content, re)];
}

export function decodeDue(content: string): [string | null, string] {
  return decodeDate(DUE_DECODE, content);
}
export function decodeCreated(content: string): [string | null, string] {
  return decodeDate(CREATED_DECODE, content);
}
export function decodeCompleted(content: string): [string | null, string] {
  return decodeDate(COMPLETED_DECODE, content);
}

/** Priority: Annado !(1-3), Tasks ⏫/🔼/🔽 with 🔺/⏬ clamped, Dataview words. */
export function decodePriority(content: string): [number | null, string] {
  const m = PRIORITY_DECODE.exec(content);
  if (!m) return [null, content];
  let p: number | null = null;
  if (m[1] !== undefined) {
    p = Number(m[1]);
  } else if (m[2] !== undefined) {
    p = { '⏫': 1, '🔼': 2, '🔽': 3, '🔺': 1, '⏬': 3 }[m[2]] ?? 2;
  } else if (m[3] !== undefined) {
    p = { high: 1, medium: 2, low: 3 }[m[3]] ?? 2;
  }
  return [p, stripFirst(content, PRIORITY_DECODE)];
}

export function decodeRecurrence(content: string): [Recurrence | null, string] {
  const m = REPEAT_DECODE.exec(content);
  if (!m) return [null, content];
  const rec = parseRule(firstGroup(m).trim());
  return [rec, stripFirst(content, REPEAT_DECODE)];
}

export function decodeDuration(content: string): [number | null, string] {
  const m = DURATION_DECODE.exec(content);
  if (!m) return [null, content];
  const mins = parseDurationStr(firstGroup(m));
  // Unmodeled value: leave the marker in the content so it round-trips verbatim
  // (same invariant as recurrence's raw rules — never destroy what we can't parse).
  if (mins === null) return [null, content];
  return [mins, stripFirst(content, DURATION_DECODE)];
}

export function decodeTime(content: string): [string | null, string] {
  const m = TIME_DECODE.exec(content);
  if (!m) return [null, content];
  return [firstGroup(m).trim(), stripFirst(content, TIME_DECODE)];
}

// ---- Encode: emit a field's marker in the chosen format ----

/** Non-date when values can't be expressed as a bare `⏳ <date>`, so under
 *  obsidian_tasks they fall back to the Annado @when(...) marker. */
export function encodeWhen(when: WhenValue, format: TaskFormat): string | null {
  if (when.kind === 'inbox') return null;
  const v = whenToStringValue(when);
  if (v === '') return null;
  switch (format) {
    case 'annado':
      return `@when(${v})`;
    case 'obsidian_tasks':
      return when.kind === 'date' ? `⏳ ${when.date}` : `@when(${v})`;
    case 'dataview':
      return `[scheduled:: ${v}]`;
  }
}

export function encodeDue(deadline: string | null, format: TaskFormat): string | null {
  if (deadline === null) return null;
  switch (format) {
    case 'annado':
      return `@due(${deadline})`;
    case 'obsidian_tasks':
      return `📅 ${deadline}`;
    case 'dataview':
      return `[due:: ${deadline}]`;
  }
}

export function encodeCreated(date: string | null, format: TaskFormat): string | null {
  if (date === null) return null;
  switch (format) {
    case 'annado':
      return `@created(${date})`;
    case 'obsidian_tasks':
      return `➕ ${date}`;
    case 'dataview':
      return `[created:: ${date}]`;
  }
}

export function encodeCompleted(date: string | null, format: TaskFormat): string | null {
  if (date === null) return null;
  switch (format) {
    case 'annado':
      return `@completed(${date})`;
    case 'obsidian_tasks':
      return `✅ ${date}`;
    case 'dataview':
      return `[completion:: ${date}]`;
  }
}

export function encodePriority(priority: number | null, format: TaskFormat): string | null {
  if (priority === null) return null;
  switch (format) {
    case 'annado':
      return `!(${priority})`;
    case 'obsidian_tasks':
      return priority === 1 ? '⏫' : priority === 2 ? '🔼' : '🔽';
    case 'dataview': {
      const word = priority === 1 ? 'high' : priority === 2 ? 'medium' : 'low';
      return `[priority:: ${word}]`;
    }
  }
}

export function encodeRecurrence(rec: Recurrence, format: TaskFormat): string {
  const rule = formatRule(rec);
  switch (format) {
    case 'annado':
      return `@repeat(${rule})`;
    case 'obsidian_tasks':
      return `🔁 ${rule}`;
    case 'dataview':
      return `[repeat:: ${rule}]`;
  }
}

/** Time has no Obsidian-Tasks equivalent → falls back to the Annado marker. */
export function encodeTime(time: string | null, format: TaskFormat): string | null {
  if (time === null) return null;
  return format === 'dataview' ? `[time:: ${time}]` : `@time(${time})`;
}

/** Duration has no Obsidian-Tasks equivalent → falls back to the Annado marker. */
export function encodeDuration(minutes: number | null, format: TaskFormat): string | null {
  if (minutes === null) return null;
  const s = formatDuration(minutes);
  return format === 'dataview' ? `[duration:: ${s}]` : `@duration(${s})`;
}

