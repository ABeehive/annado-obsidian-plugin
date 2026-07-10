// Phone bottom-sheet treatment shared by AddTaskModal and InlineEditModal:
// classes that turn the modal into a bottom sheet, plus a visualViewport clamp
// so the on-screen keyboard never covers it. Off-phone this is a no-op.
import { Modal, Platform } from 'obsidian';

/** Applies the phone bottom-sheet classes + viewport clamp to `modal`. Call from
 *  `onOpen`; call the returned cleanup from `onClose` to detach the resize
 *  listener. No-op (returns a no-op cleanup) off-phone or where
 *  `visualViewport` isn't available. */
export function setupPhoneSheet(modal: Modal): () => void {
  if (!Platform.isPhone) return () => {};

  modal.modalEl.addClass('annado-modal-mobile');
  modal.containerEl.addClass('annado-modal-container-mobile');

  const vv = window.visualViewport;
  if (!vv) return () => {};

  const handler = () => {
    const safeTop = parseFloat(getComputedStyle(modal.containerEl).paddingTop) || 0;
    modal.modalEl.style.maxHeight = `${vv.height - safeTop - 20}px`;
  };
  handler();
  vv.addEventListener('resize', handler);
  return () => vv.removeEventListener('resize', handler);
}
