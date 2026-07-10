// Plugin side of the desktop's shared-config contract (see the sync ledger entry
// 2026-07-09-plugin-shared-config-contract and the Part A spec). The file lives at
// `${manifest.dir}/shared.json` (falling back to the legacy hard-coded
// `<configDir>/plugins/annado-mobile/shared.json` — see the path-resolution
// comment below) and is read/written ONLY via the vault adapter — it's under
// .obsidian/, so it is not a vault note and gets no vault events. Pure logic
// here is vitest-tested; the adapter I/O stays thin.
import { App } from 'obsidian';
import { AnnadoSettings, PendingColorEdit } from '../settings';
import { TaskFormat } from '../parser/taskformat';

export interface SharedConfig {
  /** The raw parsed JSON object, kept verbatim for write-back fidelity. */
  raw: Record<string, unknown>;
  projectColors: Record<string, string>;
  tagColors: Record<string, string>;
  /** null = absent or "" (unset) — leave the local setting alone. */
  taskFormat: TaskFormat | null;
  /** null = absent; "" is meaningful (import all checkboxes). */
  taskMarkerTag: string | null;
  /** null = absent; [] is meaningful (exclude nothing). */
  excludedPaths: string[] | null;
}

const TASK_FORMATS: readonly string[] = ['annado', 'obsidian_tasks', 'dataview'];

function stringRecord(v: unknown): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  return out;
}

/** Defensive parse: null for missing/malformed/non-object input; wrong-typed
 *  fields degrade to "absent" instead of failing the whole document. */
export function parseSharedConfig(text: string | null): SharedConfig | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const fmt = raw['taskFormat'];
  const marker = raw['taskMarkerTag'];
  const excluded = raw['excludedPaths'];
  return {
    raw,
    projectColors: stringRecord(raw['projectColors']),
    tagColors: stringRecord(raw['tagColors']),
    taskFormat:
      typeof fmt === 'string' && TASK_FORMATS.includes(fmt) ? (fmt as TaskFormat) : null,
    taskMarkerTag: typeof marker === 'string' ? marker : null,
    excludedPaths: Array.isArray(excluded)
      ? excluded.filter((p): p is string => typeof p === 'string')
      : null,
  };
}

/** Desktop wins: the three shared parser settings override the local ones when
 *  present. Everything else (folder patterns, daily notes, …) stays local. */
export function applySharedToSettings(local: AnnadoSettings, shared: SharedConfig): AnnadoSettings {
  return {
    ...local,
    ...(shared.taskFormat !== null ? { taskFormat: shared.taskFormat } : {}),
    ...(shared.taskMarkerTag !== null ? { taskMarker: shared.taskMarkerTag } : {}),
    ...(shared.excludedPaths !== null ? { excludedPaths: shared.excludedPaths } : {}),
  };
}

/** Produce the JSON text to write after setting (color) or clearing (null) one
 *  entry in a color map. Read-modify-write: preserves schemaVersion and every
 *  field we don't own (including unknown future ones — and the *other* color
 *  map); stamps generatedBy annado-mobile. A missing or malformed source
 *  becomes a minimal valid document. */
function withColorEntry(
  text: string | null,
  mapField: 'projectColors' | 'tagColors',
  key: string,
  color: string | null,
): string {
  const parsed = text === null ? null : parseSharedConfig(text);
  const base: Record<string, unknown> = parsed ? { ...parsed.raw } : { schemaVersion: 1 };
  if (base['schemaVersion'] === undefined) base['schemaVersion'] = 1;
  const colors = stringRecord(base[mapField]);
  if (color === null) delete colors[key];
  else colors[key] = color;
  base[mapField] = colors;
  base['generatedBy'] = 'annado-mobile';
  return JSON.stringify(base, null, 2);
}

/** Set/clear one project's color. Project keys are exact-case basenames. */
export function withProjectColor(text: string | null, name: string, color: string | null): string {
  return withColorEntry(text, 'projectColors', name, color);
}

