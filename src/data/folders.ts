// Project & person discovery — port of get_all_projects / get_all_persons in
// vault.rs, minus the heavy metadata parsing. Projects also carry their frontmatter
// `up:` parent (project name) so the view can nest them like the desktop sidebar.

import { App, TFile } from 'obsidian';
import { AnnadoSettings, isPathExcluded } from '../settings';
import { parseWikilink } from '../parser/noteMetadata';

export interface FolderItem {
  name: string;
  path: string;
  /** Parent project name from the file's `up:` frontmatter, or null. */
  parentName: string | null;
}

function isHiddenPath(path: string): boolean {
  return path.split('/').some((c) => c.startsWith('.'));
}

function readParent(app: App, path: string): string | null {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const up = app.metadataCache.getFileCache(file)?.frontmatter?.['up'];
  if (up === undefined || up === null) return null;
  const name = parseWikilink(String(up));
  return name === '' ? null : name;
}

/** All .md files under a folder whose path contains `pattern`, excluding the
 *  pattern's own index file. Dedupes by name, keeping the first path found —
 *  files are sorted by path first so that "first" is deterministic regardless
 *  of the vault's (unspecified) file-listing order. Callers re-sort the result
 *  for display, so this internal sort doesn't affect the returned order. */
function collectByPattern(
  app: App,
  pattern: string,
  excludedPaths: string[],
  withParent: boolean,
): FolderItem[] {
  const items: FolderItem[] = [];
  const seen = new Set<string>();
  if (pattern === '') return items;

  const files = [...app.vault.getMarkdownFiles()].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const path = file.path;
    if (isHiddenPath(path)) continue;
    if (isPathExcluded(path, excludedPaths)) continue;

    const parts = path.split('/');
    const folderIdx = parts.findIndex((p) => p.includes(pattern) && !p.endsWith('.md'));
    if (folderIdx === -1) continue;

    const name = file.basename;
    if (name.includes(pattern) || name.startsWith('.')) continue;
    if (name === '' || seen.has(name)) continue;

    seen.add(name);
    items.push({ name, path, parentName: withParent ? readParent(app, path) : null });
  }
  return items;
}

export function getProjects(app: App, settings: AnnadoSettings): FolderItem[] {
  const items = collectByPattern(app, settings.projectsPattern, settings.excludedPaths, true);
  items.sort((a, b) => a.path.localeCompare(b.path)); // hierarchical order
  return items;
}

export function getPersons(app: App, settings: AnnadoSettings): FolderItem[] {
  const items = collectByPattern(app, settings.personsPattern, settings.excludedPaths, false);
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}
