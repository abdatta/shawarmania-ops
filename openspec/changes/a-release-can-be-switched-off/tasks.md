# Tasks

## 0. Before you start

- [x] 0.1 Read `design.md` → "Read this first". The decisions most often got
  backwards: a gate is decided once per page load and applied by a reload at a
  free moment (D6), unknown means off (D5), the outbox is never behind a gate
  (D7), the gate registry is not touched (D1), the Change gates page lists from the
  database (D4), a gate is one answer for the whole business (D3), and this
  change's own migrations obey its own lint (D16). Then items 9 and 10: staging is a
  separate project in a separate account (D19), and nothing is pushed to `main` (D20)
  — until 9.11 lands, push as before; from then on, `stage` only.
- [x] 0.2 Re-read `git log --oneline -5` against the session start; the checkout
  and the local Supabase container are shared with other sessions. Reset the local
  database before trusting any database gate.
- [x] 0.3 Migrations in this change are dated after the newest on `main`
  (`20261017000000_restore_counter_before_dish_ticks.sql` at the time of writing).
  That file is the lint baseline (D8); if a newer migration has landed, move the
  baseline to it and say so in this file. *(2026-10-13: still `20261017000000`.)*

## 1. The owner sees it first

Built against the mock adapter only; nothing in this section touches the database.

