// Project & person note metadata — faithful TS port of parse_project_metadata,
// parse_person_metadata, extract_first_paragraph, yaml_to_string, extract_persons,
// extract_string_array and extract_wikilink_array in the desktop's vault.rs
// (~lines 1511–1960). Field fallback chains, break-on-presence for scalars and
// non-empty-wins for lists all mirror the Rust exactly; see the spec's tables.

export interface Milestone {
  name: string;
  start: string | null;
  end: string | null;
  completed: boolean;
}

export interface ProjectMetadata {
  description: string | null;
  deadline: string | null;
  startDate: string | null;
  ranking: string | null;
  persons: string[];
  milestones: Milestone[];
}

export interface PersonMetadata {
  name: string | null;
  organisation: string | null;
  relationship: string | null;
  languages: string[];
  projects: string[];
}

/** Strip a `[[Wikilink]]` wrapper to the bare file name — port of the Rust
 *  parse_wikilink, which takes the last `/`-segment so a path-based link
 *  (`[[02. Projects/…/VBR]]`) resolves to the name (`VBR`). Shared with folders.ts. */
export function parseWikilink(s: string): string {
  const t = s.trim();
  const m = /^\[\[([^\]]+)\]\]$/.exec(t);
  if (m) return m[1]!.split('/').pop()!.trim(); // last segment, like Rust rsplit('/').next()
  return t;
}

/** Port of yaml_to_string: strings, numbers and booleans stringify; rest → null. */
function yamlToString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** Scalar fallback chain: the FIRST PRESENT key wins even when its value is
 *  unusable (→ null), mirroring the Rust `if let Some(val) … break`. */
function firstScalar(fm: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) if (k in fm) return yamlToString(fm[k]);
  return null;
}

/** Port of extract_persons: wikilink strip, last path segment, "NN. " prefix strip. */
function extractPersons(v: unknown): string[] {
  const values = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const item of values) {
    const s = yamlToString(item);
    if (s === null) continue;
    let cleaned = s;
    while (cleaned.startsWith('[[')) cleaned = cleaned.slice(2); // trim_start_matches strips repeats
    while (cleaned.endsWith(']]')) cleaned = cleaned.slice(0, -2);
    let name = cleaned.split('/').pop() ?? cleaned;
    const dot = name.indexOf('. ');
    if (dot !== -1) name = name.slice(dot + 2); // "01. Jane" → "Jane" (first ". ", like Rust find)
    if (name !== '') out.push(name);
  }
  return out;
}

/** Port of extract_string_array: list of scalars, or one comma-separated string. */
function extractStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(yamlToString).filter((s): s is string => s !== null);
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  return [];
}

/** Port of extract_wikilink_array. */
function extractWikilinkArray(v: unknown): string[] {
  return extractStringArray(v).map(parseWikilink);
}

/** Port of the milestones loop: serde requires name + completed with exact types,
 *  and start/end must each be absent/null/string — otherwise the item is skipped. */
function parseMilestones(v: unknown): Milestone[] {
  if (!Array.isArray(v)) return [];
  const out: Milestone[] = [];
  for (const item of v) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const name = o['name'];
    const completed = o['completed'];
    const start = o['start'];
    const end = o['end'];
    if (typeof name !== 'string' || typeof completed !== 'boolean') continue;
    if (!(start === undefined || start === null || typeof start === 'string')) continue;
    if (!(end === undefined || end === null || typeof end === 'string')) continue;
    out.push({ name, completed, start: start ?? null, end: end ?? null });
  }
  return out;
}

/** Port of extract_first_paragraph: skip headings, `- [` task lines and leading
 *  blanks; join lines with spaces; stop at the first blank line after content. */
export function extractFirstParagraph(content: string): string | null {
  let paragraph = '';
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (paragraph !== '') break;
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (paragraph !== '') break;
      continue;
    }
    if (trimmed.startsWith('- [')) {
      if (paragraph !== '') break;
      continue;
    }
    if (paragraph !== '') paragraph += ' ';
    paragraph += trimmed;
  }
  return paragraph === '' ? null : paragraph;
}

const DESCRIPTION_KEYS = ['description', 'desc', 'summary'] as const;
const DEADLINE_KEYS = ['date_deadline', 'deadline', 'due', 'due_date'] as const;
const START_KEYS = ['date_start', 'start', 'start_date', 'started'] as const;
const RANKING_KEYS = ['ranking', 'priority', 'rank'] as const;
const PERSON_KEYS = ['persons', 'person', 'people', 'assigned', 'assignee'] as const;
const ORGANISATION_KEYS = ['organisation', 'organization', 'org', 'company'] as const;
const RELATIONSHIP_KEYS = ['relationship', 'relation', 'type'] as const;
const LANGUAGE_KEYS = ['languages', 'language', 'lang'] as const;
const PROJECT_KEYS = ['projects', 'project'] as const;

/** Guard an Obsidian frontmatter value down to a plain record (null for any
 *  other shape). Shared with tags.ts, which reads frontmatter the same way. */
export function asRecord(frontmatter: unknown): Record<string, unknown> | null {
  return typeof frontmatter === 'object' && frontmatter !== null && !Array.isArray(frontmatter)
    ? (frontmatter as Record<string, unknown>)
    : null;
}

/** Port of parse_project_metadata. `body` is the note content AFTER the
 *  frontmatter block (the caller slices it); used only as description fallback. */
export function parseProjectMetadata(frontmatter: unknown, body: string): ProjectMetadata {
  const meta: ProjectMetadata = {
    description: null,
    deadline: null,
    startDate: null,
    ranking: null,
    persons: [],
    milestones: [],
  };
  const fm = asRecord(frontmatter);
  if (fm === null) {
    meta.description = extractFirstParagraph(body);
    return meta;
  }
  meta.description = firstScalar(fm, DESCRIPTION_KEYS);
  meta.deadline = firstScalar(fm, DEADLINE_KEYS);
  meta.startDate = firstScalar(fm, START_KEYS);
  meta.ranking = firstScalar(fm, RANKING_KEYS);
  for (const k of PERSON_KEYS) {
    if (k in fm) {
      const persons = extractPersons(fm[k]);
      if (persons.length > 0) {
        meta.persons = persons;
        break; // non-empty wins; empty tries the next key (Rust behaviour)
      }
    }
  }
  if ('milestones' in fm) meta.milestones = parseMilestones(fm['milestones']);
  if (meta.description === null) meta.description = extractFirstParagraph(body);
  return meta;
}

/** Port of parse_person_metadata. */
export function parsePersonMetadata(frontmatter: unknown): PersonMetadata {
  const meta: PersonMetadata = {
    name: null,
    organisation: null,
    relationship: null,
    languages: [],
    projects: [],
  };
  const fm = asRecord(frontmatter);
  if (fm === null) return meta;
  if ('name' in fm) meta.name = yamlToString(fm['name']);
  meta.organisation = firstScalar(fm, ORGANISATION_KEYS);
  meta.relationship = firstScalar(fm, RELATIONSHIP_KEYS);
  for (const k of LANGUAGE_KEYS) {
    if (k in fm) {
      const langs = extractStringArray(fm[k]);
      if (langs.length > 0) {
        meta.languages = langs;
        break;
      }
    }
  }
  for (const k of PROJECT_KEYS) {
    if (k in fm) {
      const projects = extractWikilinkArray(fm[k]);
      if (projects.length > 0) {
        meta.projects = projects;
        break;
      }
    }
  }
  return meta;
}
