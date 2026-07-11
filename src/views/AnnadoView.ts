// The single Annado view: tab bar (Inbox / Today / Projects / People / Tags) over
// task lists rendered in the desktop app's visual language (see ui.ts for the
// ported palette and label logic; markdown.ts for inline/notes rendering).

import { ItemView, WorkspaceLeaf, Notice, TFile, setIcon, Menu, Platform } from 'obsidian';
import { Task, WhenValue } from '../parser/types';
import { todayISO, addDaysISO } from '../parser/dates';
import { allTaskTags } from '../parser/tags';
import type AnnadoPlugin from '../main';
import { AddTaskModal } from './AddTaskModal';
import { ColorPickerModal } from './ColorPickerModal';
import { InlineEditModal } from './InlineEditModal';
import { ConfirmModal } from './ConfirmModal';
import { QuickFind, FindItem } from './QuickFind';
import { showWhenMenu } from './whenMenu';
import { resolveTaskView } from '../parser/taskReveal';
import { attachSwipe, ACTIONS_WIDTH } from './swipe';
import { renderInline, renderNotes, RenderContext } from './markdown';
import { groupTasksByCompletionDate, limitGroupedTasks } from '../parser/taskGrouping';
import { loadPersonMetadata, loadProjectMetadata } from '../data/noteMetadata';
import type { WriteResult } from '../data/writer';
import { Milestone, PersonMetadata, ProjectMetadata } from '../parser/noteMetadata';
import {
  VIEW_META,
  PRIORITY_CONFIG,
  projectColor,
  tagColor,
  tintTag,
  formatWhenLabel,
  deadlineDisplay,
  formatDurationShort,
  buildTagTree,
  tagsMatchFilter,
  TagNode,
  upcomingDayHeading,
  fullMonthName,
  MORE_VIEWS,
  metaFor,
  formatLogDate,
  MainTab,
  MoreTab,
  AnyTab,
} from './ui';

export const VIEW_TYPE_ANNADO = 'annado-mobile-view';

type Tab = AnyTab;

interface RowOptions {
  /** Hide the when-pill when the task's scheduled date equals this ISO date
   *  (redundant under a Today list or an Upcoming day header). */
  hideDateEq?: string;
}

/** Effective date a task sorts under (when-date, else deadline) — port of getTaskDate. */
function effectiveDate(t: Task): string | null {
  if (t.when.kind === 'date') return t.when.date;
  return t.deadline;
}

/** A node in a collapsible name tree (projects nested by `up`, tags by `/`). */
interface TreeNode {
  name: string;
  label: string;
  count: number;
  children: TreeNode[];
}

