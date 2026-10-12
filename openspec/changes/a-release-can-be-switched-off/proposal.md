# Proposal: A Release Can Be Switched Off

> **Model**: Opus · **Wave**: F · **Depends on**: #70 · **Gate**: the owner
> turns a release off and back on from their phone, and every tablet follows at its
> next free moment — within a minute, with no deploy and nobody pressing anything
> on the tablet — while the release's page shows, for each tablet, its build,
> whether it is running the release, its failed requests and its slowest request
> in the last minute; turning a release off strands no work, because writes a
> tablet queued on the switched-on path still settle exactly once after it
> switches off; only the owner can turn a release, proved by a hand-crafted request
> from a Franchise Admin and from a tablet, and each outlet's tablet health is
> isolated, proved by a hand-crafted request; a migration that drops, renames,
> retypes or rewrites anything a published build calls fails lint with a message
> saying what to write instead; every browser suite runs once with every release
> off and once with every release on; an idle counter and an idle kitchen each stay
> inside a request budget that the build #74 shipped fails; an earlier published
> build can be republished in minutes without re-running the suite, and only a
> build the suite once passed; an unverified hotfix reaches production in minutes
> only after the owner approves it in GitHub, and the full suite still runs on it
> afterwards; the probe release is created, turned on in production, turned off
> and retired through the same path every later change will use; every agent
> workflow in both agent trees asks for the switch before it writes a line of the
> change, and a proposal that does not answer fails CI whichever agent wrote it;
> and the four-role demo walkthrough still walks.

## Why

On 12 October 2026 the counter at Kalyani Cafe stopped working mid-service, and it
took two hours and a hand-written database correction to get it back.

Roadmap #74 went live at about 15:30 IST. It added three loops to the counter that
each asked the server for fresh data every second, and none of them waited for
its previous answer. The counter went from about 25–50 requests a minute to about
600 — one tablet produced 9,697 of the 9,719 bill-history reads in that window.
Production runs on Supabase's smallest compute (60 connections, shared burstable
CPU, an 8-second statement timeout), and the reads in those loops are not cheap:
the payments view averages 168 ms a call, the kitchen-status read 373 ms. The
database carried the load for about fifty minutes and then fell over. From 16:30
IST it logged 341 statement timeouts and hundreds of server errors — on taking
payment and creating orders, not only on the reads — and requests took 15 to 36
seconds. A server that slow is a tablet that looks frozen.

A repair was written within the hour. It was right: the moment it published, at
17:21, the counter's traffic fell to about 100 a minute, and from 17:26 there were
no errors and requests were back to ~130 ms. But it had to go through the full
verification suite to reach production — sixty-five minutes after the first
report — and nobody could see the tablet recovering. At 17:26 the owner asked for
a full rollback, which meant reverting five commits, writing a migration to put
ten database functions back the way they were, cancelling orders by hand with
production database access, and bypassing CI.

Two facts made that rollback hard, and both were choices nobody had to make:

- **There was no off switch.** The new behaviour and the old one could not both
  exist in one build, so the only way back was a new build.
- **The migration rewrote functions the old build called.** #74 replaced
  `revise_billing_order`, `prepare_billing_order`, `kitchen_board()`,
  `counter_kitchen_marks()` and six others in place. Republishing the previous
  bundle would have run old code against new behaviour, so even the fast frontend
  rollback was unsafe without a database correction.

The way large-scale software is shipped settles both. A release is two separate
acts: **deploying** code, which happens with the new behaviour switched off, and
**releasing** it, which is flipping a switch. Database changes come in two halves:
first only additions that the old code ignores, and the removals much later, once
nobody can need the old code back. Then "undo" is the switch, not a deploy.

The repo is built and changed mostly by AI agents, each starting cold from the
change folder. A rule that lives in somebody's head is a rule an agent will not
follow. So this change builds the switch, and makes the rules **mechanical** —
lint that refuses a destructive migration with instructions for what to write
instead, CI that proves every release can be turned off, and workflow files that
ask for the switch before a line of the change is written.

## What Changes

### The owner turns a release on and off