/** Set/clear one tag's color. Tag keys are lowercase per the contract (the
 *  desktop lowercases on write too, so a color applies to every casing). */
export function withTagColor(text: string | null, name: string, color: string | null): string {
  return withColorEntry(text, 'tagColors', name.toLowerCase(), color);
}

/** Apply a batch of queued color edits to a shared.json text, in order (a later
 *  edit to the same key wins). Idempotent — reapplying a batch to its own
 *  output is a no-op. Used by the mirror device's optimistic update AND the
 *  file device's relay, so both apply edits identically. */
export function applyPendingEdits(text: string, edits: readonly PendingColorEdit[]): string {
  let out = text;
  for (const e of edits) {
    out = e.kind === 'project' ? withProjectColor(out, e.name, e.color) : withTagColor(out, e.name, e.color);
  }
  return out;
}

// ---- Adapter I/O (thin; verified by build + live QA, not unit tests) ----
//
// Path resolution order (primary, then legacy fallback):
//   1. `${manifest.dir}/shared.json` — the plugin's *actual* installed folder.
//      Under a community-store install this happens to equal the legacy path
//      below, but under BRAT the folder is named after the GitHub repo, not
//      the plugin id, so the two diverge.
//   2. `${configDir}/plugins/annado-mobile/shared.json` — the historical
//      hard-coded path. Kept as a fallback because desktop apps already
//      deployed in the wild still write here; dropping it would silently
//      break sync for anyone who hasn't updated the desktop side yet.
// `manifest.dir` is `string | undefined` per the Obsidian API (e.g. missing
// manifest metadata) — when absent, only the legacy path is tried.

/** The plugin's real install folder path, or null when `manifest.dir` is unset. */
export function primarySharedConfigPath(manifestDir: string | undefined): string | null {
  return manifestDir !== undefined ? `${manifestDir}/shared.json` : null;
}

/** The historical hard-coded path, kept for backward-compatible reads/writes. */
export function legacySharedConfigPath(app: App): string {
  return `${app.vault.configDir}/plugins/annado-mobile/shared.json`;
}

async function readAt(app: App, path: string): Promise<string | null> {
  try {
    if (!(await app.vault.adapter.exists(path))) return null;
    return await app.vault.adapter.read(path);
  } catch {
    return null;
  }
}

/** Read the file's text plus the path it was actually found at (primary first,
 *  legacy fallback), or null when absent/unreadable at both locations. Callers
 *  that write back (e.g. `saveProjectColor`) must reuse the returned path so
 *  the write lands wherever the read succeeded, not wherever it defaults to. */
export async function readSharedTextAt(
  app: App,
  manifestDir: string | undefined,
): Promise<{ path: string; text: string } | null> {
  const primary = primarySharedConfigPath(manifestDir);
  if (primary !== null) {
    const text = await readAt(app, primary);
    if (text !== null) return { path: primary, text };
  }
  const legacy = legacySharedConfigPath(app);
  const text = await readAt(app, legacy);
  return text !== null ? { path: legacy, text } : null;
}

/** Read the file's text, or null when absent/unreadable. */
export async function readSharedText(app: App, manifestDir: string | undefined): Promise<string | null> {
  const found = await readSharedTextAt(app, manifestDir);
  return found?.text ?? null;
}

/** mtime of whichever location currently holds the file (primary first, legacy
 *  fallback), or null when neither exists — used by the cheap poll to skip a
 *  full re-read when nothing changed. */
export async function statSharedConfig(
  app: App,
  manifestDir: string | undefined,
): Promise<{ mtime: number } | null> {
  const primary = primarySharedConfigPath(manifestDir);
  if (primary !== null) {
    const stat = await app.vault.adapter.stat(primary).catch(() => null);
    if (stat !== null) return stat;
  }
  return app.vault.adapter.stat(legacySharedConfigPath(app)).catch(() => null);
}
