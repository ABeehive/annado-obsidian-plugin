import { App, FuzzySuggestModal, FuzzyMatch, setIcon } from 'obsidian';
import { Task } from '../parser/types';
import { projectColor } from './ui';

export type FindItem =
  | { kind: 'task'; task: Task }
  | { kind: 'project' | 'person' | 'tag'; name: string };

export interface QuickFindCallbacks {
  revealTask: (task: Task) => void;
  openProject: (name: string) => void;
  openPerson: (name: string) => void;
  openTag: (name: string) => void;
}

/** Fuzzy finder over open tasks + projects + people + tags. Navigation is delegated
 *  to the view (reveal / open detail); this modal owns only presentation + dispatch. */
export class QuickFind extends FuzzySuggestModal<FindItem> {
  constructor(
    app: App,
    private items: FindItem[],
    private cb: QuickFindCallbacks,
  ) {
    super(app);
    this.setPlaceholder('Find a task, project, person or tag…');
  }

  getItems(): FindItem[] {
    return this.items;
  }

  getItemText(item: FindItem): string {
    return item.kind === 'task' ? item.task.title : item.name;
  }

  renderSuggestion(match: FuzzyMatch<FindItem>, el: HTMLElement): void {
    const item = match.item;
    el.addClass('annado-find-item');
    const icon = el.createSpan({ cls: 'annado-find-icon' });
    if (item.kind === 'task') {
      setIcon(icon, 'circle');
      el.createSpan({ cls: 'annado-find-label', text: item.task.title || '(untitled)' });
    } else if (item.kind === 'project') {
      setIcon(icon, 'folder');
      icon.style.color = projectColor(item.name);
      el.createSpan({ cls: 'annado-find-label', text: item.name });
    } else if (item.kind === 'person') {
      setIcon(icon, 'user');
      el.createSpan({ cls: 'annado-find-label', text: item.name });
    } else {
      setIcon(icon, 'tag');
      el.createSpan({ cls: 'annado-find-label', text: item.name });
    }
    el.createSpan({ cls: 'annado-find-kind', text: item.kind });
  }

  onChooseItem(item: FindItem): void {
    if (item.kind === 'task') this.cb.revealTask(item.task);
    else if (item.kind === 'project') this.cb.openProject(item.name);
    else if (item.kind === 'person') this.cb.openPerson(item.name);
    else this.cb.openTag(item.name);
  }
}
