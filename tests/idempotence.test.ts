import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/parser/parser';
import { updateTaskInContent } from '../src/parser/contentEdit';

const TODAY = '2026-07-09';
const OPTS = {
  fileProject: null,
  projectNames: new Set<string>(),
  format: 'annado' as const,
  marker: '',
};

/** parse → update with the UNCHANGED task → content must be byte-identical. */
function expectIdempotent(content: string, path = 'Notes/test.md') {
  const tasks = parseFile(content, path, TODAY);
  expect(tasks.length).toBeGreaterThan(0);
  for (const task of tasks) {
    const res = updateTaskInContent(content, task, OPTS);
    expect(res.ok).toBe(true);
    expect(res.content).toBe(content);
  }
}

describe('whole-file idempotence', () => {
  it('plain task with checklist', () => {
    expectIdempotent('- [ ] Task one\n    - [ ] sub a\n    - [x] sub b\n');
  });
  it('non-standard checkbox lines are notes and must not duplicate', () => {
    expectIdempotent('- [ ] Task\n    - [-] cancelled thing\n    - [/] in progress\n');
  });
  it('markdown-link bullets are notes and must not duplicate', () => {
    expectIdempotent('- [ ] Read up\n    - [some article](https://example.com)\n');
  });
  it('double update never grows the file', () => {
    const content = '- [ ] Task\n    - [-] weird\n';
    const task = parseFile(content, 'a.md', TODAY)[0]!;
    const once = updateTaskInContent(content, task, OPTS).content;
    const t2 = parseFile(once, 'a.md', TODAY)[0]!;
    const twice = updateTaskInContent(once, t2, OPTS).content;
    expect(twice).toBe(once);
    expect(twice.split('\n').length).toBe(content.split('\n').length);
  });
  it('multi-paragraph notes with blank lines survive an unchanged update', () => {
    expectIdempotent('- [ ] Task\n    First paragraph\n\n    Second paragraph\n');
  });
  it('nested note bullets keep their relative indentation', () => {
    expectIdempotent('- [ ] Task\n    Some context:\n        - deep bullet\n        - another\n');
  });
  it('note/checklist interleaving is preserved', () => {
    expectIdempotent('- [ ] Task\n    intro note\n    - [ ] step one\n    afterthought\n    - [ ] step two\n');
  });
  it('CRLF file with notes survives an unchanged update', () => {
    expectIdempotent('- [ ] Task\r\n    a note\r\n\r\n    more\r\n');
  });
  it('unparseable @when/@duration values round-trip instead of being dropped', () => {
    expectIdempotent('- [ ] Odd one @when(next week) @duration(a while)\n');
  });
  it('wikilink anchors and URL fragments are not mistaken for tags', () => {
    expectIdempotent('- [ ] See [[Note#Heading]] https://ex.com/a#sec #tag\n');
  });
  it('multiple tasks with notes and checklists, separated by a blank line', () => {
    expectIdempotent(
      '- [ ] Task one\n    note one\n    - [ ] sub one\n\n- [ ] Task two\n    note two\n    - [ ] sub two\n',
    );
  });
  it('indented task (indent < 4) with a deeper note line', () => {
    expectIdempotent('  - [ ] Indented\n    deeper note\n');
  });
  it('tab-indented note line', () => {
    expectIdempotent('- [ ] T\n\tTabbed note\n');
  });
});
