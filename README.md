# Annado Mobile

A lightweight, **iOS-ready Obsidian plugin** (`isDesktopOnly: false`) — a mobile
companion to the **Annado** desktop app. It reads and writes the **same plain-markdown
checkbox tasks** with inline metadata, over the **same Obsidian vault**, so your phone and
Mac stay in sync through the vault itself.

Plain DOM (no framework), TypeScript, esbuild, vitest. The parser is a faithful port of
the desktop app's Rust core, so the two apps agree byte-for-byte on the file format.

---

## Works standalone

**You don't need the Annado desktop app to use this plugin.** It's a complete task
manager on its own: it reads and writes ordinary Markdown checkbox tasks in your vault,
so all its views, editing, scheduling and Quick Find work with nothing but Obsidian
installed.

The desktop app is an *optional* companion. When it's present and its vault-sharing
toggle is on, it drops a `shared.json` file next to the plugin that syncs a few settings
(project/tag colors, the task format and excluded paths). Without that file the plugin
simply falls back to its own local settings and stable per-name colors — nothing breaks.

> **Note:** *Annado* (the desktop app, React + Rust/Tauri, macOS) is a separate product
> and is **not yet publicly available**. This plugin stands on its own until it is; the
> sections below that compare the two are there so you know what the plugin deliberately
> leaves out, not because you need the desktop app to get started.

---

## Install

**Manual (available now):** copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/annado-mobile/`, let the vault sync to your device
(Obsidian Sync / iCloud / etc.), then enable **Annado Mobile** under
Settings → Community plugins. `main.js` is a build artifact — run `npm run build` first
(see [Develop](#develop)) or grab it from a release.

**Community plugins (once accepted):** search for *Annado Mobile* in
Settings → Community plugins → Browse and install it there.

After enabling, set your folder patterns and task format under the plugin's settings tab.

---

## What it does

### Views
Six tab tiles plus a **"⋯ More"** menu:

- **Inbox** — unscheduled tasks with no project
- **Today** — today/overdue by scheduled date, an **Evening** section, and overdue-by-deadline
- **Upcoming** — future tasks grouped by day, with month headers
- **Projects** — nested by frontmatter `up:` (collapsible tree)
- **People** — tasks per `[[Person]]`
- **Tags** — nested `#tag/subtag` tree
- **⋯ More → Anytime / Someday / Logbook** — Logbook groups completed tasks by
  completion date (Today / Yesterday / …), capped and newest-first

### Managing tasks
- **Complete** — tap the checkbox; the source line is toggled **byte-preservingly** (only
  the checkbox char + `@completed` marker change). Completing a modeled `@repeat(...)` task
  inserts the next occurrence, like the desktop app.
- **Edit** — pencil in the expanded card opens a modal to change title, notes, when,
  deadline, project, priority, duration and tags (the whole line re-serializes, matching
  the desktop `update_task`).
- **Reschedule** — tap the date pill (or swipe → **Reschedule**) for a when-menu; tap the
  flag/deadline chip for a deadline-menu. Both offer presets (Today / Tomorrow / This
  weekend / Next week) and **"Pick a date…"** → a built-in tap calendar.
- **Delete** — swipe → **Delete** (or from the expanded card), with a confirm dialog.
- **Swipe gestures** — right = complete, left = Reschedule + Delete (axis-locked so
  vertical scrolling still works; one row open at a time).
- **Add** — the `+` opens a compact modal (title, notes, and an icon toolbar for
  when / deadline / project / priority / duration + tag autocomplete). It's
  **context-aware**: from a project/person/tag view or Anytime/Someday it pre-fills that
  context. New tasks are appended to today's daily note.
- **Quick Find** — 🔍 (or the *Quick Find* command) fuzzy-searches tasks, projects, people
  and tags; picking a task reveals it in-app, an entity opens its detail view.
- **Open in Obsidian** — jump to a task's exact source line.

### Format & parser guarantees
`src/parser/` is a TypeScript port of the desktop app's Rust parser
(`src-tauri/src/{parser,taskformat,recurrence}.rs` — those paths live in the desktop
repo, not this one), so both apps agree byte-for-byte on the file format:

- **Reads all three dialects** — Annado (`@when()` / `@due()` / `!1`), Obsidian Tasks
  (emoji), Dataview (`[key:: value]`) — and **writes the one you configure**.
- Tags via `#tag` (nested), projects/persons via `[[Wikilinks]]`.
- Byte-preserving complete-toggle; CRLF preserved; unknown/foreign markers survive an edit
  inside the title remainder. Covered by `tests/roundtrip.test.ts` (100+ parser tests).

