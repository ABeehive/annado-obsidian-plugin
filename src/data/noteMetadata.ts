// Lazy metadata loading for detail views: frontmatter via metadataCache (free),
// one cachedRead for the project description fallback. No caching layer — a
// detail view opens, one parse happens.
import { App, TFile } from 'obsidian';
import {
  PersonMetadata,
  ProjectMetadata,
  parsePersonMetadata,
  parseProjectMetadata,
} from '../parser/noteMetadata';

export async function loadProjectMetadata(app: App, path: string): Promise<ProjectMetadata | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const cache = app.metadataCache.getFileCache(file);
  const content = await app.vault.cachedRead(file);
  // Slice off the frontmatter block so the first-paragraph fallback never sees it.
  const bodyStart = cache?.frontmatterPosition?.end.offset ?? 0;
  return parseProjectMetadata(cache?.frontmatter ?? null, content.slice(bodyStart));
}

export async function loadPersonMetadata(app: App, path: string): Promise<PersonMetadata | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  return parsePersonMetadata(app.metadataCache.getFileCache(file)?.frontmatter ?? null);
}
