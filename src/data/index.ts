// The in-memory task index: full vault scan + per-file incremental rescans.
// Mirrors Vault::scan in vault.rs, using the Obsidian API (mobile-safe).

import { App, TAbstractFile, TFile } from 'obsidian';
import { Task } from '../parser/types';
import { parseFile, resolveWikilinks, normalizeMarker } from '../parser/parser';
import { todayISO } from '../parser/dates';
import { AnnadoSettings, isPathExcluded } from '../settings';
import { getProjects, getPersons, FolderItem } from './folders';

export class TaskIndex {
  private tasksByFile = new Map<string, Task[]>();
  private sortedCache: Task[] | null = null;
  projects: FolderItem[] = [];
  persons: FolderItem[] = [];
  projectNames = new Set<string>();
  personNames = new Set<string>();

  private changeListeners = new Set<() => void>();

  constructor(
    private app: App,
    private getSettings: () => AnnadoSettings,
  ) {}

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const l of this.changeListeners) l();
  }

  async fullScan(): Promise<void> {
    this.refreshNames();
    this.tasksByFile.clear();
    this.sortedCache = null;
    for (const file of this.app.vault.getMarkdownFiles()) {
      await this.scanFile(file);
    }
    this.emitChange();
  }

  /** Rescan one file (after an edit, ours or Obsidian's). */
  async rescanFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile && file.extension === 'md') {
      // Names are cheap to refresh and a renamed project/person file must
      // re-resolve wikilinks correctly.
      this.refreshNames();
      await this.scanFile(file);
    } else {
      this.tasksByFile.delete(path);
      this.sortedCache = null;
    }
    this.emitChange();
  }

  removeFile(path: string): void {
    this.refreshNames();
    if (this.tasksByFile.delete(path)) {
      this.sortedCache = null;
      this.emitChange();
    }
  }

  handleRename(file: TAbstractFile, oldPath: string): void {
    this.tasksByFile.delete(oldPath);
    this.sortedCache = null;
    if (file instanceof TFile) void this.rescanFile(file.path);
    else this.emitChange();
  }

  /** All tasks in canonical document order (file path, then line number). */
  allTasks(): Task[] {
    if (this.sortedCache) return this.sortedCache;
    const all: Task[] = [];
    for (const tasks of this.tasksByFile.values()) all.push(...tasks);
    all.sort(
      (a, b) => a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber,
    );
    this.sortedCache = all;
    return all;
  }

  private refreshNames(): void {
    const settings = this.getSettings();
    this.projects = getProjects(this.app, settings);
    this.persons = getPersons(this.app, settings);
    this.projectNames = new Set(this.projects.map((p) => p.name));
    this.personNames = new Set(this.persons.map((p) => p.name));
  }

  private async scanFile(file: TFile): Promise<void> {
    const settings = this.getSettings();
    this.tasksByFile.delete(file.path);
    this.sortedCache = null;

    if (isPathExcluded(file.path, settings.excludedPaths)) return;
    if (this.isExcludedByFrontmatter(file)) return;

    const content = await this.app.vault.cachedRead(file);
    const marker = normalizeMarker(settings.taskMarker);
    const tasks = parseFile(content, file.path, todayISO(), marker, settings.projectsPattern);
    resolveWikilinks(tasks, this.personNames, this.projectNames);
    if (tasks.length > 0) this.tasksByFile.set(file.path, tasks);
  }

  private isExcludedByFrontmatter(file: TFile): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return false;
    if (fm['annado_exclude'] === true) return true;
    // Legacy recurring-template files are never tasks (same trio check as vault.rs).
    return 'template_id' in fm && 'recurrence_type' in fm && 'interval_unit' in fm;
  }
}