- **A new Releases page, opened from the account menu** — the top-right profile
  menu that today holds only **View Demo** and **Sign out** — and not from the
  navigation (owner decision, 2026-10-12: a business-wide setting does not belong
  on an outlet's page or among the everyday surfaces). On the owner's phone only, it
  lists every
  release that can be switched: what it is, which change it came from, and whether
  it is on.
- **A release is on or off for the whole business at once** (owner decision,
  2026-10-12). Kalyani Cafe trades alone for the coming months, so turning a
  release per outlet would buy nothing yet; design D3 keeps the door open.
- **A release's own page** says what *On* means and what *Off* means in a
  sentence each, carries one **Turn on** / **Turn off**, and asks for confirmation
  and an optional reason. Its history lists every turn, by whom, when and why.
- **The same page shows every tablet live**, grouped by outlet: its build, whether
  it has picked up the change yet, its failed requests and slowest request in the
  last minute, and when it last reported. During an incident the owner can see the
  switch land and the tablet recover, rather than guessing.
- **Only the owner turns a release** (owner decision, 2026-10-12). Franchise
  Admins, Billers and tablets cannot, and the database refuses them.
- **The page works whatever is switched.** It is never behind a switch itself,
  and lists releases from the database rather than from the build, so a phone that
  has not yet taken a new build can still turn off the release that build added.
  If the app itself cannot be opened, `docs/OPERATIONS.md` gives the one SQL line
  that does the same from the Supabase dashboard.

### Tablets follow the switch

- **A tablet picks up a turned switch within a minute**, by the live connection it
  already holds or, failing that, a once-a-minute check; and **applies it the way
  it applies a new build**: at the first moment nobody is typing and nothing is
  being saved, it reloads into the other behaviour. The header's existing update
  action applies it at once when somebody wants it now.
- **Nothing on screen changes behaviour mid-task.** A page decides each switch
  once, when it loads, and keeps that answer until it reloads.
- **A tablet that cannot reach the server keeps the last answer it had**, and a
  tablet that has never had an answer runs every release switched off — the
  behaviour as it was before.
- **Work queued on the switched-on path is never stranded.** A tablet that
  switches off still delivers every write it queued while on, and each settles
  exactly once.
- **Every tablet reports its health** with its heartbeat: build, the releases it
  is running, requests made, requests failed and the slowest request in the last
  minute. Paths only — never a query, a phone number or a payload.

### Every later change is built to be switched off

These are rules for the repository, enforced by tooling, and they apply to #74's
relaunch first:

- **A change that alters a live surface's behaviour ships behind a release
  switch, off.** The owner turns it on at a quiet hour. Off means the behaviour
  exactly as it was; a test that had to change its expectation is evidence that it
  does not.
- **Migrations only add.** A migration may create, and add nullable or defaulted
  columns; it may not drop, rename, retype, or rewrite a function, view, trigger
  or policy that a published build uses. Changed behaviour goes in a new function
  (`counter_kitchen_marks_v2`) that only the switched-on path calls. Lint refuses
  the rest, and its message says what to write instead.
- **Removal is a separate, later change.** Once a release has run on in real use
  and the owner is satisfied, a retirement change deletes the switch and the old
  path from the code; a later migration may then drop what only the old path used.
  Every switch carries a retire-by date, the build warns when it passes and fails
  a fortnight later, and at most five release switches may be live at once. A
  retired switch's name is never used again.
- **Every browser suite runs twice in CI**: with every release off — the old
  tests, proving the old behaviour survives the new schema — and with every
  release on. Each switch also carries a round-trip test: write on the new path,
  switch off, finish the work on the old path.
- **An idle counter and an idle kitchen stay inside a request budget**, measured
  in CI. The build #74 shipped fails it.

### The life of a change

Every change from now on runs in this order (design D11):

1. **Propose** — the proposal's `## Release` section names the switch and says
   what Off means, or says `No switch:` and why.
2. **Demo approval** — the owner approves the screens in the demo, which shows the
   release on, as today.
3. **Apply** — built behind the switch, off; the old path untouched.
4. **Verify** — both states, the round trip, the budget, the lints.
5. **Deploy** — a push; CI gates it; it ships **off**, so nothing changes for
   anybody.
6. **Turn on** — the owner, at a quiet hour, watching the tablets on the release's
   page through the next service.
7. **Pull the switch once** — at a quiet moment soon after, the owner turns it off
   and back on, so its way back is proved on real tablets before it is needed.
8. **Live with it** — days of real use. Trouble means: turn off, fix behind the same
   switch, deploy, turn on again.
9. **Archive** — after real use, as today; it seeds the retirement change.
10. **Retire** — a change that deletes the off path and the switch from the code,
    released normally.
11. **Contract** — at least a week after every tablet reports a build without the
    off path, a migration drops what only the off path used.

### Ways out for emergencies

A rule that cannot bend in an emergency gets bypassed by hand, as it was on 12
October. So each rule has one way out, and each way out is loud and recorded:

- **Turn the release off** — the first answer to anything behind a switch.
- **Republish** — an earlier build the suite once passed, in minutes, without the
  suite. For a change nobody put behind a switch. The expand-only rule makes it safe.
- **Hotfix** — a new, unverified fix published in minutes after a short gate (lint,
  types, unit tests, build) and **the owner's approval click in GitHub**. The full
  suite still runs on the same commit afterwards. For when neither of the above is
  enough.
- **An emergency migration** — `-- release: emergency <reason>` lets a corrective
  migration past the migration lint, printed on every run.
- **`No switch:`** in a proposal — a change can say why it needs no switch; the
  answer is visible to whoever reviews it.

### The probe release

- This change ships one real switch, **`release-probe`**, whose only effect is a
  word beside the build stamp. It is turned on and off in production to prove the
  path end to end, then retired by the same retirement path every later switch
  will take.

### The agent workflows

- `AGENTS.md`, `CLAUDE.md`, and the propose, apply, archive, verify, quickfix and
  next-change workflows in **both** agent trees carry the rules where an agent
  meets them: the proposal names its switch and what Off means, the design
  records how each database object stays compatible, the tasks build behind the
  switch and test both states, verification runs both, and archive waits for the
  release to have been on in production. Two new workflows — **release** (turn on,
  watch, pull once, turn off) and **retire a switch** — exist in both trees.
- **Whichever agent writes a change, CI holds the same line**: the lints and both
  switch states run on every push to `main`, and the proposal check runs in the
  prose tier too, so a proposal-only commit cannot skip it. Design D12 says what CI
  can and cannot check.

## Release

This change follows its own rule as far as it can:

- **`release-probe`** — On: the build stamp reads `· probe`. Off: it does not.
  Proves the path; retired by this change's last section.
- **`device-health`** — On: tablets count their requests and report their health.
  Off: tablets send nothing new, exactly as today.
- **No switch: the switch machinery, the Releases page and the tooling.** The store,
  its read and the apply path are what switches stand on and cannot be switched by
  themselves (design D16); the Releases page is a new surface, gated `demo` then
  `live` like any other; lints and CI change no device's behaviour. Every migration
  in this change only adds.

## Non-goals

- **No trying a release on one device first** (owner, 2026-10-12: "this can be an
  addition later"). Design D14 records the shape it should take — set by the owner
  on the release page, per device, expiring at the cutover — and why a query
  parameter is the wrong one.
- **No per-outlet switching** (owner, 2026-10-12). One answer for the whole
  business. Adding outlets later is an additive change (design D3).
- **No paid or hosted flag service** — LaunchDarkly, Statsig, Flagsmith Cloud,
  PostHog flags — and no self-hosted flag server. The owner ruled out paying for a
  service, and a second service in the counter's path is one more thing that can
  be down at the counter. Postgres, Realtime and the heartbeat already reach every
  tablet. Design D2 records each alternative.
- **No percentage rollouts, experiments or per-person targeting.** With one outlet
  trading, a business has no 5% to roll out to. Experiments answer a different
  question.
- **No automatic switch-off on bad health.** The page shows the health; the owner
  decides. Automatic rollback is deferred until the owner has had to turn a release
  off by hand at least once because of tablet health — the evidence it would be
  tuned against (design D14).
- **No in-place change of behaviour on an open screen.** A switch takes effect at
  the next reload; a screen never re-renders into the other behaviour mid-task.
- **No switch for Franchise Admins** (owner decision, 2026-10-12).
- **No change to the gate registry.** `hidden` / `demo` / `live` stays a
  build-time, reviewed diff for a surface's existence. A release switch governs
  behaviour *inside* a live surface. Design D1 reconciles the two.
- **No down migrations, no pgroll, no Squawk.** Migrations stay forward-only
  through the Supabase CLI; design D8 records why each was rejected.
- **No retroactive switches.** Shipped behaviour is not wrapped after the fact,
  and existing migrations are not linted; the rules apply from this change's
  baseline onward.
- **No switches on the public receipt and menu site.** It is another repository
  with its own release path.
- **No #74 work.** #74 is re-planned as the first real user of this change, in its
  own folder, after this change is in production.

## Capabilities

### New

- `release-switches` — the switch, its state and history, who may turn it, how a
  device reads and applies it, offline and queued-work behaviour, the Releases
  page, device health reports, the probe, and the release and retirement
  lifecycle.

### Modified

- `pwa-and-deployment` — the build stamp names the probe; republishing a
  previously verified build without the suite; the owner-approved hotfix lane.
- `project-scaffold` — the migration compatibility lint, the switch registry lint,
  the proposal's Release section, browser suites in both switch states, and the
  request budget.
- `demo-mode` — the demo shows every release switched on and lets a walkthrough
  turn one off locally; gates and release switches are separate layers.

## Impact

- **Database**: `release_switches` (declaration and current state, readable by
  every signed-in principal), `release_switch_events` (append-only), `device_health`
  (outlet-scoped, RLS, isolation-tested); `set_release_switch`,
  `release_switch_force` (service role only), `app_release_switch(key)`,
  `report_device_health`. All additive; nothing existing is rewritten — this change
  obeys its own lint.
- **App**: a switch store read through the adapter seam (mock and live), applied
  through the existing update path; an instrumented fetch on the one Supabase
  client; a health reporter in the counter and kitchen shells; the owner's
  Releases list and release page; the probe beside the build stamp.
- **Tooling**: `lint:migrations`, `lint:switches`, both with fixtures and tests;
  `verify.yml` gains switches-on jobs for both browser suites; `docs.yml` runs the
  proposal check; a request-budget browser test; `emergency-rollback.yml` replaced
  by **Republish** (verified commits only) and **Hotfix** (owner-approved).
- **Agents**: `AGENTS.md`, `CLAUDE.md`, `.claude/commands/opsx/*`,
  `.claude/skills/*`, `.agents/skills/*`, and two new workflows in both trees.

## Docs To Update Before Archive

- **`docs/RELEASES.md`** (new) — the durable page: deploy versus release, the life
  of a change, the rollback ladder and the ways out, the compatibility rules for
  every kind of database object, the version-skew states, and the runbooks for
  turning a release off, republishing a build, shipping a hotfix and retiring a
  switch.
- [`docs/README.md`](../../../docs/README.md) — lists the new page.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md) — the rollback ladder replaces
  "Rollback is unchanged"; the dashboard SQL for turning a release off; Republish;
  Hotfix and its GitHub environment.
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) — the runtime switch layer
  beside the build-time gate registry, and the instrumented client.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — the three tables and their
  invariants.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md) — only
  the owner turns a release; every signed-in principal reads switches.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — Releases list, release page, the
  probe beside the build stamp.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md) — gates versus switches; design
  D3 of `demo-mode-and-app-shell` is narrowed, not reversed; the demo switch panel.
- [`docs/OFFLINE_AND_SYNC.md`](../../../docs/OFFLINE_AND_SYNC.md) — the last-known
  answer offline, and the outbox replaying regardless of switches.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — health
  reports carry paths and counts only.
- [`docs/TESTING.md`](../../../docs/TESTING.md) — both switch states, the round
  trip, the request budget, the two lints.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — *release*, *release switch*,
  *toggle point*, *expand*, *contract*, *retire*, *probe*, *rollback ladder*,
  *hotfix*, and how a switch differs from a gate and from an outlet setting.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — no automatic switch-off;
  no per-outlet switching; switches apply at the next reload; the public site is
  not switched.
- [`AGENTS.md`](../../../AGENTS.md) and [`CLAUDE.md`](../../../CLAUDE.md) — see
  design D12.
