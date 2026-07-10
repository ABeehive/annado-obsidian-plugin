// Minimal ISO-date arithmetic on YYYY-MM-DD strings, replacing chrono::NaiveDate.
// All math is done on UTC timestamps built from the date parts, so the local
// timezone / DST can never shift a day.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  return d >= 1 && d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  // Month is 1-based; day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Add months, clamping the day like chrono's checked_add_months
 *  (2026-01-31 + 1 month = 2026-02-28). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return toISO(ny, nm, nd);
}

export function todayISO(now: Date = new Date()): string {
  // Local calendar date — matches Local::now().date_naive() on the Rust side.
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Day of week for an ISO date: 0 = Sunday … 6 = Saturday. */
export function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Upcoming Saturday; if already Sat/Sun, next Saturday. Port of getThisWeekend. */
export function thisWeekendISO(todayIso: string): string {
  const dow = isoWeekday(todayIso);
  const delta = dow === 6 ? 7 : dow === 0 ? 6 : 6 - dow;
  return addDaysISO(todayIso, delta);
}

/** Next Monday (used for "Next Week"). Port of getNextMonday. */
export function nextMondayISO(todayIso: string): string {
  const dow = isoWeekday(todayIso);
  const delta = dow === 0 ? 1 : 8 - dow;
  return addDaysISO(todayIso, delta);
}

function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
