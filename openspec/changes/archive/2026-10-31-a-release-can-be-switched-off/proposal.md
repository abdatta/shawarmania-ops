# Proposal: A Release Can Be Switched Off

> **Model**: Opus · **Wave**: F · **Depends on**: #70 · **Gate**: the owner
> turns a change gate off and back on from their phone, and every tablet follows at its
> next free moment — within a minute, with no deploy and nobody pressing anything
> on the tablet — while the gate's page shows, for each tablet, its build,
> whether it is running the change, its failed requests and its slowest request
> in the last minute; turning a change gate off strands no work, because writes a
> tablet queued on the on path still settle exactly once after it
> turns off; only the owner can turn a change gate, proved by a hand-crafted request
> from a Franchise Admin and from a tablet, and each outlet's tablet health is
> isolated, proved by a hand-crafted request; a migration that drops, renames,
> retypes or rewrites anything a published build calls fails lint with a message
> saying what to write instead; every browser suite runs once with every gate
> off and once with every gate on; a gate dependent on others is turned on only
> while all of them are on, and turned off with any of them; an idle counter and an idle kitchen each stay
> inside a request budget that the build #74 shipped fails; an earlier published
> build can be republished in minutes without re-running the suite, and only a
> build the suite once passed; an unverified hotfix reaches production in minutes
> only after the owner approves it in GitHub, and the full suite still runs on it
> afterwards; every change reaches production only by promoting a commit staging already verified, after the owner approves it in GitHub, and a direct push to `main` is refused; staging is a separate Supabase project on production's compute size, with synthetic data at production's scale and no third-party secret, and the owner has run it as a fake outlet — two laptops as counter and kitchen, their phone as owner — turning the probe on and off there before production; the probe gate is created, turned on in production, turned off
> and retired through the same path every later change will use; every agent
> workflow in both agent trees asks for the gate before it writes a line of the
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

- **There was no off gate.** The new behaviour and the old one could not both
  exist in one build, so the only way back was a new build.
- **The migration rewrote functions the old build called.** #74 replaced
  `revise_billing_order`, `prepare_billing_order`, `kitchen_board()`,
  `counter_kitchen_marks()` and six others in place. Republishing the previous
  bundle would have run old code against new behaviour, so even the fast frontend
  rollback was unsafe without a database correction.

A third fact is why it reached the outlet at all: **there was nowhere to try it
first.** The demo has no server, so #74 ran against a real database under real
load for the first time at Kalyani Cafe, mid-service. The owner has two laptops
and a phone and could have run them as an outlet against a production-sized copy,
had one existed (owner, 2026-10-12).

The way large-scale software is shipped settles all three. A release is two separate
acts: **deploying** code, which happens with the new behaviour switched off, and
**releasing** it, which is flipping a gate. Database changes come in two halves:
first only additions that the old code ignores, and the removals much later, once
nobody can need the old code back. Then "undo" is the gate, not a deploy. And a gate is tried on a staging copy
of the system before production ever sees it.

The repo is built and changed mostly by AI agents, each starting cold from the
change folder. A rule that lives in somebody's head is a rule an agent will not
follow. So this change builds the gate, and makes the rules **mechanical** —
lint that refuses a destructive migration with instructions for what to write
instead, CI that proves every change can be turned off, and workflow files that
ask for the gate before a line of the change is written.

## What Changes

### The owner turns a change gate on and off

A **change gate** applies or removes one change while the app runs — the owner's
name and description for it (2026-10-12): "a toggle to apply/remove a change
dynamically". It is not the screen registry's gate: that one decides whether a
screen exists and moves only with a deploy; a change gate decides which behaviour
an existing screen runs, and moves when the owner turns it.

