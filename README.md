# Annado Mobile

**Your Obsidian vault as a friendly task manager on your phone.**

Annado Mobile turns the Markdown checkboxes already in your notes into a fast,
thumb-friendly task app: Inbox, Today, Upcoming, projects, people and tags — with swipe
gestures, quick capture and search. Your tasks never leave your notes: everything is
plain text in your own files, synced however your vault syncs.

It's the mobile companion to the [Annado desktop app](https://github.com/ABeehive/Annado),
and it also works completely on its own — no desktop app required.

<p align="center">
  <img src="images/today.png" width="300" alt="The Today view: tasks with dates, priorities, tags and deadline flags, grouped by project">
</p>

## Why you might like it

- **Everything stays in your notes.** Tasks are ordinary `- [ ]` checkbox lines. No
  database, no account, no lock-in — turn the plugin off and your tasks are still right
  there in your Markdown.
- **Made for your thumb.** Swipe right to complete, swipe left to reschedule or delete.
  A big `+` for quick capture. A built-in tap calendar for picking dates (mobile
  Obsidian can't show the native iOS date picker — so we bring our own).
- **Careful with your files.** Completing a task changes only the checkbox and adds a
  completion date; everything else on the line stays exactly as you wrote it — including
  things the plugin doesn't recognize. That promise is guarded by a test suite of 240+
  cases.
- **Plays nicely with other plugins.** It reads three task styles — Annado
  (`@when(...)`), Obsidian Tasks (emoji) and Dataview (`[key:: value]`) — and writes
  whichever one you choose in settings.

## A tour

| Today | Upcoming | Inbox |
|:--:|:--:|:--:|
| <img src="images/today.png" width="240" alt="Today view"> | <img src="images/upcoming.png" width="240" alt="Upcoming view, grouped by day"> | <img src="images/inbox.png" width="240" alt="Inbox view"> |
| Today's plan plus anything overdue, with deadline flags. | The days ahead, grouped per day. | Unscheduled captures waiting for a home. |

| Projects | People | Tags |
|:--:|:--:|:--:|
| <img src="images/projects.png" width="240" alt="Projects view with color dots and task counts"> | <img src="images/people.png" width="240" alt="People view"> | <img src="images/tags.png" width="240" alt="Tags view with task counts"> |
| Your project notes, with their own colors. | Tasks per `[[Person]]` you mention. | Every `#tag`, nested tags included. |

Tap any of them to drill in:

| Inside a project | Inside a person | Inside a tag |
|:--:|:--:|:--:|
| <img src="images/project-detail.png" width="240" alt="A project's detail view with description, due date, milestones and its tasks"> | <img src="images/person-detail.png" width="240" alt="A person's detail view with organisation, role, languages and their tasks"> | <img src="images/tag-detail.png" width="240" alt="A tag's detail view listing every task carrying it"> |
| Description, dates and milestones from the project note, above its tasks. | Organisation, role and languages from the person note. | Everything carrying the tag, in one list. |

| Anytime | Someday | Logbook |
|:--:|:--:|:--:|
| <img src="images/anytime.png" width="240" alt="Anytime view"> | <img src="images/someday.png" width="240" alt="Someday view"> | <img src="images/logbook.png" width="240" alt="Logbook of completed tasks, grouped by day"> |
| Ready whenever you are. | Ideas for later. | What you finished, day by day. |

Anytime, Someday and Logbook live behind the **⋯ More** button:

| More views | Quick Find |
|:--:|:--:|
| <img src="images/more-views.png" width="240" alt="The More menu with Anytime, Someday and Logbook"> | <img src="images/quick-find.png" width="240" alt="Quick Find searching tasks, projects, people and tags"> |
| One tap away. | Search tasks, projects, people and tags from anywhere. |

## Adding and editing

| New task | Edit task | Delete asks first |
|:--:|:--:|:--:|
| <img src="images/new-task.png" width="240" alt="The New task sheet"> | <img src="images/edit-task.png" width="240" alt="The Edit task sheet"> | <img src="images/delete-task.png" width="240" alt="Delete confirmation dialog"> |

- **Add** — tap `+`. Set a date, deadline, project, priority, duration and tags from the
  icon row; tags autocomplete. The sheet is context-aware: add from a project, person or
  tag view and it's pre-filled. New tasks land in today's daily note.
- **Edit** — open a task and tap the pencil to change anything.
- **Complete** — tap the circle. Recurring tasks (`every week`, `every 2 days when done`,
  …) automatically schedule their next occurrence.
- **Reschedule** — tap a task's date pill for Today / Tomorrow / This weekend / Next
  week, or pick any date on the tap calendar.
- **Open in Obsidian** — jump straight to the task's line in your note.

## How your tasks are stored

A task is one checkbox line in any note, with optional details inline:

```markdown
- [ ] Order the kitchen sink @when(2026-07-12) @due(2026-07-14) !! #home [[Home Renovation]]
```

- The date it's planned for (`@when`), a deadline (`@due`), priority (`!` to `!!!`),
  a duration, `#tags`, and `[[Project]]` or `[[Person]]` links.
- Indented lines below a task become its **notes**; indented checkboxes become its
  **checklist**.
- Projects and people are regular notes in folders you point the plugin at
  (`Projects/`, `Persons/` — configurable). A project's tasks can live in its own note
  or reference it with a `[[wikilink]]` from anywhere.
- Prefer the [Obsidian Tasks](https://publish.obsidian.md/tasks/) emoji style or
  Dataview fields? The plugin reads all three styles and writes the one you pick.

## Using it with the Annado desktop app

[Annado](https://github.com/ABeehive/Annado) is a task manager for your Mac built on the
same idea — your Obsidian / Markdown files are the database. Run both and your phone and
Mac stay in sync through the vault itself: same files, same format, no extra service.

When the desktop app's *"This vault is used with the Obsidian plugin"* toggle is on, it
shares a small `shared.json` with the plugin: project colors sync both ways, and tag
colors, the task format, the import marker and excluded paths follow the desktop
(they show as locked in the plugin's settings). Without the desktop app the plugin
simply uses its own settings and picks stable colors per name — nothing breaks.

Curious exactly what the desktop app adds? There's a
[full comparison](#compared-to-the-annado-desktop-app) at the bottom of this page.

## Install

**Community plugins (once accepted):** Settings → Community plugins → Browse → search
for *Annado Mobile*.

**Manual:** download `main.js`, `manifest.json` and `styles.css` from a
[release](https://github.com/ABeehive/annado-obsidian-plugin/releases) and copy them
into `<vault>/.obsidian/plugins/annado-mobile/`. Let the vault sync to your device, then
enable **Annado Mobile** under Settings → Community plugins.

## Settings

| | |
|:--:|:--:|
| <img src="images/settings-1.png" width="280" alt="Settings: folder patterns, task format, import marker"> | <img src="images/settings-2.png" width="280" alt="Settings: daily notes fallback and excluded paths"> |

- **Projects / Persons folder pattern** — which folders hold your project and people
  notes.
- **Task format** — the style new edits are written in (reading understands all three).
- **Import marker** — optional: only treat checkboxes tagged e.g. `#task` as tasks.
- **Daily notes (fallback)** — only used when the Daily Notes core plugin isn't
  configured; its settings always win.
- **Excluded paths** — folders or files the plugin should ignore (`Archive/`, …).

## Known limitations

- **Projects are keyed by file name** — two project notes with the same name in
  different folders are treated as one.
- **No native date picker on mobile** — Obsidian's mobile webview can't open one, so
  dates are picked on the built-in tap calendar instead.
- **Tag colors are sync-only** — they follow the desktop app via `shared.json` and
  aren't editable in the plugin (project colors are).
- **`inheritFrontmatterTags` isn't applied yet** — the setting syncs and is preserved,
  but a note's frontmatter tags aren't inherited onto its tasks yet.

## Compared to the Annado desktop app

*(For context — the plugin is fully usable without the desktop app; this section just
maps out what the larger desktop product adds, so you know what the plugin intentionally
scopes out.)*

The [desktop app](https://github.com/ABeehive/Annado) (React + Rust/Tauri, macOS) is the
full product. The plugin is a **focused mobile companion for capture, triage and
day-to-day managing** — it deliberately leaves the heavy and macOS-native features to
the desktop.

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
  Obsidian plugin" toggle is on, project colors sync two-way (editable from a project's
  view by tapping the color dot); tag colors and the parser settings (task format, import
  marker, excluded paths) sync one-way from the desktop and show as locked in the
  plugin's settings tab. Without the file, the plugin falls back to local settings and
  stable per-name colors, and color editing is disabled — the plugin never creates the
  file (an absent file means the integration is off).

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
| **Theming / shortcuts** | Custom accent colour, fully customisable keybindings | Fixed ported palette; two commands (*Open Annado*, *Quick find*) |

Most of these are **intentional non-goals** for a phone: the plugin's job is to let you
capture, triage and manage tasks anywhere, and let the desktop own planning, review and
the macOS-native pieces.

## Under the hood & contributing

Plain TypeScript and DOM (no framework), bundled with esbuild, tested with vitest. The
parser is a line-for-line port of the desktop app's Rust core, so both apps agree
byte-for-byte on the file format.

```bash
npm install
npm test          # vitest — parser, round-trip and byte-preservation suites
npm run build     # type-check + bundle to main.js
npm run dev       # esbuild watch mode
```

`main.js` is a build artifact (git-ignored). For quick testing, symlink this folder into
a test vault's `.obsidian/plugins/` and run `npm run dev`.
