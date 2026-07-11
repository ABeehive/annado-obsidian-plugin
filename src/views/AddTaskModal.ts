import { App, Modal, Menu, AbstractInputSuggest, setIcon } from 'obsidian';
import { WhenValue, Task } from '../parser/types';
import { todayISO } from '../parser/dates';
import { NewTaskInput } from '../data/writer';
import { PRIORITY_CONFIG, formatDurationShort, formatWhenLabel, tagColor, tintTag } from './ui';
import { showWhenMenu, showDeadlineMenu } from './whenMenu';
import { DatePickerModal } from './DatePickerModal';
import { mergeEditedProjects } from './projectEdit';
import { setupPhoneSheet } from './phoneSheet';

interface AddTaskOptions {
  defaultWhen: WhenValue;
  projects: string[];
  tags: string[];
  onSubmit?: (input: NewTaskInput) => void | Promise<void>;
  mode?: 'create' | 'edit';
  task?: Task;                       // the original, when editing
  onSave?: (updated: Task) => void | Promise<void>;
  defaultProject?: string;
  defaultTags?: string[];
  defaultPersons?: string[];         // seeded as [[Name]] at the front of the title
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

/** Word half of the priority menu labels; the "!!!"-style marker half comes
 *  from PRIORITY_CONFIG so the two stay in sync with the rest of the UI. */
const PRIORITY_NAMES: Record<number, string> = { 1: 'High', 2: 'Medium', 3: 'Low' };

/** Autocomplete over the vault's existing tags for the modal's tag input. */
class TagSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement,
    private tags: string[],
    private onPick: (tag: string) => void,
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase().replace(/^#/, '');
    if (q === '') return this.tags.slice(0, 20);
    return this.tags.filter((t) => t.toLowerCase().includes(q)).slice(0, 20);
  }

  renderSuggestion(tag: string, el: HTMLElement): void {
    el.setText(`#${tag}`);
    el.style.color = tagColor(tag);
  }

  selectSuggestion(tag: string): void {
    this.onPick(tag);
    this.inputEl.value = '';
    this.close();
  }
}

/** Compact add-task modal: title + notes, then one row of small icon buttons that
 *  open native menus (When / Deadline / Project / Priority / Duration), plus a tag
 *  autocomplete. Mirrors the desktop QuickAdd toolbar. */
export class AddTaskModal extends Modal {
  private title = '';
  private notes = '';
  private when: WhenValue;
  private deadline: string | null = null;
  private project = '';
  private priority: number | null = null;
  private duration: number | null = null;
  private selectedTags: string[] = [];
  // Read-only in this modal: never added to selectedTags, so they can never be
  // serialized into the line (edits re-serialize from selectedTags only).
  private inheritedTags: string[] = [];
  private originalProjects: string[] = [];

  private saveBtn!: HTMLButtonElement;
  private toolbarEl!: HTMLElement;
  private tagChipsEl!: HTMLElement;
  private cleanupSheet: (() => void) | null = null;

  constructor(
    app: App,
    private opts: AddTaskOptions,
  ) {
    super(app);
    const t = opts.task;
    if (opts.mode === 'edit' && t) {
      this.title = t.title;
      this.notes = t.notes;
      this.when = t.when;
      this.deadline = t.deadline;
      this.project = t.projects[0] ?? '';
      this.originalProjects = [...t.projects];
      this.priority = t.priority;
      this.duration = t.durationMinutes;
      this.selectedTags = [...t.tags];
      this.inheritedTags = [...t.inheritedTags];
    } else {
      this.when = opts.defaultWhen;
      this.project = opts.defaultProject ?? '';
      this.selectedTags = opts.defaultTags ? [...opts.defaultTags] : [];
      if (opts.defaultPersons && opts.defaultPersons.length > 0) {
        this.title = opts.defaultPersons.map((p) => `[[${p}]]`).join(' ') + ' ';
      }
    }
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.mode === 'edit' ? 'Edit task' : 'New task');
    this.modalEl.addClass('annado-modal');
    this.cleanupSheet = setupPhoneSheet(this);

    const { contentEl } = this;

    // Title — prefixed with a checkbox-placeholder circle so it reads as a task,
    // matching the round checkboxes on every task row.
    const titleRow = contentEl.createDiv({ cls: 'annado-title-row' });
    titleRow.createSpan({ cls: 'annado-title-circle' });
    const titleInput = titleRow.createEl('input', {
      type: 'text',
      cls: 'annado-add-title',
      placeholder: 'What needs doing?',
    });
    titleInput.value = this.title;
    titleInput.addEventListener('input', () => {
      this.title = titleInput.value;
      this.updateSaveState();
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.submit();
    });

