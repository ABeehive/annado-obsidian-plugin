import {
  Plugin,
  PluginSettingTab,
  Setting,
  App,
  TFile,
  Notice,
  Platform,
  debounce,
  TextComponent,
} from 'obsidian';
import { AnnadoSettings, DEFAULT_SETTINGS, PendingSharedEdit, mergeSettings } from './settings';
import { TaskIndex } from './data/index';
import { toggleTask, toggleChecklistItem, createTask, updateTask, deleteTask, NewTaskInput, WriteResult } from './data/writer';
import {
  SharedConfig,
  applySharedToSettings,
  parseSharedConfig,
  readSharedText,
  readSharedTextAt,
  statSharedConfig,
  applyPendingEdits,
} from './data/sharedConfig';
import { setColorOverrides } from './views/ui';
import { AnnadoView, VIEW_TYPE_ANNADO } from './views/AnnadoView';
import { Task } from './parser/types';
import { TaskFormat } from './parser/taskformat';
import { validateExcludedTagInput } from './parser/tags';

export default class AnnadoPlugin extends Plugin {
  settings: AnnadoSettings = DEFAULT_SETTINGS;
  index!: TaskIndex;

  /** Parsed shared config (desktop sync), or null when unavailable. */
  shared: SharedConfig | null = null;
  /** Where `shared` came from: the real shared.json ('file'), or the data.json
   *  mirror ('mirror' — this device can't reach the file; Obsidian Sync doesn't
   *  carry extra plugin-folder files to mobile, see settings.sharedMirror). */
  sharedSource: 'file' | 'mirror' | null = null;
  private lastAppliedSharedText: string | null = null;
  private lastSharedMtime: number | null = null;
  private lastDataMtime: number | null = null;

