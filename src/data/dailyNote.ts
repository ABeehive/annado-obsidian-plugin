// Daily-note resolution — port of get_daily_note_path / ensure_daily_note_exists.
// In an Obsidian vault the Daily Notes plugin settings win; otherwise the
// configurable fallback applies. Uses Obsidian's bundled moment, so the format
// string needs no translation.

import { App, TFile, moment, normalizePath } from 'obsidian';
import { AnnadoSettings } from '../settings';

interface DailyNotesConfig {
  folder?: string;
  format?: string;
}

async function readDailyNotesConfig(app: App): Promise<DailyNotesConfig | null> {
  try {
    const raw = await app.vault.adapter.read(`${app.vault.configDir}/daily-notes.json`);
    return JSON.parse(raw) as DailyNotesConfig;
  } catch {
    return null;
  }
}

export async function getDailyNotePath(
  app: App,
  settings: AnnadoSettings,
  date: Date,
): Promise<string> {
  const cfg = await readDailyNotesConfig(app);
  let folder = settings.dailyNotesFolder;
  let format = settings.dailyNotesFormat;
  // Same rule as the desktop app: Obsidian's config wins when it has a format.
  if (cfg && cfg.format) {
    folder = (cfg.folder ?? '').replace(/\/+$/, '');
    format = cfg.format;
  }
  const datePath = moment(date).format(format);
  return normalizePath(folder ? `${folder}/${datePath}.md` : `${datePath}.md`);
}

/** Get the daily note file, creating it (and its folders) with the same
 *  skeleton the desktop app writes if it doesn't exist yet. */
export async function ensureDailyNote(app: App, path: string, date: Date): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;

  // Create parent folders one segment at a time (createFolder is not
  // guaranteed to be recursive on all platforms).
  const segments = path.split('/').slice(0, -1);
  let dir = '';
  for (const segment of segments) {
    dir = dir === '' ? segment : `${dir}/${segment}`;
    if (!app.vault.getAbstractFileByPath(dir)) {
      try {
        await app.vault.createFolder(dir);
      } catch {
        // Folder may have been created concurrently; the create() below will
        // surface any real problem.
      }
    }
  }

  const m = moment(date);
  const content = `---\ndate: ${m.format('YYYY-MM-DD')}\n---\n\n# ${m.format(
    'dddd, MMMM D, YYYY',
  )}\n\n## Tasks\n\n`;
  return app.vault.create(path, content);
}
