// Duration string handling — port of parse_duration_str / format_duration in parser.rs.

/** Parse "15m", "15min", "1h", "1h30m", "1h30min", "2h" into minutes. */
export function parseDurationStr(s: string): number | null {
  const t = s.trim().toLowerCase();
  const hPos = t.indexOf('h');
  if (hPos !== -1) {
    const hours = parseIntStrict(t.slice(0, hPos));
    if (hours === null) return null;
    let rest = t.slice(hPos + 1);
    if (rest === '') return hours * 60;
    rest = stripSuffix(stripSuffix(rest, 'min'), 'm');
    if (rest === '') return hours * 60;
    const minutes = parseIntStrict(rest);
    if (minutes === null) return null;
    return hours * 60 + minutes;
  }
  const stripped = stripSuffix(stripSuffix(t, 'min'), 'm');
  if (stripped !== t) {
    return parseIntStrict(stripped);
  }
  return null;
}

/** Format minutes back to the compact markdown form ("90" → "1h30m"). */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function stripSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

function parseIntStrict(s: string): number | null {
  // Rust's u32::parse rejects empty strings, signs, and non-digits.
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}
