import { Menu } from 'obsidian';
import { WhenValue } from '../parser/types';
import { todayISO, addDaysISO, thisWeekendISO, nextMondayISO } from '../parser/dates';

/** The relative date presets shared by the when- and deadline-menus. */
export function datePresets(today: string): { label: string; date: string }[] {
  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDaysISO(today, 1) },
    { label: 'This weekend', date: thisWeekendISO(today) },
    { label: 'Next week', date: nextMondayISO(today) },
  ];
}

/** The shared "when" chooser used by the add/edit modal and the row pill.
 *  `onPickDate` is invoked for "Pick a date…" (caller shows a native date input). */
export function showWhenMenu(
  evt: MouseEvent,
  onPick: (when: WhenValue) => void,
  onPickDate: () => void,
): void {
  const today = todayISO();
  const menu = new Menu();
  const opt = (label: string, value: WhenValue) =>
    menu.addItem((i) => i.setTitle(label).onClick(() => onPick(value)));
  opt('Inbox', { kind: 'inbox' });
  for (const p of datePresets(today)) opt(p.label, { kind: 'date', date: p.date });
  opt('Evening', { kind: 'evening' });
  opt('Anytime', { kind: 'anytime' });
  opt('Someday', { kind: 'someday' });
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('Pick a date…').setIcon('calendar').onClick(() => onPickDate()));
  menu.showAtMouseEvent(evt);
}

/** The deadline chooser — same date presets as the when-menu (native date pickers don't
 *  open in Obsidian's mobile webview, so this menu mirrors how "when" works).
 *  `onPickDate` opens the custom calendar for an arbitrary date. */
export function showDeadlineMenu(
  evt: MouseEvent,
  hasDeadline: boolean,
  onPick: (deadline: string | null) => void,
  onPickDate: () => void,
): void {
  const today = todayISO();
  const menu = new Menu();
  for (const p of datePresets(today)) {
    menu.addItem((i) => i.setTitle(p.label).onClick(() => onPick(p.date)));
  }
  menu.addItem((i) => i.setTitle('Pick a date…').setIcon('calendar').onClick(() => onPickDate()));
  if (hasDeadline) {
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Clear deadline').setIcon('x').onClick(() => onPick(null)));
  }
  menu.showAtMouseEvent(evt);
}
