// Single-field editor sheet for the expanded card's title/notes on mobile.
// Naked inline fields in the scrolling list fight iOS's native keyboard pan
// (the "blank pane" bug); a modal doesn't — Obsidian + the AddTaskModal's
// visualViewport clamp handle the keyboard reliably. Desktop keeps true
// inline editing; this sheet is the phone path of wireInlineEdit.
import { App, Modal } from 'obsidian';
import { setupPhoneSheet } from './phoneSheet';

interface InlineEditOptions {
  /** Modal heading, e.g. 'Edit title' / 'Edit notes'. */
  heading: string;
  value: string;
  multiline: boolean;
  /** Called with the new text; skipped when empty or unchanged (same rule as
   *  the desktop inline edit). */
  onSave: (next: string) => Promise<void>;
}

export class InlineEditModal extends Modal {
  private field!: HTMLInputElement | HTMLTextAreaElement;
  private cleanupSheet: (() => void) | null = null;

  constructor(
    app: App,
    private opts: InlineEditOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.heading);
    this.modalEl.addClass('annado-modal', 'annado-inline-modal');

    // Same phone-sheet treatment as AddTaskModal: bottom sheet clamped to the
    // visual viewport so the keyboard never covers it.
    this.cleanupSheet = setupPhoneSheet(this);

    if (this.opts.multiline) {
      const area = this.contentEl.createEl('textarea', { cls: 'annado-inline-modal-field is-notes' });
      area.value = this.opts.value;
      this.field = area;
    } else {
      const input = this.contentEl.createEl('input', {
        cls: 'annado-inline-modal-field',
        attr: { type: 'text' },
      });
      input.value = this.opts.value;
      // Enter commits a single-line edit (notes keep Enter for newlines).
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.close();
        }
      });
      this.field = input;
    }

    const footer = this.contentEl.createDiv({ cls: 'annado-inline-modal-footer' });
    const save = footer.createEl('button', { cls: 'mod-cta', text: 'Save' });
    save.addEventListener('click', () => this.close());

    this.field.focus();
    window.setTimeout(() => this.field.focus(), 50);
  }

  onClose(): void {
    this.cleanupSheet?.();
    // Auto-save on any dismissal (Save, backdrop tap, Escape) — mirrors the
    // desktop inline edit's save-on-blur. Empty or unchanged → no write.
    const next = this.field.value;
    if (next !== this.opts.value && next.trim() !== '') void this.opts.onSave(next);
    this.contentEl.empty();
  }
}
