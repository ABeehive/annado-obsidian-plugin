// Surgical, byte-preserving line edits.
//
// The desktop app rewrites a whole task line from the Task struct on every edit,
// which normalizes field order and spacing. On mobile we are stricter: toggling
// completion only flips the checkbox character and adds/removes the completed
// marker — every other byte of the line is preserved exactly.

import { COMPLETED_DECODE, encodeCompleted, TaskFormat } from './taskformat';

const CHECKBOX_RE = /^(\s*- \[)([ xX])(\])/;

/** Flip a task line's completion state in place.
 *
 *  Completing appends the completed-date marker in the chosen format (unless the
 *  line already carries one); un-completing removes the first completed marker.
 *  Pass `stamp: false` to skip the marker entirely (checklist sub-items carry no
 *  completion dates). Returns null when the line isn't a checkbox line (stale
 *  index guard).
 */
export function setLineCompleted(
  line: string,
  complete: boolean,
  format: TaskFormat,
  todayISO: string,
  stamp = true,
): string | null {
  const m = CHECKBOX_RE.exec(line);
  if (!m) return null;

  const prefixLen = m[1]!.length;
  let out = line.slice(0, prefixLen) + (complete ? 'x' : ' ') + line.slice(prefixLen + 1);

  if (complete) {
    if (stamp && !COMPLETED_DECODE.test(out)) {
      out = `${out} ${encodeCompleted(todayISO, format)}`;
    }
  } else {
    const cm = COMPLETED_DECODE.exec(out);
    if (cm) {
      let start = cm.index;
      const end = cm.index + cm[0].length;
      // Take one preceding space with the marker so we don't leave a double gap.
      if (start > 0 && out[start - 1] === ' ') start--;
      out = out.slice(0, start) + out.slice(end);
    }
  }

  return out;
}