### Mobile niceties
- A **built-in tap calendar** for arbitrary dates — Obsidian's mobile webview can't open
  native `<input type="date">` pickers, so dates are chosen with buttons that do work.
- Subtle completion animation, warm empty states, phone-optimised icon tab bar.
- Detail-view info panels collapse to a one-line summary (chevron) to keep tasks on screen.

---

## Compared to the Annado desktop app

*(For context — the plugin is fully usable without the desktop app; this section just maps
out what the larger desktop product adds, so you know what the plugin intentionally
scopes out.)*

The desktop app (React + Rust/Tauri, macOS) is the full product. The plugin is a
**focused mobile companion for capture, triage and day-to-day managing** — it deliberately
leaves the heavy and macOS-native features to the desktop.

### Shared (both apps)
Same vault & task file format (all three dialects, read-any/write-chosen, `#task` import
marker, frontmatter-tag inheritance) · Inbox / Today / Upcoming / Anytime / Someday /
Logbook · Projects (nested) / People / Tags (nested) · create · edit · complete ·
reschedule (when) · deadlines · priority · duration · checklists · notes · delete ·
Quick Find · open-in-editor · recurrence **advance on complete** for modeled `@repeat`
rules.

- **Project & person info** — a project's view shows its description, due/start dates,
  priority, people and milestones; a person's view shows organisation, relationship,
  languages and projects (read-only on mobile — edit on desktop or in the note).
- **Desktop sync (`shared.json`)** — when the desktop app's "This vault is used with the
  Obsidian plugin" toggle is on, project colors sync two-way (editable from a project's view
  by tapping the color dot) through `.obsidian/plugins/annado-mobile/shared.json`; tag colors
  and the parser settings (task format, import marker, excluded paths) sync one-way from the
  desktop and show as locked in the plugin's settings tab. Without the file, the plugin falls
  back to local settings and stable per-name colors, and color editing is disabled — the
  plugin never creates the file (an absent file means the integration is off).

### Only on desktop (not in the plugin)
| Area | Desktop | Plugin |
|------|---------|--------|
| **Agenda / time-blocking** | Day & week timelines, drag-to-schedule, auto-scheduling, now-line | — |
| **Calendar integration** | Reads the macOS Calendar (EventKit) into the agenda | — |
| **Wrapped** | Spotify-Wrapped-style year recap (~14 animated slides) | — |
| **Review** | GTD review: stalled / overdue / quiet-project surfacing | — |
| **Recurring templates** | A *Recurring* view + UI to create/edit `@repeat` rules (+ a legacy→inline migration) | Advances existing rules on complete, but no recurrence editor — rules survive untouched in the line |
| **Smart Lists** | Saved custom filters (priority, hasDeadline, age, dueWithin, …) | — |
| **Added Today** | A dedicated view of today's captures | — |
| **Natural-language add** | "morgen", "next week" parsed in Quick Add (EN + NL) | Menus / presets / calendar instead |
| **Bulk & reorder** | Multi-select bulk actions, drag-and-drop ordering of tasks & projects | — |
| **Delete** | Delete **with undo** (snapshot + restore) | Confirm-before-delete (no undo) |
| **Notifications & tray** | Deadline/overdue notifications, system tray | — |
| **Scheduled time** | `@time()` editable | Displayed, not editable |
| **Theming / shortcuts** | Custom accent colour, fully customisable keybindings | Fixed ported palette; two commands (*Open Annado*, *Quick Find*) |

Most of these are **intentional non-goals** for a phone: the plugin's job is to let you
capture, triage and manage tasks anywhere, and let the desktop own planning, review and
the macOS-native pieces.

---

## Known limitations

- **Projects are keyed by file name.** Like the desktop app, a project is identified by
  its basename and the `up:` parent is matched by name, so two project files with the
  *same* name in different folders collapse into one (one is hidden, and `up` links can't
  tell them apart).
- **No native date picker on mobile.** Obsidian's mobile webview can't open a native
  `<input type="date">`, so arbitrary dates are chosen with the built-in tap calendar
  ("Pick a date…") rather than the OS date wheel.
- **Tag colors are sync-only.** They sync *from* the desktop via `shared.json` but aren't
  editable in the plugin (project colors are).
- **`inheritFrontmatterTags` isn't applied yet.** The setting arrives via `shared.json` and
  is preserved, but the plugin doesn't yet inherit a note's frontmatter tags onto its tasks.

## Develop

```bash
npm install
npm test          # vitest — parser ports + round-trip / byte-preservation corpus
npm run build     # type-check + bundle to main.js
npm run dev       # esbuild watch mode
```

`main.js` is a build artifact (git-ignored); build it before deploying. For quick
desktop-Obsidian testing, symlink this folder into a test vault's `.obsidian/plugins/` and
run `npm run dev`.
