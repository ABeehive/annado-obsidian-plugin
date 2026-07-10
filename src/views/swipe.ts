// Thin pointer-event controller for a collapsed task row's foreground element.
// Vertical scroll is owned by the browser via `touch-action: pan-y` on the
// wrapper; we only take over once a horizontal drag passes the slop. Pure math
// lives in ./swipeMath. Verified by build + live CLI QA (no unit test), like data/*.
//
// The visual drag runs on the pointer stream; a separate touch-event guard (below)
// preventDefault + stopPropagation's horizontal touchmoves so Obsidian's mobile
// sidebar-drawer swipe (which reads the touch stream) never commits. Pointer and
// touch are independent streams, so the guard doesn't touch the drag logic.

import { lockAxis, clampTranslate, releaseOutcome } from './swipeMath';

/** Combined width (px) of the two revealed action buttons. AnnadoView imports
 *  and reads this constant for its inline `.annado-swipe-actions` width, so the
 *  two can't drift out of sync. */
export const ACTIONS_WIDTH = 160;

const SLOP = 8;          // px of horizontal travel before we hijack the gesture
const OVERSCROLL = 16;   // px of rubber-band past the open position
const COMPLETE_FRAC = 0.4; // fraction of row width to release-complete

export interface SwipeHandlers {
  /** Released past the complete threshold on a right-swipe. */
  onComplete: () => void;
  /** A clean tap (no horizontal lock) on the foreground. */
  onTap: () => void;
  /** Snapped open on a left-swipe; receives this row's `close` for single-open tracking. */
  onOpen: (close: () => void) => void;
  /** CSS selector for children that own their own tap (buttons, pills) — a
   *  pointerdown starting inside one of these is ignored by the controller. */
  interactiveSelector: string;
}

export interface SwipeHandle {
  close: () => void;
}

export function attachSwipe(fg: HTMLElement, h: SwipeHandlers): SwipeHandle {
  type Gesture = 'none' | 'candidate' | 'horizontal' | 'vertical';
  let gesture: Gesture = 'none';
  let startX = 0;
  let startY = 0;
  let rowWidth = 0;
  let tx = 0;
  let baseTx = 0;
  let suppressClick = false;

  const setTx = (px: number) => {
    tx = px;
    fg.style.transform = `translateX(${px}px)`;
    // Reveal the coloured behind-layers only while the row is off its resting position,
    // so they can't flash through during vertical scroll.
    fg.parentElement?.classList.toggle('is-swiping', px !== 0);
  };
  const snap = (px: number) => {
    fg.classList.add('is-snapping');
    setTx(px);
  };
  const close = () => snap(0);

  fg.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest(h.interactiveSelector)) {
      gesture = 'none';
      return;
    }
    gesture = 'candidate';
    startX = e.clientX;
    startY = e.clientY;
    rowWidth = fg.offsetWidth;
    baseTx = tx; // resting offset before this gesture (0, or -ACTIONS_WIDTH if already open)
    fg.classList.remove('is-snapping'); // drag tracks the finger 1:1
  });

  fg.addEventListener('pointermove', (e) => {
    if (gesture === 'none' || gesture === 'vertical') return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (gesture === 'candidate') {
      const axis = lockAxis(dx, dy, SLOP);
      if (axis === null) return;
      if (axis === 'vertical') {
        gesture = 'vertical'; // let pan-y scroll the list
        return;
      }
      gesture = 'horizontal';
      fg.setPointerCapture(e.pointerId);
    }
    setTx(clampTranslate(baseTx + dx, ACTIONS_WIDTH, rowWidth, OVERSCROLL));
    e.preventDefault();
  });

  const onUp = () => {
    if (gesture === 'candidate') {
      gesture = 'none';
      h.onTap();
      return;
    }
    if (gesture !== 'horizontal') {
      gesture = 'none';
      return;
    }
    gesture = 'none';
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    const outcome = releaseOutcome(tx, ACTIONS_WIDTH, rowWidth * COMPLETE_FRAC);
    if (outcome === 'complete') {
      snap(0);
      h.onComplete();
    } else if (outcome === 'open') {
      snap(-ACTIONS_WIDTH);
      h.onOpen(close);
    } else {
      snap(0);
    }
  };

  fg.addEventListener('pointerup', onUp);
  fg.addEventListener('pointercancel', () => {
    // e.g. the browser took over for a vertical pan — never a tap.
    if (gesture === 'horizontal') snap(baseTx);
    gesture = 'none';
  });

  // Swallow the phantom click that can follow a horizontal drag so it doesn't
  // bubble to a tap handler.
  fg.addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
      }
    },
    true,
  );

  // Independently suppress Obsidian's mobile sidebar-drawer swipe: our drag runs on
  // the pointer stream, the drawer on the touch stream. Once a touch drags
  // horizontally we preventDefault + stopPropagation the touchmove so the drawer
  // never commits. Vertical drags pass through untouched (list scroll still works).
  // Own start coords + axis decision so it doesn't depend on pointer/touch ordering.
  let tStartX = 0;
  let tStartY = 0;
  let tHoriz: boolean | null = false; // false = inactive, null = undecided, true = locked horizontal

  fg.addEventListener(
    'touchstart',
    (e) => {
      const t0 = e.touches[0];
      if (e.touches.length !== 1 || !t0) {
        tHoriz = false;
        return;
      }
      tStartX = t0.clientX;
      tStartY = t0.clientY;
      tHoriz = null;
    },
    { passive: true },
  );

  fg.addEventListener(
    'touchmove',
    (e) => {
      if (tHoriz === false) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - tStartX;
      const dy = t.clientY - tStartY;
      if (tHoriz === null) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return; // still within slop
        tHoriz = Math.abs(dx) > Math.abs(dy);
        if (!tHoriz) return; // vertical → let it scroll
      }
      e.preventDefault();
      e.stopPropagation();
    },
    { passive: false },
  );

  const resetTouch = () => {
    tHoriz = false;
  };
  fg.addEventListener('touchend', resetTouch);
  fg.addEventListener('touchcancel', resetTouch);

  return { close };
}
