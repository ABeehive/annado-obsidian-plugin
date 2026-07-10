import { describe, it, expect } from 'vitest';
import { lockAxis, clampTranslate, releaseOutcome } from '../src/views/swipeMath';

describe('lockAxis', () => {
  it('returns null while both deltas are within slop (still a tap)', () => {
    expect(lockAxis(5, 5, 8)).toBe(null);
    expect(lockAxis(-7, 3, 8)).toBe(null);
  });
  it('locks horizontal when |dx| dominates past slop', () => {
    expect(lockAxis(20, 4, 8)).toBe('horizontal');
    expect(lockAxis(-20, 4, 8)).toBe('horizontal');
  });
  it('locks vertical when |dy| dominates past slop', () => {
    expect(lockAxis(4, 20, 8)).toBe('vertical');
    expect(lockAxis(3, -20, 8)).toBe('vertical');
  });
  it('crossing slop on one axis alone still resolves', () => {
    expect(lockAxis(10, 0, 8)).toBe('horizontal');
    expect(lockAxis(0, 10, 8)).toBe('vertical');
  });
});

describe('clampTranslate', () => {
  it('passes small right/left drags through unchanged', () => {
    expect(clampTranslate(30, 160, 400, 16)).toBe(30);
    expect(clampTranslate(-100, 160, 400, 16)).toBe(-100);
  });
  it('caps rightward drag at maxRight', () => {
    expect(clampTranslate(999, 160, 400, 16)).toBe(400);
  });
  it('clamps leftward drag at -(actionsWidth + overscroll)', () => {
    expect(clampTranslate(-999, 160, 400, 16)).toBe(-176);
  });
});

describe('releaseOutcome', () => {
  it('completes at/above the complete threshold', () => {
    expect(releaseOutcome(160, 160, 160)).toBe('complete');
    expect(releaseOutcome(200, 160, 160)).toBe('complete');
  });
  it('opens when pulled left past half the actions width', () => {
    expect(releaseOutcome(-80, 160, 160)).toBe('open');
    expect(releaseOutcome(-120, 160, 160)).toBe('open');
  });
  it('closes for small offsets in either direction', () => {
    expect(releaseOutcome(40, 160, 160)).toBe('closed');
    expect(releaseOutcome(-40, 160, 160)).toBe('closed');
    expect(releaseOutcome(0, 160, 160)).toBe('closed');
  });
});
