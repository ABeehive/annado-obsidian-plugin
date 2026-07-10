import { TaskFormat } from './parser/taskformat';
import { DEFAULT_PROJECTS_PATTERN } from './parser/parser';

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
}

export const DEFAULT_SETTINGS: AnnadoSettings = {
  projectsPattern: DEFAULT_PROJECTS_PATTERN,
  personsPattern: 'Persons',
  dailyNotesFolder: '00. Daily Notes',
  dailyNotesFormat: 'YYYY/MM-MMMM/YYYY-MM-DD',
  taskFormat: 'annado',
  taskMarker: '',
  excludedPaths: [],
};

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
