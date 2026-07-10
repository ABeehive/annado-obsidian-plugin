import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private opts: { title: string; body?: string; confirmText?: string; onConfirm: () => void },
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.title);
    this.modalEl.addClass('annado-confirm');
    if (this.opts.body) this.contentEl.createEl('p', { text: this.opts.body, cls: 'annado-confirm-body' });
    const row = this.contentEl.createDiv({ cls: 'annado-modal-footer' });
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const confirm = row.createEl('button', { text: this.opts.confirmText ?? 'Delete', cls: 'mod-warning' });
    confirm.addEventListener('click', () => {
      this.close();
      this.opts.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
