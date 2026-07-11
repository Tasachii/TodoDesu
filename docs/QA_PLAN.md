# Todoo — QA Testing Plan

How Todoo is tested, what must pass before any commit lands on `main`, and the manual
checks that automation cannot cover. This is the working checklist for every release —
not aspirational process.

## 1. Test pyramid (automated)

| Layer | Suite | Covers | Runs in |
|---|---|---|---|
| Server integration | `packages/server/test/*.test.js` | Every endpoint via `fastify.inject()` plus on-disk migration coverage — CRUD rules, soft delete/restore, recurrence idempotency, focus lifecycle, stats, settings, error shapes, strict validation | `npm test`, CI |
| CLI unit | `packages/cli/test/dates.test.js` | Natural-language date parsing (most fragile logic) | `npm test`, CI |
| CLI integration | `packages/cli/test/api.test.js` | The CLI's HTTP wrapper against a real in-process server — bodyless DELETE regression guard, error propagation | `npm test`, CI |
| Standalone engine | `packages/web/test/local.test.js` | Parity with the server, case by case: business rules, persistence, corrupt-snapshot recovery, clock-skew clamping, id reconciliation | `npm test`, CI |
| E2E smoke | `packages/web/e2e/smoke.spec.js` | The real build + real server + headless Chromium: quick-add with date detection, complete/undo, search, theme cycle into Wa, board columns, Pomodoro toggle, recurring spawn | `npm run test:e2e -w @todoo/web`, CI |

Rules:

- **A bug fix lands with the regression test that would have caught it.** (Precedent:
  the `todo rm` content-type bug.)
- **Server rules and engine rules change together.** If a route's behavior changes,
  the same change lands in `local.js` and both suites in the same commit.
- CI (GitHub Actions) runs the full suite plus a production web build on every push
  and pull request; a red build blocks merging.

## 2. Pre-commit gate (every change)

```bash
npm test          # all workspaces — must be 100% green
npm run build     # web build must complete without errors
```

Plus, for any change touching the listed area:

| Area touched | Additional gate |
|---|---|
| Server routes / DB | curl smoke against a real server on a throwaway DB (`TODOO_DB=/tmp/...`) |
| CLI commands | run the affected command against a throwaway server with `HOME` pointed at a temp dir |
| Web data layer | engine suite + check both modes: normal build serves from API, `VITE_STANDALONE=1` build uses the engine |
| Focus timer logic | manual timer run (start, background the tab, return — remaining time must be correct) |
| iOS packaging | `npm run app:sync` completes and `dist/` ends up as the **normal** build |

## 3. Manual checklist (per release / UI-affecting change)

Run in Safari first (primary target), then Chrome. iPhone SE width (375 px) and a
desktop window; both light and dark themes.

**Today**
- [ ] Quick-add: type → Enter → task appears instantly (optimistic), survives reload
- [ ] Swipe right completes with green underlay; swipe left deletes with red underlay
- [ ] Both swipes show the 5-second Undo toast, and Undo actually reverts
- [ ] Overdue section shows red accent; empty state appears when all clear

**Board**
- [ ] Drag between columns and reorder within a column (mouse and touch)
- [ ] Card lands where dropped and stays there after reload (fractional `sort_order`)
- [ ] Done column hides items completed more than 7 days ago
- [ ] Keyboard: tab to a card, space lifts, arrows move, space drops; tabbing once more
      reveals the Details button

**Calendar**
- [ ] Dots appear on days with tasks; tapping a day lists its tasks
- [ ] Upcoming toggle shows the next 7 days grouped by day

**Focus**
- [ ] Timer mode: presets and custom minutes; finished card offers done/break/dismiss
- [ ] Pomodoro mode: work round chimes into auto-break; round dots advance after the
      break; long break after the final round resets the cycle
- [ ] Background the tab mid-session, return after >1 min — remaining time is correct
- [ ] Second device/tab shows the same running session
- [ ] "Give up early" stops without advancing the round

**Cross-cutting**
- [ ] Theme toggle cycles auto → light → dark and persists across reloads
- [ ] PWA: Add to Home Screen on iPhone; app opens standalone with the correct icon
- [ ] CLI: `todo add "x" -d "tomorrow 6pm"` then `todo` then `todo done 1` round-trips
- [ ] LAN mode (`TODOO_HOST=0.0.0.0`): reachable from a phone on the same Wi-Fi

## 4. Feature-specific plans

### Backup (export / import)
- Automated: round-trip test in both server and engine suites — create data → export →
  import into a fresh instance → identical task/session/settings content; import
  rejects payloads that aren't a Todoo backup (wrong `app`/`version`).
- Manual: export downloads a dated `.json`; import shows a confirmation (it replaces
  everything), then the UI reflects the imported data without a reload.
- Cross-mode: a file exported from the server-backed web app imports cleanly into a
  standalone build, and vice versa (same payload shape by design).

### Quick-add natural-language dates
- Automated: `packages/web/test/quickdate.test.js` — phrase extraction, title
  stripping, 18:00 default, forward dates, bare-number/date-only rejection.
- Manual: typing "pay rent tomorrow 6pm" shows the chip within ~a keystroke pause;
  "keep as text" stores the full title with no date; the manual date picker always
  wins over the detected date; Thai titles with embedded English dates work.

### Search and keyboard shortcuts
- Manual: `/` opens search anywhere (except while typing in a field); results split
  Open/Done and cap at 30; tapping a result closes search and opens its detail sheet;
  `esc` closes search/detail/settings; `n` lands the cursor in quick-add from any
  view; `1–4` switch views; none of the shortcuts fire while typing.

### Static hosting (GitHub Pages)
- Build with `VITE_STANDALONE=1` and a non-root `VITE_BASE` (e.g. `/todoo/`), serve
  `dist/` under that subpath locally, and verify: page loads, JS/CSS/icon URLs all
  resolve under the subpath, client-side routes work, deep-link reload falls back to
  the SPA (404.html), service worker registers at the subpath scope.
- After the first real deploy: install as PWA from the Pages URL on a phone, add a
  task, kill and reopen — data persists (localStorage).

## 5. Release checklist

1. `npm test` green; CI green on `main`.
2. Manual checklist (section 3) for the areas the release touches.
3. Version bump in the affected `package.json` files; `VERSION` in
   `packages/server/src/app.js` for server releases.
4. Tag and push; verify the Pages deploy workflow finishes and the live URL works.
5. Export a backup of your own data before trying schema-affecting upgrades —
   eat your own dog food.
