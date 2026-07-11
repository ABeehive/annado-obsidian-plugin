// Visual language ported from the desktop app (src/utils/projectColors.ts,
// src/utils/dates.ts, src/components/TaskItem.tsx). Colors and labels are kept
// identical so the plugin reads as the same product.

// Shared color palette for projects and tags (projectColors.ts).
export const PROJECT_COLORS = [
  '#5C6BC0', // Indigo (default)
  '#E53935', // Red
  '#F5C000', // Yellow
  '#43A047', // Green
  '#1E88E5', // Blue
  '#8E6AC8', // Purple
  '#00ACC1', // Cyan
  '#FF7043', // Deep Orange
  '#78909C', // Blue Grey
  '#EC407A', // Pink
  '#8D6E63', // Brown
  '#26A69A', // Teal
  '#AB47BC', // Violet
  '#FFA726', // Orange
  '#66BB6A', // Light Green
  '#42A5F5', // Light Blue
  '#EF5350', // Coral
  '#7E57C2', // Deep Purple
  '#26C6DA', // Light Cyan
  '#BDBDBD', // Grey
];

export const DEFAULT_ACCENT = '#5C6BC0';

/** Keyed 1 (high) / 2 (medium) / 3 (low). The intersection keeps a plain
 *  `number` index signature (so a `task.priority`-shaped `number | null` can
 *  still be looked up and guarded/asserted as before) while also giving
 *  callers that already hold a `1 | 2 | 3` key — e.g. the priority picker's
 *  `for (const p of [1, 2, 3] as const)` — a non-undefined lookup with no
 *  assertion needed. */
export const PRIORITY_CONFIG: { [priority: number]: { color: string; label: string } } & Record<
  1 | 2 | 3,
  { color: string; label: string }
> = {
  1: { color: '#E53935', label: '!!!' },
  2: { color: '#FB8C00', label: '!!' },
  3: { color: '#5C6BC0', label: '!' },
};

export const VIEW_META = {
  inbox: { label: 'Inbox', icon: 'inbox', color: '#1E88E5' },
  today: { label: 'Today', icon: 'star', color: '#F5C000' },
  upcoming: { label: 'Upcoming', icon: 'calendar', color: '#E53935' },
  projects: { label: 'Projects', icon: 'folder', color: '#5C6BC0' },
  people: { label: 'People', icon: 'users', color: '#00ACC1' },
  tags: { label: 'Tags', icon: 'tag', color: '#8E6AC8' },
} as const;

/** The three views tucked behind the "⋯ More" tab tile. Colours match the desktop
 *  viewIcons; icons are lucide names (swappable). */
export const MORE_VIEWS = {
  anytime: { label: 'Anytime', icon: 'layout-grid', color: '#43A047' },
  someday: { label: 'Someday', icon: 'hourglass', color: '#8E6AC8' },
  logbook: { label: 'Logbook', icon: 'book', color: '#78909C' },
} as const;

export type MainTab = keyof typeof VIEW_META;
export type MoreTab = keyof typeof MORE_VIEWS;
export type AnyTab = MainTab | MoreTab;

/** Metadata for any tab, whether it's a main tile or a More view. */
export function metaFor(tab: AnyTab): { label: string; icon: string; color: string } {
  return tab in VIEW_META ? VIEW_META[tab as MainTab] : MORE_VIEWS[tab as MoreTab];
}

// Shared-config color overrides (shared.json, set by main.ts). Module-level so
// every call site — section headers, tree dots, QuickFind, wikilink chips —
// resolves through one place.
let projectColorOverrides: Record<string, string> = {};
let tagColorOverrides: Record<string, string> = {};

export function setColorOverrides(
  projects: Record<string, string>,
  tags: Record<string, string>,
): void {
  projectColorOverrides = projects;
  tagColorOverrides = tags;
}

/** Desktop-assigned color from shared.json when present; otherwise the stable
 *  name-hash palette color (the pre-sync behaviour). */
export function projectColor(name: string): string {
  const override = projectColorOverrides[name];
  if (override !== undefined) return override;
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  return PROJECT_COLORS[Math.abs(h) % PROJECT_COLORS.length]!;
}

/** Consumer default for tags with no override — the desktop renders those
 *  indigo too (getTagColor's fallback). */
export const DEFAULT_TAG_COLOR = '#5C6BC0';

/** Tag color from shared.json. Port of the desktop's resolveTagColor
 *  (src/utils/projectColors.ts): lowercase lookup, then nested tags inherit
 *  the nearest ancestor's color (`a/b/c` → `a/b` → `a`), then an exact-key
 *  lookup so legacy pre-lowercase keys still resolve, else the default. */
export function tagColor(name: string): string {
  let key = name.toLowerCase();
  for (;;) {
    const c = tagColorOverrides[key];
    if (c !== undefined) return c;
    const slash = key.lastIndexOf('/');
    if (slash < 0) break;
    key = key.slice(0, slash);
  }
  return tagColorOverrides[name] ?? DEFAULT_TAG_COLOR;
}

/** One tint treatment for every tag chip/pill: colored text on a ~12% wash.
 *  Assumes a 6-digit #rrggbb value — all the desktop writes today; anything
 *  else renders the text color with a garbled-but-harmless background. */
export function tintTag(el: HTMLElement, tag: string): void {
  const c = tagColor(tag);
  el.style.color = c;
  el.style.background = `${c}1f`;
}

