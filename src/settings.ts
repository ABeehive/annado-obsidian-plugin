import { TaskFormat } from './parser/taskformat';
import { DEFAULT_PROJECTS_PATTERN } from './parser/parser';

/** One queued shared.json change made on a device where shared.json isn't
 *  reachable (see sharedMirror below): a project/tag color, or a settings
 *  field (excludedTags / inheritFrontmatterTags). Lives here rather than in
 *  data/sharedConfig.ts to avoid an import cycle — sharedConfig already
 *  imports from this module. */
export type PendingSharedEdit =
  | { kind: 'project'; name: string; color: string | null }
  | { kind: 'tag'; name: string; color: string | null }
  | { kind: 'excludedTags'; value: string[] }
  | { kind: 'inheritTags'; value: boolean };

export interface AnnadoSettings {
  /** Folders whose path contains this string are scanned for project files. */
  projectsPattern: string;
  /** Same idea for contacts. */
  personsPattern: string;
  /** Fallback daily-notes location, used only when the vault has no Daily Notes
   *  plugin config (its settings win, same as the desktop app). */
  dailyNotesFolder: string;
  /** Moment.js filename format for daily notes (fallback, see above). */
  dailyNotesFormat: string;
  /** The one format task edits are written in ("read any, write one"). */
  taskFormat: TaskFormat;
  /** Import marker: when set, only checkboxes tagged with it become tasks. */
  taskMarker: string;
  /** Exclusion list, one entry per line: `Archive/` (folder) or `Notes/File.md`. */
  excludedPaths: string[];
  /** When on, a note's frontmatter `tags` are inherited by its tasks (per-note
   *  `annado_inherit_tags` overrides this). Off by default (desktop parity,
   *  settingsSlice.ts:236). */
  inheritFrontmatterTags: boolean;
  /** Tasks carrying any of these tags (own or inherited, subtree match) are
   *  dropped from the index entirely. Stored without a leading '#', original
   *  casing preserved — comparisons are case-insensitive downstream. */
  excludedTags: string[];
  /** Verbatim shared.json text, carried inside data.json because Obsidian Sync
   *  syncs plugin settings but NOT extra files in the plugin folder — so a
   *  phone can resolve the desktop-shared config from this mirror. Written by
   *  the device that can read shared.json; null when integration is off. */
  sharedMirror: string | null;
  /** Edits made on a mirror-only device, waiting for a device that can reach
   *  shared.json to apply them (the relay). */
  pendingSharedEdits: PendingSharedEdit[];
}

export const DEFAULT_SETTINGS: AnnadoSettings = {
  projectsPattern: DEFAULT_PROJECTS_PATTERN,
  personsPattern: 'Persons',
  dailyNotesFolder: '00. Daily Notes',
  dailyNotesFormat: 'YYYY/MM-MMMM/YYYY-MM-DD',
  taskFormat: 'annado',
  taskMarker: '',
  excludedPaths: [],
  inheritFrontmatterTags: false,
  excludedTags: [],
  sharedMirror: null,
  pendingSharedEdits: [],
};

/** Merge a loaded data.json object over the defaults. A handful of fields get
 *  sanitized: data.json is rewritten by Obsidian Sync from other devices (and
 *  possibly other plugin versions), so their shapes can't be trusted the way
 *  the settings tab's own writes can. */
export function mergeSettings(loaded: unknown): AnnadoSettings {
  const raw = (loaded ?? {}) as Record<string, unknown>;
  const merged: AnnadoSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<AnnadoSettings>) };
  merged.inheritFrontmatterTags =
    typeof raw['inheritFrontmatterTags'] === 'boolean'
      ? raw['inheritFrontmatterTags']
      : DEFAULT_SETTINGS.inheritFrontmatterTags;
  const excludedTags = Array.isArray(raw['excludedTags']) ? raw['excludedTags'] : [];
  merged.excludedTags = excludedTags.filter((t: unknown): t is string => typeof t === 'string');
  merged.sharedMirror = typeof raw['sharedMirror'] === 'string' ? raw['sharedMirror'] : null;
  // Migration: fold the 0.3.0 `pendingColorEdits` queue into the generalized
  // `pendingSharedEdits` union. Legacy entries were queued earlier, so they
  // sort first. Both keys can be present mid-migration (e.g. a phone still on
  // 0.3.0 synced a legacy queue after this device already wrote the new key).
  const legacyEdits = Array.isArray(raw['pendingColorEdits']) ? raw['pendingColorEdits'] : [];
  const currentEdits = Array.isArray(raw['pendingSharedEdits']) ? raw['pendingSharedEdits'] : [];
  merged.pendingSharedEdits = [...legacyEdits, ...currentEdits].filter(isValidPendingSharedEdit);
  // Drop the migrated legacy key: the spread above carries every unknown key
  // along (deliberate forward-compat), but this one would be persisted back by
  // saveData(this.settings) and re-folded on the NEXT load — resurrecting
  // edits long after the relay applied them and cleared the queue, potentially
  // clobbering newer desktop-side values.
  delete (merged as unknown as Record<string, unknown>)['pendingColorEdits'];
  return merged;
}

/** Per-kind shape check for a queued edit loaded from data.json — other
 *  devices (and other plugin versions) write this file, so nothing here can
 *  be trusted the way the settings tab's own writes can. Garbage entries are
 *  dropped silently rather than crashing the load. */
function isValidPendingSharedEdit(e: unknown): e is PendingSharedEdit {
  if (typeof e !== 'object' || e === null) return false;
  const rec = e as Record<string, unknown>;
  switch (rec['kind']) {
    case 'project':
    case 'tag':
      return typeof rec['name'] === 'string' && (typeof rec['color'] === 'string' || rec['color'] === null);
    case 'excludedTags':
      return Array.isArray(rec['value']) && rec['value'].every((v): v is string => typeof v === 'string');
    case 'inheritTags':
      return typeof rec['value'] === 'boolean';
    default:
      return false;
  }
}

/** Port of Vault::is_path_excluded — `relative` is a vault-relative path. */
export function isPathExcluded(relative: string, excludedPaths: string[]): boolean {
  for (const pattern of excludedPaths) {
    if (pattern === '') continue;
    if (pattern.endsWith('/')) {
      // 'Archive/' matches the folder's contents and the folder itself,
      // but not 'Archives/…' or 'Archive-2024.md'.
      // The `relative === pattern.slice(0, -1)` arm (bare folder name, no
      // trailing slash) is unreachable via current call sites — they only ever
      // pass file paths. Kept for API completeness / future folder-level callers.
      if (relative.startsWith(pattern) || relative === pattern.slice(0, -1)) {
        return true;
      }
    } else {
      if (relative === pattern) return true;
      if (relative === `${pattern}.md`) return true;
      if (relative.startsWith(`${pattern}/`)) return true;
    }
  }
  return false;
}
