import { describe, it, expect } from 'vitest';
import { isPathExcluded } from '../src/settings';

describe('isPathExcluded', () => {
  it('folder pattern excludes the folder contents', () => {
    expect(isPathExcluded('Archive/old.md', ['Archive/'])).toBe(true);
  });
  it('folder pattern does NOT exclude sibling folders/files sharing the prefix', () => {
    expect(isPathExcluded('Archives/notes.md', ['Archive/'])).toBe(false);
    expect(isPathExcluded('Archive-2024.md', ['Archive/'])).toBe(false);
  });
  it('file pattern still matches exact / .md / subtree forms', () => {
    expect(isPathExcluded('Notes/File.md', ['Notes/File.md'])).toBe(true);
    expect(isPathExcluded('Notes/File.md', ['Notes/File'])).toBe(true);
    expect(isPathExcluded('Notes/File/sub.md', ['Notes/File'])).toBe(true);
  });
});
