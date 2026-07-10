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

<details>
<summary><b>What stays desktop-only?</b> (the plugin is deliberately a lean companion)</summary>

| Area | Desktop | Plugin |
|------|---------|--------|
| **Agenda / time-blocking** | Day & week timelines, drag-to-schedule, auto-scheduling | — |
| **Calendar integration** | Reads the macOS Calendar into the agenda | — |
| **Wrapped** | A year-in-review recap | — |
| **Review** | GTD-style review of stalled and overdue work | — |
| **Recurring templates** | Full editor for `@repeat` rules | Advances existing rules on complete; rules survive untouched |
| **Smart Lists** | Saved custom filters | — |
| **Natural-language add** | "tomorrow", "next week" typed in Quick Add | Presets + tap calendar instead |
| **Bulk & reorder** | Multi-select, drag-and-drop ordering | — |
| **Delete** | Delete with undo | Confirm-before-delete |
| **Notifications & tray** | Deadline notifications, system tray | — |
| **Scheduled time** | `@time()` editable | Displayed, not editable |

</details>

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
