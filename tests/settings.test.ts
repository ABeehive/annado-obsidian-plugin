import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, isPathExcluded, mergeSettings } from '../src/settings';

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

describe('mergeSettings', () => {
  it('null/undefined input yields the defaults', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults: inheritFrontmatterTags is off, excludedTags is empty', () => {
    expect(DEFAULT_SETTINGS.inheritFrontmatterTags).toBe(false);
    expect(DEFAULT_SETTINGS.excludedTags).toEqual([]);
  });

  it('a valid inheritFrontmatterTags/excludedTags round-trip intact', () => {
    const loaded = {
      ...DEFAULT_SETTINGS,
      inheritFrontmatterTags: true,
      excludedTags: ['werk', 'Privé'],
    };
    expect(mergeSettings(loaded)).toEqual(loaded);
  });

  it('sanitizes a non-boolean inheritFrontmatterTags back to the default', () => {
    const merged = mergeSettings({ inheritFrontmatterTags: 'yes' });
    expect(merged.inheritFrontmatterTags).toBe(false);
  });

  it('sanitizes a non-array excludedTags to []', () => {
    const merged = mergeSettings({ excludedTags: 'werk' });
    expect(merged.excludedTags).toEqual([]);
  });

  it('drops non-string entries from excludedTags, keeping the rest in order', () => {
    const merged = mergeSettings({ excludedTags: ['a', 3, null, 'b'] });
    expect(merged.excludedTags).toEqual(['a', 'b']);
  });

  it('a valid mirror and queue survive the round-trip intact', () => {
    const loaded = {
      ...DEFAULT_SETTINGS,
      sharedMirror: '{"schemaVersion":1}',
      pendingColorEdits: [
        { kind: 'tag', name: 'Admin', color: '#E53935' },
        { kind: 'project', name: 'X', color: null },
      ],
    };
    expect(mergeSettings(loaded)).toEqual(loaded);
  });

  it('sanitizes garbage in the sync-plumbing fields (other devices write data.json)', () => {
    const merged = mergeSettings({
      sharedMirror: 42,
      pendingColorEdits: [
        { kind: 'tag', name: 'ok', color: null }, // valid: null color = clear
        { kind: 'person', name: 'bad-kind', color: '#111111' },
        { kind: 'tag', color: '#111111' }, // missing name
        { kind: 'project', name: 'bad-color', color: 7 },
        'not-an-object',
      ],
    });
    expect(merged.sharedMirror).toBeNull();
    expect(merged.pendingColorEdits).toEqual([{ kind: 'tag', name: 'ok', color: null }]);
    const noArray = mergeSettings({ pendingColorEdits: 'nope' });
    expect(noArray.pendingColorEdits).toEqual([]);
  });

  it('a legacy pre-0.3.0 data.json keeps its fields and gains the new defaults', () => {
    const merged = mergeSettings({ projectsPattern: 'Projecten', taskMarker: '#task' });
    expect(merged.projectsPattern).toBe('Projecten');
    expect(merged.taskMarker).toBe('#task');
    expect(merged.sharedMirror).toBeNull();
    expect(merged.pendingColorEdits).toEqual([]);
  });
});