  private refreshViews = debounce(
    () => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ANNADO)) {
        if (leaf.view instanceof AnnadoView) leaf.view.refresh();
      }
    },
    150,
    true,
  );

  /** Local settings with the desktop-shared parser settings applied on top. */
  get effectiveSettings(): AnnadoSettings {
    return this.shared ? applySharedToSettings(this.settings, this.shared) : this.settings;
  }

  /** Push the current shared state into the color layer. */
  private applySharedState(): void {
    setColorOverrides(this.shared?.projectColors ?? {}, this.shared?.tagColors ?? {});
  }

  /** Adopt a shared-config text as current state (malformed keeps the previous
   *  parse — never wipe), remember it for the equality guard, and repaint. */
  private applyResolvedShared(text: string, source: 'file' | 'mirror'): void {
    this.lastAppliedSharedText = text;
    const parsed = parseSharedConfig(text);
    if (parsed !== null) this.shared = parsed;
    this.sharedSource = source;
    this.applySharedState();
    this.refreshViews();
  }

  /** Re-resolve the shared config: from shared.json when readable, else from
   *  the data.json mirror (the phone's path). Content-equality guard: same
   *  text from the same source is a no-op. Malformed content keeps the
   *  previous config (never wipe); nothing at all clears it (back to local
   *  settings + hash colors). A change to any of the three parser settings, or
   *  to shared excludedTags/inheritFrontmatterTags, rescans the index —
   *  color-only changes just re-render. */
  async reloadSharedConfig(): Promise<void> {
    const fileText = await readSharedText(this.app, this.manifest.dir);
    if (fileText === null && this.sharedSource === 'file') {
      // Toggle-off witnessed: only the device that HAD the file and saw it
      // vanish drops the carried state — a mirror device never had the file,
      // so sync delivering the cleared mirror is what turns IT off.
      this.settings.sharedMirror = null;
      this.settings.pendingSharedEdits = [];
      await this.persistSettings();
    }
    const source: 'file' | 'mirror' | null =
      fileText !== null ? 'file' : this.settings.sharedMirror !== null ? 'mirror' : null;
    const text = fileText ?? this.settings.sharedMirror;
    if (text === this.lastAppliedSharedText && source === this.sharedSource) return;
    const before = this.effectiveSettings;
    this.lastAppliedSharedText = text;
    if (text === null) {
      this.shared = null;
      this.sharedSource = null;
      if (this.settings.pendingSharedEdits.length > 0) {
        // Integration is off everywhere we can see — don't hold edits forever.
        this.settings.pendingSharedEdits = [];
        await this.persistSettings();
      }
    } else {
      const parsed = parseSharedConfig(text);
      if (parsed !== null) this.shared = parsed;
      this.sharedSource = source;
      if (source === 'file' && parsed !== null && this.settings.sharedMirror !== text) {
        // Mirror maintenance: carry the (valid) file text to devices that can't
        // read the file. Never enqueues edits, so this can't loop.
        this.settings.sharedMirror = text;
        await this.persistSettings();
      }
    }
    this.applySharedState();
    const after = this.effectiveSettings;
    const parserChanged =
      before.taskFormat !== after.taskFormat ||
      before.taskMarker !== after.taskMarker ||
      before.excludedPaths.join('\n') !== after.excludedPaths.join('\n') ||
      before.excludedTags.join('\n') !== after.excludedTags.join('\n') ||
      before.inheritFrontmatterTags !== after.inheritFrontmatterTags;
    if (parserChanged && this.index !== undefined) await this.index.fullScan();
    else this.refreshViews();
  }

  /** Obsidian never tells a plugin when Sync rewrites its data.json — detect
   *  it by mtime and re-ingest (fresh mirror, arrived or cleared pending
   *  edits, possibly changed settings). Our own writes are suppressed via
   *  trackDataMtime after every persistSettings. */
  private async pollDataJson(): Promise<void> {
    const path = this.dataJsonPath();
    if (path === null) return;
    const stat = await this.app.vault.adapter.stat(path).catch(() => null);
    const mtime = stat?.mtime ?? null;
    if (mtime === this.lastDataMtime) return;
    this.lastDataMtime = mtime;
    await this.loadSettings(); // authoritative: last write (another device) wins
    await this.reloadSharedConfig();
    this.requestRescan(); // an external change can carry parser-relevant settings
    this.refreshViews();
  }

  /** The 30s heartbeat: ingest synced settings first (fresh mirror / queue),
   *  then external shared.json changes, then relay any queued edits. */
  private async pollSharedConfig(): Promise<void> {
    await this.pollDataJson();
    const stat = await statSharedConfig(this.app, this.manifest.dir);
    const mtime = stat?.mtime ?? null;
    if (mtime !== this.lastSharedMtime) {
      this.lastSharedMtime = mtime;
      await this.reloadSharedConfig();
    }
    await this.relayPendingEdits();
  }

  /** Write shared.json (read-modify-write output) at the path the read found,
   *  keep the poll guards and the mirror in step, and adopt the new state.
   *  Callers reach this only after readSharedTextAt succeeded — the plugin
   *  still never CREATES the file (hardened contract). Caller persists. */
  private async writeSharedFile(path: string, next: string): Promise<void> {
    // Write back to whichever path the read succeeded on (primary or legacy)
    // so we never fork the file into two locations.
    await this.app.vault.adapter.write(path, next);
    // Re-stat the path we just wrote (same call statSharedConfig makes) so the
    // next 30s poll sees our own mtime and doesn't do a wasted extra read.
    const stat = await this.app.vault.adapter.stat(path).catch(() => null);
    this.lastSharedMtime = stat?.mtime ?? null;
    this.settings.sharedMirror = next;
    this.applyResolvedShared(next, 'file');
  }

  /** One shared-config change from the UI (a color, or a synced setting like
   *  excludedTags/inheritFrontmatterTags), routed by what this device can
   *  reach: shared.json present → write it directly (the desktop picks it
   *  up); mirror only → apply optimistically and queue for the relay; neither
   *  → for a color edit there's nothing to sync a color INTO, so that's a
   *  Notice; for a settings edit, standalone (no desktop integration) is a
   *  legitimate mode, so it's a silent no-op — the setting just stays
   *  local-only (Task 4's settings UI relies on this). */
  async saveSharedEdit(edit: PendingSharedEdit): Promise<void> {
    const isColor = edit.kind === 'project' || edit.kind === 'tag';
    try {
      const found = await readSharedTextAt(this.app, this.manifest.dir);
      if (found !== null) {
        await this.writeSharedFile(found.path, applyPendingEdits(found.text, [edit]));
        await this.persistSettings(); // the mirror changed along with the file
      } else if (this.settings.sharedMirror !== null) {
        this.settings.sharedMirror = applyPendingEdits(this.settings.sharedMirror, [edit]);
        this.settings.pendingSharedEdits.push(edit);
        await this.persistSettings();
        this.applyResolvedShared(this.settings.sharedMirror, 'mirror');
      } else if (isColor) {
        // Hardened contract: no file and no mirror = integration off — never
        // create the file from the plugin side (the desktop deletes it when
        // the toggle goes off).
        new Notice('Color sync is off — enable the vault toggle in the desktop app.');
      }
    } catch {
      if (isColor) new Notice(`Could not save the ${edit.kind} color.`);
      else new Notice('Could not save the setting.');
    }
  }

  async saveProjectColor(name: string, color: string | null): Promise<void> {
    await this.saveSharedEdit({ kind: 'project', name, color });
  }

  async saveTagColor(name: string, color: string | null): Promise<void> {
    await this.saveSharedEdit({ kind: 'tag', name, color });
  }

  /** Settings-tab write for the excluded-tags list: persist locally (rescans),
   *  then route to shared.json/mirror when reachable — saveSharedEdit no-ops
   *  silently for a settings-kind edit when standalone (no file, no mirror),
   *  so nothing extra is needed here for that case. */
  async saveExcludedTags(next: string[]): Promise<void> {
    this.settings.excludedTags = next;
    await this.saveSettings();
    await this.saveSharedEdit({ kind: 'excludedTags', value: next });
  }

  /** Settings-tab write for the inherit-frontmatter-tags toggle. Same
   *  local-then-shared pattern as saveExcludedTags above. */
  async saveInheritFrontmatterTags(enabled: boolean): Promise<void> {
    this.settings.inheritFrontmatterTags = enabled;
    await this.saveSettings();
    await this.saveSharedEdit({ kind: 'inheritTags', value: enabled });
  }

  /** File-device half of the relay: apply edits queued on mirror devices
   *  (delivered via data.json sync) to shared.json, then clear the queue.
   *  Write first, clear after — a failed write must keep the queue so the
   *  next poll retries. */
  private async relayPendingEdits(): Promise<void> {
    if (this.settings.pendingSharedEdits.length === 0) return;
    try {
      const found = await readSharedTextAt(this.app, this.manifest.dir);
      if (found === null) return; // mirror device: keep the queue for the relay
      const next = applyPendingEdits(found.text, this.settings.pendingSharedEdits);
      if (next !== found.text) await this.writeSharedFile(found.path, next);
      this.settings.pendingSharedEdits = [];
      await this.persistSettings(); // clears the queue even when apply was a no-op
    } catch {
      // Keep the queue; retried on the next poll.
    }
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.trackDataMtime(); // baseline for external data.json detection
    await this.reloadSharedConfig(); // shared state ready before the first scan
    await this.relayPendingEdits(); // edits that synced in while Obsidian was closed
    this.applySharedState(); // unconditional: overrides reflect `shared` even when reload short-circuits
    this.index = new TaskIndex(this.app, () => this.effectiveSettings);
    this.index.onChange(() => this.refreshViews());

    this.registerView(VIEW_TYPE_ANNADO, (leaf) => new AnnadoView(leaf, this));
    this.addRibbonIcon('list-checks', 'Open Annado', () => void this.activateView());
    this.addCommand({
      id: 'open-view',
      name: 'Open Annado',
      callback: () => void this.activateView('tab'),
    });
    this.addCommand({
      id: 'open-view-sidebar',
      name: 'Open Annado in sidebar',
      // Desktop-only: on mobile the "sidebar" is a drawer — the full view wins.
      checkCallback: (checking) => {
        if (Platform.isMobile) return false;
        if (!checking) void this.activateView('sidebar');
        return true;
      },
    });
    this.addCommand({
      id: 'quick-find',
      name: 'Quick find',
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_ANNADO)[0];
        if (leaf) await leaf.loadIfDeferred();
        const view = leaf?.view;
        if (view instanceof AnnadoView) view.openQuickFind();
      },
    });
    this.addSettingTab(new AnnadoSettingTab(this.app, this));

    // Scan once the vault is fully loaded, then keep the index incremental.
    this.app.workspace.onLayoutReady(() => {
      void this.index.fullScan().then(() => {
        this.registerEvent(
          this.app.vault.on('modify', (f) => {
            if (f instanceof TFile && f.extension === 'md') void this.index.rescanFile(f.path);
          }),
        );
        this.registerEvent(
          // getFileCache can lag a rapid edit; 'changed' fires once Obsidian's
          // cache is updated, so a frontmatter-only edit reliably rescans with
          // fresh frontmatter. Same rescan the 'modify' handler above uses —
          // the resulting double rescan per edit is cheap and idempotent.
          this.app.metadataCache.on('changed', (f) => {
            if (f.extension === 'md') void this.index.rescanFile(f.path);
          }),
        );
        this.registerEvent(
          this.app.vault.on('create', (f) => {
            if (f instanceof TFile && f.extension === 'md') void this.index.rescanFile(f.path);
          }),
        );
        this.registerEvent(this.app.vault.on('delete', (f) => this.index.removeFile(f.path)));
        this.registerEvent(
          this.app.vault.on('rename', (f, oldPath) => this.index.handleRename(f, oldPath)),
        );
      });
    });

    this.registerInterval(window.setInterval(() => void this.pollSharedConfig(), 30_000));
  }

  onunload(): void {
    // A settings save right before unload leaves this pending ~500ms out;
    // without cancelling it, it would fire after the plugin instance is gone.
    this.requestRescan.cancel();
  }

  /** Open the Annado view. Without a `location`, an existing instance is
   *  revealed wherever it lives (ribbon / Quick Find never move it); with one,
   *  the view is forced to that side — an instance living on the other side is
   *  moved by recreating it. `sidebar` = the right sidebar (desktop). */
  async activateView(location?: 'tab' | 'sidebar'): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_ANNADO)[0];
    if (existing) {
      const inSidebar = existing.getRoot() !== this.app.workspace.rootSplit;
      if (location === undefined || (location === 'sidebar') === inSidebar) {
        await this.app.workspace.revealLeaf(existing);
        return;
      }
      existing.detach(); // move to the requested side by recreating below
    }
    const leaf =
      location === 'sidebar' ? this.app.workspace.getRightLeaf(false) : this.app.workspace.getLeaf(true);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_ANNADO, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async toggleTask(task: Task, complete: boolean): Promise<WriteResult> {
    return toggleTask(this.app, this.index, this.effectiveSettings, task, complete);
  }

  async toggleChecklistItem(task: Task, itemIndex: number): Promise<WriteResult> {
    return toggleChecklistItem(this.app, this.index, this.effectiveSettings, task, itemIndex);
  }

  async createTask(input: NewTaskInput): Promise<Task> {
    return createTask(this.app, this.index, this.effectiveSettings, input);
  }

  async updateTask(task: Task): Promise<WriteResult> {
    return updateTask(this.app, this.index, this.effectiveSettings, task);
  }

  async deleteTask(task: Task): Promise<WriteResult> {
    return deleteTask(this.app, this.index, this.effectiveSettings, task);
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  private dataJsonPath(): string | null {
    return this.manifest.dir !== undefined ? `${this.manifest.dir}/data.json` : null;
  }

  /** Remember our own data.json mtime so pollDataJson only reacts to writes
   *  made by Obsidian Sync (i.e. by other devices). */
  private async trackDataMtime(): Promise<void> {
    const path = this.dataJsonPath();
    const stat = path === null ? null : await this.app.vault.adapter.stat(path).catch(() => null);
    this.lastDataMtime = stat?.mtime ?? null;
  }

  /** Write settings without the settings-tab rescan — the sync-plumbing paths
   *  (mirror maintenance, queue changes) don't alter what gets parsed locally. */
  private async persistSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.trackDataMtime();
  }

  private requestRescan = debounce(() => void this.index.fullScan(), 500, true);

  async saveSettings(): Promise<void> {
    await this.persistSettings();
    this.requestRescan(); // full scan only after the user stops typing
  }
}

class AnnadoSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: AnnadoPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Projects folder pattern')
      .setDesc('Folders whose path contains this string are scanned for project files.')
      .addText((t) =>
        t.setValue(this.plugin.settings.projectsPattern).onChange(async (v) => {
          this.plugin.settings.projectsPattern = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Persons folder pattern')
      .setDesc('Same idea, for contacts.')
      .addText((t) =>
        t.setValue(this.plugin.settings.personsPattern).onChange(async (v) => {
          this.plugin.settings.personsPattern = v;
          await this.plugin.saveSettings();
        }),
      );

    const fmtSetting = new Setting(containerEl)
      .setName('Task format')
      .setDesc('The format new edits are written in. Reading understands all three.')
      .addDropdown((d) =>
        d
          .addOptions({
            annado: 'Annado (@when, @due, …)',
            obsidian_tasks: 'Obsidian Tasks (emoji)',
            dataview: 'Dataview ([field:: …])',
          })
          .setValue(this.plugin.effectiveSettings.taskFormat)
          .onChange(async (v) => {
            this.plugin.settings.taskFormat = v as TaskFormat;
            await this.plugin.saveSettings();
          }),
      );
    if (this.plugin.shared?.taskFormat != null) {
      fmtSetting.setDesc('Synced from the Annado desktop app (shared.json) — change it there.');
      fmtSetting.setDisabled(true);
    }

    const markerSetting = new Setting(containerEl)
      .setName('Import marker')
      .setDesc(
        'Optional tag (e.g. #task). When set, only checkboxes carrying it are treated as tasks — must match the desktop app’s setting.',
      )
      .addText((t) =>
        t.setValue(this.plugin.effectiveSettings.taskMarker).onChange(async (v) => {
          this.plugin.settings.taskMarker = v;
          await this.plugin.saveSettings();
        }),
      );
    if (this.plugin.shared?.taskMarkerTag != null) {
      markerSetting.setDesc('Synced from the Annado desktop app (shared.json) — change it there.');
      markerSetting.setDisabled(true);
    }

    new Setting(containerEl).setName('Daily notes (fallback)').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Only used when the Daily Notes core plugin has no configuration — its settings always win.',
    });

    new Setting(containerEl).setName('Folder').addText((t) =>
      t.setValue(this.plugin.settings.dailyNotesFolder).onChange(async (v) => {
        this.plugin.settings.dailyNotesFolder = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl)
      .setName('Filename format')
      .setDesc('Moment.js format, e.g. YYYY/MM-MMMM/YYYY-MM-DD')
      .addText((t) =>
        t.setValue(this.plugin.settings.dailyNotesFormat).onChange(async (v) => {
          this.plugin.settings.dailyNotesFormat = v;
          await this.plugin.saveSettings();
        }),
      );

    const excludedSetting = new Setting(containerEl)
      .setName('Excluded paths')
      .setDesc('One per line. "Archive/" excludes a folder, otherwise a single file.')
      .addTextArea((t) =>
        t
          .setValue(this.plugin.effectiveSettings.excludedPaths.join('\n'))
          .onChange(async (v) => {
            this.plugin.settings.excludedPaths = v
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s !== '');
            await this.plugin.saveSettings();
          }),
      );
    if (this.plugin.shared?.excludedPaths != null) {
      excludedSetting.setDesc('Synced from the Annado desktop app (shared.json) — change it there.');
      excludedSetting.setDisabled(true);
    }

    // Two-way, unlike the settings above: this is never disabled even when
    // shared config is present — see saveInheritFrontmatterTags/saveExcludedTags.
    new Setting(containerEl)
      .setName('Show frontmatter tags on tasks')
      .setDesc(
        'When on, a note’s frontmatter tags apply to its tasks too (a note can override with ' +
          'annado_inherit_tags: true/false in its own frontmatter). Syncs with the Annado desktop ' +
          'app when shared config is present.',
      )
      .addToggle((t) =>
        t.setValue(this.plugin.effectiveSettings.inheritFrontmatterTags).onChange(async (v) => {
          await this.plugin.saveInheritFrontmatterTags(v);
        }),
      );

    new Setting(containerEl).setName('Excluded tags').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text:
        'Tasks carrying any of these tags — their own, or inherited from the note’s frontmatter — are ' +
        'hidden everywhere in the plugin (excluding a tag also excludes its subtree). Syncs with the ' +
        'Annado desktop app when shared config is present.',
    });

    for (const tag of this.plugin.effectiveSettings.excludedTags) {
      new Setting(containerEl)
        .setName(`#${tag}`)
        .addExtraButton((b) =>
          b
            .setIcon('x')
            .setTooltip('Remove')
            .onClick(async () => {
              await this.plugin.saveExcludedTags(
                this.plugin.effectiveSettings.excludedTags.filter((t) => t !== tag),
              );
              this.display();
            }),
        );
    }

    let excludedTagInput: TextComponent;
    const submitExcludedTag = async (): Promise<void> => {
      const result = validateExcludedTagInput(
        excludedTagInput.getValue(),
        this.plugin.effectiveSettings.excludedTags,
        this.plugin.effectiveSettings.taskMarker,
      );
      switch (result.outcome) {
        case 'empty':
          return;
        case 'duplicate':
          new Notice('That tag is already excluded.');
          return;
        case 'marker':
          new Notice(`#${result.marker} is your import marker — excluding it would hide every task.`);
          return;
        case 'ok':
          await this.plugin.saveExcludedTags([...this.plugin.effectiveSettings.excludedTags, result.tag]);
          this.display();
      }
    };
    new Setting(containerEl)
      .addText((t) => {
        excludedTagInput = t;
        t.setPlaceholder('personal');
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submitExcludedTag();
          }
        });
      })
      .addButton((b) => b.setButtonText('Add').onClick(() => void submitExcludedTag()));
  }
}
