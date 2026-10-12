# Tasks

## 0. Before you start

- [ ] 0.1 Read `design.md` → "Read this first". The decisions most often got
  backwards: a switch is decided once per page load and applied by a reload at a
  free moment (D6), unknown means off (D5), the outbox is never behind a switch
  (D7), the gate registry is not touched (D1), the Releases page lists from the
  database (D4), a switch is one answer for the whole business (D3), and this
  change's own migrations obey its own lint (D16).
- [ ] 0.2 Re-read `git log --oneline -5` against the session start; the checkout
  and the local Supabase container are shared with other sessions. Reset the local
  database before trusting any database gate.
- [ ] 0.3 Migrations in this change are dated after the newest on `main`
  (`20261017000000_restore_counter_before_dish_ticks.sql` at the time of writing).
  That file is the lint baseline (D8); if a newer migration has landed, move the
  baseline to it and say so in this file.

## 1. The owner sees it first

Built against the mock adapter only; nothing in this section touches the database.

- [ ] 1.1 Adapter types in `src/data-access/adapters.ts`: a `ReleaseSwitchesAdapter`
  with `read()`, `subscribe(onChange)`, and for the owner `overview()` (switches,
  their history, and every tablet's health grouped by outlet) and
  `turn(key, enabled, reason)`. Mock implementation in `src/data-access/mock/` with
  the demo scenario: `release-probe` and `device-health` declared; Kalyani Cafe
  tablets in every state — running, waiting, stale, failing — and a history of
  turns.
- [ ] 1.2 `src/release/switches.ts` (declarations and tombstones, D4) and the
  switch store (`src/release/store.ts`, an external store read with
  `useSyncExternalStore`, as `src/pwa/update-store.ts` is): boot snapshot from
  local storage, frozen; `useReleaseSwitch(key)`, an undeclared key a type error
  (D5).
- [ ] 1.3 The Releases surface: gate `owner-releases` (path `releases`, **no `nav`
  entry**) in `demo`; the list and the release page per design D18 and the owner UI
  conventions; Turn on / Turn off with the confirmation sheet and optional reason;
  history; the tablets' live readings grouped by outlet. Shimmers shaped like the
  list and the page.
- [ ] 1.4 The way in (D18): a **Releases** link in `src/auth/account-menu.tsx`,
  above **View Demo**, for `super_admin` only. In the demo (D15): no menu and no
  entry point — the page is reached at `/demo/owner/releases`, turns switches
  locally, applied on reload, reset with the demo. Tests: the link is absent for
  every other role; the navigation bar has no Releases entry in either tree; the
  demo address opens the page from a cold load.
- [ ] 1.5 The probe: the build stamp reads `· probe` while `release-probe` is on.
- [ ] 1.6 **STOP for the owner.** Capture at phone width, light and dark: the
  account menu open with Releases; the Releases list; a release page with four
  tablets in the four states; the Turn off sheet; the history; the demo's Releases
  page at its address; the build stamp with the probe. Ask the owner to confirm the page's name. Send
  them. Apply what the owner changes and record each decision, dated and
  attributed, in `design.md` D18. Nothing below starts until the owner approves.

## 2. Database

One migration after the baseline. It builds the machinery rather than serving a
switch's on-path, so it declares no `release-switch`. It must pass
`lint:migrations` (5.1) — writing 5.1 first is a reasonable order.

- [ ] 2.1 `release_switches` (declaration plus `enabled`, `changed_at`,
  `changed_by`, `retired_at`; a retired switch refuses to be turned),
  `release_switch_events` (append-only trigger) and `device_health`, per design D3.
  Insert the `release-probe` and `device-health` rows, off, with their titles and
  *On means* / *Off means* sentences.
- [ ] 2.2 RLS per D3: `release_switches` readable by every authenticated principal,
  not `anon`; events owner-only; `device_health` the owner and that outlet's
  Franchise Admins. Revoke every direct insert, update and delete from client roles.
- [ ] 2.3 `set_release_switch`, `release_switch_force` (postgres and service role
  only), `app_release_switch(key)` (stable), `report_device_health(...)` (device and
  outlet from the device session, never arguments). `security definer`, empty
  `search_path`, explicit grants, revokes from `public` and `anon`.
- [ ] 2.4 Add `release_switches` to the Realtime publication, in the guarded form
  earlier migrations use.
- [ ] 2.5 pgTAP `supabase/tests/NN_a_release_can_be_switched_off.sql`: a declared
  switch starts off; a retired switch reads off and refuses a turn; re-inserting a
  key fails; the owner turns on and off with a reason and the event is recorded;
  setting the current answer records an event and changes nothing else; a Franchise
  Admin, a Biller, a counter device and a kitchen device are each refused
  `set_release_switch`; `release_switch_force` is not executable by `anon` or
  `authenticated`; events refuse update and delete for every role; every signed-in
  principal reads `release_switches` and `anon` does not; `app_release_switch` for
  every case; `report_device_health` writes only the caller's own device row.
- [ ] 2.6 **Isolation, `device_health`**: a Franchise Admin and a counter device of
  one outlet each hand-craft a select of the other outlet's health and receive
  nothing; a Biller reads none; every client role's direct write to any of the three
  tables is refused. pgTAP and a REST probe in `supabase/tests/rest/`.
- [ ] 2.7 `npm run db:types`; inspect the diff (only the new objects; watch for the
  telemetry line).

## 3. The switch in the app

- [ ] 3.1 The live adapter (`src/data-access/supabase-adapters/release-switches.ts`):
  `read` selects the non-retired rows, `subscribe` via Realtime on
  `release_switches`, `overview` and `turn` for the owner.
- [ ] 3.2 The store's refresh (D6): Realtime change, foreground, `online`, every 60 s
  while visible, once after first render; one read at a time with one trailing read.
  On a differing answer: save it, then `recordUpdateReady()`. Every failure branch
  keeps the current answers. Unit tests for each trigger, the queue, every failure
  branch, the frozen snapshot, unknown-is-off, offline boot from cache, and that a
  differing answer raises the update signal exactly once.
- [ ] 3.3 Mount the store before the router in `src/main.tsx` (or the app root), so
  every shell — owner, admin, counter, kitchen, employee — boots with a snapshot.
- [ ] 3.4 `describeSwitch('<key>', (state) => …)` test helper, and a test provider
  that pins a snapshot.
- [ ] 3.5 Prove the outbox is not behind a switch (D7): a unit test that a command
  queued under one snapshot is dispatched under the other, and a short comment at the
  outbox's dispatch registration saying why it must stay outside toggle points.
- [ ] 3.6 Promote `owner-releases` to `live` on the live adapter; demo still walks.

## 4. Device health

- [ ] 4.1 Instrumented fetch in `src/data-access/supabase.ts`, installed only when
  `device-health` was on at boot: resource name from the path only (`rest/v1/<table>`,
  `rest/v1/rpc/<fn>`, `functions/v1/<name>`, `auth`), failure as D13 defines it,
  duration; a 60-second ring; accounting wrapped so it can never fail or delay the
  request. Unit tests: query strings never read; a thrown accounting error leaves the
  response intact; each failure class.
- [ ] 4.2 The reporter: the counter's and kitchen's existing one-minute heartbeat
  timers also call `report_device_health`, plus once right after boot; failures
  swallowed. Build from `src/pwa/build-info.ts`; booted switches from the store.
- [ ] 4.3 The release page reads `device_health`; *running* versus *waiting*
  compares a tablet's booted switches with the current answer; stale after two
  minutes; tablets grouped by outlet.

## 5. Tooling

- [ ] 5.1 `scripts/check-migrations.mjs` and `npm run lint:migrations`, added to
  `npm run lint`: every rule in design D8's table, the header declarations, inline
  exceptions, emergency, the baseline, comment and body stripping, remediation
  messages (D12). `scripts/check-migrations.test.mjs`: a failing and a passing
  fixture per rule, including #74's `create or replace function
  public.counter_kitchen_marks` as a must-fail fixture and this change's own
  migration as a must-pass.
- [ ] 5.2 `scripts/check-switches.mjs` and `npm run lint:switches`, added to
  `npm run lint`: every check in design D4 and the `## Release` section check for
  change folders created on or after 2026-10-13. Remediation messages. Tests with
  fixtures, including a clock injected for the `retireBy` warning and failure. Add
  the Release-section check to `docs.yml` as its own step, so a proposal-only commit
  meets it, and keep `check-workflow-path-tiers.test.mjs` green.
- [ ] 5.3 Extend `scripts/check-agent-instructions.mjs` so `release` and
  `retire-switch` must exist in both `.claude/skills/` and `.agents/skills/`, with a
  test.
- [ ] 5.4 Playwright plumbing for `RELEASE_SWITCHES=off|on` in both configs: the
  demo init script (all off) for `off`; a global setup turning every declared switch
  on through the service role for the auth suite's `on`; the tag filter
  (`@switch-on:`, `@switch-off:`, `@switch-round-trip:`); `npm run test:e2e:on` and
  `npm run test:e2e:auth:on`.
- [ ] 5.5 `verify.yml`: `e2e browser tests (releases on)` and `auth browser tests
  (releases on)` as parallel jobs, each exiting early with a line saying so when no
  release switch is declared. Keep `check-workflow-path-tiers.test.mjs` and
  `check-release-order.test.mjs` green.
- [ ] 5.6 Tests carrying the probe's and device-health's coverage so 5.2 passes on
  this change: `describeSwitch` for each; `@switch-on:release-probe` (demo and auth:
  the stamp reads `· probe`); `@switch-on:device-health` (auth: a report row appears
  with resource counts and no query text).
- [ ] 5.7 The request budget (D10): `e2e-auth/request-budget.spec.ts` — counter and
  kitchen idle over a measured minute after settling, then five dish ticks and one
  payment. Measure the current build three times, set each budget at 1.5× the worst,
  record the numbers, date and SHA in the test. Runs in both states.
- [ ] 5.8 Prove the budget catches the incident: in a temporary worktree at
  `11bd95a7`, run the budget spec against that build on a freshly reset local stack
  (that commit's migrations), confirm it fails, record the counts here, remove the
  worktree, and reset the shared stack again.
- [ ] 5.9 The ways out (D17). `republish.yml`: SHA input; the GitHub API check for a
  successful Deploy run on exactly that SHA, before any build; build and publish; no
  migrate, no functions. `hotfix.yml`: SHA and reason inputs; the short gate (lint,
  typecheck, unit tests, build); then migrate, functions, publish in Deploy's order,
  every one of those jobs in the `production-hotfix` environment. Move the `pages`
  concurrency group from Deploy's workflow level to its publishing job, and use the
  same group on the publishing jobs of Republish and Hotfix. Delete
  `emergency-rollback.yml`. `scripts/check-republish.test.mjs` and
  `scripts/check-hotfix.test.mjs` pin the shapes; keep `check-release-order.test.mjs`
  green.

## 6. Agent instructions

Both trees; `npm run lint:agents` green at the end.

- [ ] 6.1 `AGENTS.md`: a **Releases are reversible** section under Hard Rules (D12's
  list, D11's table of the life of a change, and the ways out of D17); the
  Verification list gains `lint:migrations`, `lint:switches`, the two `on` jobs and
  the budget, mirroring `verify.yml`; the quickfix lane's refusal list gains
  "changes counter or kitchen runtime behaviour beyond copy and styling without a
  switch". `CLAUDE.md`: the third rule worth loading.
- [ ] 6.2 Propose — `.claude/commands/opsx/propose.md` and
  `.agents/skills/openspec-propose/SKILL.md`: the mandatory `## Release` section
  (the switch key, On and Off each in one owner-readable sentence, or `No switch:`
  and why) and a version-skew paragraph in design for every database object
  touched. **The agent derives it** — On is the change, Off is today — and asks the
  owner only in D11a's cases; the workflow says so in those words.
- [ ] 6.3 Apply — `apply.md` and `openspec-apply-change`: build the switch and its
  migration row first; off path untouched; `_v2` instead of editing; run
  `npm run lint:migrations` after each migration; tag old tests rather than editing
  them; the round trip for anything persisted.
- [ ] 6.4 Archive — `archive.md` and `openspec-archive-change`: refuse until the
  switch's history shows it on in production and then pulled once (off and on again)
  — check `release_switch_events` read-only, or ask the owner; seed the retirement
  change with the switch's `retireBy`.
- [ ] 6.5 Propose → apply → verify, both trees: both states, the budget, and the
  report names the switch and what Off was proved to mean.
- [ ] 6.6 Quickfix (`.claude/skills/quickfix/SKILL.md`): the runtime-behaviour rule
  from 6.1, and a pointer to Hotfix for when the counter is down.
- [ ] 6.7 Next change, both trees: switches past or within seven days of `retireBy`
  listed first as work due.
- [ ] 6.8 New workflows in both trees, `release` and `retire-switch` (D11, D12):
  preconditions, the quiet-hour check, turning on, what to watch on the release page
  and for how long, pulling it once, when to turn off; and the retirement sequence
  with the telemetry check before the contract migration. `agents/openai.yaml` for
  the Codex side, matching its siblings.
- [ ] 6.9 Explore, both trees: one paragraph — when an idea changes a live surface,
  ask early what Off would mean.

## 7. Docs and the board

- [ ] 7.1 `docs/RELEASES.md` (new), and every page the proposal names. In
  `docs/DEMO_MODE.md`, record D3 of `demo-mode-and-app-shell` as narrowed, not
  reversed. In `docs/OPERATIONS.md`, replace "Rollback is unchanged" with the ladder,
  the Republish and Hotfix runbooks (including how to check the `production-hotfix`
  environment's reviewer), and the dashboard SQL for `release_switch_force`.
- [ ] 7.2 `docs/LIMITATIONS.md`; `openspec/todos/` notes for automatic switch-off
  (D14), trying a release on one device (D14) and per-outlet switching (D3), each
  with its trigger and the shape already agreed.
- [ ] 7.3 `npm run roadmap:sync`.

## 8. Verification

- [ ] 8.1 Run every gate CI runs, on fresh resets: lint (all invariants, including
  the two new lints), format, typecheck, functions typecheck, contrast, unit, build,
  `test:e2e` and `test:e2e:on`, `test:db`, `test:rls`, `test:e2e:auth` and
  `test:e2e:auth:on`, the budget, generated types, and the prose tier's steps.
  Record counts here.
- [ ] 8.2 Walk the live-built owner Releases page at phone width in both themes, and
  the counter and kitchen at tablet width, with console and network clean. On the
  local stack: turn the probe on from the owner's page and watch an idle counter and
  kitchen take it within a minute, then off; turn a switch while typing on the
  counter and confirm the reload waits.
- [ ] 8.3 Offline: with `device-health` on, take the counter offline, ring bills,
  turn `device-health` off from the owner, reconnect; every bill settles exactly
  once and the counter reloads into off at its next free moment.

## 9. Production

Pushing is the owner's decision and window. Nothing here is done without it.

- [ ] 9.1 Before the first push: the owner creates the `production-hotfix`
  environment in the repository's settings with themselves as required reviewer.
  Confirm it with `gh api repos/{owner}/{repo}/environments/production-hotfix`.
- [ ] 9.2 Deploy at the owner's chosen window. Confirm the production build, the
  three tables, and that every tablet still runs exactly as before (all switches off).
- [ ] 9.3 With the owner, at a quiet hour: the owner turns `release-probe` on from
  their phone; every tablet's stamp gains `· probe` without anyone touching it;
  measure the time per tablet. Then off, then on, then off — the pull. Record times
  here.
- [ ] 9.4 The owner turns `device-health` on; the release page shows each tablet's
  build, requests, failures and slowest request within two minutes; watch through
  one service; pull it once. Record what it showed.
- [ ] 9.5 Ways-out rehearsal, outside service and with the owner's agreement:
  Republish with an unverified SHA is refused; Republish of the current verified SHA
  publishes without the suite; Hotfix of the current SHA waits for the owner's
  approval and, once approved, publishes while a Deploy run is still verifying.

## 10. Retire the probe

The retirement path, run once before any real change needs it.

- [ ] 10.1 Using the `retire-switch` workflow: remove the probe's toggle point and its
  tests' tags, move `release-probe` to `RETIRED_SWITCHES`, release that build.
- [ ] 10.2 Once every tablet's health report shows a build without the probe for a
  week, a contract migration (`-- release: contract release-probe`) setting its
  `retired_at`. Confirm `lint:migrations` accepts it and would have refused it before
  10.1.
- [ ] 10.3 Note in this file what the workflow got wrong or left unsaid, and fix the
  workflow in both trees.

## 11. Phase gate

- [ ] 11.1 **PHASE GATE.** The owner turns a release off and back on from their
  phone, and every tablet follows at its next free moment — within a minute, with no
  deploy and nobody pressing anything on the tablet — while the release's page
  shows, for each tablet, its build, whether it is running the release, its failed
  requests and its slowest request in the last minute; turning a release off
  strands no work, because writes a tablet queued on the switched-on path still
  settle exactly once after it switches off; only the owner can turn a release,
  proved by a hand-crafted request from a Franchise Admin and from a tablet, and
  each outlet's tablet health is isolated, proved by a hand-crafted request; a
  migration that drops, renames, retypes or rewrites anything a published build
  calls fails lint with a message saying what to write instead; every browser suite
  runs once with every release off and once with every release on; an idle counter
  and an idle kitchen each stay inside a request budget that the build #74 shipped
  fails; an earlier published build can be republished in minutes without re-running
  the suite, and only a build the suite once passed; an unverified hotfix reaches
  production in minutes only after the owner approves it in GitHub, and the full
  suite still runs on it afterwards; the probe release is created, turned on in
  production, turned off and retired through the same path every later change will
  use; every agent workflow in both agent trees asks for the switch before it writes
  a line of the change, and a proposal that does not answer fails CI whichever agent
  wrote it; and the four-role demo walkthrough still walks.
