# TodoDesu トドデス。

TodoDesu is a local-first todo application for Mac, iPhone, and iPad, paired with a terminal
CLI that shares the same data. Capture a task from the command line in seconds, organize it
on a kanban board from your iPad, run a focus session, and review your week on the calendar —
all backed by a single SQLite file on your machine. No accounts, no cloud, no tracking.
The web build also runs fully standalone in the browser with data in `localStorage`, so the
live demo at `https://tasachii.github.io/TodoDesu/` costs nothing to host and requires no
server.

**Live** — [tasachii.github.io/TodoDesu](https://tasachii.github.io/TodoDesu/) · **Issues** — [github.com/Tasachii/TodoDesu/issues](https://github.com/Tasachii/TodoDesu/issues)

---

## Screenshots

| Today — Wa (和) theme | Focus — Pomodoro with the ensō ring |
| --- | --- |
| ![Today view in the Wa theme](docs/images/today-wa.jpg) | ![Pomodoro focus in the Wa theme](docs/images/focus-wa.jpg) |

| Today — light theme | Board — brush-stroke strikethroughs |
| --- | --- |
| ![Today view in the light theme](docs/images/today-light.jpg) | ![Kanban board in the Wa theme](docs/images/board-wa.jpg) |

---

## What it is

Most todo apps force a choice: fast capture (terminal tools) or rich organization (GUI apps).
TodoDesu does both against one source of truth. The REST API is the single authority over the
data; the web app and the CLI are equal clients, so a task added with `todo add` appears in
the browser instantly, and a card dragged to *Done* on the board is reflected in the next
`todo list`.

- **Stack** — React 18 · Vite · Tailwind CSS v4 · TanStack Query · dnd-kit · framer-motion · Fastify 5 · `node:sqlite` · Capacitor 8 · commander · chrono-node · Vitest · Playwright

---

## Architecture

The repository is an npm-workspaces monorepo with four packages:

| Package | Role | Key technology |
| --- | --- | --- |
| `packages/core` | Shared recurrence logic (`nextDueAt`) | Pure JS, zero dependencies |
| `packages/server` | REST API, data layer, serves the web build | Fastify 5, `node:sqlite` |
| `packages/web` | Progressive web app + iOS native app | React 18, Vite, Capacitor 8 |
| `packages/cli` | `todo` command | commander, chrono-node, picocolors |

```
CLI (todo) ----+
               +----> Fastify REST API (127.0.0.1:4521) ----> SQLite (~/.todoo/data.db)
Browser -------+              |
                              +--- serves the built web app (packages/web/dist)
```

Design decisions:

| Topic | Decision |
| --- | --- |
| Dual data engine | The web build detects whether a server is reachable. When it is, all writes go through the Fastify API to SQLite. When it is not (GitHub Pages, App Store build), the app switches to a `localStorage` engine that is kept at full feature parity with the server engine. |
| `node:sqlite` over an ORM | Node 23 ships SQLite in the standard library — no native compilation, no driver to pin. The database is a single file; backing up means copying it. |
| CLI never touches the DB directly | The CLI speaks to the same API as the browser and transparently starts the server when it is not running. Business rules live in exactly one place. |
| Timezone-safe by construction | The server never computes "today". Clients convert their local day boundaries to UTC and pass explicit ranges. |
| Fractional ordering | Card positions use a `REAL` sort key, so dropping a card between two others writes a single midpoint value instead of re-indexing the column. |
| Shared recurrence in `@todoo/core` | `nextDueAt` is extracted into a zero-dependency package so the server engine and the standalone localStorage engine share identical recurrence logic and can be tested independently at 100 % coverage. |

---

## Installation

**Requirements** — [Node.js 23.4+](https://nodejs.org) (for the built-in `node:sqlite` module) — check with `node -v`

macOS is the primary target; Linux works as well. On **Windows**, the server, web app, and
tests run in PowerShell or WSL; the only macOS-specific command is `todo open` (it shells
out to `open`).

**Mac / Linux**
```bash
git clone https://github.com/Tasachii/TodoDesu.git
cd TodoDesu
npm install
npm run cli:link      # install the `todo` command globally
```

**Windows**
```bat
git clone https://github.com/Tasachii/TodoDesu.git
cd TodoDesu
npm install
npm run cli:link      :: install the `todo` command globally
```

No database setup is needed — SQLite ships inside Node and the file is created on first run
at `~/.todoo/data.db`.

---

## Running

### Development

```bash
npm run dev           # start API on :4521 + Vite dev server on :5173 (concurrently)
```

### Daily use

```bash
npm run build         # build the web app once (packages/web/dist)
npm start             # serve app + API together at http://127.0.0.1:4521
```

### LAN mode (iPhone / iPad on the same Wi-Fi)

```bash
TODOO_HOST=0.0.0.0 npm start    # bind to all interfaces; open http://<mac-ip>:4521 in Safari
```

Then choose **Add to Home Screen** to install as an app. LAN mode has no authentication by
default — use it only on networks you trust, or set `TODOO_TOKEN` (see Configuration).

### Free public hosting (GitHub Pages)

Enable once: repo **Settings → Pages → Source: GitHub Actions**, then every push to `main`
deploys the standalone build to `https://<user>.github.io/<repo>/`. Visitors can **Add to
Home Screen** for an app-like install; the **Settings** sheet (gear icon) exports and imports
backups to move data between devices.

---

## CLI reference

```
todo                          List overdue, today, and inbox tasks
todo add "title"              Add a task
  -d, --due <text>            Natural-language due date ("tomorrow 6pm", "fri 14:00")
  -p, --priority <level>      low | med | high
  -n, --notes <text>          Attach notes
  -r, --repeat <rule>         daily | weekly | monthly (requires --due)
todo list --all               All tasks grouped by status
todo done <n>                 Complete task <n> from the last printed list
todo start <n>                Move task <n> to In progress
todo rm <n>                   Delete task <n> (soft delete)
todo undo                     Undo the last done/rm action
todo focus <n> [-t minutes]   Run a focus session in the terminal (default 25 min)
todo open                     Open the web app in the browser (macOS)
todo server <action>          start | stop | status
```

List numbers refer to the most recently printed list — a typical flow is `todo`, then
`todo done 2`.

---

## Usage

1. **Start the app.** `npm run build && npm start`, then open `http://127.0.0.1:4521`.
2. **Add a task with a natural-language date (1 action).** Type **"pay rent tomorrow 6pm"** in the quick-add bar — the date chip appears as you type, stripped from the title — and press Enter.
3. **Move it on the Board (2 taps).** Press `2` to open the **Board**, drag the card to *In progress*.
4. **Run a Pomodoro session (2 taps).** Press `4` for **Focus**, switch the header toggle to **Pomodoro**, hit *Start focusing* — when the chime plays, the break starts automatically.
5. **Complete the task.** Swipe right (or click the circle) — try the **和** theme (theme button) to see the hanko 完 stamp and brush-stroke strikethrough.
6. **Search and export.** Press `/` to search everything ever added; open **Settings** (gear) to export a backup.

Keyboard shortcuts: `n` new task · `1–4` switch views · `/` search · `Esc` closes any sheet.

---

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `TODOO_PORT` | `4521` | API and server port |
| `TODOO_HOST` | `127.0.0.1` | Bind address — set `0.0.0.0` to allow LAN access |
| `TODOO_DB` | `~/.todoo/data.db` | Database file path (`:memory:` for throwaway runs) |
| `TODOO_TOKEN` | _(unset)_ | Optional bearer token. When set and `TODOO_HOST` is non-loopback, mutating routes (POST / PUT / PATCH / DELETE) require `Authorization: Bearer <token>`; reads stay open. Loopback is never gated. |

---

## Testing

```bash
npm test                              # all four Vitest suites in order
npm run test:coverage                 # same suites with v8 coverage + enforced thresholds
npm run lint                          # ESLint flat config + react-hooks across every package
npm run test:e2e -w @todoo/web        # Playwright smoke suite (build first)
```

224 unit tests across four workspaces, plus 7 Playwright e2e scenarios:

| Suite | Count | What it covers |
| --- | --- | --- |
| `@todoo/core` | 23 | `nextDueAt` recurrence rule — daily/weekly/monthly, DST, leap years, multi-miss catch-up, and server ⇄ engine parity (100 % coverage enforced) |
| `@todoo/server` | 47 | Every endpoint via Fastify injection (no real network): CRUD, recurrence with an injected clock, focus start/stop incl. backward-clock 0-clamp and idempotency, `q`-search, stats range edges, backup round-trip, optional LAN token auth |
| `@todoo/cli` | 54 | Natural-language date parsing, API wrapper against a live server, on-disk state store, every command handler (`done` / `rm` / `undo` / `focus` / `server` …) driven through injectable deps |
| `@todoo/web` | 100 | Standalone localStorage engine, quick-add date detection, `useTasks` optimistic-update + rollback, focus/pomodoro engine with once-only guards, theme switching, board fractional-midpoint reorder, HTTP client |
| e2e | 7 scenarios | Playwright smoke against the real build + real server in headless Chromium: quick-add NL date, undo toast, search, the 和 theme, board columns, pomodoro mode switch, recurring-task spawn |

Coverage thresholds are enforced per package in each `vitest.config.js` (server 90 / cli 80
lines; `@todoo/core` 100; web gates `hooks` / `api` / `lib` hard). CI runs `npm test`, the
coverage gate, `npm run lint`, the build, and the e2e suite on every push and PR.

---

## Project documentation

| File | Contents |
| --- | --- |
| [`DESCRIPTION.md`](DESCRIPTION.md) | Project story: overview, concept, module diagram, statistics design |
| [`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md) | How every part of the code works, data flows, and design decisions |
| [`docs/PLAN.md`](docs/PLAN.md) | Technical plan, milestones, and risk register |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Functional and non-functional requirements |
| [`docs/API.md`](docs/API.md) | REST API contract |
| [`docs/QA_PLAN.md`](docs/QA_PLAN.md) | Test pyramid, pre-commit gates, manual checklist |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What to build next, with starting points in the code |
| [`docs/APP_STORE.md`](docs/APP_STORE.md) | Building the native iOS app and shipping to the App Store |
| [`SKILLS.md`](SKILLS.md) | Log of skills and techniques used while building this project |

---

## Roadmap

Recurring tasks and natural-language quick-add have shipped. Next, in order of value:
cross-device sync (free-tier, keeping the local-first promise), Thai natural-language dates,
and weekly statistics with streaks. The full plan — with starting points in the code, design
constraints, and the ideas deliberately rejected — lives in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## License

MIT © Phasathat Jaruchitsophon
