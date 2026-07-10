import { describe, it, expect } from 'vitest';
import { mergeEditedProjects } from '../src/views/projectEdit';

describe('mergeEditedProjects', () => {
  it('keeps secondary projects when primary is unchanged', () => {
    expect(mergeEditedProjects(['A', 'B', 'C'], 'A')).toEqual(['A', 'B', 'C']);
  });
  it('replaces only the primary project', () => {
    expect(mergeEditedProjects(['A', 'B'], 'X')).toEqual(['X', 'B']);
  });
  it('clearing the primary keeps the secondaries', () => {
    expect(mergeEditedProjects(['A', 'B'], '')).toEqual(['B']);
  });
  it('no projects + selection yields just the selection', () => {
    expect(mergeEditedProjects([], 'X')).toEqual(['X']);
  });
  it('never duplicates a project already in the tail', () => {
    expect(mergeEditedProjects(['A', 'B'], 'B')).toEqual(['B']);
  });
});
