import { describe, expect, it } from 'vitest';
import { applySharedToSettings, parseSharedConfig, withProjectColor } from '../src/data/sharedConfig';
import { DEFAULT_SETTINGS } from '../src/settings';

const FULL = JSON.stringify({
  schemaVersion: 1,
  generatedBy: 'annado-desktop',
  excludedPaths: ['Archive/', 'Templates/Meeting.md'],
  projectColors: { 'Website Redesign': '#e84545' },
  tagColors: { design: '#5aa9e6' },
  taskFormat: 'obsidian_tasks',
  taskMarkerTag: '#task',
  inheritFrontmatterTags: false,
});

describe('parseSharedConfig', () => {
  it('parses a full valid document', () => {
    const c = parseSharedConfig(FULL)!;
    expect(c.projectColors).toEqual({ 'Website Redesign': '#e84545' });
    expect(c.tagColors).toEqual({ design: '#5aa9e6' });
    expect(c.taskFormat).toBe('obsidian_tasks');
    expect(c.taskMarkerTag).toBe('#task');
    expect(c.excludedPaths).toEqual(['Archive/', 'Templates/Meeting.md']);
  });

  it('returns null for missing or malformed input', () => {
    expect(parseSharedConfig(null)).toBeNull();
    expect(parseSharedConfig('not json {')).toBeNull();
    expect(parseSharedConfig('42')).toBeNull();
    expect(parseSharedConfig('[1,2]')).toBeNull();
  });

  it('treats absent or wrong-typed fields as absent, not errors', () => {
    const c = parseSharedConfig('{"schemaVersion":1,"projectColors":"oops","taskFormat":7}')!;
    expect(c.projectColors).toEqual({});
    expect(c.tagColors).toEqual({});
    expect(c.taskFormat).toBeNull();
    expect(c.taskMarkerTag).toBeNull();
    expect(c.excludedPaths).toBeNull();
  });

  it('drops non-string values inside color maps but keeps the rest', () => {
    const c = parseSharedConfig('{"projectColors":{"A":"#111111","B":7},"tagColors":{"x":"#222222"}}')!;
    expect(c.projectColors).toEqual({ A: '#111111' });
    expect(c.tagColors).toEqual({ x: '#222222' });
  });

  it('empty-string taskFormat means unset; empty taskMarkerTag is meaningful (import all)', () => {
    const c = parseSharedConfig('{"taskFormat":"","taskMarkerTag":""}')!;
    expect(c.taskFormat).toBeNull();
    expect(c.taskMarkerTag).toBe('');
  });

  it('keeps the raw object, including unknown fields', () => {
    const c = parseSharedConfig('{"schemaVersion":2,"futureField":{"a":1}}')!;
    expect(c.raw['futureField']).toEqual({ a: 1 });
    expect(c.raw['schemaVersion']).toBe(2);
  });
});

describe('applySharedToSettings', () => {
  it('shared parser settings win over local ones', () => {
    const merged = applySharedToSettings(DEFAULT_SETTINGS, parseSharedConfig(FULL)!);
    expect(merged.taskFormat).toBe('obsidian_tasks');
    expect(merged.taskMarker).toBe('#task');
    expect(merged.excludedPaths).toEqual(['Archive/', 'Templates/Meeting.md']);
  });

  it('absent shared fields leave local values untouched', () => {
    const local = { ...DEFAULT_SETTINGS, taskFormat: 'dataview' as const, taskMarker: '#x', excludedPaths: ['Keep/'] };
    const merged = applySharedToSettings(local, parseSharedConfig('{"schemaVersion":1}')!);
    expect(merged.taskFormat).toBe('dataview');
    expect(merged.taskMarker).toBe('#x');
    expect(merged.excludedPaths).toEqual(['Keep/']);
  });

  it('empty taskMarkerTag overrides local marker with "" (import all)', () => {
    const local = { ...DEFAULT_SETTINGS, taskMarker: '#task' };
    const merged = applySharedToSettings(local, parseSharedConfig('{"taskMarkerTag":""}')!);
    expect(merged.taskMarker).toBe('');
  });

  it('never touches non-shared settings', () => {
    const merged = applySharedToSettings(DEFAULT_SETTINGS, parseSharedConfig(FULL)!);
    expect(merged.projectsPattern).toBe(DEFAULT_SETTINGS.projectsPattern);
    expect(merged.dailyNotesFolder).toBe(DEFAULT_SETTINGS.dailyNotesFolder);
  });

  it('empty excludedPaths overrides local exclusions with [] (exclude nothing)', () => {
    const local = { ...DEFAULT_SETTINGS, excludedPaths: ['Archive/'] };
    const merged = applySharedToSettings(local, parseSharedConfig('{"excludedPaths":[]}')!);
    expect(merged.excludedPaths).toEqual([]);
  });
});

describe('withProjectColor', () => {
  it('sets a color and stamps generatedBy, preserving everything else', () => {
    const out = JSON.parse(withProjectColor(FULL, 'New Project', '#43A047'));
    expect(out.projectColors).toEqual({ 'Website Redesign': '#e84545', 'New Project': '#43A047' });
    expect(out.generatedBy).toBe('annado-mobile');
    expect(out.schemaVersion).toBe(1);
    expect(out.excludedPaths).toEqual(['Archive/', 'Templates/Meeting.md']);
    expect(out.tagColors).toEqual({ design: '#5aa9e6' });
    expect(out.inheritFrontmatterTags).toBe(false);
    expect(out.taskFormat).toBe('obsidian_tasks');
  });

  it('changes an existing color', () => {
    const out = JSON.parse(withProjectColor(FULL, 'Website Redesign', '#1E88E5'));
    expect(out.projectColors['Website Redesign']).toBe('#1E88E5');
  });

  it('null removes the override', () => {
    const out = JSON.parse(withProjectColor(FULL, 'Website Redesign', null));
    expect(out.projectColors).toEqual({});
  });

  it('builds a minimal valid document from a missing file', () => {
    const out = JSON.parse(withProjectColor(null, 'A', '#111111'));
    expect(out).toEqual({ schemaVersion: 1, generatedBy: 'annado-mobile', projectColors: { A: '#111111' } });
  });

  it('builds a minimal valid document from a malformed file (never propagates garbage)', () => {
    const out = JSON.parse(withProjectColor('not json {', 'A', '#111111'));
    expect(out).toEqual({ schemaVersion: 1, generatedBy: 'annado-mobile', projectColors: { A: '#111111' } });
  });

  it('preserves unknown future fields verbatim', () => {
    const out = JSON.parse(withProjectColor('{"schemaVersion":3,"futureField":[1,2]}', 'A', '#111111'));
    expect(out.schemaVersion).toBe(3);
    expect(out.futureField).toEqual([1, 2]);
  });
});
