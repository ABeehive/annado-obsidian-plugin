import { App, Modal, setIcon } from 'obsidian';
import { todayISO } from '../parser/dates';
import { FULL_MONTHS, WEEKDAYS_SHORT } from './ui';

const iso = (y: number, m0: number, d: number): string =>
  `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** A tap-friendly month calendar for picking an arbitrary date. Obsidian's mobile
 *  webview doesn't open native `<input type="date">` pickers, so we build one from
 *  buttons (which do work). Used by the deadline- and when-menus' "Pick a date…". */
export class DatePickerModal extends Modal {
  private year: number;
  private month: number; // 0-based
  private monthTitle!: HTMLElement;
  private grid!: HTMLElement;
  private selected: string | null;

  constructor(
    app: App,
    initial: string | null,
    private onPick: (date: string) => void,
  ) {
    super(app);
    this.selected = initial;
    const base = initial ?? todayISO();
    const [y, m] = base.split('-').map(Number) as [number, number, number];
    this.year = y;
    this.month = m - 1;
  }

  onOpen(): void {
    this.modalEl.addClass('annado-datepicker');

    const head = this.contentEl.createDiv({ cls: 'annado-dp-head' });
    const prev = head.createEl('button', { cls: 'annado-dp-nav', attr: { 'aria-label': 'Previous month' } });
    setIcon(prev, 'chevron-left');
    prev.addEventListener('click', () => this.shiftMonth(-1));
    this.monthTitle = head.createDiv({ cls: 'annado-dp-title' });
    const next = head.createEl('button', { cls: 'annado-dp-nav', attr: { 'aria-label': 'Next month' } });
    setIcon(next, 'chevron-right');
    next.addEventListener('click', () => this.shiftMonth(1));

    const weekdays = this.contentEl.createDiv({ cls: 'annado-dp-weekdays' });
    for (const w of WEEKDAYS_SHORT) weekdays.createSpan({ text: w });

    this.grid = this.contentEl.createDiv({ cls: 'annado-dp-grid' });
    this.renderMonth();
  }

  private shiftMonth(delta: number): void {
    this.month += delta;
    if (this.month < 0) {
      this.month = 11;
      this.year--;
    } else if (this.month > 11) {
      this.month = 0;
      this.year++;
    }
    this.renderMonth();
  }

  private renderMonth(): void {
    this.monthTitle.setText(`${FULL_MONTHS[this.month]} ${this.year}`);
    this.grid.empty();
    const today = todayISO();
    // Weekday of the 1st, Monday-first (JS getUTCDay is Sunday-first).
    const jsDay = new Date(Date.UTC(this.year, this.month, 1)).getUTCDay();
    const lead = (jsDay + 6) % 7;
    for (let i = 0; i < lead; i++) this.grid.createSpan({ cls: 'annado-dp-pad' });
    const days = new Date(Date.UTC(this.year, this.month + 1, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const date = iso(this.year, this.month, d);
      let cls = 'annado-dp-day';
      if (date === today) cls += ' is-today';
      if (date === this.selected) cls += ' is-selected';
      const btn = this.grid.createEl('button', { cls, text: String(d) });
      btn.addEventListener('click', () => {
        this.onPick(date);
        this.close();
      });
    }
  }
}