// ---- Date labels (port of formatWhenDisplay / formatDeadlineCountdown) ----

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Monday-first short weekday labels for the date-picker grid header (distinct
 *  from the Sunday-first SHORT_DAYS used in when-labels). */
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface DayHeading {
  dayNumber: number; // day of month
  dayName: string; // "Tomorrow" or full weekday name
  monthIndex: number; // 0-11, for month-change detection
}

/** Port of getDaySections' per-day label: today → "Today", tomorrow → "Tomorrow", else weekday. */
export function upcomingDayHeading(dateISO: string, todayISO: string): DayHeading {
  const [, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const diff = diffDaysISO(dateISO, todayISO);
  const dayName =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : FULL_DAYS[new Date(isoToUTC(dateISO)).getUTCDay()]!;
  return { dayNumber: d, dayName, monthIndex: m - 1 };
}

export function fullMonthName(monthIndex: number): string {
  return FULL_MONTHS[monthIndex]!;
}

function isoToUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function diffDaysISO(dateISO: string, todayISO: string): number {
  return Math.round((isoToUTC(dateISO) - isoToUTC(todayISO)) / 86400000);
}

/** "Today" / "Tomorrow" / "Fri" / "22 Jun" / "22 Jun 2027" — like the desktop when-pill. */
export function formatWhenLabel(dateISO: string, todayISO: string): string {
  const diff = diffDaysISO(dateISO, todayISO);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const todayYear = Number(todayISO.slice(0, 4));
  if (diff >= 2 && diff <= 6) {
    return SHORT_DAYS[new Date(isoToUTC(dateISO)).getUTCDay()]!;
  }
  if (y === todayYear) {
    return `${d} ${SHORT_MONTHS[m - 1]}`;
  }
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

/** Date label for Logbook groups: "22 Jun" (current year) or "22 Jun 2027". */
export function formatLogDate(dateISO: string, todayISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const sameYear = y === Number(todayISO.slice(0, 4));
  return sameYear ? `${d} ${SHORT_MONTHS[m - 1]}` : `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

export type DeadlineUrgency = 'overdue' | 'urgent' | 'approaching' | 'normal';

export const DEADLINE_URGENCY_COLORS: Record<DeadlineUrgency, string> = {
  overdue: '#e84545',
  urgent: '#e84545',
  approaching: '#e89b45',
  normal: '#8b8fa3',
};

export function deadlineDisplay(deadline: string, todayISO: string): { label: string; color: string } {
  const diff = diffDaysISO(deadline, todayISO);
  const urgency: DeadlineUrgency =
    diff < 0 ? 'overdue' : diff <= 2 ? 'urgent' : diff <= 7 ? 'approaching' : 'normal';
  const label =
    diff < 0 ? 'Overdue' : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `${diff} days left`;
  return { label, color: DEADLINE_URGENCY_COLORS[urgency] };
}

export function formatDurationShort(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

// Wiki-links and markdown links, same pattern as RenderTitleWithLinks.
export const TITLE_LINK_RE = /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)/g;

// ---- Tags: nested matching + tree (port of src/utils/tags.ts + tagTree.ts) ----

// tagMatchesFilter/tagsMatchFilter moved to parser/tags.ts (pure, unit-tested,
// shared with excluded-tags matching); re-exported here so existing view
// call-sites and tests/ui.test.ts keep working unchanged.
export { tagMatchesFilter, tagsMatchFilter } from '../parser/tags';

export interface TagNode {
  name: string; // full path, e.g. "inbox/to-read"
  label: string; // last segment
  count: number; // incomplete tasks matching this node's subtree
  children: TagNode[];
}

/** Build the nested-tag tree from a flat tag list, synthesizing intermediate
 *  parents. Subtree counts come from `openTags` (each incomplete task's tag list):
 *  a task counts once per ancestor it touches (no double-counting). Port of
 *  buildTagTree in src/utils/tagTree.ts. */
export function buildTagTree(tagNames: string[], openTaskTagLists: string[][]): TagNode[] {
  const casing = new Map<string, string>();
  const remember = (fullName: string) => {
    const parts = fullName.split('/');
    for (let i = 0; i < parts.length; i++) {
      const prefixLower = parts.slice(0, i + 1).join('/').toLowerCase();
      if (!casing.has(prefixLower)) casing.set(prefixLower, parts.slice(0, i + 1).join('/'));
    }
  };
  for (const t of tagNames) remember(t);

  const counts = new Map<string, number>();
  for (const tags of openTaskTagLists) {
    const prefixes = new Set<string>();
    for (const tag of tags) {
      const parts = tag.toLowerCase().split('/');
      for (let i = 0; i < parts.length; i++) prefixes.add(parts.slice(0, i + 1).join('/'));
    }
    for (const p of prefixes) counts.set(p, (counts.get(p) ?? 0) + 1);
  }

  const roots: TagNode[] = [];
  const byKey = new Map<string, TagNode>();
  const ensure = (lowerPath: string): TagNode => {
    const existing = byKey.get(lowerPath);
    if (existing) return existing;
    const slash = lowerPath.lastIndexOf('/');
    const name = casing.get(lowerPath) ?? lowerPath;
    const node: TagNode = {
      name,
      label: name.slice(name.lastIndexOf('/') + 1),
      count: counts.get(lowerPath) ?? 0,
      children: [],
    };
    byKey.set(lowerPath, node);
    if (slash < 0) roots.push(node);
    else ensure(lowerPath.slice(0, slash)).children.push(node);
    return node;
  };
  for (const t of tagNames) ensure(t.toLowerCase());

  const sortRec = (nodes: TagNode[]) => {
    nodes.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
