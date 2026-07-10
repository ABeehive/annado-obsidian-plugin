// Task model — a faithful port of the structs in src-tauri/src/parser.rs.
// Field names are camelCase to match the serde(rename_all = "camelCase") wire format
// the desktop app already uses.

export type WhenValue =
  | { kind: 'inbox' }
  | { kind: 'evening' }
  | { kind: 'anytime' }
  | { kind: 'someday' }
  | { kind: 'date'; date: string }; // ISO date YYYY-MM-DD

export interface ChecklistItem {
  title: string;
  completed: boolean;
}

export type IntervalUnit = 'days' | 'weeks' | 'months' | 'years';
export type RecurrenceMode = 'fixed' | 'when_done';

export interface Recurrence {
  interval: number;
  unit: IntervalUnit;
  mode: RecurrenceMode;
  /** Set when the rule is outside the modeled subset (e.g. "every weekday").
   *  When present, the rule round-trips verbatim and is never advanced. */
  raw: string | null;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  when: WhenValue;
  deadline: string | null; // ISO date
  tags: string[];
  checklist: ChecklistItem[];
  completed: boolean;
  completedDate: string | null;
  createdDate: string | null;
  filePath: string;
  lineNumber: number; // 1-based, like the Rust side
  projects: string[];
  indentLevel: number;
  priority: number | null; // 1 = high, 2 = medium, 3 = low
  persons: string[];
  recurrence: Recurrence | null;
  durationMinutes: number | null;
  scheduledTime: string | null; // "HH:MM"
  /** Raw markdown line (no \r) this task was parsed from; identity check for edits. */
  sourceLine: string;
}