export class AnnadoView extends ItemView {
  private tab: Tab = 'today';
  /** Drill-down selection within the Projects / People / Tags tabs. */
  private selected: string | null = null;
  /** Task id whose row is expanded to show notes + checklist. */
  private expanded: string | null = null;
  /** Expanded tree nodes, keyed `${kind}:${name.toLowerCase()}`. */
  private expandedNodes = new Set<string>();
  /** Detail-view metadata panels the user collapsed this session (`tab:name`). */
  private metadataCollapsed = new Set<string>();
  /** Closes whichever row currently has its swipe actions revealed (one at a time). */
  private closeOpenSwipe: (() => void) | null = null;
  /** Tab + drill-in of the last render, so scroll position is kept when re-rendering the
   *  same view (expand, complete, reschedule, refresh) and reset only on a real change. */
  private lastViewKey = '';

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: AnnadoPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_ANNADO;
  }

  getDisplayText(): string {
    return 'Annado';
  }

  getIcon(): string {
    return 'list-checks';
  }

  async onOpen(): Promise<void> {
    void this.plugin.reloadSharedConfig();
    this.render();
  }

  refresh(): void {
    this.render();
  }

  /** Awaits a write-back op and shows the canonical "changed on disk" Notice on
   *  `'stale'` (the file shifted underneath us between render and write —
   *  caller should treat the edit as not applied). Returns whether it wrote. */
  private async write(
    op: Promise<WriteResult>,
    staleMsg = 'That task changed on disk — list refreshed.',
  ): Promise<boolean> {
    const result = await op;
    if (result === 'stale') new Notice(staleMsg);
    return result === 'ok';
  }

  /** Context for markdown/title rendering (chip navigation callbacks). */
  private ctx(): RenderContext {
    const { personNames, projectNames } = this.plugin.index;
    return {
      personNames,
      projectNames,
      openProject: (n) => this.openProject(n),
      openPerson: (n) => this.openPerson(n),
    };
  }

  private render(): void {
    const root = this.contentEl;
    // Preserve the list scroll position across a same-view re-render (expand/collapse,
    // complete, reschedule, background refresh); reset to top on a real view change.
    const viewKey = `${this.tab}:${this.selected ?? ''}`;
    const prevBody = root.querySelector('.annado-body');
    const savedScroll = viewKey === this.lastViewKey && prevBody ? prevBody.scrollTop : 0;
    root.empty();
    root.addClass('annado-view');
    this.closeOpenSwipe = null;

    const tabBar = root.createDiv({ cls: 'annado-tabs' });
    const scroll = tabBar.createDiv({ cls: 'annado-tab-scroll' });
    for (const tab of Object.keys(VIEW_META) as MainTab[]) {
      const meta = VIEW_META[tab];
      const btn = scroll.createEl('button', {
        cls: `annado-tab${this.tab === tab ? ' is-active' : ''}`,
        attr: { 'aria-label': meta.label },
      });
      const iconEl = btn.createSpan({ cls: 'annado-tab-icon' });
      setIcon(iconEl, meta.icon);
      if (this.tab === tab) iconEl.style.color = meta.color;
      btn.createSpan({ cls: 'annado-tab-label', text: meta.label });
      btn.addEventListener('click', () => {
        this.tab = tab;
        this.selected = null;
        this.expanded = null;
        this.render();
      });
    }

    // Trailing "⋯ More" tile → menu of Anytime / Someday / Logbook.
    const moreActive = this.tab in MORE_VIEWS;
    const moreBtn = scroll.createEl('button', {
      cls: `annado-tab${moreActive ? ' is-active' : ''}`,
      attr: { 'aria-label': 'More views' },
    });
    const moreIcon = moreBtn.createSpan({ cls: 'annado-tab-icon' });
    setIcon(moreIcon, 'more-horizontal');
    if (moreActive) moreIcon.style.color = metaFor(this.tab).color;
    moreBtn.createSpan({ cls: 'annado-tab-label', text: 'More' });
    moreBtn.addEventListener('click', (e) => this.openMoreMenu(e));

    // Pinned search + add buttons — always visible top-right, outside the scroll,
    // so they never scroll away or reach Obsidian's bottom mobile toolbar.
    const search = tabBar.createEl('button', { cls: 'annado-search-top', attr: { 'aria-label': 'Quick find' } });
    setIcon(search, 'search');
    search.addEventListener('click', () => this.openQuickFind());

    const add = tabBar.createEl('button', { cls: 'annado-add-top', attr: { 'aria-label': 'Add task' } });
    setIcon(add, 'plus');
    add.addEventListener('click', () => this.openAddTask(this.addContext()));

    const body = root.createDiv({ cls: 'annado-body' });
    switch (this.tab) {
      case 'inbox': {
        const inboxTasks = this.inboxTasks();
        this.renderHeader(body, 'inbox', inboxTasks.length);
        this.renderTaskListTab(body, inboxTasks, {
          icon: 'inbox',
          title: 'Inbox zero',
          subtitle: 'Nothing waiting.',
        });
        break;
      }
      case 'today':
        this.renderToday(body);
        break;
      case 'upcoming':
        this.renderUpcoming(body);
        break;
      case 'projects':
        this.renderProjectsTab(body);
        break;
      case 'people':
        this.renderPeopleTab(body);
        break;
      case 'tags':
        this.renderTagsTab(body);
        break;
      case 'anytime':
        this.renderMoreList(body, 'anytime', this.anytimeTasks());
        break;
      case 'someday':
        this.renderMoreList(body, 'someday', this.somedayTasks());
        break;
      case 'logbook':
        this.renderLogbook(body);
        break;
    }

    this.lastViewKey = viewKey;
    body.scrollTop = savedScroll;
  }

  private renderHeader(body: HTMLElement, tab: Tab, count: number): void {
    const meta = metaFor(tab);
    const header = body.createDiv({ cls: 'annado-header' });
    const iconEl = header.createSpan({ cls: 'annado-header-icon' });
    setIcon(iconEl, meta.icon);
    iconEl.style.color = meta.color;
    header.createEl('h1', { text: meta.label, cls: 'annado-header-title' });
    if (count > 0) header.createSpan({ cls: 'annado-header-count', text: String(count) });
  }

  /** Shared empty state. Pass an icon + subtitle for the "all clear" lists; title-only
   *  for plain config hints. */
  private renderEmpty(
    body: HTMLElement,
    opts: { icon?: string; title: string; subtitle?: string },
  ): void {
    const el = body.createDiv({ cls: 'annado-empty' });
    if (opts.icon) setIcon(el.createSpan({ cls: 'annado-empty-icon' }), opts.icon);
    el.createDiv({ cls: 'annado-empty-title', text: opts.title });
    if (opts.subtitle) el.createDiv({ cls: 'annado-empty-sub', text: opts.subtitle });
  }

  // ---- Task filters ----

  private openTasks(): Task[] {
    return this.plugin.index.allTasks().filter((t) => !t.completed);
  }

  /** Port of filterTasks 'inbox': unscheduled AND not assigned to a project. */
  private inboxTasks(): Task[] {
    return this.openTasks().filter((t) => t.when.kind === 'inbox' && t.projects.length === 0);
  }

  /** Port of filterTasks 'today': evening, scheduled date ≤ today, or deadline ≤ today. */
  private todayTasks(): Task[] {
    const today = todayISO();
    return this.openTasks().filter(
      (t) =>
        t.when.kind === 'evening' ||
        (t.when.kind === 'date' && t.when.date <= today) ||
        (t.deadline !== null && t.deadline <= today),
    );
  }

  /** Port of filterTasks 'upcoming': scheduled date > today, or deadline > today. */
  private upcomingTasks(): Task[] {
    const today = todayISO();
    return this.openTasks().filter(
      (t) =>
        (t.when.kind === 'date' && t.when.date > today) ||
        (t.deadline !== null && t.deadline > today),
    );
  }

  private anytimeTasks(): Task[] {
    return this.openTasks().filter((t) => t.when.kind === 'anytime');
  }

  private somedayTasks(): Task[] {
    return this.openTasks().filter((t) => t.when.kind === 'someday');
  }

  // ---- Tab renderers ----

  private renderToday(body: HTMLElement): void {
    const today = todayISO();
    const tasks = this.todayTasks();
    this.renderHeader(body, 'today', tasks.length);

    const dayTasks = tasks.filter((t) => t.when.kind !== 'evening');
    const eveningTasks = tasks.filter((t) => t.when.kind === 'evening');

    this.renderGroupedByProject(body, dayTasks, { hideDateEq: today });
    if (eveningTasks.length > 0) {
      this.renderEveningHeader(body);
      this.renderGroupedByProject(body, eveningTasks, { hideDateEq: today });
    }
    if (tasks.length === 0) {
      this.renderEmpty(body, { icon: 'check-circle', title: 'All clear', subtitle: 'Nothing scheduled for today.' });
    }
  }

  /** Upcoming: future tasks grouped by effective date into day sections with a
   *  big day-number header, month labels on month change (port of the desktop
   *  Upcoming view). Only non-empty days are shown — a clean forward overview. */
  private renderUpcoming(body: HTMLElement): void {
    const today = todayISO();
    const byDate = new Map<string, Task[]>();
    let shown = 0;
    for (const t of this.upcomingTasks()) {
      const date = effectiveDate(t);
      if (date === null || date <= today) continue; // shown under Today, not here
      const list = byDate.get(date) ?? [];
      list.push(t);
      byDate.set(date, list);
      shown++;
    }
    this.renderHeader(body, 'upcoming', shown);

    const dates = [...byDate.keys()].sort();
    if (dates.length === 0) {
      this.renderEmpty(body, { icon: 'calendar', title: 'Nothing ahead', subtitle: 'No future tasks scheduled.' });
      return;
    }

    let prevMonth = Number(today.slice(5, 7)) - 1;
    for (const date of dates) {
      const heading = upcomingDayHeading(date, today);
      if (heading.monthIndex !== prevMonth) {
        this.renderMonthLabel(body, fullMonthName(heading.monthIndex));
        prevMonth = heading.monthIndex;
      }
      this.renderDayHeader(body, heading.dayNumber, heading.dayName);
      for (const t of byDate.get(date)!) this.renderTaskRow(body, t, { hideDateEq: date });
    }
  }

  private renderDayHeader(body: HTMLElement, dayNumber: number, dayName: string): void {
    const header = body.createDiv({ cls: 'annado-day-header' });
    header.createSpan({ cls: 'annado-day-number', text: String(dayNumber) });
    const rule = header.createDiv({ cls: 'annado-day-rule' });
    rule.createSpan({ cls: 'annado-day-name', text: dayName });
  }

  private renderMonthLabel(body: HTMLElement, label: string): void {
    const el = body.createDiv({ cls: 'annado-month-label' });
    el.createSpan({ text: label.toUpperCase() });
    el.createDiv({ cls: 'annado-month-rule' });
  }

  private renderEveningHeader(body: HTMLElement): void {
    const header = body.createDiv({ cls: 'annado-section' });
    const icon = header.createSpan({ cls: 'annado-section-icon' });
    setIcon(icon, 'moon');
    header.createSpan({ cls: 'annado-section-name', text: 'Evening' });
    header.createDiv({ cls: 'annado-section-line' });
  }

  private renderTaskListTab(
    body: HTMLElement,
    tasks: Task[],
    empty: { icon?: string; title: string; subtitle?: string },
  ): void {
    for (const t of tasks) this.renderTaskRow(body, t, {});
    if (tasks.length === 0) this.renderEmpty(body, empty);
  }

  /** Ungrouped tasks first, then a section per project — like the desktop lists. */
  private renderGroupedByProject(body: HTMLElement, tasks: Task[], opts: RowOptions): void {
    const noProject: Task[] = [];
    const byProject = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.projects.length === 0) {
        noProject.push(t);
      } else {
        for (const p of t.projects) {
          const list = byProject.get(p) ?? [];
          list.push(t);
          byProject.set(p, list);
        }
      }
    }
    for (const t of noProject) this.renderTaskRow(body, t, opts);
    for (const project of [...byProject.keys()].sort((a, b) => a.localeCompare(b))) {
      this.renderSectionHeader(body, project, projectColor(project), () => this.openProject(project));
      for (const t of byProject.get(project)!) this.renderTaskRow(body, t, opts);
    }
  }

  private renderSectionHeader(
    body: HTMLElement,
    label: string,
    color: string,
    onClick?: () => void,
  ): void {
    const header = body.createDiv({ cls: 'annado-section' });
    const dot = header.createSpan({ cls: 'annado-section-dot' });
    dot.style.backgroundColor = color;
    const name = header.createSpan({ cls: 'annado-section-name', text: label });
    if (onClick) {
      name.addClass('is-clickable');
      name.addEventListener('click', onClick);
    }
    header.createDiv({ cls: 'annado-section-line' });
  }

  /** Anytime / Someday: grouped by project, like Today. */
  private renderMoreList(body: HTMLElement, tab: MoreTab, tasks: Task[]): void {
    this.renderHeader(body, tab, tasks.length);
    this.renderGroupedByProject(body, tasks, {});
    if (tasks.length === 0) this.renderEmpty(body, { icon: metaFor(tab).icon, title: 'Nothing here yet' });
  }

  /** Logbook: completed tasks grouped by completion date, newest first, capped. */
  private renderLogbook(body: HTMLElement): void {
    const today = todayISO();
    const completed = this.plugin.index.allTasks().filter((t) => t.completed);
    this.renderHeader(body, 'logbook', completed.length);
    if (completed.length === 0) {
      this.renderEmpty(body, { icon: 'book', title: 'No completed tasks yet', subtitle: 'Finished tasks land here.' });
      return;
    }
    const groups = limitGroupedTasks(
      groupTasksByCompletionDate(completed, today, (iso) => formatLogDate(iso, today)),
      200,
    );
    let shown = 0;
    for (const group of groups) {
      const header = body.createDiv({ cls: 'annado-section' });
      header.createSpan({ cls: 'annado-section-name', text: group.label });
      header.createDiv({ cls: 'annado-section-line' });
      for (const t of group.tasks) this.renderTaskRow(body, t, {});
      shown += group.tasks.length;
    }
    if (shown < completed.length) {
      body.createDiv({
        cls: 'annado-log-footer',
        text: `Showing the latest ${shown} of ${completed.length} completed tasks.`,
      });
    }
  }

  // ---- Navigation ----

  private openProject(name: string): void {
    this.tab = 'projects';
    this.selected = name;
    this.expanded = null;
    this.render();
  }

  private openPerson(name: string): void {
    this.tab = 'people';
    this.selected = name;
    this.expanded = null;
    this.render();
  }

  /** Open a vault file in Obsidian, optionally jumping to a 0-based line. */
  private async openInObsidian(path: string, line?: number): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace
        .getLeaf(false)
        .openFile(file, line != null ? { eState: { line } } : undefined);
    } else {
      new Notice('Source file not found.');
    }
  }

  private openTag(name: string): void {
    this.tab = 'tags';
    this.selected = name;
    this.expanded = null;
    this.render();
  }

  // ---- Detail view (drill-in for a project / person / tag) ----

  /** Shared color-edit flow for the tappable project dot and tag icon: guard
   *  on the desktop integration being on, then open the palette modal.
   *  `current`/`hasOverride` are thunks so the modal reflects the state at tap
   *  time, not at render time. */
  private wireColorPicker(
    el: HTMLElement,
    opts: {
      title: string;
      current: () => string;
      hasOverride: () => boolean;
      save: (color: string | null) => Promise<void>;
    },
  ): void {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.plugin.shared === null) {
        // Neither shared.json nor the data.json mirror is available = the
        // desktop integration is off; the plugin never creates the file
        // (hardened contract), so color editing is unavailable. On a phone
        // the mirror stands in for the file (edits queue for the relay).
        new Notice('Color sync is off — enable the vault toggle in the desktop app.');
        return;
      }
      new ColorPickerModal(this.app, {
        title: opts.title,
        current: opts.current(),
        hasOverride: opts.hasOverride(),
        onChoose: (color) => void opts.save(color),
      }).open();
    });
  }

  private renderDetail(body: HTMLElement, tab: MainTab, name: string, tasks: Task[]): void {
    const back = body.createEl('button', { cls: 'annado-back-btn' });
    setIcon(back.createSpan(), 'chevron-left');
    back.createSpan({ text: VIEW_META[tab].label });
    back.addEventListener('click', () => {
      this.selected = null;
      this.render();
    });

    // Projects & people map to a note; tapping the title opens it in Obsidian.
    const notePath =
      tab === 'projects'
        ? this.plugin.index.projects.find((p) => p.name === name)?.path
        : tab === 'people'
          ? this.plugin.index.persons.find((p) => p.name === name)?.path
          : undefined;

    const header = body.createDiv({ cls: 'annado-header' });
    if (tab === 'projects') {
      const dot = header.createSpan({
        cls: 'annado-detail-dot is-tappable',
        attr: { 'aria-label': 'Change project color' },
      });
      dot.style.backgroundColor = projectColor(name);
      this.wireColorPicker(dot, {
        title: name,
        current: () => projectColor(name),
        hasOverride: () => this.plugin.shared?.projectColors[name] !== undefined,
        save: (color) => this.plugin.saveProjectColor(name, color),
      });
    } else if (tab === 'tags') {
      const iconEl = header.createSpan({
        cls: 'annado-header-icon is-tappable',
        attr: { 'aria-label': 'Change tag color' },
      });
      setIcon(iconEl, 'tag');
      iconEl.style.color = tagColor(name);
      this.wireColorPicker(iconEl, {
        title: '#' + name,
        current: () => tagColor(name),
        // Own-key check (not the resolved color): a nested tag inheriting its
        // parent's color still shows "Default", and Default clears only this
        // tag's own entry — same semantics as the desktop.
        hasOverride: () => this.plugin.shared?.tagColors[name.toLowerCase()] !== undefined,
        save: (color) => this.plugin.saveTagColor(name, color),
      });
    } else {
      const iconEl = header.createSpan({ cls: 'annado-header-icon' });
      setIcon(iconEl, 'user');
      iconEl.style.color = VIEW_META[tab].color;
    }
    const title = header.createEl('h1', { text: name, cls: 'annado-header-title' });
    if (notePath !== undefined) {
      title.addClass('is-openable');
      const openIcon = header.createSpan({ cls: 'annado-header-open' });
      setIcon(openIcon, 'external-link');
      const open = () => void this.openInObsidian(notePath);
      title.addEventListener('click', open);
      openIcon.addEventListener('click', open);
    }

    if ((tab === 'projects' || tab === 'people') && notePath !== undefined) {
      const metaContainer = body.createDiv();
      this.renderMetadataPanel(metaContainer, tab, name, notePath);
    }

    for (const t of tasks) this.renderTaskRow(body, t, {});
    if (tasks.length === 0) {
      this.renderEmpty(body, { icon: 'check-circle', title: 'All done here', subtitle: 'No open tasks.' });
    }
  }

  /** Fill the detail-view metadata panel asynchronously: the task list renders
   *  immediately; the card appears above it once the (cheap) parse resolves.
   *  A response for a view the user already left is dropped (isConnected). */
  private renderMetadataPanel(
    container: HTMLElement,
    tab: 'projects' | 'people',
    name: string,
    path: string,
  ): void {
    void (async () => {
      if (tab === 'projects') {
        const meta = await loadProjectMetadata(this.app, path);
        if (meta === null || !container.isConnected) return;
        this.fillProjectPanel(container, meta, name, path);
      } else {
        const meta = await loadPersonMetadata(this.app, path);
        if (meta === null || !container.isConnected) return;
        this.fillPersonPanel(container, meta, name);
      }
    })();
  }

  /** Card head shared by both panels: chevron + (collapsed) summary line.
   *  Returns null when collapsed — the caller skips the body. */
  private metaCardHead(
    container: HTMLElement,
    key: string,
    summary: string,
  ): { card: HTMLElement; head: HTMLElement } | null {
    const collapsed = this.metadataCollapsed.has(key);
    const card = container.createDiv({ cls: 'annado-meta-card' });
    const head = card.createDiv({ cls: 'annado-meta-head' });
    const chev = head.createEl('button', {
      cls: 'annado-meta-chevron',
      attr: { 'aria-label': collapsed ? 'Expand details' : 'Collapse details' },
    });
    setIcon(chev, collapsed ? 'chevron-right' : 'chevron-down');
    // Whole head toggles (easy phone tap target); the open-note button inside
    // the head already stopPropagation()s so it keeps working.
    head.addEventListener('click', () => {
      if (collapsed) this.metadataCollapsed.delete(key);
      else this.metadataCollapsed.add(key);
      this.render();
    });
    if (collapsed) {
      head.createSpan({ cls: 'annado-meta-summary', text: summary });
      return null;
    }
    return { card, head };
  }

  private fillProjectPanel(
    container: HTMLElement,
    meta: ProjectMetadata,
    name: string,
    path: string,
  ): void {
    const hasContent =
      meta.description !== null ||
      meta.deadline !== null ||
      meta.startDate !== null ||
      meta.ranking !== null ||
      meta.persons.length > 0 ||
      meta.milestones.length > 0;
    if (!hasContent) return; // no metadata → no panel, not even a collapsed line

    const today = todayISO();
    const done = meta.milestones.filter((m) => m.completed).length;
    const bits: string[] = [];
    if (meta.deadline !== null) bits.push(`Due ${meta.deadline}`);
    if (meta.milestones.length > 0) bits.push(`${done}/${meta.milestones.length} milestones`);
    const result = this.metaCardHead(container, `projects:${name}`, bits.join(' · ') || 'Details');
    if (result === null) return;
    const { card, head } = result;
    if (meta.description !== null) {
      head.createSpan({ cls: 'annado-meta-desc', text: meta.description });
    }
    const open = head.createEl('button', {
      cls: 'annado-meta-open',
      attr: { 'aria-label': 'Open in Obsidian' },
    });
    setIcon(open, 'external-link');
    open.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openInObsidian(path);
    });

    // Fields row: only non-empty fields render.
    const fields = card.createDiv({ cls: 'annado-meta-fields' });
    if (meta.deadline !== null) {
      const f = fields.createSpan({ cls: 'annado-meta-field' });
      setIcon(f.createSpan({ cls: 'annado-mini-icon' }), 'flag');
      // ISO dates get the task-style urgency colour + label; anything else shows raw.
      if (/^\d{4}-\d{2}-\d{2}$/.test(meta.deadline)) {
        const { label, color } = deadlineDisplay(meta.deadline, today);
        f.style.color = color;
        f.createSpan({ text: `Due ${meta.deadline} · ${label}` });
      } else {
        f.createSpan({ text: `Due ${meta.deadline}` });
      }
    }
    if (meta.startDate !== null) {
      const f = fields.createSpan({ cls: 'annado-meta-field is-start' });
      setIcon(f.createSpan({ cls: 'annado-mini-icon' }), 'arrow-right');
      f.createSpan({ text: `Started ${meta.startDate}` });
    }
    if (meta.ranking !== null) {
      const f = fields.createSpan({ cls: 'annado-meta-field is-ranking' });
      setIcon(f.createSpan({ cls: 'annado-mini-icon' }), 'star');
      f.createSpan({ text: meta.ranking });
    }
    if (meta.persons.length > 0) {
      const row = card.createDiv({ cls: 'annado-meta-persons' });
      setIcon(row.createSpan({ cls: 'annado-mini-icon' }), 'user');
      for (const person of meta.persons) {
        const chip = row.createSpan({ cls: 'annado-meta-chip', text: person });
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openPerson(person);
        });
      }
    }

    if (meta.milestones.length > 0) {
      const list = card.createDiv({ cls: 'annado-meta-milestones' });
      for (const m of meta.milestones) this.renderMilestone(list, m);
    }
  }

  private renderMilestone(list: HTMLElement, m: Milestone): void {
    const row = list.createDiv({ cls: 'annado-meta-milestone' });
    setIcon(
      row.createSpan({ cls: `annado-ms-icon${m.completed ? ' is-done' : ''}` }),
      m.completed ? 'check-circle-2' : 'circle',
    );
    row.createSpan({ cls: `annado-ms-name${m.completed ? ' is-done' : ''}`, text: m.name });
    const date = m.end ?? m.start;
    if (date !== null) row.createSpan({ cls: 'annado-ms-date', text: date });
  }

  private fillPersonPanel(container: HTMLElement, meta: PersonMetadata, name: string): void {
    const hasContent =
      meta.organisation !== null ||
      meta.relationship !== null ||
      meta.languages.length > 0 ||
      meta.projects.length > 0;
    if (!hasContent) return;

    const rel =
      meta.relationship !== null
        ? meta.relationship.charAt(0).toUpperCase() + meta.relationship.slice(1)
        : null;
    const summary = meta.organisation ?? rel ?? 'Details';
    const result = this.metaCardHead(container, `people:${name}`, summary);
    if (result === null) return;
    const { card } = result;

    const fields = card.createDiv({ cls: 'annado-meta-fields annado-meta-person-fields' });
    if (meta.organisation !== null) {
      const f = fields.createSpan({ cls: 'annado-meta-field is-org' });
      setIcon(f.createSpan({ cls: 'annado-mini-icon' }), 'building-2');
      f.createSpan({ text: meta.organisation });
    }
    if (meta.relationship !== null) {
      const f = fields.createSpan({ cls: 'annado-meta-field is-relation' });
      setIcon(f.createSpan({ cls: 'annado-mini-icon' }), 'link');
      // Desktop renders the relationship capitalized.
      f.createSpan({
        text: meta.relationship.charAt(0).toUpperCase() + meta.relationship.slice(1),
      });
    }
    if (meta.languages.length > 0) {
      const f = fields.createSpan({ cls: 'annado-meta-field is-languages' });
      setIcon(f.createSpan({ cls: 'annado-mini-icon' }), 'globe');
      f.createSpan({ text: meta.languages.join(', ') });
    }
    if (meta.projects.length > 0) {
      const row = card.createDiv({ cls: 'annado-meta-persons' });
      for (const project of meta.projects) {
        const chip = row.createSpan({ cls: 'annado-meta-chip', text: project });
        chip.style.color = projectColor(project);
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openProject(project);
        });
      }
    }
  }

  // ---- People tab (flat) ----

  private renderPeopleTab(body: HTMLElement): void {
    const openTasks = this.openTasks();
    if (this.selected !== null) {
      const name = this.selected;
      this.renderDetail(body, 'people', name, openTasks.filter((t) => t.persons.includes(name)));
      return;
    }
    this.renderHeader(body, 'people', 0);
    const items = this.plugin.index.persons;
    if (items.length === 0) {
      this.renderEmpty(body, { title: 'No people found — check the folder pattern in settings.' });
      return;
    }
    const counts = new Map<string, number>();
    for (const t of openTasks) for (const n of t.persons) counts.set(n, (counts.get(n) ?? 0) + 1);

    const list = body.createDiv({ cls: 'annado-group-list' });
    for (const item of items) {
      const row = list.createDiv({ cls: 'annado-group-row' });
      setIcon(row.createSpan({ cls: 'annado-group-icon' }), 'user');
      row.createSpan({ cls: 'annado-group-name', text: item.name });
      const n = counts.get(item.name) ?? 0;
      if (n > 0) row.createSpan({ cls: 'annado-group-count', text: String(n) });
      row.addEventListener('click', () => {
        this.selected = item.name;
        this.render();
      });
    }
  }

  // ---- Projects tab (nested by frontmatter `up`) ----

  private renderProjectsTab(body: HTMLElement): void {
    const openTasks = this.openTasks();
    if (this.selected !== null) {
      const name = this.selected;
      this.renderDetail(body, 'projects', name, openTasks.filter((t) => t.projects.includes(name)));
      return;
    }
    this.renderHeader(body, 'projects', 0);
    const items = this.plugin.index.projects;
    if (items.length === 0) {
      this.renderEmpty(body, { title: 'No projects found — check the folder pattern in settings.' });
      return;
    }

    // Direct task count per project name.
    const counts = new Map<string, number>();
    for (const t of openTasks) for (const n of t.projects) counts.set(n, (counts.get(n) ?? 0) + 1);

    // Build the tree from `up` → parent name. A parent that isn't itself a known
    // project (or points nowhere) makes its child a root.
    const names = new Set(items.map((i) => i.name));
    const childrenBy = new Map<string, TreeNode[]>();
    const roots: TreeNode[] = [];
    const nodeOf = new Map<string, TreeNode>();
    for (const item of items) {
      nodeOf.set(item.name, { name: item.name, label: item.name, count: counts.get(item.name) ?? 0, children: [] });
    }
    for (const item of items) {
      const node = nodeOf.get(item.name)!;
      const parent = item.parentName && names.has(item.parentName) ? item.parentName : null;
      if (parent === null || parent === item.name) {
        roots.push(node);
      } else {
        const list = childrenBy.get(parent) ?? [];
        list.push(node);
        childrenBy.set(parent, list);
      }
    }
    for (const [parent, children] of childrenBy) {
      const p = nodeOf.get(parent);
      if (p) p.children = children.sort((a, b) => a.label.localeCompare(b.label));
    }
    roots.sort((a, b) => a.label.localeCompare(b.label));

    const list = body.createDiv({ cls: 'annado-group-list' });
    this.renderTree(list, roots, 0, 'projects');
  }

  // ---- Tags tab (nested by `/`) ----

  private renderTagsTab(body: HTMLElement): void {
    if (this.selected !== null) {
      const name = this.selected;
      const tasks = this.openTasks().filter((t) => tagsMatchFilter(allTaskTags(t), name));
      this.renderDetail(body, 'tags', name, tasks);
      return;
    }
    this.renderHeader(body, 'tags', 0);

    const open = this.openTasks();
    const names = [...new Set(open.flatMap((t) => allTaskTags(t)))];
    if (names.length === 0) {
      this.renderEmpty(body, { title: 'No tags yet.' });
      return;
    }
    const tree = buildTagTree(names, open.map((t) => allTaskTags(t))) as TagNode[];
    const list = body.createDiv({ cls: 'annado-group-list' });
    this.renderTree(list, tree, 0, 'tags');
  }

  /** Collapsible indented tree shared by Projects and Tags. Chevron toggles a
   *  node's children; tapping the name drills into that node's tasks. */
  private renderTree(list: HTMLElement, nodes: TreeNode[], depth: number, kind: 'projects' | 'tags'): void {
    for (const node of nodes) {
      const key = `${kind}:${node.name.toLowerCase()}`;
      const isOpen = this.expandedNodes.has(key);
      const hasChildren = node.children.length > 0;

      const row = list.createDiv({ cls: 'annado-group-row annado-tree-row' });
      // Depth drives the left indent via CSS: padding-left: calc(6px + var(--annado-depth) * 18px).
      row.style.setProperty('--annado-depth', String(depth));

      const chevron = row.createSpan({ cls: 'annado-tree-chevron' });
      if (hasChildren) {
        setIcon(chevron, isOpen ? 'chevron-down' : 'chevron-right');
        chevron.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isOpen) this.expandedNodes.delete(key);
          else this.expandedNodes.add(key);
          this.render();
        });
      }

      if (kind === 'projects') {
        row.createSpan({ cls: 'annado-group-dot' }).style.backgroundColor = projectColor(node.name);
      } else {
        const icon = row.createSpan({ cls: 'annado-group-icon' });
        setIcon(icon, 'tag');
        // node.name is the full slash path, so collapsed parents and children
        // resolve their own (or inherited) color like the desktop sidebar.
        icon.style.color = tagColor(node.name);
      }

      row.createSpan({ cls: 'annado-group-name', text: node.label });
      if (node.count > 0) row.createSpan({ cls: 'annado-group-count', text: String(node.count) });

      row.addEventListener('click', () => {
        if (kind === 'projects') this.openProject(node.name);
        else this.openTag(node.name);
      });

      if (hasChildren && isOpen) this.renderTree(list, node.children, depth + 1, kind);
    }
  }

  // ---- Add-task ----

  /** Default `when` for a task created from the current tab. */
  private defaultAddWhen(): Task['when'] {
    const today = todayISO();
    if (this.tab === 'today') return { kind: 'date', date: today };
    if (this.tab === 'upcoming') return { kind: 'date', date: addDaysISO(today, 1) };
    return { kind: 'inbox' };
  }

  /** The vault's tags, de-duplicated and sorted — shared by add + Quick Find.
   *  Accepts a precomputed task list to avoid a redundant allTasks() call. */
  private allTagsSorted(tasks: Task[] = this.plugin.index.allTasks()): string[] {
    return [...new Set(tasks.flatMap((t) => allTaskTags(t)))].sort((a, b) => a.localeCompare(b));
  }

  private openAddTask(ctx: {
    when: WhenValue;
    project?: string;
    persons?: string[];
    tags?: string[];
  }): void {
    new AddTaskModal(this.app, {
      defaultWhen: ctx.when,
      defaultProject: ctx.project,
      defaultTags: ctx.tags,
      defaultPersons: ctx.persons,
      projects: this.plugin.index.projects.map((p) => p.name),
      tags: this.allTagsSorted(),
      onSubmit: async (input) => {
        await this.plugin.createTask(input);
        new Notice('Task added to today’s daily note');
      },
    }).open();
  }

  /** Open the fuzzy finder over open tasks + projects + people + tags. Public so the
   *  Obsidian command can trigger it on the active view. */
  openQuickFind(): void {
    const index = this.plugin.index;
    const tasks = index.allTasks();
    const items: FindItem[] = [
      ...tasks.filter((t) => !t.completed).map((task): FindItem => ({ kind: 'task', task })),
      ...index.projects.map((p): FindItem => ({ kind: 'project', name: p.name })),
      ...index.persons.map((p): FindItem => ({ kind: 'person', name: p.name })),
      ...this.allTagsSorted(tasks).map((name): FindItem => ({ kind: 'tag', name })),
    ];
    new QuickFind(this.app, items, {
      revealTask: (task) => this.revealTask(task),
      openProject: (name) => this.openProject(name),
      openPerson: (name) => this.openPerson(name),
      openTag: (name) => this.openTag(name),
    }).open();
  }

  /** Switch to a view that contains `task`, expand it, and scroll it into view. */
  private revealTask(task: Task): void {
    const target = resolveTaskView(task, todayISO());
    this.tab = target.tab;
    this.selected = target.selected ?? null;
    this.expanded = task.id;
    this.render();
    requestAnimationFrame(() => {
      this.contentEl
        .querySelector('.annado-task.is-expanded')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /** Context for the `+`, derived from the active view: project/person/tag detail,
   *  Anytime/Someday when, else the tab's default when. */
  private addContext(): { when: WhenValue; project?: string; persons?: string[]; tags?: string[] } {
    if (this.tab === 'projects' && this.selected) return { when: { kind: 'inbox' }, project: this.selected };
    if (this.tab === 'people' && this.selected) return { when: { kind: 'inbox' }, persons: [this.selected] };
    if (this.tab === 'tags' && this.selected) return { when: { kind: 'inbox' }, tags: [this.selected] };
    if (this.tab === 'anytime') return { when: { kind: 'anytime' } };
    if (this.tab === 'someday') return { when: { kind: 'someday' } };
    return { when: this.defaultAddWhen() };
  }

  /** Open the "⋯ More" menu (Anytime / Someday / Logbook). */
  private openMoreMenu(evt: MouseEvent): void {
    const menu = new Menu();
    for (const view of Object.keys(MORE_VIEWS) as MoreTab[]) {
      const meta = MORE_VIEWS[view];
      menu.addItem((i) =>
        i
          .setTitle(meta.label)
          .setIcon(meta.icon)
          .setChecked(this.tab === view)
          .onClick(() => {
            this.tab = view;
            this.selected = null;
            this.expanded = null;
            this.render();
          }),
      );
    }
    menu.showAtMouseEvent(evt);
  }

  // ---- Task row (port of the CollapsedTaskRow layout) ----

  private renderTaskRow(body: HTMLElement, task: Task, opts: RowOptions): void {
    const today = todayISO();
    const isExpanded = this.expanded === task.id;
    const isCompleted = task.completed;
    const row = createDiv({ cls: `annado-task${isExpanded ? ' is-expanded' : ''}` });

    const check = row.createEl('button', {
      cls: `annado-check${isCompleted ? ' is-checked' : ''}`,
      attr: { 'aria-label': isCompleted ? 'Mark not done' : 'Complete task' },
    });
    setIcon(check.createSpan({ cls: 'annado-check-icon' }), 'check');
    check.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isCompleted) {
        check.setAttribute('disabled', 'true');
        await this.write(this.plugin.toggleTask(task, false));
        return;
      }
      row.addClass('is-completing');
      check.setAttribute('disabled', 'true');
      await this.write(this.plugin.toggleTask(task, true));
    });

    // The when-pill is tappable-to-reschedule on open rows; on completed (Logbook)
    // rows it's a static chip — rescheduling a done task makes no sense.
    if (task.when.kind === 'date' && task.when.date !== opts.hideDateEq) {
      const pill = row.createSpan({
        cls: `annado-when-pill${isCompleted ? '' : ' is-tappable'}`,
        text: formatWhenLabel(task.when.date, today),
      });
      if (!isCompleted) this.wireReschedule(pill, task);
    } else if (task.when.kind === 'evening') {
      const pill = row.createSpan({
        cls: `annado-when-pill${isCompleted ? '' : ' is-tappable'}`,
        text: 'Evening',
      });
      if (!isCompleted) this.wireReschedule(pill, task);
    }

    if (task.scheduledTime !== null) {
      const time = row.createSpan({ cls: 'annado-duration' });
      setIcon(time.createSpan({ cls: 'annado-mini-icon' }), 'clock');
      time.createSpan({ text: task.scheduledTime });
    } else if (task.durationMinutes !== null) {
      const dur = row.createSpan({ cls: 'annado-duration' });
      setIcon(dur.createSpan({ cls: 'annado-mini-icon' }), 'clock');
      dur.createSpan({ text: formatDurationShort(task.durationMinutes) });
    }

    const main = row.createDiv({ cls: 'annado-task-main' });
    const titleLine = main.createDiv({ cls: 'annado-task-titleline' });
    if (task.priority !== null) {
      const cfg = PRIORITY_CONFIG[task.priority];
      if (cfg) {
        const pri = titleLine.createSpan({ cls: 'annado-priority', text: cfg.label });
        pri.style.color = cfg.color;
      }
    }
    const titleSpan = titleLine.createSpan({ cls: `annado-task-title${isCompleted ? ' is-done' : ''}` });
    renderInline(titleSpan, task.title, this.ctx());
    if (isExpanded && !isCompleted) {
      this.wireInlineEdit(titleSpan, {
        value: task.title,
        multiline: false,
        onSave: async (next) => {
          task.title = next;   // keep the in-memory task fresh if the modal opens mid-edit
          await this.write(this.plugin.updateTask({ ...task, title: next }));
        },
      });
    }
    if (task.notes !== '') setIcon(titleLine.createSpan({ cls: 'annado-notes-icon' }), 'file-text');
    for (const tag of task.tags) this.renderTagPill(titleLine, tag, false);
    for (const tag of task.inheritedTags) this.renderTagPill(titleLine, tag, true);

    if (isExpanded) {
      this.renderExpanded(main, task);
    } else if (task.checklist.length > 0) {
      const cl = main.createDiv({ cls: 'annado-checklist-count' });
      setIcon(cl.createSpan({ cls: 'annado-mini-icon' }), 'check-square');
      const done = task.checklist.filter((c) => c.completed).length;
      cl.createSpan({ text: `${done}/${task.checklist.length}` });
    }

    const right = row.createDiv({ cls: 'annado-task-right' });
    if (task.recurrence !== null) setIcon(right.createSpan({ cls: 'annado-recurrence-icon' }), 'repeat');
    if (task.deadline !== null) {
      const { label, color } = deadlineDisplay(task.deadline, today);
      const dl = right.createSpan({ cls: 'annado-deadline' });
      dl.style.color = color;
      setIcon(dl.createSpan({ cls: 'annado-mini-icon' }), 'flag');
      dl.createSpan({ text: label });
    }

    if (isExpanded) {
      // Expanded rows: no swipe; a tap on the header collapses (the expanded
      // panel stops propagation, so only the header area collapses).
      body.appendChild(row);
      row.addEventListener('click', () => {
        this.expanded = null;
        this.render();
      });
      return;
    }

    if (isCompleted) {
      // Completed (Logbook) rows: no swipe; tap expands. The checkbox un-completes.
      body.appendChild(row);
      row.addEventListener('click', () => {
        this.expanded = task.id;
        this.render();
      });
      return;
    }

    // Collapsed rows: wrap for swipe with two behind-layers.
    const wrap = body.createDiv({ cls: 'annado-swipe' });
    const complete = wrap.createDiv({ cls: 'annado-swipe-complete' });
    setIcon(complete.createSpan({ cls: 'annado-swipe-check' }), 'check');

    const actions = wrap.createDiv({ cls: 'annado-swipe-actions' });
    actions.style.setProperty('--annado-actions-width', `${ACTIONS_WIDTH}px`);
    const resched = actions.createEl('button', {
      cls: 'annado-swipe-action is-reschedule',
      attr: { 'aria-label': 'Reschedule task' },
    });
    setIcon(resched.createSpan(), 'clock');
    resched.createSpan({ text: 'Reschedule' });
    resched.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeOpenSwipe?.();
      this.closeOpenSwipe = null;
      this.rescheduleTask(e, task);
    });
    const del = actions.createEl('button', {
      cls: 'annado-swipe-action is-delete',
      attr: { 'aria-label': 'Delete task' },
    });
    setIcon(del.createSpan(), 'trash-2');
    del.createSpan({ text: 'Delete' });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeOpenSwipe?.();
      this.closeOpenSwipe = null;
      this.confirmDelete(task);
    });

    wrap.appendChild(row);
    attachSwipe(row, {
      interactiveSelector: 'button, .annado-when-pill, .annado-tag-pill',
      onTap: () => {
        // If a row is open, first tap dismisses it; otherwise expand.
        if (this.closeOpenSwipe) {
          this.closeOpenSwipe();
          this.closeOpenSwipe = null;
          return;
        }
        this.expanded = task.id;
        this.render();
      },
      onComplete: () => void this.completeViaSwipe(row, task),
      onOpen: (close) => {
        this.closeOpenSwipe?.();
        this.closeOpenSwipe = close;
      },
    });
  }

  /** Complete a task from a right-swipe: fade the row, then toggle via the
   *  byte-preserving write path. The index change re-renders the list. */
  private async completeViaSwipe(row: HTMLElement, task: Task): Promise<void> {
    row.addClass('is-completing');
    await this.write(this.plugin.toggleTask(task, true));
  }

  /** One tag pill on a task row: tinted per the resolved tag color, tapping opens
   *  the tag view. Inherited tags (from the note's frontmatter) get a dashed
   *  `is-inherited` treatment and a tooltip explaining why they're there — same
   *  click behavior as own tags, shown on completed rows too (own pills already are). */
  private renderTagPill(parent: HTMLElement, tag: string, inherited: boolean): void {
    const pill = parent.createSpan({
      cls: `annado-tag-pill${inherited ? ' is-inherited' : ''}`,
      text: tag,
      ...(inherited ? { attr: { title: "Inherited from the note's frontmatter" } } : {}),
    });
    tintTag(pill, tag);
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openTag(tag);
    });
  }

  private wireReschedule(pill: HTMLElement, task: Task): void {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.rescheduleTask(e, task);
    });
  }

  /** Open the shared when-menu at the event and reschedule via `updateTask`.
   *  Shared by the row's when-pill and the swipe Reschedule action. */
  private rescheduleTask(evt: MouseEvent, task: Task): void {
    showWhenMenu(
      evt,
      async (when) => {
        await this.write(this.plugin.updateTask({ ...task, when }));
      },
      () => new Notice('Open the task to pick a specific date.'),
    );
  }

  /** Make `el` double-tap-to-edit. On desktop the element is replaced in place
   *  by an input/textarea that auto-saves on blur. On mobile a single-field
   *  editor sheet opens instead: naked inline fields in the scrolling list
   *  fight iOS's native keyboard pan (blank-pane bug), while modals handle the
   *  keyboard reliably. Empty or unchanged text is never written.
   *  Double (not single) activation, matching the desktop app's double-click
   *  convention: a single tap is too easy to hit while scrolling and popped
   *  the keyboard at once. Manual two-tap detection — iOS delivers two click
   *  events, while 'dblclick' is unreliable in WKWebView. */
  private wireInlineEdit(
    el: HTMLElement,
    opts: { value: string; multiline: boolean; onSave: (next: string) => Promise<void> },
  ): void {
    el.addClass('is-editable');
    let lastTap = 0;
    el.addEventListener('click', (e) => {
      e.stopPropagation(); // single tap: do nothing (and don't collapse the card)
      const now = Date.now();
      const isDouble = now - lastTap <= 350;
      lastTap = isDouble ? 0 : now;
      if (!isDouble) return;
      if (Platform.isMobile) {
        new InlineEditModal(this.app, {
          heading: opts.multiline ? 'Edit notes' : 'Edit title',
          value: opts.value,
          multiline: opts.multiline,
          onSave: opts.onSave, // updateTask re-renders via the index change
        }).open();
        return;
      }
      const field = opts.multiline
        ? el.parentElement!.createEl('textarea', { cls: 'annado-inline-notes' })
        : el.parentElement!.createEl('input', { cls: 'annado-inline-input', attr: { type: 'text' } });
      field.value = opts.value;
      el.replaceWith(field);
      field.addEventListener('click', (e) => e.stopPropagation());
      field.focus();
      field.scrollIntoView({ block: 'nearest' });
      let done = false;
      const commit = async () => {
        if (done) return;
        done = true;
        const next = field.value;
        if (next !== opts.value && next.trim() !== '') {
          await opts.onSave(next);   // updateTask re-renders via the index change
        } else {
          this.render();             // nothing to save — restore the label
        }
      };
      field.addEventListener('blur', () => void commit());
      // Title field only: Enter commits, Escape cancels. (Notes stays
      // blur-only — Enter there means "new line", not "save".)
      if (!opts.multiline) {
        field.addEventListener('keydown', (e) => {
          const key = (e as KeyboardEvent).key;
          if (key === 'Enter') {
            e.preventDefault();
            e.stopPropagation(); // don't let Enter/Escape bubble to future row-level handlers
            void commit();     // sets `done` synchronously — the blur this
            field.blur();       // triggers below is a guarded no-op
          } else if (key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            done = true;        // guard: the blur below must not also commit
            this.render();      // restore the original label without saving
            field.blur();
          }
        });
      }
    });
  }

  /** Expanded card: markdown notes + a toggleable checklist. */
  private renderExpanded(main: HTMLElement, task: Task): void {
    const panel = main.createDiv({ cls: 'annado-expanded' });
    panel.addEventListener('click', (e) => e.stopPropagation());

    // Notes: tap to edit inline (auto-save on blur). Empty notes show a tappable
    // placeholder so you can start typing without opening the modal.
    const wireNotes = (el: HTMLElement) =>
      this.wireInlineEdit(el, {
        value: task.notes,
        multiline: true,
        onSave: async (next) => {
          task.notes = next;   // keep the in-memory task fresh if the modal opens mid-edit
          await this.write(this.plugin.updateTask({ ...task, notes: next }));
        },
      });

    if (task.notes !== '') {
      const notesEl = panel.createDiv({ cls: 'annado-notes' });
      renderNotes(notesEl, task.notes, this.ctx());
      if (!task.completed) wireNotes(notesEl);
    } else if (task.checklist.length === 0) {
      const empty = panel.createDiv({ cls: 'annado-notes annado-notes-empty', text: 'No notes.' });
      if (!task.completed) wireNotes(empty);
    }

    if (task.checklist.length > 0) {
      const list = panel.createDiv({ cls: 'annado-checklist' });
      task.checklist.forEach((item, i) => {
        const itemRow = list.createDiv({ cls: 'annado-checklist-item' });
        const btn = itemRow.createEl('button', {
          cls: `annado-check annado-check-sub${item.completed ? ' is-checked' : ''}`,
          attr: {
            'aria-label': task.completed ? 'Checklist item (read-only)' : 'Toggle checklist item',
          },
        });
        setIcon(btn.createSpan({ cls: 'annado-check-icon' }), 'check');
        // Same read-only rule as notes/title: no toggling on completed tasks —
        // items still render with their checked state.
        if (task.completed) {
          btn.setAttribute('aria-disabled', 'true');
        } else {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.setAttribute('disabled', 'true');
            await this.write(
              this.plugin.toggleChecklistItem(task, i),
              'That item changed on disk — list refreshed, please retry.',
            );
          });
        }
        const label = itemRow.createSpan({
          cls: `annado-checklist-title${item.completed ? ' is-done' : ''}`,
        });
        renderInline(label, item.title, this.ctx());
      });
    }

    // Compact right-aligned icon row (open / edit / delete), replacing the old
    // stacked text links. Matches the desktop card's bottom-right icon cluster.
    const actions = panel.createDiv({ cls: 'annado-card-actions' });

    const open = actions.createEl('button', {
      cls: 'annado-card-action',
      attr: { 'aria-label': 'Open in Obsidian' },
    });
    setIcon(open, 'external-link');
    open.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openInObsidian(task.filePath, task.lineNumber - 1);
    });

    // Completed tasks (Logbook) are read-only apart from un-completing — no
    // modal editing either.
    if (!task.completed) {
      const edit = actions.createEl('button', {
        cls: 'annado-card-action',
        attr: { 'aria-label': 'Edit task' },
      });
      setIcon(edit, 'pencil');
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        new AddTaskModal(this.app, {
          mode: 'edit',
          task,
          defaultWhen: task.when,
          projects: this.plugin.index.projects.map((p) => p.name),
          tags: this.allTagsSorted(),
          onSave: async (updated) => {
            await this.write(this.plugin.updateTask(updated));
          },
        }).open();
      });
    }

    const del = actions.createEl('button', {
      cls: 'annado-card-action is-delete',
      attr: { 'aria-label': 'Delete task' },
    });
    setIcon(del, 'trash-2');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.confirmDelete(task);
    });
  }

  /** Confirm-then-delete via `deleteTask`. Shared by the expanded card and the
   *  swipe Delete action. */
  private confirmDelete(task: Task): void {
    new ConfirmModal(this.app, {
      title: 'Delete task',
      body: task.title || 'This task',
      confirmText: 'Delete',
      onConfirm: async () => {
        if (await this.write(this.plugin.deleteTask(task))) new Notice('Task deleted');
      },
    }).open();
  }
}
