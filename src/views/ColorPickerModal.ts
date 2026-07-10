import { App, Modal } from 'obsidian';
import { PROJECT_COLORS } from './ui';

interface ColorPickerOptions {
  /** Modal title (the project name). */
  title: string;
  /** Currently resolved color — its swatch gets a ring. */
  current: string;
  /** Whether an explicit override exists (highlights "Default" when not). */
  hasOverride: boolean;
  /** Called with the picked palette color, or null for "Default" (clear override). */
  onChoose: (color: string | null) => void;
}

/** Compact palette grid over the fixed desktop palette + a "Default" action that
 *  clears the override (back to the name-hash color). Same visual language as the
 *  desktop color picker; a modal because Obsidian's Menu can't host a grid. */
export class ColorPickerModal extends Modal {
  constructor(
    app: App,
    private opts: ColorPickerOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('annado-color-modal');
    this.titleEl.setText(this.opts.title);
    const grid = this.contentEl.createDiv({ cls: 'annado-color-grid' });
    for (const color of PROJECT_COLORS) {
      const swatch = grid.createEl('button', {
        cls: 'annado-color-swatch',
        attr: { 'aria-label': `Set color ${color}` },
      });
      swatch.style.background = color;
      if (this.opts.hasOverride && color.toLowerCase() === this.opts.current.toLowerCase()) {
        swatch.addClass('is-current');
      }
      swatch.addEventListener('click', () => {
        this.close();
        this.opts.onChoose(color);
      });
    }
    const def = this.contentEl.createEl('button', {
      cls: `annado-color-default${this.opts.hasOverride ? '' : ' is-current'}`,
      text: 'Default',
      attr: { 'aria-label': 'Use the default color' },
    });
    def.addEventListener('click', () => {
      this.close();
      this.opts.onChoose(null);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
