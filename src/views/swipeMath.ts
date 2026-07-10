// Pure gesture math for the collapsed-row swipe controller (src/views/swipe.ts).
// Unit-tested; no DOM. See docs/specs/2026-07-07-mobile-swipe-phase2-design.md.

export type Axis = 'horizontal' | 'vertical' | null;
export type Outcome = 'complete' | 'open' | 'closed';

/** Decide the drag axis once movement crosses `slop`. Returns null while both
 *  deltas are within slop — the gesture is still a tap candidate. */
export function lockAxis(dx: number, dy: number, slop: number): Axis {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}

/** Foreground translateX from the raw horizontal delta. Rightward is allowed up
 *  to `maxRight` (the complete gesture); leftward is clamped to
 *  -(actionsWidth + overscroll) (rubber-band past the revealed buttons). */
export function clampTranslate(
  dx: number,
  actionsWidth: number,
  maxRight: number,
  overscroll: number,
): number {
  if (dx >= 0) return Math.min(dx, maxRight);
  return Math.max(dx, -(actionsWidth + overscroll));
}

/** Snap target on pointer release, given the current translateX. */
export function releaseOutcome(
  tx: number,
  actionsWidth: number,
  completeThreshold: number,
): Outcome {
  if (tx >= completeThreshold) return 'complete';
  if (tx <= -actionsWidth / 2) return 'open';
  return 'closed';
}