- [x] 1.1 Adapter types in `src/data-access/adapters.ts`: a `ChangeGatesAdapter`
  with `read()`, `subscribe(onChange)`, and for the owner `overview()` (gates,
  their history, and every tablet's health grouped by outlet) and
  `turn(key, enabled, reason)`. Mock implementation in `src/data-access/mock/` with
  the demo scenario: `probe` and `tablet-health` declared; Kalyani Cafe
  tablets in every state — running, waiting, stale, failing — and a history of
  turns.
- [x] 1.2 `src/change-gates/gates.ts` (declarations and tombstones, D4) and the
  gate store (`src/change-gates/store.ts`, an external store read with
  `useSyncExternalStore`, as `src/pwa/update-store.ts` is): boot snapshot from
  local storage, frozen; `useChangeGate(key)`, an undeclared key a type error
  (D5).
- [x] 1.3 The Change gates surface: surface gate `owner-change-gates` (path `change-gates`, **no `nav`
  entry**) in `demo`; the list and the gate's page per design D18 and the owner UI
  conventions; Turn on / Turn off with the confirmation sheet and optional reason;
  history; the tablets' live readings grouped by outlet. Shimmers shaped like the
  list and the page.
- [x] 1.4 The way in (D18): a **Change gates** link in `src/auth/account-menu.tsx`,
  above **View Demo**, for `super_admin` only. In the demo (D15): no menu and no
  entry point — the page is reached at `/demo/owner/change-gates`, turns gates
  locally, at once with the demo's data kept (D15), reset with the demo. Tests: the link is absent for
  every other role; the navigation bar has no Change gates entry in either tree; the
  demo address opens the page from a cold load.
- [x] 1.5 The build stamp reads as it always has and, while any gate is on, opens
  the build code with a Copy (the probe's whole effect is *PB* appearing in it). It
  shows at the foot of every screen without an account menu — signed-out screens, counter, kitchen, tablet setup and
  shift start — and of the Change gates pages (owner, 2026-10-12; D16).
  *(2026-10-13: section 1 built against the mock adapter. 2,465 of 2,466 unit and
  component tests pass — the one failure is `mock/billing.test.ts`'s take-back
  case, which advances the demo clock an hour and so crosses the 04:00 IST cutover
  when run between 03:00 and 04:00 IST; unrelated, to be re-run after 04:00. Demo
  e2e `releases.spec.ts` (now `change-gates.spec.ts`) and `shell.spec.ts`: 18 passed across tablet and desktop.
  Typecheck and ESLint clean on every touched file.)*
- [x] 1.6 **STOP for the owner.** Capture at phone width, light and dark: the
  account menu open with Change gates; the Change gates list; a gate's page with four
  tablets in the four states; the Turn off sheet; the history; the demo's Change gates
  page at its address; the build stamp. Ask the owner to confirm the page's name. Send
  them. Apply what the owner changes and record each decision, dated and
  attributed, in `design.md` D18. Nothing below starts until the owner approves.
  *(Three rounds, 2026-10-13. Round one: the name is **Change gates**, everywhere,
  code and database included; every gate belongs to an OpenSpec change and a roadmap
  number shows only when it has one; the build number shows only where there is no
  account menu, plus the Change gates pages; the tablet numbers stay, generic,
  reworded *38 requests · 0 failed · slowest 0.4 s*; several gates run at once and
  gates may depend on others. Round two: codes are two characters, capitals or
  digits with at least one letter, unique among live gates; the build number reads
  as it always did and, while any gate is on, opens the build code
  `c1f19c32·DT-KR` with a Copy; a gate's page leads with its state and a switch;
  dependencies are a list, shown as **Dependent on** and **Needed by** rows like the
  main list's, and the main list is flat rather than nested (D18, D21). The owner
  approved the rest — "Rest lgtm. You can build this end to end now." The demo keeps
  a #74-shaped pair, Dish ticks and Kitchen Ready depending on it, as the example of
  a dependency.)*

## 2. Database

One migration after the baseline. It builds the machinery rather than serving a
gate's on-path, so it declares no `change-gate`. It must pass
`lint:migrations` (5.1) — writing 5.1 first is a reasonable order.

- [x] 2.1 `change_gates` (declaration plus `code` — unique among live gates by a
  partial index — `enabled`, `changed_at`, `changed_by`, `retired_at`; a retired gate
  refuses to be turned), `change_gate_dependencies` (no self-dependency, no loops),
  `change_gate_events` (append-only trigger) and `device_health`, per design D3.
  Insert the `probe` and `tablet-health` rows, off, with their titles and
  *On means* / *Off means* sentences — the words the demo already shows, in
  `src/data-access/mock/change-gates.ts`, codes *PB* and *TH*, no dependencies, and
  `change_number` 75.
- [x] 2.2 RLS per D3: `change_gates` readable by every authenticated principal,
  not `anon`; events owner-only; `device_health` the owner and that outlet's
  Franchise Admins. Revoke every direct insert, update and delete from client roles.
- [x] 2.3 `set_change_gate`, `change_gate_force` (postgres and service role
  only), `app_change_gate(key)` (stable), `report_device_health(...)` (device and
  outlet from the device session, never arguments). `security definer`, empty
  `search_path`, explicit grants, revokes from `public` and `anon`.
- [x] 2.4 Add `change_gates` to the Realtime publication, in the guarded form
  earlier migrations use.
- [x] 2.5 pgTAP `supabase/tests/NN_a_release_can_be_switched_off.sql`: a declared
  gate starts off; a retired gate reads off and refuses a turn; re-inserting a
  key fails; a code repeated among live gates fails and a retired gate's code is
  accepted; a self-dependency and a loop are refused; turning a gate on while any
  gate it depends on is off is refused naming them; turning a gate off turns every
  gate depending on it, at any depth, off with its own event; turning it back on
  leaves them off; `app_change_gate` is false for a gate with any dependency off; the owner turns on and off with a reason and the event is recorded;
  setting the current answer records an event and changes nothing else; a Franchise
  Admin, a Biller, a counter device and a kitchen device are each refused
  `set_change_gate`; `change_gate_force` is not executable by `anon` or
  `authenticated`; events refuse update and delete for every role; every signed-in
  principal reads `change_gates` and `anon` does not; `app_change_gate` for
  every case; `report_device_health` writes only the caller's own device row.
- [x] 2.6 **Isolation, `device_health`**: a Franchise Admin and a counter device of
  one outlet each hand-craft a select of the other outlet's health and receive
  nothing; a Biller reads none; every client role's direct write to any of the three
  tables is refused. pgTAP and a REST probe in `supabase/tests/rest/`.
- [x] 2.7 `npm run db:types`; inspect the diff (only the new objects; watch for the
  telemetry line).
  *(Done 2026-10-12: `20261018000000_change_gates.sql`. pgTAP `86_a_release_can_be_switched_off.sql` 70/70; a kitchen tablet's refusal is the counter fixture with its kind flipped for one call. REST probe `supabase/tests/rest/zz-change-gates.test.ts` 4/4 under `vitest.change-gates.config.ts`, chained into `test:rls`. `database.types.ts` +205 lines, only the new objects, no telemetry line. The migration was written before 5.1, so 5.1's first run must pass it unchanged.)*

## 3. The gate in the app

- [x] 3.1 The live adapter (`src/data-access/supabase-adapters/change-gates.ts`):
  `read` selects the non-retired rows, `subscribe` via Realtime on
  `change_gates`, `overview` and `turn` for the owner.
- [x] 3.2 The store's refresh (D6): Realtime change, foreground, `online`, every 60 s
  while visible, once after first render; one read at a time with one trailing read.
  On a differing answer: save it, then `recordUpdateReady()`. Every failure branch
  keeps the current answers. Unit tests for each trigger, the queue, every failure
  branch, the frozen snapshot, unknown-is-off, offline boot from cache, and that a
  differing answer raises the update signal exactly once.
- [x] 3.3 Mount the store before the router in `src/main.tsx` (or the app root), so
  every shell — owner, admin, counter, kitchen, employee — boots with a snapshot.
  *(Done in section 1: `bootSnapshot()` is provided above the router in `src/main.tsx`;
  the demo root provides its own. The refresh of 3.2 is still to come.)*
- [x] 3.4 `describeChangeGate('<key>', (state) => …)` test helper, and a test provider
  that pins a snapshot.
- [x] 3.5 Prove the outbox is not behind a gate (D7): a unit test that a command
  queued under one snapshot is dispatched under the other, and a short comment at the
  outbox's dispatch registration saying why it must stay outside toggle points.
- [x] 3.6 Promote `owner-change-gates` to `live` on the live adapter; demo still walks.
  *(Done 2026-10-12. Refresh: 9 tests in `refresh.test.ts`; the frozen snapshot, unknown-is-off and the offline boot from saved answers are in `snapshot.test.ts` (13). 3.5 is proved statically rather than by one dispatch under two snapshots: `src/outbox/outbox-ignores-change-gates.test.ts` fails if any outbox source imports the gate store, so the outbox has no way to read a gate at all; the comment sits at the top of `src/outbox/drain.ts`. The phone, counter and kitchen roots each run the refresh; the demo does not.)*

## 4. Device health

- [x] 4.1 Instrumented fetch in `src/data-access/supabase.ts`, installed only when
  `tablet-health` was on at boot: resource name from the path only (`rest/v1/<table>`,
  `rest/v1/rpc/<fn>`, `functions/v1/<name>`, `auth`), failure as D13 defines it,
  duration; a 60-second ring; accounting wrapped so it can never fail or delay the
  request. Unit tests: query strings never read; a thrown accounting error leaves the
  response intact; each failure class.
- [x] 4.2 The reporter: the counter's and kitchen's one-minute reporter (its own timer, see below)
  calls `report_device_health`, plus once right after boot; failures
  swallowed. Build from `src/pwa/build-info.ts`; booted gates from the store.
- [x] 4.3 The gate's page reads `device_health`; *running* versus *waiting*
  compares a tablet's booted gates with the current answer; stale after two
  minutes; tablets grouped by outlet.
  *(Done 2026-10-12. `src/data-access/request-health.ts` (6 tests) is installed only when `tablet-health` was on at boot. The reporter, `src/change-gates/use-device-health-report.ts` (3 tests, both gate states), runs its **own** one-minute timer in the counter and kitchen roots rather than riding the outbox's heartbeat: that heartbeat lives in `src/outbox/`, which must never import the gate store (D7). The request count is the same, one call a minute while the gate is on. D13 updated to say so. Unit suite 2,496/2,496, `tsc` and ESLint clean.)*

## 5. Tooling

- [x] 5.1 `scripts/check-migrations.mjs` and `npm run lint:migrations`, added to
  `npm run lint`: every rule in design D8's table, the header declarations, inline
  exceptions, emergency, the baseline, comment and body stripping, remediation
  messages (D12). `scripts/check-migrations.test.mjs`: a failing and a passing
  fixture per rule, including #74's `create or replace function
  public.counter_kitchen_marks` as a must-fail fixture and this change's own
  migration as a must-pass.
  *(Done 2026-10-12: 52 tests. Replayed with the baseline moved to 20261015000000 it
  fails #74 at `20261016010000_the_kitchen_reports_ready_food.sql:209`, the replaced
  `counter_kitchen_marks`. Replayed over the 68 migrations since 2026-08-20 it raised
  only real non-additive changes (replaced functions, swapped check constraints, a `with`
  query moving rows), none a misreading. Two additions D8 implied but did not list: a
  contract migration may set `retired_at` and `enabled` on its own gate's row and no
  other, and its key must already be in `RETIRED_CHANGE_GATES` (D11 step 11). A `do`
  block's body is linted, `execute '…'` literals included, because it runs at migration
  time; a unique index on an existing table counts as a constraint.)*
- [x] 5.2 `scripts/check-change-gates.mjs` and `npm run lint:change-gates`, added to
  `npm run lint`: every check in design D4 — codes and dependencies included — and the `## Change gate` section check for
  change folders created on or after 2026-10-13. Remediation messages. Tests with
  fixtures, including a clock injected for the `retireBy` warning and failure. Add
  the Change-gate-section check to `docs.yml` as its own step, so a proposal-only commit
  meets it, and keep `check-workflow-path-tiers.test.mjs` green.
  *(Done 2026-10-12: 23 tests, a clock injected. It reads `gates.ts` through the
  TypeScript compiler, not a regular expression, and the gate rows through the migration
  lint's SQL reader. Beyond D4's list it also fails a migration header naming an
  undeclared gate, an `ops` gate with no `reason`, a gate whose `change` has no folder,
  and a test tag naming an undeclared gate (with the retirement step as the remedy).
  D4's "no unit test … and no browser test" is read as needing both, as 5.6 assumes. A
  folder with no `created:` date fails, except the three written before folders had one.
  First run failed both gates for want of an `@cg-on:` browser test — 5.6's work.)*
- [x] 5.3 Extend `scripts/check-agent-instructions.mjs` so `release` and
  `retire-gate` must exist in both `.claude/skills/` and `.agents/skills/`, with a
  test.
- [x] 5.4 Playwright plumbing for `CHANGE_GATES=off|on` in both configs: the
  demo init script (all off) for `off`; a global setup turning every declared gate
  on through the service role for the auth suite's `on`; the tag filter
  (`@cg-on:`, `@cg-off:`, `@cg-round-trip:` — the last in `on`, turning only its own
  gate off, D10); `npm run test:e2e:on` and `npm run test:e2e:auth:on`.
- [x] 5.5 `verify.yml`: `e2e browser tests (gates on)` and `auth browser tests
  (gates on)` as parallel jobs, each exiting early with a line saying so when no
  change gate is declared. Keep `check-workflow-path-tiers.test.mjs` and
  `check-release-order.test.mjs` green.
- [x] 5.6 Tests carrying the probe's and tablet-health's coverage so 5.2 passes on
  this change: `describeChangeGate` for each; `@cg-on:probe` (demo and auth:
  the build code includes `PB`); `@cg-on:tablet-health` (auth: a report row appears
  with resource counts and no query text).
  *(5.4–5.6 done 2026-10-12. Each suite's specs take `test` from its own `./test`
  (`e2e/test.ts`, `e2e-auth/test.ts`), which seeds the run's answers into every context
  before its first page — the demo's session answers off for the off run; the device's
  saved answers for the auth suite, including contexts a spec opens itself, so a tablet
  boots running them rather than reloading into them mid-test. ESLint refuses a spec
  importing Playwright's `test` directly. The auth suite's global setup
  (`e2e-auth/change-gates.setup.ts`) turns the local database's gates to the run's state
  through `change_gate_force` and back off after an on run; it sets off explicitly too,
  against D10's "off sets nothing", so a crashed on run cannot leak into the next off
  run, and it turns only gates that differ. `scripts/with-change-gates.mjs` sets the
  variable, since npm scripts run under cmd.exe on Windows. Demo `change-gates.spec.ts`: 6
  pass off (one `@cg-off:probe`), 7 pass on. Auth `change-gates.spec.ts`: the `@cg-off:`
  test passes off, both `@cg-on:` tests pass on; the history shows the setup's two turns
  on and teardown's two off. A demo reset inside a test returns to the demo's own start,
  every gate on, until the next load — no spec relies on otherwise.)*
- [x] 5.7 The request budget (D10): `e2e-auth/request-budget.spec.ts` — counter and
  kitchen idle over a measured minute after settling, then five dish ticks and one
  payment. Measure the current build three times, set each budget at 1.5× the worst,
  record the numbers, date and SHA in the test. Runs in both states.
- [x] 5.8 Prove the budget catches the incident: in a temporary worktree at
  `11bd95a7`, run the budget spec against that build on a freshly reset local stack
  (that commit's migrations), confirm it fails, record the counts here, remove the
  worktree, and reset the shared stack again.
  *(5.7 and 5.8 done 2026-10-13. Budgets, at 1.5× the worst of seven readings at
  `e38f420f` (four gates off, three gates on): counter idle minute 5 (read 2–3), kitchen
  idle minute 14 (8–9), one ACK 11 (5–7), one payment 63 (33–42); gates on adds the
  minute's gate read on each tablet. Against `11bd95a7` on its own migrations the spec
  fails: **counter idle 661 a minute**, kitchen 7, ACK 7, payment 143 — production read
  about 600 a minute on 12 October. Worktree removed, stack reset to this checkout.
  The first repeated runs hung because the order helpers reused the same customer phone
  numbers on every run: on a stack not freshly reset the customer already existed and the
  name box was replaced mid-fill. Numbers now come from the clock, a click fails after 30 s
  rather than waiting out the test, and `ringOrder` allows 15 s for its card among earlier
  runs' open orders. The ACK and payment rows count requests in a ten-second window after
  the action; #74's dish ticks are not counted, because they are not in this build — its
  relaunch adds them to this spec.)*
- [x] 5.9 The ways out (D17). `republish.yml`: SHA input; the GitHub API check for a
  successful Deploy run on exactly that SHA, before any build; build and publish; no
  migrate, no functions. `hotfix.yml`: SHA and reason inputs; the short gate (lint,
  typecheck, unit tests, build); then migrate, functions, publish in Deploy's order,
  every one of those jobs in the `production-hotfix` environment. Move the `pages`
  concurrency group from Deploy's workflow level to its publishing job, and use the
  same group on the publishing jobs of Republish and Hotfix. Delete
  `emergency-rollback.yml`. `scripts/check-republish.test.mjs` and
  `scripts/check-hotfix.test.mjs` pin the shapes; keep `check-release-order.test.mjs`
  green.
  *(Done 2026-10-12. One correction, made in D17 too: Hotfix gates production with an
  `approve` job in `production-hotfix` that migrate, functions and publish all need,
  rather than running each of them in that environment, because their secrets live in
  `production-database` and `production-functions` and a job has one environment.
  Approving cancels any Deploy still running for another commit. Deploy keeps a
  workflow-level group, renamed `deploy`, so pushes still never interleave; both
  migrate jobs share `production-migrations`. Hotfix requires `main` to be an ancestor
  of the fix and lists what it carries. Fast-forwarding `main` to the fix after
  publishing needs Promote's deploy key, so it lands with 9.9. Shapes: 5 + 10 tests,
  reading through `scripts/lib/workflow.mjs`.)*

## 6. Agent instructions

Both trees; `npm run lint:agents` green at the end.

- [x] 6.1 `AGENTS.md`: a **Every change can be turned off** section under Hard Rules (D12's
  list, D11's table of the life of a change, and the ways out of D17); the
  Verification list gains `lint:migrations`, `lint:change-gates`, the two `on` jobs and
  the budget, mirroring `verify.yml`; the quickfix lane's refusal list gains
  "changes counter or kitchen runtime behaviour beyond copy and styling without a
  gate". `CLAUDE.md`: the third rule worth loading.
- [x] 6.2 Propose — `.claude/commands/opsx/propose.md` and
  `.agents/skills/openspec-propose/SKILL.md`: the mandatory `## Change gate` section
  (the gate key, On and Off each in one owner-readable sentence, or `No gate:`
  and why) and a version-skew paragraph in design for every database object
  touched. **The agent derives it** — On is the change, Off is today — and asks the
  owner only in D11a's cases; the workflow says so in those words.
- [x] 6.3 Apply — `apply.md` and `openspec-apply-change`: build the gate and its
  migration row first; off path untouched; `_v2` instead of editing; run
  `npm run lint:migrations` after each migration; tag old tests rather than editing
  them; the round trip for anything persisted.
- [x] 6.4 Archive — `archive.md` and `openspec-archive-change`: refuse until the
  gate's history shows it on in production and then pulled once (off and on again)
  — check `change_gate_events` read-only, or ask the owner; seed the retirement
  change with the gate's `retireBy`.
- [x] 6.5 Propose → apply → verify, both trees: both states, the budget, and the
  report names the gate and what Off was proved to mean.
- [x] 6.6 Quickfix (`.claude/skills/quickfix/SKILL.md`): the runtime-behaviour rule
  from 6.1, and a pointer to Hotfix for when the counter is down.
- [x] 6.7 Next change, both trees: gates past or within seven days of `retireBy`
  listed first as work due.
- [x] 6.8 New workflows in both trees, `release` and `retire-gate` (D11, D12):
  preconditions, the quiet-hour check, turning on, what to watch on the gate's page
  and for how long, pulling it once, when to turn off; and the retirement sequence
  with the telemetry check before the contract migration. `agents/openai.yaml` for
  the Codex side, matching its siblings.
- [x] 6.9 Explore, both trees: one paragraph — when an idea changes a live surface,
  ask early what Off would mean.
  *(Section 6 and 5.3 done 2026-10-12; `lint:agents` checks 20 files, green. Beyond the
  list: `openspec/config.yaml` gains the rule as a non-negotiable and per-artifact
  rules (proposal section, design version skew, tasks gate-first), since both propose
  workflows tell the agent to re-read it; propose-apply-verify's "fix the broken test"
  rule now says a gated change tags instead; `CLAUDE.md`'s quickfix line names runtime
  behaviour. `lint:agents` now requires `next-change`, `propose-apply-verify`, `release`
  and `retire-gate` in both `.claude/skills/` and `.agents/skills/` (10 tests).)*

## 7. Docs and the board

- [x] 7.1 `docs/RELEASES.md` (new), and every page the proposal names. In
  `docs/DEMO_MODE.md`, record D3 of `demo-mode-and-app-shell` as narrowed, not
  reversed. In `docs/OPERATIONS.md`, replace "Rollback is unchanged" with the ladder,
  the Republish and Hotfix runbooks (including how to check the `production-hotfix`
  environment's reviewer), and the dashboard SQL for `change_gate_force`.
- [x] 7.2 `docs/LIMITATIONS.md`; `openspec/todos/` notes for automatic gate-off
  (D14), trying a change on one device (D14) and per-outlet gating (D3), each
  with its trigger and the shape already agreed.
- [x] 7.3 `npm run roadmap:sync`.
  *(Section 7 done 2026-10-12 for everything that exists today: `docs/RELEASES.md`
  (new; the anchors `#change-gates` and `#migrations-only-add` the lints print), README,
  OPERATIONS (the ladder, the concurrency groups, tablet health under Monitoring),
  ARCHITECTURE, DATA_MODEL, ROLES_AND_PERMISSIONS, SCREENS, DEMO_MODE (D3 narrowed, not
  reversed), OFFLINE_AND_SYNC, SECURITY_AND_PRIVACY, TESTING, GLOSSARY, LIMITATIONS; three
  `openspec/todos/` notes. Staging, Promote and the `stage` branch are written into
  RELEASES and OPERATIONS by section 9 when they exist, not before. `roadmap:sync`: already
  in sync.)*

## 8. Verification

- [x] 8.1 Run every gate CI runs, on fresh resets: lint (all invariants, including
  the two new lints), format, typecheck, functions typecheck, contrast, unit, build,
  `test:e2e` and `test:e2e:on`, `test:db`, `test:rls`, `test:e2e:auth` and
  `test:e2e:auth:on`, the budget, generated types, and the prose tier's steps.
  Record counts here.
  *(Done 2026-10-13, in `verify.yml`'s order with `CI=true`, the demo and auth suites
  one after another, each database job on a fresh reset: lint (eleven invariants) 0
  errors; format clean; typecheck and functions typecheck clean; unit 2,619 in 209 files;
  contrast 78 pairs AA in both themes; build clean; `test:e2e` 350 passed and
  `test:e2e:on` 352; `test:db` 3,542 in 87 files; `test:rls` every phase green;
  `test:e2e:auth` 41 passed and `test:e2e:auth:on` 42, the request budget among them;
  generated types unchanged; the prose tier's proposal check green. The first `test:db`
  failed `01_schema_coverage.sql`: the three gate tables were unclassified. They are
  `global` now, with teeth beside the customers table's — one select policy each, no
  client verb but select — and the suite was rerun on a fresh reset. The lesson is the
  one the repo already records: run every gate CI runs, not only the file you wrote.)*
- [x] 8.2 Walk the live-built owner Change gates page at phone width in both themes, and
  the counter and kitchen at tablet width, with console and network clean. On the
  local stack: turn the probe on from the owner's page and watch an idle counter and
  kitchen take it within a minute, then off; turn a gate while typing on the
  counter and confirm the reload waits.
- [x] 8.3 Offline: with `tablet-health` on, take the counter offline, ring bills,
  turn `tablet-health` off from the owner, reconnect; every bill settles exactly
  once and the counter reloads into off at its next free moment.
  *(8.2 and 8.3 done 2026-10-13 on the local stack, driven by a throwaway Playwright spec
  (kept outside the repository) and walked in the browser pane. An idle counter and
  kitchen took the probe both ways in **4 s** each. A counter with a bill open did not
  reload in 75 s, and reloaded 5 s after the bill was cleared. The first run found one
  gap: a turn made within a second or two of the tablets opening took **62 s**, the
  minute read, because their live channel had not joined. The change-gates channel now
  asks for a read each time it joins — and so after every rejoin — and the same turn
  lands in 4 s (a unit test pins the join nudge). Offline, with tablet health on: two
  orders rung and one paid offline, tablet health turned off by the owner, reconnect —
  each order arrived once, the paid one has exactly one bill, and the counter reloaded
  into the turn (its build code lost TH). The owner's Change gates list and gate page
  at phone width in light and dark, and the counter at tablet width: console clean,
  every request 200. The gate page showed the offline counter's last minute honestly —
  99 requests, 49 failed, waiting. The kitchen board was exercised by the automated runs
  here and in 8.1, not walked by eye.)*

## 9. Staging and the `stage` branch

Design D19 and D20. Added 2026-10-12 while section 1 was in progress. The owner's
steps are marked **owner**: an agent prepares them and confirms them afterwards
read-only, but cannot create accounts or enter credentials. Work in this order:
staging must verify this change before 10 promotes it to production.

- [ ] 9.1 **Owner:** create a separate Supabase account with a different email, and
  in it a project on **the same plan and compute size as production**. Read both
  projects' plan, compute, Postgres major version and region through the Management
  API (read-only) and record them side by side in `docs/OPERATIONS.md`. Record the
  account's email there too, and nothing else about it.
  *(Partly done 2026-10-13. The owner created the account and the project "Ops (Staging)",
  ref `diimnemgqmoqrnqzopiz`, in its own organization. Read in the dashboard: Free plan,
  Nano compute, ap-south-1 — production read through the Management API the same day:
  Free, Nano (no compute add-on), ap-south-1, Postgres 17.6.1.147. Still to do: staging's
  Postgres version through the Management API with the staging token, and the side-by-side
  record and the account email in `docs/OPERATIONS.md` (part of 9.11's commit).)*
  *(Since: staging's Postgres `17.11.0.003` read through the Management API (9.10's note),
  and the side-by-side table is in `docs/OPERATIONS.md`. Still open: the account's email
  there, which only the owner has.)*
- [x] 9.2 **Owner:** set staging's Auth settings to production's (site URL and
  redirect URLs pointing at the staging address); bootstrap the owner's own Super
  Admin in staging the way production's was; create a Cloudflare Pages project
  `shawarmania-ops-staging` and an API token scoped to it. Ask the owner whether
  they want their own subdomain (design, Open questions).
  *(Partly done 2026-10-13, in the owner's browser with their go-ahead. Staging Auth now
  matches production's (read through the Management API): sign-ups off, email confirmation
  on, manual linking and anonymous sign-ins off; site URL `https://stage-ops.shawarmania.in/`,
  redirect `https://stage-ops.shawarmania.in/**`. Cloudflare Pages project
  `shawarmania-ops-staging` (direct upload), production branch `stage`, custom domain
  `stage-ops.shawarmania.in` added — Cloudflare made the CNAME to
  `shawarmania-ops-staging.pages.dev` itself. Account ID `f2f737527a40ab8dc8052d3ba1fadabc`
  for `CLOUDFLARE_ACCOUNT_ID`. Still the owner's: the Pages-scoped API token, and the staging
  owner bootstrap is replaced by the seed's `staging.owner` unless they want their own.
  Production's own site URL still reads the old `abdatta.github.io` address; nothing in the
  app sends a Supabase auth email or redirect, so it is cosmetic there.)*
  *(Done 2026-10-13: the Cloudflare token came with the credential handoff (9.10) and
  publishes every Staging run; the owner uses the seed's `staging.owner` and wanted no
  separate bootstrap.)*
- [x] 9.3 Build-time `VITE_APP_ENVIRONMENT=staging`: the **Staging · not a real
  outlet** band on every shell and role, and the manifest name *Shawarmania Ops
  (staging)*. Unit test: the band renders only for `staging`; a production build has
  neither.
  *(Done 2026-10-12: `src/env/app-environment.ts` (pure, so `vite.config.ts` names the
  manifest with it) and `src/components/staging-band.tsx`, 4 tests. The band is rendered
  once above the router rather than in each shell's banner slot, so signed-out, setup and
  kitchen screens get it too; in a staging build `index.css` takes its height off every
  `h-dvh` and `min-h-dvh` layout, so nothing is pushed below the fold — measured on a
  staging build: 1,257 + 21 = the 1,278 px viewport. Colours are the inverted text tokens,
  distinct from the demo's amber strip, which it sits above in a staging demo. The tab
  title reads *Staging · Shawarmania Ops*.)*
- [x] 9.3a Staging installs under its own icon (D19): the brand mark with the wrap and
  flame recoloured blue, the owner's pick of the mock-ups.
  *(Done 2026-10-13: `assets/brand/shawarmania-mark-staging-512.png`, same field and
  alpha as the master; `npm run icons:generate` derives `public/icons/staging/` from it
  beside `public/icons/`. A staging build points its manifest and `index.html` links
  there and precaches only that set; a production build's manifest, links and precache
  list are unchanged. Tests: `src/env/app-environment.test.ts`,
  `scripts/generate-icons.test.mjs` (the two masters share a silhouette, so replacing
  one alone fails), and a smoke check that the published staging site serves its own
  icons — it failed against the build live before this.)*
- [x] 9.4 Third parties stay out (D19): for each Edge Function and scheduled job that
  reaches outside the project (`send-bill-receipts`, `bill-receipt-report`, the
  aggregator functions, `bill-receipt-recovery`, the aggregator jobs), prove it does
  nothing or fails closed when its secret or Vault entry is absent, with a test where
  one does not already exist. List them in `docs/OPERATIONS.md` as "never configured
  on staging".
  *(Done 2026-10-12. What reaches outside: `send-bill-receipts`, `bill-receipt-report`,
  `aggregator-reader`, `ingest-aggregator-cycle`, `request-aggregator-sync`, and the
  receipt wake-up behind `bill-receipt-recovery`. `parse-operator-statement` and
  `answer-aggregator-otp` reach nothing outside. No aggregator job runs inside the database
  — the syncs run in the sync repository and call in with the secret. New:
  `src/lib/third-parties-fail-closed.test.ts` (7: each refusal precedes the first call
  out) and `supabase/tests/87_staging_reaches_no_third_party.sql` (5, including the
  control that the same wake-up does make a request once configured). The list is in
  OPERATIONS under *Never configured on staging*.)*
- [x] 9.5 `scripts/seed-staging.mjs`: a synthetic history at production's row
  counts (read from production as **counts only**, recorded in the script with the
  date), a generated menu of production's shape, *Test Cafe*, and one test account
  per role. Phone numbers from a reserved fictional range; integer paise; no
  production row copied. Run with the staging service-role key from the environment;
  refuses any URL whose project ref is production's. Test the refusal.
- [x] 9.6 `staging.yml`: on push to `stage` with Deploy's path filter — a paused-project
  check with its one-sentence message; the suite (`verify.yml`); migrate, functions
  (the derive-the-ref guard), build with the staging variables, publish to Cloudflare
  Pages; then `test:e2e:staging`. Environments `staging-database`,
  `staging-functions`, `staging-pages`, `staging-smoke`; variables
  `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`. A shape test in the style of
  `check-release-order.test.mjs`.
- [x] 9.7 `staging-reset.yml`: manual; wipe, re-migrate to `stage`'s tip, re-seed;
  refuses production's ref. Confirm the CLI's remote reset works against the staging
  project and say which command was used.
- [x] 9.8 `e2e-staging/` and `npm run test:e2e:staging`: owner, Franchise Admin,
  counter and kitchen through one order, one payment and one change-gate turn on *Test
  Cafe*, the band visible on each; passwords from the environment only.
  *(9.5 and 9.8 done 2026-10-13, rehearsed together on the local stack. The seed is
  `supabase/staging/seed.sql`, one `do` block because `supabase db query` takes one
  statement; `scripts/seed-staging.mjs` (7 tests: production refused however spelled, a
  password of 12+ characters, placeholders filled as literals) writes the password into
  it from the environment. Every sale goes through the counter's own commands as the
  tablet — `create_billing_order`, `prepare_billing_order`, `pay_billing_order` — against
  one ended shift a day. Rehearsal, 46 s: 3,009 orders and bills (production 3,094 and
  3,009), 4,224 lines (4,454), 3,130 payments (3,140), 9,027 commands (9,782), 3,009
  receipt links, 446 customers, 353 expenses, 246 attendance days, 132 dishes in 17
  categories; totals equal payments to the paisa. Then `npm run test:e2e:staging`, against
  a staging-mode build served locally on that seed, passed in 25 s: both handshakes, one
  order rung, acknowledged and paid, the probe turned on and back off, the band on every
  screen, both shifts left. A Franchise Admin holds the kitchen's shift, so neither person
  holds two. Stack reset afterwards.)*
- [x] 9.9 `promote.yml` (D20): SHA input defaulting to `stage`'s tip; the successful
  Staging run check and the ancestor check, each stopping with one sentence; the
  summary of commits and change folders; the push job in `production-promote` with
  the deploy key. `deploy.yml`: skip the suite when a successful Staging run exists
  for the SHA, run it otherwise. Update 5.9's `hotfix.yml` to take a SHA on `stage`,
  require `main` as its ancestor, list what it carries, and fast-forward `main` after
  publishing. `ci.yml` and `docs.yml` triggers per D20's table. Extend
  `check-release-order.test.mjs`, `check-workflow-path-tiers.test.mjs` and
  `check-hotfix.test.mjs`; add `check-promote.test.mjs`.
  *(9.6, 9.7 and 9.9 written 2026-10-13 and pinned by `check-promote.test.mjs` (14, with
  Staging, Staging reset and Deploy's skip), `check-hotfix.test.mjs` (12) and the path
  tiers. Staging stops in one sentence when its project is paused, read from the
  Management API's project status with the staging account's token. Staging reset runs
  `supabase db reset --db-url … --no-seed` — `--no-seed` because `supabase/seed.sql`
  carries the local password — then `scripts/seed-staging.mjs`; that the CLI's remote
  reset works against the hosted project is confirmed only at 9.12, on the real one.
  Deploy's `staged` job reads a failed lookup as "not verified", the safe direction.
  Hotfix's last job pushes `main` with the deploy key, which therefore lives in
  `production-hotfix` as well as `production-promote`; GitHub asks the owner once more
  for that job. `docs.yml` covers pushes to `main` and `stage` until 9.11 retires direct
  pushes to `main`. Nothing here runs until `stage` exists.)*
- [ ] 9.10 Create `stage` from `main`'s tip and push it. **Owner:** create the deploy
  key and the `production-promote` environment (themselves as required reviewer);
  the `main` ruleset (no direct push, no force push, no deletion; the deploy key the
  only bypass) and the `stage` ruleset (no deletion; force pushes allowed, so the owner
  can squash commits not yet promoted — D20, 2026-10-13). Confirm each
  with `gh api` read-only.
  *(Credential handoff completed 2026-10-13, with the owner's explicit approval
  for the access grants. All three repository variables and all six environment
  secrets in the setup checklist are configured; the `promote` deploy key
  (GitHub ID `166283612`) has write access. Both `production-promote` and
  `production-hotfix` require `abdatta` as reviewer. The Supabase token is scoped
  to staging alone, Project Settings Read and Edge Functions Read-write; the
  Cloudflare token has Pages Edit for the named account, the scope its dashboard
  offers, rather than an individual Pages project. Read-only API calls accepted
  both tokens and confirmed the staging Pages project's `stage` production branch.
  Staging's session-pooler password came from the local `SUPABASE_STAGE_PWD` and
  passed a read-only SQL query. Management API reads: staging PostgreSQL
  `17.11.0.003`, production `17.6.1.147`, both major 17 and `ap-south-1`.
  No password, access token or private key was printed; temporary key and token
  files were removed after storage and validation. The generated test password is
  retained in a local, user-only file for the owner's fake-outlet walkthrough.
  The `stage` branch, rulesets, 9.11's instruction commit, deployment/reset and
  owner walkthrough remain pending; these tasks are deliberately still open.)*
  *(Corrected 2026-10-13, before anything was pushed. GitHub starts a hand-run
  (`workflow_dispatch`) workflow only from the default branch, so Promote, Staging reset,
  Republish and Hotfix cannot run until this change is on `main`. Three consequences:
  the `stage` ruleset goes on as soon as `stage` exists, but the `main` ruleset only after
  10.2, whose push to `main` is this change's own, and the last direct one; the Staging
  workflow seeds a staging that holds no Test Cafe itself (`seed-staging.mjs --if-empty`
  after migrating), because Staging reset cannot yet; and `STAGING_TEST_PASSWORD` must be
  in `staging-database` as well as `staging-smoke`, because the seed step and Staging
  reset run there. **Owner:** add it there.)*
  *(2026-10-13: `STAGING_TEST_PASSWORD` added to `staging-database` at the owner's request,
  read from the user-only file and never displayed; the local copy now lives in the
  gitignored `.env`. `stage` pushed at `8ad96b90` with the owner's approval; `main`
  untouched at `92eaf70c`. The `stage` ruleset (id `25030428`) was created at the owner's
  request the same day: deletion refused, force pushes allowed; `gh api
  repos/abdatta/shawarmania-ops/rules/branches/stage` reads back `deletion` alone. Open:
  the `main` ruleset, after 10.2.)*
- [x] 9.11 In **one commit**, pushed to `stage` just before the ruleset is turned
  on: `AGENTS.md` (push to `stage`, never `main`; promotion is the release and keeps
  the deploy-window rule; a push to `stage` is safe at any hour), every workflow in
  both agent trees that pushes or releases, `docs/OPERATIONS.md` and
  `docs/RELEASES.md` (the life of a change with steps 5–5b, the fake-outlet runbook,
  Promote, the reset). `npm run lint:agents` green.
  *(Committed locally 2026-10-13 as its own commit, "Staging #75: Every commit goes to
  stage first": `AGENTS.md`, `CLAUDE.md`, the quickfix lane, and the Staging section,
  life-of-a-change rows and staging-beside-production table of `docs/RELEASES.md` and
  `docs/OPERATIONS.md`; the script that wrote them is deleted in it. Pushed to `stage`
  2026-10-13 as `8ad96b90`. The `main` ruleset follows 10.2, not this push — see 9.10's
  correction.)*
- [ ] 9.12 Push this change to `stage`. Staging migrates, seeds the empty project
  (`--if-empty`), publishes, and the smoke suite passes. Run the paused-project message
  once by pausing staging deliberately, then resume it.
  *(2026-10-13, Staging run `38457964697` on `8ad96b90`, green in 16m15s: the suite
  11m, migrate and the first seed 2m, functions 29s, publish 32s, smoke 1m57s. Open: the
  paused-project message.)*
- [x] 9.12a The smoke suite moves to its own outlet (D19, at the owner's request
  during 9.13): *Smoke tests* with its own manager and biller, where the suite sets
  up a counter and a kitchen tablet with setup codes and removes them afterwards, so
  Test Cafe and its accounts are the owner's alone. `--if-empty` now seeds whatever
  is missing, so the next Staging run adds the outlet to the staging already seeded
  and retires the two tablets earlier seeds left in Test Cafe.
  *(Done 2026-10-13. Rehearsed on the local stack: the old seed then the new one with
  `--if-empty` — Test Cafe's 120 bills untouched, its two tablets removed, Smoke
  tests added; again, changing nothing; plain mode refusing; a fresh seed leaving
  Test Cafe's list empty. The smoke suite against a local staging build: green in
  21 s, every tablet it set up removed and no shift left open, including after a
  crashed run's tablet was put back by hand. Measured staging: 39 MB of 500 MB.)*
- [x] 9.12b The build stamp copies on a tap (D16, the owner's call during 9.13): it is
  always a button, and a tap copies *Build <sha>·<codes> · <built>*, showing *Copied*,
  or shows and selects that line where the clipboard is refused. The pop-up with the
  build code and a Copy is gone. Tests read the code from the stamp's
  `data-build-code`; the demo suite checks the clipboard itself.
  *(Done 2026-10-13: unit 7 tests, demo e2e green with gates off and on.)*
- [x] 9.12c Staging reads as a real outlet, and says so quietly (D19, the owner's
  calls during 9.13): *Test Cafe* is *Cafe Staging*, with Kalyani Cafe's menu as
  production held it on 13 October (65 items in 11 categories, read read-only and
  written into the seed), invented but realistic staff and customer names, receipt-like
  expenses, and a customer on about a third of past bills; the white band is a blue
  corner ribbon reading *Staging*, inside the 54px top bar, letting taps through.
  Staging is wiped and reseeded once for it, since the history is rung from the menu.
  *(Done 2026-10-13: the full-scale seed in 47 s locally — 3,009 bills, 1,051 with a
  customer, none of an item that is switched off; ribbon unit tests, contrast 6.7:1
  in both themes, and the smoke suite green against a local staging build.)*
- [x] 9.13 **The fake outlet, with the owner.** Laptop 1 as *Cafe Staging*'s counter
  (one-time code, shift handshake from the owner's phone), laptop 2 as its kitchen,
  the phone as owner. The owner turns `probe` on and off from staging's
  Change gates page and both laptops follow without a touch; then `tablet-health` on,
  and the page shows both laptops' readings. Ring orders through one simulated
  service. Read staging's request counts from its logs and compare with the budget
  (5.7). Record what was seen here.
  *(Done by the owner, 14 October 01:35–05:16 IST, on the staging that still held
  *Test Cafe*: their laptop as the counter in Brave ("Brave Counter"), their Android
  phone as the kitchen in Chrome ("Chrome Android"), the owner and staff in other
  browsers on the laptop. Seven orders rung, acknowledged and mostly paid; `probe` on
  at 03:47 and off at 05:16, `tablet-health` on at 05:00. The owner: "it all looks
  good." Tablet health's readings, read from staging's `device_health`: the counter
  2 requests a minute and the kitchen 3, against the budget's 5 and 14 (5.7) and the
  roughly 600 a minute #74's counter made; slowest request 5.8 s once on the counter
  and 0.8 s on the kitchen — the counter's is one sample, worth watching when Tablet
  health first runs in production. Recorded before staging was wiped for 9.12c.)*
- [ ] 9.14 Promote rehearsal: Promote a SHA with no successful Staging run is
  refused; Promote with no SHA, while `stage`'s tip is docs-only, takes the newest
  verified commit beneath it and lists the tip as left behind; Promote of a SHA `main` is not an ancestor of is refused; a direct push to
  `main` is refused by the ruleset. *Only after 10.2*: Promote runs from `main`, which
  does not hold it until then.

## 10. Production

Promoting is the owner's decision and window. Nothing here is done without it.
Production is reached only through Promote (9.9), from a SHA staging verified — except
this change's own first arrival, which carries Promote to `main` (10.2).

- [x] 10.1 Before the first push: the owner creates the `production-hotfix`
  environment in the repository's settings with themselves as required reviewer.
  Confirm it with `gh api repos/{owner}/{repo}/environments/production-hotfix`.
  *(Done 2026-10-13 in the credential handoff; `gh api` reads `abdatta` as its required
  reviewer, and it holds `PROMOTE_DEPLOY_KEY`.)*
- [x] 10.2 At the owner's chosen window, and with their go-ahead for that push, push
  the SHA 9.13 ran on straight to `main` — the last direct push to `main`, because
  Promote is not there to run until it lands. Confirm Deploy skipped the suite (it finds
  the Staging run), the production build carries the same SHA as staging's, the three
  tables exist, and every tablet still runs exactly as before (all gates off). Then the
  **owner** turns on the `main` ruleset (no direct push, no force push, no deletion; the
  deploy key the only bypass), and 9.14's rehearsal follows.
  *(Done 2026-10-14 at 05:56 IST, with the owner's go-ahead, outside trading (no shift
  open; the last bill 23:25 the night before). Pushed `79ae9435`, the newest commit
  Staging verified (run `38488172907`), rather than `52d5f29`, the build 9.13 ran on: the
  three commits between are the tap-to-copy stamp, staging's realistic data and ribbon,
  and a test fix, each through its own green Staging run. Deploy `38490140960` found the
  Staging run, skipped the suite, and migrated, deployed functions and published in
  1m19s. Production then held `20261018000000`, the four tables (`change_gates`,
  `change_gate_events`, `change_gate_dependencies`, `device_health`), `probe` and
  `tablet-health` both off, and served build `79ae943` under its own name and icon. No
  tablet was trading, so "runs exactly as before" is read off the first service, with
  every gate off. The `main` ruleset (id `25040290`) was created through the API at the
  owner's request ("if you can do it yourself go ahead"): deletion, non-fast-forward and
  update refused, the deploy-key actor its one bypass, and only the `promote` key exists;
  `gh api repos/abdatta/shawarmania-ops/rules/branches/main` reads all three back.)*
- [ ] 10.3 With the owner, at a quiet hour: the owner turns `probe` on from
  their phone; every tablet's build code gains `PB` without anyone touching it,
  as it did on staging in 9.13;
  measure the time per tablet. Then off, then on, then off — the pull. Record times
  here.
  *(Half done, read from production 2026-10-15: the owner turned `probe` on from the
  app at 09:29 IST on 14 October (reason "Test"), and both of Kalyani Cafe's tablets
  — *Kalyani Counter 2* and *Shawarma Kitchen* — reported it in their booted gates
  through that day's service, last at 23:52 and 23:58. The per-tablet times were not
  recorded, and a health report is overwritten each minute, so they cannot be read
  back now. Still open: the pull (off, on, off) with its times, and `probe` is on
  where this task ends it off.)*
- [ ] 10.4 The owner turns `tablet-health` on; the gate's page shows each tablet's
  build, requests, failures and slowest request within two minutes; watch through
  one service; pull it once. Record what it showed.
  *(Half done, read from production 2026-10-15: on from the app at 09:30 IST on 14
  October, and it ran through that day's service, the first with `dish-ticks` and
  `kitchen-ready` on. Each tablet's last report: *Kalyani Counter 2*, build
  `5e2e872`, 16 requests in 60 s, none failed, slowest 530 ms (23:52); *Shawarma
  Kitchen*, build `5e2e872`, 9 requests, none failed, slowest 216 ms (23:58). Not
  yet pulled: its history holds the one turn on and nothing since.)*
- [ ] 10.5 Ways-out rehearsal, outside service and with the owner's agreement:
  Republish with an unverified SHA is refused; Republish of the current verified SHA
  publishes without the suite; Hotfix of the current SHA waits for the owner's
  approval and, once approved, publishes while a Deploy run is still verifying.
  *(Not started as of 2026-10-15: neither Republish nor Hotfix has a run.)*

## 11. Retire the probe

The retirement path, run once before any real change needs it.

- [ ] 11.1 Using the `retire-gate` workflow: remove the probe's toggle point and its
  tests' tags, move `probe` to `RETIRED_CHANGE_GATES`, release that build.
- [ ] 11.2 Once every tablet's health report shows a build without the probe for a
  week, a contract migration (`-- release: contract probe`) setting its
  `retired_at`. Confirm `lint:migrations` accepts it and would have refused it before
  11.1.
- [ ] 11.3 Note in this file what the workflow got wrong or left unsaid, and fix the
  workflow in both trees.

## 12. Phase gate

- [ ] 12.1 **PHASE GATE.** The owner turns a change gate off and back on from their
  phone, and every tablet follows at its next free moment — within a minute, with no
  deploy and nobody pressing anything on the tablet — while the gate's page
  shows, for each tablet, its build, whether it is running the change, its failed
  requests and its slowest request in the last minute; turning a change gate off
  strands no work, because writes a tablet queued on the on path still
  settle exactly once after it turns off; only the owner can turn a change gate,
  proved by a hand-crafted request from a Franchise Admin and from a tablet, and
  each outlet's tablet health is isolated, proved by a hand-crafted request; a
  migration that drops, renames, retypes or rewrites anything a published build
  calls fails lint with a message saying what to write instead; every browser suite
  runs once with every gate off and once with every gate on; an idle counter
  and an idle kitchen each stay inside a request budget that the build #74 shipped
  fails; an earlier published build can be republished in minutes without re-running
  the suite, and only a build the suite once passed; an unverified hotfix reaches
  production in minutes only after the owner approves it in GitHub, and the full
  suite still runs on it afterwards; every change reaches production only by promoting a commit staging already verified, after the owner approves it in GitHub, and a direct push to `main` is refused; staging is a separate Supabase project on production's compute size, with synthetic data at production's scale and no third-party secret, and the owner has run it as a fake outlet — two laptops as counter and kitchen, their phone as owner — turning the probe on and off there before production; the probe gate is created, turned on in
  production, turned off and retired through the same path every later change will
  use; every agent workflow in both agent trees asks for the gate before it writes
  a line of the change, and a proposal that does not answer fails CI whichever agent
  wrote it; and the four-role demo walkthrough still walks.
