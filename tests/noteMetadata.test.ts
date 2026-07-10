import { describe, expect, it } from 'vitest';
import {
  extractFirstParagraph,
  parsePersonMetadata,
  parseProjectMetadata,
  parseWikilink,
} from '../src/parser/noteMetadata';

describe('parseProjectMetadata — scalar fallback keys', () => {
  it('reads each field from its primary key', () => {
    const m = parseProjectMetadata(
      {
        description: 'A project',
        date_deadline: '2026-08-12',
        date_start: '2026-06-01',
        ranking: 'high',
      },
      '',
    );
    expect(m.description).toBe('A project');
    expect(m.deadline).toBe('2026-08-12');
    expect(m.startDate).toBe('2026-06-01');
    expect(m.ranking).toBe('high');
  });

  it('falls back through the alternate keys in order', () => {
    const m = parseProjectMetadata(
      { summary: 'Summary text', due: '2026-01-01', started: '2025-12-01', rank: '2' },
      '',
    );
    expect(m.description).toBe('Summary text');
    expect(m.deadline).toBe('2026-01-01');
    expect(m.startDate).toBe('2025-12-01');
    expect(m.ranking).toBe('2');
  });

  it('a PRESENT key with an unusable value wins the chain and yields null (Rust break-on-presence)', () => {
    const m = parseProjectMetadata({ description: ['not', 'a', 'string'], desc: 'ignored' }, '');
    expect(m.description).toBeNull();
  });

  it('stringifies numbers and booleans like yaml_to_string', () => {
    const m = parseProjectMetadata({ priority: 1, deadline: 20260101 }, '');
    expect(m.ranking).toBe('1');
    expect(m.deadline).toBe('20260101');
  });
});

describe('parseProjectMetadata — description body fallback', () => {
  it('uses the first body paragraph when frontmatter has no description', () => {
    const m = parseProjectMetadata({ deadline: '2026-01-01' }, '# Head\n\nFirst para line one\nline two\n\nSecond para');
    expect(m.description).toBe('First para line one line two');
  });

  it('uses the body when there is no frontmatter at all', () => {
    const m = parseProjectMetadata(null, 'Intro text.\n\n- [ ] a task');
    expect(m.description).toBe('Intro text.');
    expect(m.deadline).toBeNull();
  });
});

describe('extractFirstParagraph', () => {
  it('skips headings, task lines and leading blanks; joins lines; stops at a blank line', () => {
    expect(extractFirstParagraph('\n# H1\n- [ ] task\nreal text\nmore\n\nnext para')).toBe('real text more');
  });
  it('returns null for content with nothing but headings/tasks', () => {
    expect(extractFirstParagraph('# H\n- [ ] a\n- [x] b\n')).toBeNull();
  });
});

describe('parseProjectMetadata — persons', () => {
  it('cleans wikilinks, paths and numeric prefixes; list form', () => {
    const m = parseProjectMetadata({ persons: ['[[01. Persons/Jane Doe]]', 'Bob'] }, '');
    expect(m.persons).toEqual(['Jane Doe', 'Bob']);
  });

  it('accepts a single scalar value', () => {
    expect(parseProjectMetadata({ person: '[[Alice]]' }, '').persons).toEqual(['Alice']);
  });

  it('an empty result moves on to the next key (non-empty wins)', () => {
    const m = parseProjectMetadata({ persons: [], people: ['Carol'] }, '');
    expect(m.persons).toEqual(['Carol']);
  });
});

describe('parseProjectMetadata — milestones', () => {
  it('parses valid items and skips malformed ones (missing name/completed, wrong-typed dates)', () => {
    const m = parseProjectMetadata(
      {
        milestones: [
          { name: 'Phase 1', completed: true, end: '2026-07-15' },
          { name: 'Phase 2', completed: false, start: '2026-08-01', end: null },
          { name: 'No completed flag' },
          { completed: true },
          { name: 'Bad date', completed: false, end: 20260101 },
          'not an object',
        ],
      },
      '',
    );
    expect(m.milestones).toEqual([
      { name: 'Phase 1', completed: true, start: null, end: '2026-07-15' },
      { name: 'Phase 2', completed: false, start: '2026-08-01', end: null },
    ]);
  });

  it('non-list milestones value yields an empty list', () => {
    expect(parseProjectMetadata({ milestones: 'oops' }, '').milestones).toEqual([]);
  });
});

describe('parsePersonMetadata', () => {
  it('reads all fields with their fallback keys', () => {
    const m = parsePersonMetadata({
      name: 'Jane Doe',
      organization: 'Acme',
      relation: 'colleague',
      language: 'Dutch, English',
      projects: ['[[02. Projects/Website Redesign]]', '[[Personal]]'],
    });
    expect(m.name).toBe('Jane Doe');
    expect(m.organisation).toBe('Acme');
    expect(m.relationship).toBe('colleague');
    expect(m.languages).toEqual(['Dutch', 'English']);
    expect(m.projects).toEqual(['Website Redesign', 'Personal']);
  });

  it('languages accepts a real list too, and empty results fall through to the next key', () => {
    const m = parsePersonMetadata({ languages: [], lang: ['German'] });
    expect(m.languages).toEqual(['German']);
  });

  it('no frontmatter → all-empty metadata', () => {
    const m = parsePersonMetadata(null);
    expect(m).toEqual({ name: null, organisation: null, relationship: null, languages: [], projects: [] });
  });
});

describe('parseWikilink', () => {
  it('unwraps [[…]] and takes the last path segment', () => {
    expect(parseWikilink('[[02. Projects/Sub/VBR]]')).toBe('VBR');
    expect(parseWikilink('Plain Name')).toBe('Plain Name');
    expect(parseWikilink('  [[X]]  ')).toBe('X');
  });
});
