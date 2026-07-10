import { Plugin, PluginSettingTab, Setting, App, TFile, Notice, Platform, apiVersion, debounce } from 'obsidian';
import { AnnadoSettings, DEFAULT_SETTINGS } from './settings';
import { TaskIndex } from './data/index';
import { toggleTask, toggleChecklistItem, createTask, updateTask, deleteTask, NewTaskInput, WriteResult } from './data/writer';
import {
  SharedConfig,
  applySharedToSettings,
  parseSharedConfig,
  readSharedText,
  readSharedTextAt,
  statSharedConfig,
  withProjectColor,
} from './data/sharedConfig';
import { setColorOverrides } from './views/ui';
import { AnnadoView, VIEW_TYPE_ANNADO } from './views/AnnadoView';
import { Task } from './parser/types';
import { TaskFormat } from './parser/taskformat';

export default class AnnadoPlugin extends Plugin {
  settings: AnnadoSettings = DEFAULT_SETTINGS;
  index!: TaskIndex;

  /** Parsed shared.json (desktop sync), or null when absent. */
  shared: SharedConfig | null = null;
  private lastSharedText: string | null = null;
  private lastSharedMtime: number | null = null;

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

  /** Re-read shared.json. Content-equality guard: identical text is a no-op.
   *  Malformed content keeps the previous config (never wipe); an absent file
   *  clears it (back to local settings + hash colors). A change to any of the
   *  three parser settings rescans the index; color-only changes just re-render. */
  async reloadSharedConfig(): Promise<void> {
    const text = await readSharedText(this.app, this.manifest.dir);
    if (text === this.lastSharedText) return;
    const before = this.effectiveSettings;
    this.lastSharedText = text;
    if (text === null) {
      this.shared = null;
    } else {
      const parsed = parseSharedConfig(text);
      if (parsed !== null) this.shared = parsed;
    }
    this.applySharedState();
    const after = this.effectiveSettings;
    const parserChanged =
      before.taskFormat !== after.taskFormat ||
      before.taskMarker !== after.taskMarker ||
      before.excludedPaths.join('\n') !== after.excludedPaths.join('\n');
    if (parserChanged && this.index !== undefined) await this.index.fullScan();
    else this.refreshViews();
  }

  /** Cheap mtime check so the 30s poll doesn't re-read unchanged content. */
  private async pollSharedConfig(): Promise<void> {
    const stat = await statSharedConfig(this.app, this.manifest.dir);
    const mtime = stat?.mtime ?? null;
    if (mtime === this.lastSharedMtime) return;
    this.lastSharedMtime = mtime;
    await this.reloadSharedConfig();
  }

  /** Write one project color to shared.json (read-modify-write per the desktop
   *  contract) and apply it locally. Last-write-wins; the desktop picks it up. */
  async saveProjectColor(name: string, color: string | null): Promise<void> {
    try {
      const found = await readSharedTextAt(this.app, this.manifest.dir);
      if (found === null) {
        // Hardened contract: file absent = integration off — never create it
        // from the plugin side (the desktop deletes it when the toggle goes off).
        new Notice('Color sync is off — enable the vault toggle in the desktop app.');
        return;
      }
      const next = withProjectColor(found.text, name, color);
      // Write back to whichever path the read succeeded on (primary or legacy)
      // so we never fork the file into two locations.
      await this.app.vault.adapter.write(found.path, next);
      this.lastSharedText = next; // our own write: don't re-apply it via the poll
      // Re-stat the path we just wrote (same call statSharedConfig makes) so the
      // next 30s poll sees our own mtime and doesn't do a wasted extra read.
      const stat = await this.app.vault.adapter.stat(found.path).catch(() => null);
      this.lastSharedMtime = stat?.mtime ?? null;
      this.shared = parseSharedConfig(next);
      this.applySharedState();
      this.refreshViews();
    } catch {
      new Notice('Could not save the project color.');
    }
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.reloadSharedConfig(); // shared state ready before the first scan
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
    // TEMPORARY (remove after the mobile scroll diagnosis): dumps the live
    // layout numbers to a vault note so the phone's rendering can be read back
    // on the desk via sync — Obsidian iOS has no inspectable webview.
    this.addCommand({
      id: 'layout-debug',
      name: 'Layout debug (tijdelijk)',
      callback: () => void this.writeLayoutDebug(),
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

  /** TEMPORARY (see the layout-debug command): write the numbers we can't see
   *  on the phone into a note that syncs back to the desk. Read-only DOM
   *  inspection + one vault write; safe to run anywhere. */
  private async writeLayoutDebug(): Promise<void> {
    const lines: string[] = [
      `plugin: ${this.manifest.version}`,
      `obsidian api: ${apiVersion}`,
      `platform: phone=${Platform.isPhone} mobile=${Platform.isMobile} iosApp=${Platform.isIosApp}`,
      `userAgent: ${navigator.userAgent}`,
      `body classes: ${document.body.className}`,
    ];
    // Undocumented but stable internals; degrade to 'n/a' rather than throw.
    const customCss = (this.app as unknown as { customCss?: { theme?: string; enabledSnippets?: Iterable<string> } }).customCss;
    lines.push(`theme: ${customCss?.theme || '(default)'}`);
    lines.push(`snippets: ${customCss?.enabledSnippets ? [...customCss.enabledSnippets].join(', ') || '(none)' : 'n/a'}`);

    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_ANNADO)[0];
    const view = leaf?.view;
    if (view instanceof AnnadoView) {
      const content = view.contentEl;
      const cs = getComputedStyle(content);
      lines.push(
        '',
        `contentEl classes: ${content.className}`,
        `contentEl computed: display=${cs.display} overflow=${cs.overflow} height=${cs.height}`,
        `--annado-primary resolves to: "${cs.getPropertyValue('--annado-primary').trim() || '(EMPTY)'}"`,
      );
      const body = content.querySelector('.annado-body');
      if (body instanceof HTMLElement) {
        const bs = getComputedStyle(body);
        lines.push(
          `annado-body: clientHeight=${body.clientHeight} scrollHeight=${body.scrollHeight} ` +
            `overflow-y=${bs.overflowY} touch-action=${bs.touchAction}`,
          `scrollable: ${body.scrollHeight > body.clientHeight}`,
        );
        let el: HTMLElement | null = body;
        for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
          lines.push(
            `  up${depth}: <${el.tagName.toLowerCase()} class="${el.className}"> offsetHeight=${el.offsetHeight}`,
          );
        }
      } else {
        lines.push('annado-body: NOT FOUND');
      }
    } else {
      lines.push('', 'Annado view is not open — open it first, then rerun this command.');
    }

    const text = '```\n' + lines.join('\n') + '\n```\n';
    const path = 'Annado Debug.md';
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.process(existing, () => text);
    else await this.app.vault.create(path, text);
    new Notice('Annado debug weggeschreven');
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
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) ?? {}) };
  }

  private requestRescan = debounce(() => void this.index.fullScan(), 500, true);

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
  }
}