    // Notes — a distinct, lighter card with a doc icon so it's clearly secondary.
    const notesRow = contentEl.createDiv({ cls: 'annado-notes-row' });
    setIcon(notesRow.createSpan({ cls: 'annado-notes-glyph' }), 'file-text');
    const notesInput = notesRow.createEl('textarea', {
      cls: 'annado-add-notes',
      placeholder: 'Notes (optional)',
    });
    notesInput.value = this.notes;
    notesInput.addEventListener('input', () => (this.notes = notesInput.value));

    // Icon toolbar.
    this.toolbarEl = contentEl.createDiv({ cls: 'annado-toolbar' });
    this.renderToolbar();

    // Tag chips + autocomplete input.
    const tagWrap = contentEl.createDiv({ cls: 'annado-tag-wrap' });
    this.tagChipsEl = tagWrap.createDiv({ cls: 'annado-tag-chips' });
    const tagInput = tagWrap.createEl('input', {
      type: 'text',
      cls: 'annado-tag-input',
      placeholder: '＋ tag',
    });
    new TagSuggest(this.app, tagInput, this.opts.tags, (tag) => this.addTag(tag));
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const raw = tagInput.value.trim().replace(/^#+/, '');
        if (raw) this.addTag(raw);
        tagInput.value = '';
      }
    });
    this.renderTagChips();

    // Footer.
    const footer = contentEl.createDiv({ cls: 'annado-modal-footer' });
    const cancel = footer.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    this.saveBtn = footer.createEl('button', { text: 'Save', cls: 'mod-cta' });
    this.saveBtn.addEventListener('click', () => this.submit());
    this.updateSaveState();

    // Focus the title so you can type immediately. The synchronous call stays
    // within the opening tap's gesture context, which is what iOS needs to raise
    // the keyboard right away; the timeout is a fallback for desktop animation timing.
    titleInput.focus();
    window.setTimeout(() => titleInput.focus(), 50);
  }

  // ---- Toolbar ----

  private renderToolbar(): void {
    const bar = this.toolbarEl;
    bar.empty();
    const today = todayISO();

    this.toolButton(bar, 'calendar', this.whenLabel(today), this.when.kind !== 'inbox', (e) =>
      this.whenMenu(e),
    );
    this.toolButton(
      bar,
      'flag',
      this.deadline ? formatWhenLabel(this.deadline, today) : null,
      this.deadline !== null,
      (e) => this.deadlineMenu(e),
      this.deadline !== null ? () => this.setDeadline(null) : undefined,
    );
    if (this.opts.projects.length > 0) {
      this.toolButton(bar, 'folder', this.project || null, this.project !== '', (e) =>
        this.projectMenu(e),
      );
    }
    const priBtn = this.toolButton(
      bar,
      'alert-circle',
      this.priority ? PRIORITY_CONFIG[this.priority]!.label : null,
      this.priority !== null,
      (e) => this.priorityMenu(e),
    );
    if (this.priority) priBtn.style.setProperty('--tool-accent', PRIORITY_CONFIG[this.priority]!.color);
    this.toolButton(
      bar,
      'clock',
      this.duration ? formatDurationShort(this.duration) : null,
      this.duration !== null,
      (e) => this.durationMenu(e),
    );
  }

  private toolButton(
    bar: HTMLElement,
    icon: string,
    value: string | null,
    active: boolean,
    onClick: (e: MouseEvent) => void,
    onClear?: () => void,
  ): HTMLElement {
    const btn = bar.createEl('button', { cls: `annado-tool${active ? ' is-set' : ''}` });
    setIcon(btn.createSpan({ cls: 'annado-tool-icon' }), icon);
    if (value) btn.createSpan({ cls: 'annado-tool-value', text: value });
    btn.addEventListener('click', (e) => onClick(e));
    if (onClear && value) {
      const x = btn.createSpan({ cls: 'annado-tool-clear' });
      setIcon(x, 'x');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        onClear();
      });
    }
    return btn;
  }

  private whenLabel(today: string): string | null {
    switch (this.when.kind) {
      case 'inbox':
        return null;
      case 'evening':
        return 'Evening';
      case 'anytime':
        return 'Anytime';
      case 'someday':
        return 'Someday';
      case 'date':
        return formatWhenLabel(this.when.date, today);
    }
  }

  private whenMenu(e: MouseEvent): void {
    const current = this.when.kind === 'date' ? this.when.date : null;
    showWhenMenu(
      e,
      (when) => {
        this.when = when;
        this.renderToolbar();
      },
      () =>
        new DatePickerModal(this.app, current, (date) => {
          this.when = { kind: 'date', date };
          this.renderToolbar();
        }).open(),
    );
  }

  private deadlineMenu(e: MouseEvent): void {
    showDeadlineMenu(
      e,
      this.deadline !== null,
      (deadline) => this.setDeadline(deadline),
      () => new DatePickerModal(this.app, this.deadline, (date) => this.setDeadline(date)).open(),
    );
  }

  private projectMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) =>
      i.setTitle('No project').onClick(() => {
        this.project = '';
        this.renderToolbar();
      }),
    );
    for (const p of this.opts.projects) {
      menu.addItem((i) =>
        i.setTitle(p).onClick(() => {
          this.project = p;
          this.renderToolbar();
        }),
      );
    }
    menu.showAtMouseEvent(e);
  }

  private priorityMenu(e: MouseEvent): void {
    const menu = new Menu();
    for (const p of [1, 2, 3] as const) {
      const label = `${PRIORITY_NAMES[p]} ${PRIORITY_CONFIG[p].label}`;
      menu.addItem((i) =>
        i.setTitle(label).onClick(() => {
          this.priority = p;
          this.renderToolbar();
        }),
      );
    }
    menu.addSeparator();
    menu.addItem((i) =>
      i.setTitle('None').onClick(() => {
        this.priority = null;
        this.renderToolbar();
      }),
    );
    menu.showAtMouseEvent(e);
  }

  private durationMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) =>
      i.setTitle('None').onClick(() => {
        this.duration = null;
        this.renderToolbar();
      }),
    );
    for (const d of DURATIONS) {
      menu.addItem((i) =>
        i.setTitle(formatDurationShort(d)).onClick(() => {
          this.duration = d;
          this.renderToolbar();
        }),
      );
    }
    menu.showAtMouseEvent(e);
  }

  private setDeadline(v: string | null): void {
    this.deadline = v;
    this.renderToolbar();
  }

  // ---- Tags ----

  private addTag(tag: string): void {
    if (!this.selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      this.selectedTags.push(tag);
      this.renderTagChips();
    }
  }

  private renderTagChips(): void {
    this.tagChipsEl.empty();
    // Inherited (from the note's frontmatter) render first, read-only: no remove
    // button, and they never enter selectedTags — so they can never be
    // serialized into the line on save.
    for (const tag of this.inheritedTags) {
      const chip = this.tagChipsEl.createSpan({
        cls: 'annado-tag-selected is-inherited',
        attr: { title: "Inherited from the note's frontmatter" },
      });
      tintTag(chip, tag);
      chip.createSpan({ text: `#${tag}` });
    }
    for (const tag of this.selectedTags) {
      const chip = this.tagChipsEl.createSpan({ cls: 'annado-tag-selected' });
      tintTag(chip, tag);
      chip.createSpan({ text: `#${tag}` });
      const x = chip.createSpan({ cls: 'annado-tag-remove' });
      setIcon(x, 'x');
      x.addEventListener('click', () => {
        this.selectedTags = this.selectedTags.filter((t) => t !== tag);
        this.renderTagChips();
      });
    }
  }

  // ---- Save ----

  private updateSaveState(): void {
    const disabled = this.title.trim() === '';
    this.saveBtn.toggleClass('is-disabled', disabled);
    if (disabled) this.saveBtn.setAttribute('disabled', 'true');
    else this.saveBtn.removeAttribute('disabled');
  }

  private submit(): void {
    if (this.title.trim() === '') return;
    if (this.opts.mode === 'edit' && this.opts.task && this.opts.onSave) {
      const updated: Task = {
        ...this.opts.task,
        title: this.title.trim(),
        notes: this.notes,
        when: this.when,
        deadline: this.deadline,
        projects: mergeEditedProjects(this.originalProjects, this.project),
        tags: [...this.selectedTags],
        priority: this.priority,
        durationMinutes: this.duration,
      };
      this.close();
      void this.opts.onSave(updated);
      return;
    }
    const input: NewTaskInput = {
      title: this.title.trim(),
      when: this.when,
      notes: this.notes,
      deadline: this.deadline,
      projects: mergeEditedProjects(this.originalProjects, this.project),
      tags: [...this.selectedTags],
      priority: this.priority,
      durationMinutes: this.duration,
    };
    this.close();
    void this.opts.onSubmit?.(input);
  }

  onClose(): void {
    this.cleanupSheet?.();
    this.contentEl.empty();
  }
}