- **A new Change gates page, opened from the account menu** — the top-right profile
  menu that today holds only **View Demo** and **Sign out** — and not from the
  navigation (owner decision, 2026-10-12: a business-wide setting does not belong
  on an outlet's page or among the everyday surfaces). On the owner's phone only, it
  lists every change gate: its name, its code, which change it came from, and
  whether it is on. A gate that depends on others names them, by code, on its
  row, and comes after them in the list.
- **A change gate is on or off for the whole business at once** (owner decision,
  2026-10-12). Kalyani Cafe trades alone for the coming months, so turning a
  change gate per outlet would buy nothing yet; design D3 keeps the door open.
- **Every change gate belongs to an OpenSpec change**, and is shown with it; the
  roadmap number appears beside it only when the change has one, because fixes and
  tooling do not (owner, 2026-10-12).
- **Every gate has a two-character code** — capitals or digits, at least one a
  letter: *DT* for Dish ticks, *PB* for the probe (owner, 2026-10-13). It is unique
  among the gates not yet cleaned up, checked when a gate is added; a retired
  gate's code may be given out again, its key never.
- **The build code.** The build number reads as it always has, and a tap copies
  that line with the **build code** in place of the build — the build and the codes
  of the gates the screen is running, joined by a middle dot:
  *Build c1f19c32·DT-KR · 13 Oct 2026, 03:15 am* — so anybody reporting a problem
  hands over exactly what they were running, and when it was built, in one paste
  (owner, 2026-10-13).
- **Several gates can be on at once, and a gate can depend on others** — one or
  several (owner, 2026-10-12 and 2026-10-13). It can be turned on only while every
  gate it depends on is on; turning any of those off turns it off too, and says so
  first; turning that one back on leaves it off until it is turned on itself. A
  screen runs a gate only while every gate it depends on, directly or through
  another, is on.
- **A gate's own page** leads with its state and a **switch** that turns it
  (owner, 2026-10-13: a switch, not a loud Turn on / Turn off button, and at the
  top). Below them: its code, what *On* means and what *Off* means in a sentence
  each, then **Dependent on** and **Needed by** — the gates it depends on and the
  gates that depend on it, as rows like the main list's that open those gates.
  Turning asks for confirmation and an optional reason. Its history lists every
  turn, by whom, when and why.
- **The same page shows every tablet live**, grouped by outlet. Two things on each
  line: whether that tablet has picked up this gate's current state yet
  (*running* or *waiting*), and how the tablet is talking to the server over the
  last minute — requests sent, how many failed, and the slowest. The second is
  generic, the same whichever gate's page it is read on: it is what would have
  shown a counter sending six hundred requests a minute on 12 October, and then
  recovering. During an incident the owner sees the gate land and the tablet
  recover, rather than guessing.
- **Only the owner turns a change gate** (owner decision, 2026-10-12). Franchise
  Admins, Billers and tablets cannot, and the database refuses them.
- **The page works whatever is gated.** It is never behind a gate itself,
  and lists gates from the database rather than from the build, so a phone that
  has not yet taken a new build can still turn off the gate that build added.
  If the app itself cannot be opened, `docs/OPERATIONS.md` gives the one SQL line
  that does the same from the Supabase dashboard.

### Tablets follow the gate

- **A tablet picks up a turned gate within a minute**, by the live connection it
  already holds or, failing that, a once-a-minute check; and **applies it the way
  it applies a new build**: at the first moment nobody is typing and nothing is
  being saved, it reloads into the other behaviour. The header's existing update
  action applies it at once when somebody wants it now.
- **Nothing on screen changes behaviour mid-task.** A page decides each gate
  once, when it loads, and keeps that answer until it reloads.
- **A tablet that cannot reach the server keeps the last answer it had**, and a
  tablet that has never had an answer runs every gate off — the
  behaviour as it was before.
- **Work queued on the on path is never stranded.** A tablet whose gate
  turns off still delivers every write it queued while on, and each settles
  exactly once.
- **Every tablet reports its health** with its heartbeat: build, the change gates
  it is running, requests made, requests failed and the slowest request in the last
  minute. Paths only — never a query, a phone number or a payload.

### Every later change is built to be switched off

These are rules for the repository, enforced by tooling, and they apply to #74's
relaunch first:

- **A change that alters a live surface's behaviour ships behind a change
  gate, off.** The owner turns it on at a quiet hour. Off means the behaviour
  exactly as it was; a test that had to change its expectation is evidence that it
  does not.
- **Migrations only add.** A migration may create, and add nullable or defaulted
  columns; it may not drop, rename, retype, or rewrite a function, view, trigger
  or policy that a published build uses. Changed behaviour goes in a new function
  (`counter_kitchen_marks_v2`) that only the on path calls. Lint refuses
  the rest, and its message says what to write instead.
- **Removal is a separate, later change.** Once a change has run on in real use
  and the owner is satisfied, a retirement change deletes the gate and the old
  path from the code; a later migration may then drop what only the old path used.
  Every gate carries a retire-by date, the build warns when it passes and fails
  a fortnight later, and at most five change gates that depend on nothing may be live at once. A gate is
  retired before or with every gate it depends on, never after. A retired gate's
  name is never used again.
- **Every browser suite runs twice in CI**: with every gate off — the old
  tests, proving the old behaviour survives the new schema — and with every gate
  on. Each gate also carries a round-trip test, run with every other gate on:
  write on its new path, turn **it alone** off, finish the work on the old path.
  That is the state an owner actually creates when one of several live changes
  misbehaves.
- **An idle counter and an idle kitchen stay inside a request budget**, measured
  in CI. The build #74 shipped fails it.

### Staging, and nothing is pushed to `main`

Added by the owner on 2026-10-12, after the rest of this proposal (design D19, D20).

- **A staging copy of the whole system**: a separate Supabase project, in a
  separate Supabase account, on the same plan and compute size as production, with
  its own address on Cloudflare Pages. It holds synthetic data only, generated at
  production's scale so its reads cost what production's do — with the trading
  outlet's real menu, which is public, and invented people — and never a
  third-party secret, so a bill rung there texts nobody and no sync reaches a real
  restaurant account.
- **The owner runs it as a fake outlet**: one laptop as *Cafe Staging*'s counter, one
  as its kitchen, their phone as the owner — and tries each change there before
  production. Every screen carries a blue **Staging** ribbon in its top-left corner.
- **Nobody else can see it.** Production's accounts do not exist there; only the
  owner creates staging accounts.
- **Every push goes to a `stage` branch**, which runs the full suite and publishes
  to staging, at any hour.
- **`main` is protected.** It moves only when the owner approves a **Promote** in
  GitHub, which fast-forwards `main` to a commit staging already verified — the
  same commit, not a merge — and Deploy publishes it to production without running
  the suite a second time. Promotion is the release, and keeps the owner's deploy
  window.
- **An agent verifies staging with a smoke suite**, signing in as staging's test
  accounts, not by typing passwords into a browser.

### The life of a change

Every change from now on runs in this order (design D11):

1. **Propose** — the proposal's `## Change gate` section names the gate and says
   what Off means, or says `No gate:` and why.
2. **Demo approval** — the owner approves the screens in the demo, which shows the
   change on, as today.
3. **Apply** — built behind the gate, off; the old path untouched.
4. **Verify** — both states, the round trip, the budget, the lints.
5. **Stage** — a push to `stage`; CI gates it and publishes it to staging.
6. **Try on staging** — the owner turns the gate on in staging and runs the fake
   outlet; an agent runs the staging smoke suite.
7. **Promote** — the owner approves it in GitHub; production gets the same commit,
   and it ships **off**, so nothing changes for anybody.
8. **Turn on** — the owner, at a quiet hour, watching the tablets on the gate's
   page through the next service.
9. **Pull the gate once** — at a quiet moment soon after, the owner turns it off
   and back on, so its way back is proved on real tablets before it is needed.
10. **Live with it** — days of real use. Trouble means: turn off, fix behind the
    same gate, stage, promote, turn on again.
11. **Archive** — after real use, as today; it seeds the retirement change.
12. **Retire** — a change that deletes the off path and the gate from the code,
    released normally.
13. **Contract** — at least a week after every tablet reports a build without the
    off path, a migration drops what only the off path used.

### Ways out for emergencies

A rule that cannot bend in an emergency gets bypassed by hand, as it was on 12
October. So each rule has one way out, and each way out is loud and recorded:

- **Turn the gate off** — the first answer to anything behind a gate.
- **Republish** — an earlier build the suite once passed, in minutes, without the
  suite. For a change nobody put behind a gate. The expand-only rule makes it safe.
- **Hotfix** — a new, unverified fix published in minutes after a short gate (lint,
  types, unit tests, build) and **the owner's approval click in GitHub**. The full
  suite still runs on the same commit afterwards. For when neither of the above is
  enough.
- **An emergency migration** — `-- release: emergency <reason>` lets a corrective
  migration past the migration lint, printed on every run.
- **`No gate:`** in a proposal — a change can say why it needs no gate; the
  answer is visible to whoever reviews it.

### The probe gate

- This change ships one real gate, **`probe`** (code *PB*), whose only effect is
  its own code appearing in the build code. It is turned on and off in
  production to prove the path end to end, and then stays as the gate system's
  own test switch, marked `selfTest`: the demo and authenticated suites and the
  staging smoke run turn it after every publish, and no product gate can be
  turned for that (owner, 2026-10-16). It counts toward no limit and is never
  retired. The retirement path ran first on `outside-tap-closes` instead.

### The build number

- **Shown where there is no account menu** (owner, 2026-10-12): at the foot of
  the signed-out screens, the counter (below Expenses, taking no height from the
  till), the counter's setup and shift-start screens, the kitchen, and the Change
  gates pages. Every other phone page already shows it inside the account menu.
- **It reads as it always has** — *Build 1a2b3c4 · 13 Oct 2026, 03:15 am* — and a
  tap copies it with the build code (above).

### The agent workflows

- `AGENTS.md`, `CLAUDE.md`, and the propose, apply, archive, verify, quickfix and
  next-change workflows in **both** agent trees carry the rules where an agent
  meets them: the proposal names its gate and what Off means, the design
  records how each database object stays compatible, the tasks build behind the
  gate and test both states, verification runs both, and archive waits for the
  gate to have been on in production. Two new workflows — **release** (turn on,
  watch, pull once, turn off) and **retire a gate** — exist in both trees.
- **Whichever agent writes a change, CI holds the same line**: the lints and both
  gate states run on every push to `main`, and the proposal check runs in the
  prose tier too, so a proposal-only commit cannot skip it. Design D12 says what CI
  can and cannot check.

## Change gate

This change follows its own rule as far as it can:

- **`probe`** (*PB*) — On: every build code includes *PB*. Off: it does not.
  Proves the path; retired by this change's last section.
- **`tablet-health`** (*TH*) — On: tablets count their requests and report their health.
  Off: tablets send nothing new, exactly as today.
- **No gate: staging, the `stage` branch and promotion.** They change how a
  commit reaches production, not how any device behaves; the staging ribbon exists
  only in a staging build (design D19).
- **No gate: the gate machinery, the Change gates page and the tooling.** The store,
  its read and the apply path are what gates stand on and cannot be gated by
  themselves (design D16); the Change gates page is a new surface, gated `demo` then
  `live` like any other; lints and CI change no device's behaviour. Every migration
  in this change only adds.

## Non-goals

- **No trying a change on one device first** (owner, 2026-10-12: "this can be an
  addition later"). Design D14 records the shape it should take — set by the owner
  on the gate's page, per device, expiring at the cutover — and why a query
  parameter is the wrong one.
- **No per-outlet gating** (owner, 2026-10-12). One answer for the whole
  business. Adding outlets later is an additive change (design D3).
- **No paid or hosted flag service** — LaunchDarkly, Statsig, Flagsmith Cloud,
  PostHog flags — and no self-hosted flag server. The owner ruled out paying for a
  service, and a second service in the counter's path is one more thing that can
  be down at the counter. Postgres, Realtime and the heartbeat already reach every
  tablet. Design D2 records each alternative.
- **No percentage rollouts, experiments or per-person targeting.** With one outlet
  trading, a business has no 5% to roll out to. Experiments answer a different
  question.
- **No automatic gate-off on bad health.** The page shows the health; the owner
  decides. Automatic rollback is deferred until the owner has had to turn a gate
  off by hand at least once because of tablet health — the evidence it would be
  tuned against (design D14).
- **No in-place change of behaviour on an open screen.** A gate takes effect at
  the next reload; a screen never re-renders into the other behaviour mid-task.
- **No gate for Franchise Admins** (owner decision, 2026-10-12).
- **No change to the gate registry.** `hidden` / `demo` / `live` stays a
  build-time, reviewed diff for a surface's existence. A change gate governs
  behaviour *inside* a live surface. Design D1 reconciles the two.
- **No down migrations, no pgroll, no Squawk.** Migrations stay forward-only
  through the Supabase CLI; design D8 records why each was rejected.
- **No retroactive gates.** Shipped behaviour is not wrapped after the fact,
  and existing migrations are not linted; the rules apply from this change's
  baseline onward.
- **No gates on the public receipt and menu site.** It is another repository
  with its own release path.
- **No #74 work.** #74 is re-planned as the first real user of this change, in its
  own folder, after this change is in production.

- **No production data in staging**, not even the menu. Staging's history is
  generated at production's row counts, which are the only thing read from
  production (design D19).
- **No paid Supabase plan for staging.** A separate free account instead (owner,
  2026-10-12); revisit when production moves to Pro for its own reasons.
- **No pull request from `stage` to `main`.** GitHub's merge buttons all make new
  commits, so production would not run the commit staging verified (design D20).

## Capabilities

### New

- `change-gates` — the gate, its state and history, who may turn it, how a
  device reads and applies it, offline and queued-work behaviour, the Change gates
  page, device health reports, the probe, and the release and retirement
  lifecycle.

### Modified

- `pwa-and-deployment` — where the build number shows, and the gate codes it
  carries; republishing a
  previously verified build without the suite; the owner-approved hotfix lane; the
  staging environment, the `stage` branch, owner-approved promotion and a protected
  `main`.
- `project-scaffold` — the migration compatibility lint, the change-gate lint,
  the proposal's Change gate section, browser suites in both gate states, and the
  request budget.
- `demo-mode` — the demo shows every change gate on and lets a walkthrough
  turn one off locally; surface gates and change gates are separate layers.

## Impact

- **Database**: `change_gates` (declaration and current state, readable by
  every signed-in principal), `change_gate_events` (append-only), `device_health`
  (outlet-scoped, RLS, isolation-tested); `set_change_gate`,
  `change_gate_force` (service role only), `app_change_gate(key)`,
  `report_device_health`. All additive; nothing existing is rewritten — this change
  obeys its own lint.
- **App**: a gate store read through the adapter seam (mock and live), applied
  through the existing update path; an instrumented fetch on the one Supabase
  client; a health reporter in the counter and kitchen shells; the owner's
  Change gates list and gate page; the build number with gate codes on the
  screens that have no account menu.
- **Tooling**: `lint:migrations`, `lint:change-gates`, both with fixtures and tests;
  `verify.yml` gains gates-on jobs for both browser suites; `docs.yml` runs the
  proposal check; a request-budget browser test; `emergency-rollback.yml` replaced
  by **Republish** (verified commits only) and **Hotfix** (owner-approved).
- **Staging**: a separate Supabase project and account, a Cloudflare Pages
  project, `scripts/seed-staging.mjs`, `e2e-staging/`, `staging.yml`,
  `staging-reset.yml`, `promote.yml`, a `stage` branch, rulesets on `main` and
  `stage`, and the GitHub environments `production-promote`, `staging-database`,
  `staging-functions`, `staging-pages` and `staging-smoke`. `deploy.yml` skips the
  suite for a SHA staging already passed; `hotfix.yml` takes a SHA on `stage`.
- **Agents**: `AGENTS.md`, `CLAUDE.md`, `.claude/commands/opsx/*`,
  `.claude/skills/*`, `.agents/skills/*`, and two new workflows in both trees.

## Docs To Update Before Archive

- **`docs/RELEASES.md`** (new) — the durable page: deploy versus release, the life
  of a change, the rollback ladder and the ways out, the compatibility rules for
  every kind of database object, the version-skew states, and the runbooks for
  turning a change gate off, republishing a build, shipping a hotfix and retiring a
  gate; staging, running it as a fake outlet, promoting, and resetting it.
- [`docs/README.md`](../../../docs/README.md) — lists the new page.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md) — the rollback ladder replaces
  "Rollback is unchanged"; the dashboard SQL for turning a change gate off; Republish;
  Hotfix and its GitHub environment; Staging provisioned (its account, its size beside
  production's, what is never configured on it); Promote, the rulesets and the
  `stage` branch.
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) — the runtime gate layer
  beside the build-time gate registry, and the instrumented client.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — the three tables and their
  invariants.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md) — only
  the owner turns a change gate; every signed-in principal reads them.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the Change gates list and gate page,
  dependencies, the switch, and the build number with its build code on the screens
  without an account menu.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md) — surface gates versus change
  gates; design D3 of `demo-mode-and-app-shell` is narrowed, not reversed; the
  demo's Change gates page at its address.
- [`docs/OFFLINE_AND_SYNC.md`](../../../docs/OFFLINE_AND_SYNC.md) — the last-known
  answer offline, and the outbox replaying regardless of gates.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — health
  reports carry paths and counts only.
- [`docs/TESTING.md`](../../../docs/TESTING.md) — both gate states, the round
  trip, the request budget, the two lints.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — *release*, *change gate*,
  *toggle point*, *expand*, *contract*, *retire*, *probe*, *rollback ladder*,
  *hotfix*, *gate code*, *build code*, and the three senses of *gate* — a change gate, a surface
  gate in the screen registry, and a change's phase gate — each always written
  with its qualifier.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — no automatic gate-off;
  no per-outlet gating; gates apply at the next reload; the public site is
  not gated.
- [`AGENTS.md`](../../../AGENTS.md) and [`CLAUDE.md`](../../../CLAUDE.md) — see
  design D12.
