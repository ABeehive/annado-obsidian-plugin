// Plain-DOM port of src/components/MarkdownNotesRenderer.tsx (InlineMarkdown +
// the block renderer). Renders the small markdown subset Annado supports in task
// titles, checklist items, and notes: bold/italic/strike/code inline, plus
// headings / blockquote / list-item / paragraph blocks. Wiki-links and markdown
// links are rendered as interactive chips/anchors via the shared context.

import { setIcon } from 'obsidian';
import { projectColor, TITLE_LINK_RE } from './ui';

export interface RenderContext {
  personNames: ReadonlySet<string>;
  projectNames: ReadonlySet<string>;
  openProject: (name: string) => void;
  openPerson: (name: string) => void;
}

// Ordered so ** is checked before * (else one star is consumed at a time).
const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_/g;

type InlineToken =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'code'; content: string }
  | { type: 'strike'; content: string };

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  const re = new RegExp(INLINE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', content: text.slice(last, m.index) });
    if (m[1] !== undefined || m[2] !== undefined) {
      tokens.push({ type: 'bold', content: (m[1] ?? m[2])! });
    } else if (m[3] !== undefined) {
      tokens.push({ type: 'strike', content: m[3] });
    } else if (m[4] !== undefined) {
      tokens.push({ type: 'code', content: m[4] });
    } else if (m[5] !== undefined || m[6] !== undefined) {
      tokens.push({ type: 'italic', content: (m[5] ?? m[6])! });
    }
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ type: 'text', content: text.slice(last) });
  return tokens;
}

/** Links must survive emphasis tokenization (underscores/asterisks inside a URL
 *  would otherwise shred it). Extract links as atomic text tokens first; only the
 *  gaps between them get emphasis parsing. Same tradeoff as the desktop. */
function tokenizeProtectingLinks(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = new RegExp(TITLE_LINK_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(...tokenizeInline(text.slice(last, m.index)));
    tokens.push({ type: 'text', content: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push(...tokenizeInline(text.slice(last)));
  return tokens;
}

/** Render one line of inline markdown into `el`. */
export function renderInline(el: HTMLElement, text: string, ctx: RenderContext): void {
  for (const tok of tokenizeProtectingLinks(text)) {
    if (tok.type === 'code') {
      el.createEl('code', { cls: 'annado-md-code', text: tok.content });
    } else if (tok.type === 'bold') {
      renderLinks(el.createEl('strong', { cls: 'annado-md-bold' }), tok.content, ctx);
    } else if (tok.type === 'italic') {
      renderLinks(el.createEl('em'), tok.content, ctx);
    } else if (tok.type === 'strike') {
      renderLinks(el.createEl('s', { cls: 'annado-md-strike' }), tok.content, ctx);
    } else {
      renderLinks(el, tok.content, ctx);
    }
  }
}

/** Render text that may contain [[wikilinks]] and [text](url) links (port of
 *  RenderTitleWithLinks): person → blue chip, project → tinted chip, unknown
 *  wiki-link → plain text, markdown link → anchor. */
function renderLinks(el: HTMLElement, text: string, ctx: RenderContext): void {
  const re = new RegExp(TITLE_LINK_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) el.appendText(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const name = m[1];
      if (ctx.personNames.has(name)) {
        const chip = el.createSpan({ cls: 'annado-person-chip' });
        setIcon(chip.createSpan({ cls: 'annado-mini-icon' }), 'user');
        chip.createSpan({ text: name });
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          ctx.openPerson(name);
        });
      } else if (ctx.projectNames.has(name)) {
        const color = projectColor(name);
        const chip = el.createSpan({ cls: 'annado-project-chip' });
        chip.style.backgroundColor = `${color}20`;
        chip.style.color = color;
        chip.createSpan({ cls: 'annado-chip-dot' }).style.backgroundColor = color;
        chip.createSpan({ text: name });
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          ctx.openProject(name);
        });
      } else {
        el.appendText(name); // unknown wiki-link: plain text without brackets
      }
    } else if (m[2] !== undefined && m[3] !== undefined) {
      const link = el.createEl('a', { text: m[2], cls: 'annado-md-link', href: m[3] });
      link.addEventListener('click', (e) => e.stopPropagation());
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendText(text.slice(last));
}

const CHECKBOX_LINE = /^- \[[ xX]\] /;

/** Render a multi-line notes block (port of MarkdownNotesRenderer's block loop). */
export function renderNotes(container: HTMLElement, notes: string, ctx: RenderContext): void {
  for (const line of notes.split('\n')) {
    if (line === '') {
      container.createDiv({ cls: 'annado-md-gap' });
      continue;
    }
    if (line.startsWith('### ')) {
      renderInline(container.createDiv({ cls: 'annado-md-h3' }), line.slice(4), ctx);
    } else if (line.startsWith('## ')) {
      renderInline(container.createDiv({ cls: 'annado-md-h2' }), line.slice(3), ctx);
    } else if (line.startsWith('# ')) {
      renderInline(container.createDiv({ cls: 'annado-md-h1' }), line.slice(2), ctx);
    } else if (line.startsWith('> ')) {
      renderInline(container.createDiv({ cls: 'annado-md-quote' }), line.slice(2), ctx);
    } else if (CHECKBOX_LINE.test(line.trim())) {
      // Checklist lines are rendered separately by the caller.
      continue;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const li = container.createDiv({ cls: 'annado-md-li' });
      li.createSpan({ cls: 'annado-md-bullet', text: '•' });
      renderInline(li.createSpan(), line.slice(2), ctx);
    } else {
      renderInline(container.createDiv({ cls: 'annado-md-p' }), line, ctx);
    }
  }
}
