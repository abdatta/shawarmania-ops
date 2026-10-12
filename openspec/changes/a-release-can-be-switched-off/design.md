# Design: A Release Can Be Switched Off

## Read this first

This change is infrastructure that every later change builds on, and it is
implemented in a fresh session from this folder alone. The decisions most often
got backwards:

1. **A switch is decided once per page load, never live.** A turned switch is
   applied by reloading at a free moment through the existing update path (D6).
   Do not make components re-render into the other behaviour while open.
2. **Unknown means off, and off means the old behaviour.** A device that has never
   read a switch, or cannot read one, runs the release switched off. Nothing in
   this change may make "on" the fallback (D5).
3. **The outbox is never behind a switch.** Writes queued while a switch was on
   are delivered after it turns off. Dispatch code for a command type lives
   outside every toggle point (D7).
4. **This change obeys its own lint.** Every migration here is additive. The
   health reporter it adds is itself behind a switch, `device-health`, off until
   the owner turns it on (D16). The switch machinery is the one thing that cannot
   be switched, so it is kept small and fails towards "keep what you have".
5. **The gate registry is not changed.** Gates say whether a surface exists;
   release switches say which behaviour a live surface runs. Do not add runtime
   state to `src/gates/registry.ts` (D1).
6. **The Releases page lists switches from the database, not from the build**, so
   an old build on the owner's phone can still turn off a switch a newer build
   added (D4).
7. **Lint messages are written for an agent to act on**: what is wrong, why the
   rule exists, what to write instead, which doc to read (D12).
8. **Only the owner turns a release** (owner, 2026-10-12). Not a Franchise Admin,
   not for their own outlet.

## Context — what happened on 12 October 2026

All times IST (UTC + 5:30). Request counts are from Supabase's edge logs, statement
timings from `pg_stat_statements` and Postgres logs, read on 12 October with the
Management API (read-only). One tablet, Windows Edge at the outlet's address,
produced almost all of the load.

| Time | What the logs show |
|---|---|
| before 15:30 | 200–500 requests per 10 minutes across every device; p95 under 0.9 s |
| ~15:30 | #74 published (`11bd95a7`) |
| 15:40–16:20 | ~6,000 requests per 10 minutes — about 600 a minute from the counter alone; still fast (p95 ≤ 0.4 s) |
| 16:16 | first report: ticking dishes is slow |
| 16:30–16:50 | 115 statement timeouts (SQLSTATE 57014); p95 27–41 s, slowest 136 s; 5xx on `pay_billing_order`, `create_billing_order`, `revise_billing_order`, reads |
| 17:10–17:21 | the worst stretch: median request 11.8 s, 217 timeouts in 20 minutes |
| 17:21 | repair `9e91664` published (ten-second fallbacks, one read at a time) |
| 17:22–17:26 | counter traffic falls from ~300 to ~100 a minute; the backlog drains |
| 17:26 onward | zero errors, median ~130 ms — recovered |
| 17:26 | owner asks for a full rollback |
| 17:35–17:38 | corrective migration restoring ten functions; rollback bundle published without CI |

**Cause.** Three loops on the counter called the server every second, and none
waited for its previous answer: the rail's reload (orders, kitchen marks, shift
history with its payments), a label lookup (all open orders again), and a
demo-only review refresher left mounted in the live counter. Each loop fired
several reads. The reads are expensive — cumulative statistics since July put the
payments view at 168 ms a call (66,850 calls), `counter_kitchen_marks()` at
373 ms (7,974 calls, slowest 7.99 s, a hair under the 8-second timeout) and the
order read at 261 ms. On the smallest compute — 60 connections, shared burstable
CPU — that is roughly two CPU-seconds of work every second. Fifty steady minutes
followed by a sudden collapse fits burst CPU credit running out. Once a read took
longer than a second, the loops started reads faster than they finished, and
everything at the outlet queued behind them, payments included.

**Why recovery took two hours.** The repair was correct and was written within an
hour, but it could reach production only through the full suite, which itself
caught one more freeze in the first attempt. Then nobody could see the tablet
recovering, so a working fix was rolled back five minutes after it landed. And the
rollback could not simply republish the previous bundle, because #74's migration
had rewritten ten functions that bundle called; a database correction had to be
written and rehearsed under pressure, and unfinished orders cancelled by hand.

**What would have changed the outcome.** A switch would have ended the incident
at 16:16 in under a minute. A request budget in CI would have stopped the build
before it shipped. An additive migration would have made republishing the
previous bundle safe in two minutes. A health line per tablet would have shown
the recovery at 17:26. This change builds all four.

## Research — how this is done at scale, and what was taken from it

**Deploy is not release.** Pete Hodgson's taxonomy of toggles on
martinfowler.com — release, ops, experiment and permission toggles, differing in
how long they live and how dynamic they are — is still the standard vocabulary.
Release toggles are short-lived and exist to separate deploying code from turning
it on; ops toggles include long-lived kill switches; and toggles carry a cost, so
they should get removal tasks, expiry dates, "time bombs" that fail a test after
expiry, and a cap on how many exist. Testing guidance from the same source: test
the production configuration and the configuration being released, plus the
fallback with new toggles off; all-on occasionally; not every combination.
*Taken:* release and ops kinds (D3), expiry and a cap enforced by lint (D11), the
two-configuration test matrix (D10), and decisions wrapped in named functions
rather than flag lookups scattered through components (D5).

**The failure mode of a missing switch is well documented.** Google Cloud's 12
June 2025 outage report says the change that crashed Service Control globally
"was not feature flag protected", that flags are how Google enables a feature
region by region, and that with one the issue would have been caught in staging.
The code path never ran during the binary's staged rollout because only a data
change triggered it. *Taken:* every behaviour change to a live surface ships
switched off (D11), including changes whose risk only shows under load.

**Old switches and dead code are their own hazard.** Knight Capital lost about
$440 million in 45 minutes in 2012 when a repurposed flag woke code that had sat
dead for years on one server that missed a deploy. *Taken:* a switch name is
never reused, enforced by a primary key in the database (D3); the off path is
deleted by a retirement change rather than left callable (D11).

**Rollback first, then canaries.** Google's SRE Workbook chapter on canarying puts
the ability to roll back as the foundation, separates feature enablement from
binary release, expands a release in stages, and notes that engineers stop seeing
problems in graphs — detection should compare the canary with a control
automatically. *Taken:* the rollback ladder (D9); a quiet hour first and the
switch pulled once before it is trusted (D11); health
shown per tablet, beside the switch (D13). Automated comparison is deferred (D14):
with one outlet trading there is no control group.

**Schema changes are expand, then contract.** The pattern goes by many names —
expand/contract, parallel change, Stripe's four-step dual-write migration — and
its core rule is the same everywhere: a migration must work with the code
currently running, removals come last, and rollback before the contract step
needs no schema change. Tools enforce it mechanically: strong_migrations (Rails)
refuses a column drop until the code ignores it, Squawk lints Postgres migrations
for locking hazards, and Xata's pgroll runs two schema versions side by side
through views and can roll back instantly. Supabase's CLI is forward-only; its
answer to a bad migration is a new forward migration. *Taken:* the expand-only
lint (D8), the contract migration as a separate, later, declared step (D11), and
versioned functions instead of rewritten ones (D8).

**Old clients outlive deploys.** Vercel's "skew protection" exists because a tab
left open keeps calling the backend with old code for days; even with pinning,
Vercel notes, the backend must stay compatible with older clients. A counter
tablet is exactly that tab. *Taken:* the version-skew table (D9) is a design
requirement, not an afterthought.

**Kill switches must be validated and fail safe.** Cloudflare's 18 November 2025
outage spread a malformed configuration file globally within minutes, and its
remediation list reportedly included a global kill switch and stricter
validation of what is propagated. *Taken:* a switch's state is a boolean per
outlet with nothing to parse, and every read path fails towards the cached or the
off answer (D5).

**The AI-era layer.** OpenAI's "harness engineering" account of building a
product with agent-written code describes enforcing architecture with custom
linters and structural tests whose error messages carry the fix back into the
agent's context, plus recurring agents that clean up drift. Flagsmith's guidance
for AI-generated code is that a change affecting production ships with its flag,
an owner and a review date, and that the human reviews the rollout plan rather
than every line. Flag-cleanup agents (LaunchDarkly's published cleanup skill,
Augment's weekly cleanup workflow) and Uber's Piranha automate removal; Piranha
has removed some two thousand stale flags at Uber. *Taken:* lint messages written
as remediation (D12); the proposal's mandatory Release section and an agent-facing
release and retirement workflow in both agent trees (D12); `/next-change` treating
an overdue retirement as the next job (D11). Claude Code hooks were considered and
rejected as the enforcement point (D12): Codex does not run them, and CI does.

Sources: [Feature Toggles](https://www.martinfowler.com/articles/feature-toggles.html) ·
[Google Cloud incident report, June 2025](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) ·
[Knight Capital and feature flags](https://www.statsig.com/blog/lose-half-a-billion-dollars-with-bad-feature-flags-knight-capital) ·
[SRE Workbook: Canarying Releases](https://sre.google/workbook/canarying-releases/) ·
[Online migrations at scale (Stripe)](https://stripe.com/se/blog/online-migrations) ·
[pgroll and expand/contract](https://xata.io/blog/pgroll-expand-contract) ·
[strong_migrations](https://github.com/ankane/strong_migrations) ·
[Squawk](https://pypi.org/project/squawk-cli/) ·
[Version skew](https://industrialempathy.com/posts/version-skew) ·
[Vercel Skew Protection](https://examples.vercel.com/blog/version-skew-protection) ·
[Cloudflare outage postmortem summary](https://www.ilert.com/postmortems/cloudflare-global-outage-nov-2025) ·
[Harness engineering (OpenAI)](https://openai.com/index/harness-engineering/) ·
[Feature flags and AI (Flagsmith)](https://www.flagsmith.com/blog/feature-flags-ai) ·
[Piranha (Uber)](https://www.uber.com/blog/piranha/) ·
[Short-lived feature flags (Unleash)](https://docs.getunleash.io/topics/feature-flags/short-lived-feature-flags) ·
[OpenFeature flag evaluation](https://docs.openfeature.dev/specification/sections/flag-evaluation)

## Decisions

### D1. Gates and release switches are two layers, and the gate registry stays as it is

`demo-mode-and-app-shell` D3 made the gate registry a build-time constant and
rejected runtime config for three reasons: it adds a fetch, a failure mode, and a
way for production to disagree with the repo — "all cost, and the only benefit
(flipping a surface without deploying) is something this project explicitly does
not want".

That reasoning was about whether a **surface exists**, and it still holds: a
surface becoming real is a property of a release, earned by a `*-live` change,
read off one file. It did not consider a change to the **behaviour of a surface
that is already live**, which is most of what this repo now ships — #69, #70, #72
and #74 each changed the counter in place, with no gate to stand behind. For
those, flipping without deploying is the whole benefit, as 12 October showed.

So the layers are:

| | Gate | Release switch |
|---|---|---|
| Answers | does this surface exist, and is it real? | which behaviour does a live surface run? |
| Lives in | `src/gates/registry.ts`, build-time | `release_switches` rows + `src/release/switches.ts` |
| Changed by | a reviewed one-line diff and a deploy | the owner, on the Releases page |
| Lifetime | permanent | until its retirement change |

D3's three costs are each answered rather than waved away: the fetch is one small
read a minute and rides the existing Realtime connection (D6); the failure mode
fails towards the cached or the off answer, never towards a broken page (D5);
and production may disagree with the repo only in a way the repo declares — each
switch is declared in code with its expiry and reported back by every tablet (D4,
D13). `docs/DEMO_MODE.md` records D3 as narrowed, not reversed.

### D2. Built on Postgres and Realtime, with no flag service

| Alternative | Why not |
|---|---|
| LaunchDarkly, Statsig, Flagsmith Cloud, ConfigCat | Paid beyond small free tiers, and the owner ruled out paying. A second vendor in the counter's path is a second thing that can be down at the counter. |
| PostHog feature flags (free tier) | Free, but every switch read then depends on a second service, and its client evaluates in the browser from a payload it fetches — the same fetch this design makes against a database the counter already depends on. PostHog stays the analytics direction only. |
| Self-hosted Unleash, Flagsmith, GrowthBook, Flipt, flagd | Needs a server running somewhere, always; no free host keeps one up with a guarantee, and it would have to be monitored itself. |
| OpenFeature SDK with a custom provider | A standard interface for several providers; with one provider it is a dependency for its own sake. Its semantics are adopted (never throw, the caller's default on error, an evaluation context) so a provider could be slotted in later without rewriting a toggle point. |
| Build-time flags (`VITE_*`) | Changing one is a build and a deploy — the thing a switch exists to avoid. |
| Server-side switching only (RPCs read a flag) | The #74 incident was entirely client code — loops in the browser. A switch must be able to change which client code runs. |

Postgres holds the state, Realtime nudges devices, the heartbeat already reaches
every tablet, and the owner's phone already writes through RPCs that re-derive
authority. Nothing new has to be running.

### D3. Data model

Three tables, all created in this change's migration; nothing existing is
altered.

**A switch is one answer for the whole business** (owner, 2026-10-12: "making it
per outlet is not necessary, we can enable for entire app at once"). Per-outlet
switching was designed first and dropped: it is what made switch state
outlet-scoped data — a second table, its own RLS and isolation tests, two typed
forms of every read, and a button per outlet on the release page — and with Kalyani
Cafe trading alone for the coming months it would turn nothing that one switch does
not. **Adding it later is additive**, so it obeys the rules this change sets: a new
`release_switch_outlets (switch_key, outlet_id, enabled)` table, with its policy and
isolation test, read as an override of the business answer by a new
`release_switches_for(outlet)`, behind a switch of its own.

**`public.release_switches`** — one row per switch ever declared, never deleted,
holding its declaration and its current answer.

| Column | |
|---|---|
| `key text primary key` | `^[a-z][a-z0-9-]{2,62}$`. A primary key, so a retired name can never be declared again (Knight Capital). |
| `kind text` | `release` (temporary) or `ops` (permanent kill switch, rare, needs a stated reason in the code declaration). |
| `title text` | Owner-facing name, e.g. *Dish ticks*. |
| `on_means text`, `off_means text` | One sentence each, owner-facing. |
| `change_name text` | The change folder that introduced it. |
| `enabled boolean not null default false` | The current answer. A migration declares a switch off; only the owner turns it. |
| `changed_at`, `changed_by` | The last turn. |
| `created_at`, `retired_at timestamptz` | `retired_at` is set by the contract migration of its retirement change; a retired switch reads off and cannot be turned. |

**`public.release_switch_events`** — append-only history: switch, the state set,
who, when, the optional reason (≤ 200 characters), and how (`app` or `operator`).
An append-only trigger refuses update and delete, in the pattern the repo already
uses for receipts. Keyed by text, not a cascading foreign key, so history outlives
retirement.

**`public.device_health`** — one row per tablet, overwritten by each report:
`device_id` (the `counter_devices` row), `outlet_id`, `build`, `booted_switches
text[]` (the keys this page loaded with on), `window_seconds`, `requests`,
`failed`, `slowest_ms`, `reported_at`. Latest snapshot only; history of requests
is what Supabase's own logs are for.

**RLS.**

- `release_switches`: readable by every authenticated principal — every person,
  every counter and kitchen device. It holds no outlet data, so it is not
  outlet-scoped; the same select policy is what lets Realtime deliver its changes to
  every device. Not readable by `anon`.
- `release_switch_events`: owner only.
- `device_health` carries `outlet_id` and **is** outlet-scoped: the owner and that
  outlet's Franchise Admins read; it gets its isolation test in this change.
- **No client role writes any of the three tables directly**; every insert, update
  and delete is refused and tested as refused. Only migrations insert switch rows.

**Functions** (all new; `security definer`, empty `search_path`, explicit grants,
as every privileged function in the repo):

- `set_release_switch(p_key, p_enabled, p_reason)` — re-derives `app_is_owner()`
  from the caller's own token and refuses everybody else with one sentence; refuses
  an unknown or retired key; writes the answer and an `app` event in one statement.
  Setting the current answer records an event and changes nothing else.
- `release_switch_force(p_key, p_enabled, p_reason)` — the same write for an
  operator in the Supabase dashboard when the app cannot be opened; executable by
  `postgres` and `service_role` only, revoked from `anon` and `authenticated`;
  records an `operator` event.
- `app_release_switch(p_key text) returns boolean` — `stable`, for triggers and
  policies, which have no caller to choose a path (D8). False for an unknown key or
  a retired one.
- `report_device_health(...)` — writes the calling device's own row, the device and
  outlet derived from `app_counter_device()` and `app_counter_device_outlet()`,
  never from arguments.

Devices read switches with a plain select of the non-retired rows through the
adapter; no read function is needed.

### D4. Each switch is declared twice, and a lint holds the two together

The migration that introduces a switch inserts its `release_switches` row, so the
switch exists in production before any bundle that reads it (the deploy order is
migrate → functions → publish). The code declares the same key in
`src/release/switches.ts`, which gives toggle points a typed key and carries what
only the repo needs:

```ts
export const RELEASE_SWITCHES = {
  'release-probe': {
    kind: 'release',
    change: 'a-release-can-be-switched-off',
    retireBy: '2026-11-30',
    roundTrip: 'none: the probe changes one word and writes nothing',
  },
  'device-health': {
    kind: 'release',
    change: 'a-release-can-be-switched-off',
    retireBy: '2026-11-30',
    roundTrip: 'none: a health report is overwritten every minute and read by no other path',
  },
} as const satisfies Record<string, ReleaseSwitchDeclaration>

/** Tombstones. A key here may never be declared again. */
export const RETIRED_SWITCHES = [] as const
```

`lint:switches` fails when: a declared key has no migration inserting it; a key
inserted by a migration is neither declared nor retired; a retired key is
declared; a declared switch's `kind` disagrees with its migration row;
more than five `release`-kind switches are declared; a `retireBy` has passed by
more than fourteen days (it warns from the day it passes); a declared switch has
no unit test calling `describeSwitch('<key>'` and no browser test tagged
`@switch-on:<key>`; a switch whose `roundTrip` is not a `none:` sentence has no
browser test tagged `@switch-round-trip:<key>`; or an active change folder created
on or after this change's baseline has no `## Release` section in its proposal
(D12).

**Why the Releases page reads the database and not the code.** In an incident the
owner's phone may still be on the build before the one that added the switch. If
the page listed switches from its own code, the switch they need would be
missing. Titles and the *On means* / *Off means* sentences live in the row for the
same reason.

### D5. How a page reads a switch

**One answer per page load.** At boot, before the router renders, the switch
store reads the last answers this device saved (local storage; booleans only).
That snapshot is frozen for the life of the page. A toggle point reads the frozen
snapshot, never the network: `useReleaseSwitch('device-health')`, typed so an
undeclared key does not compile.

**Unknown is off.** A key with no saved answer reads off. An error anywhere in the
read path reads off for keys never seen, and the last saved answer for keys that
were. Reads never throw (OpenFeature's rule).

**Decisions are named, not scattered.** Following Hodgson's "decouple decision
points from decision logic", a feature exposes a named decision —
`dishTicksEnabled()` — and components receive its result as a prop or
through the feature's provider, rather than calling the switch store from deep in
the tree. A switch with several toggle points uses a strategy: the old and new
implementations behind one interface, chosen once. This is what makes the
retirement change a mechanical deletion (D11).

**The demo** reads switches from the mock adapter: every declared release
switch on by default, so the walkthrough shows the newest behaviour, and the
demo's own Releases page turns one off locally to compare. It resets with the demo
and never reaches the backend. (D15.)

### D6. How a turned switch reaches a tablet, and when it takes effect

**Discovery.** The store refreshes by reading the non-retired `release_switches`
rows:

- on a Realtime change to `release_switches`;
- on return to the foreground and on regaining connectivity;
- every 60 seconds while visible, one read at a time, a trailing read retained —
  the queue rule #74's repair established;
- and once at boot, after first render.

The request cost is one small read a minute per device, inside the budget (D10).

**Application.** When a fresh answer differs from the page's frozen snapshot, the
store saves it and calls the update store's `recordUpdateReady()` — the same
signal a new build raises. From there the existing machinery owns it: wait until
the app is connected, nothing is typed, no surface has unsaved work and no write
is in flight, re-confirm after the settle delay, reload once. The header's update
action appears if the page stays occupied, and applies it at once on a tap.

Target latency: under a minute from the owner's tap to the tablet running the
other behaviour, when the tablet is idle and connected. Typically seconds (Realtime
plus the settle delay).

**Rejected: re-rendering in place.** A live re-render means every toggle point
must handle the moment of change — an open composer built by the new code
suddenly owned by the old, timers started by one path cleared by the other — and
every one of those transitions would need its own tests. A reload at a free moment
reuses a path that is already tested and already trusted with every deploy, and
makes each page's behaviour one fixed configuration. The cost is a reload; that
cost already exists for every build.

**Rejected: blocking first paint until switches are fetched.** The counter never
blocks on the network. A brand-new device renders off, learns the answer, and
reloads once at a free moment if it differs.

### D7. Queued work is never stranded

The outbox (`src/outbox/`) delivers every command it holds, whatever the switches
say. Command types and their dispatch are registered outside every toggle point,
so a tablet switched off can still deliver a `prepare_order_lines` it queued while
on. On the server, the switched-on path's RPCs are not removed while the switch
exists (D8), so they are there to accept it.

Command envelopes change additively: new command types and new optional fields,
never a changed meaning of an existing one — the billing command contract already
requires older queued commands to settle, and #74's rollback depended on exactly
that.

Every switch whose on-path persists anything carries a **round-trip test**: with
the switch on, do the new work (including something queued offline); turn the
switch off; reload; finish the order on the old path — pay it, prepare it, cancel
it — and assert it settles exactly once with nothing lost. The old path must cope
with rows the new path wrote; that is a design question each change answers in
its own design, and this test is where the answer is proved.

### D8. Migrations only add — the compatibility rules and their lint

A migration is published before the bundle that uses it, and stays published when
a switch turns off or an earlier bundle is republished. So every migration must
leave every published build working. The rules, per object:

| Object | An ordinary migration may | To change behaviour instead | Only a contract migration may |
|---|---|---|---|
| Table | create | — | drop |
| Column | add, nullable or with a default | add a new column; the on-path writes both or the new one | drop, rename, retype, set not null, change default |
| Existing column | — (no rename, retype, `set not null`, default change, drop) | new column | as above |
| Constraint on an existing table | — (an old build's write might now fail) | enforce it in the new path's function | add |
| Index | create | — | drop |
| Function a build calls | — (no `create or replace`, `alter`, `drop`, overload of the name, or `revoke`) | `name_v2(...)`, called only by the switched-on path | drop the old one |
| View | — (same as a function) | `name_v2` | drop |
| Trigger on an existing table | create, **only if** its body checks `app_release_switch('<key>')` for the switch the migration declares | — | drop |
| Policy on an existing table | add a permissive policy whose expression checks `app_release_switch('<key>')` | — | drop or replace |
| Grant | grant | — | revoke |
| Enum | add a value only the on-path writes | — | — |
| Data | insert switch rows; backfill a column this change added | — | update or delete existing rows |
| Realtime publication, cron job | add | — | remove, reschedule |

Two declarations in a migration's header drive the lint:

```sql
-- release-switch: dish-workflow     -- this migration serves that switch's on-path
-- release: contract dish-workflow   -- a retirement's contract migration
```

**A function or view first created by a migration declaring the same
`release-switch`** may be replaced by a later migration declaring it too: only that
switch's on-path calls it, so the switch still protects it. Anything else is
"existing". Pre-baseline files are inventoried for what exists, never linted
themselves.

**Exceptions** are inline, one statement at a time, and printed on every run:

```sql
-- release-lint: allow policy-change — closes a cross-outlet read reported 2026-11-02;
-- applying it to old builds is the point
```

The reason must be at least 20 characters. AGENTS.md requires the owner's
agreement to be recorded in the change's design for any exception, and the
proposal workflow asks for it.

**Emergencies.** `-- release: emergency <reason>` admits anything, prints a loud
notice, and is for a corrective migration the owner has explicitly authorised —
which is what `20261017000000_restore_counter_before_dish_ticks.sql` was. With
switches in place it should not be needed.

**Mechanics.** `scripts/check-migrations.mjs`, run by `npm run lint`:

- Baseline `20261017000000`: files at or before it are read for the inventory of
  existing tables, columns, functions, views, triggers and policies; files after
  it are linted.
- Comments and `$$…$$` bodies are stripped before matching, exactly as
  `check-drawer-migration-additive.test.mjs` does and for the same reasons; the
  trigger-guard check reads the body of the trigger's function separately.
- Each finding prints file, line, rule id, and a remediation message (D12).
- `scripts/check-migrations.test.mjs` pins every rule with a fixture that fails and
  a fixture that passes, including the #74 migration's `create or replace
  function public.counter_kitchen_marks` as a fixture that must fail.

**Edge Functions** follow the same rule in prose (AGENTS.md): a behaviour change is
a new function or reads `app_release_switch` with the service role. No lint, because
there is no cheap reliable way to tell a behaviour change in TypeScript; review and
the round-trip test carry it.

**Rejected:**

- *pgroll.* It would replace the Supabase CLI's migration flow with its own JSON
  format and serve each schema version through views — which PostgREST would
  expose and RLS would have to be written twice for. Its instant rollback is what
  the switch provides at the application layer, for far less machinery, at a scale
  of one counter.
- *Squawk.* It checks lock hazards — an index built without `concurrently`, a
  constraint that takes an exclusive lock. With under three thousand bills, a lock
  is milliseconds; the hazard that hurt here was behavioural, which Squawk does not
  model. Worth revisiting if a table reaches millions of rows.
- *Down migrations.* The Supabase CLI has no runner for them, a down migration is
  as untested as any rollback written in advance, and it cannot restore data. The
  contract/expand split makes them unnecessary.
- *A Claude Code hook that refuses destructive SQL.* Codex does not run Claude
  hooks, and a hook in a user-editable file is advice. CI runs for every agent and
  every push; the lint is the enforcement and the agents run it themselves first.

### D9. The version-skew states, and the rollback ladder

At any moment production is some combination of bundle, schema and switch. Every
one of these must work, and each is covered by a named test:

| Bundle on the tablet | Schema | Switch | When | Proved by |
|---|---|---|---|---|
| old | new | — | after migrate, before a tablet takes the new build (minutes to hours) | lint:migrations; the off-state suites against the new schema |
| new | new | off | the new build has arrived, the owner has not released | every suite in the off state |
| new | new | on | released | every suite in the on state |
| new → reload | new | on → off | turned off | the round-trip test |
| older, republished | new | — | rung 2 below | lint:migrations (the republished bundle is an "old bundle") |
| new | new, contracted | retired | after retirement | the retirement change's own suites |

**The rollback ladder**, in the order to reach for it:

1. **Turn the release off** — the owner's phone, under a minute, no deploy. For
   anything behind a switch, which from now on is every behaviour change to a live
   surface.
2. **Republish an earlier verified build** — Actions → Republish, about two to
   three minutes plus the tablets' update check (at most five minutes while open).
   For a change nobody put behind a switch. Safe only because rung-2 bundles meet
   an expand-only schema.
3. **Hotfix** — a new fix, unverified, through a short gate and the owner's
   approval in GitHub, in about five minutes; the full suite runs on it afterwards
   (D17). For when neither the switch nor an earlier build is the answer — a fault
   in the switch machinery itself, or a bug that was already in the previous build.
4. **Fix forward** — a new commit through the full suite and Deploy, about fifteen
   minutes. The ordinary way, whenever there is time.

The incident would have ended on rung 1 at 16:16 IST. Without a switch, rung 2
would have ended it by about 16:25 — had the migration been additive. Codex's
correct repair would have reached the counter on rung 3 about fifty minutes sooner
than it did.

### D10. Testing in both states, the round trip, and the request budget

**Unit and component.** Tests run with every switch off by default, as production
does. `describeSwitch('<key>', (state) => …)` runs a block once per state, and is
how a toggle point's own tests cover both.

**Browser suites run twice.** `RELEASE_SWITCHES=off|on` selects the state:

- *Demo suite* (`npm run test:e2e`): `off` sets the demo's local override to all-off
  before load (an init script); `on` leaves the demo's default, all on.
- *Auth suite* (`npm run test:e2e:auth`): `on` runs a global setup that turns every
  declared switch on through the service role; `off` sets nothing.
- Tags decide what runs where: `@switch-on:<key>` runs only in `on`;
  `@switch-off:<key>` only in `off` — **adding that tag is the only change an
  existing test may receive** when a switch changes what it asserts; untagged tests
  run in both. `@switch-round-trip:<key>` runs in `off` (it turns its switch on and
  off itself).

`verify.yml` runs the `off` suites in the existing jobs and the `on` suites as two
new parallel jobs — `e2e browser tests (releases on)` and `auth browser tests
(releases on)` — so wall time does not grow. Both skip in a few seconds when no
release switch is declared. The repository is public, so runner minutes are free.

**Why not every combination.** With N switches there are 2ᴺ configurations;
Hodgson and the testing literature agree most flags do not interact, and recommend
the production configuration, the release configuration and the fallback. Off is
production's default and the fallback; on is every release. The cap of five
switches (D11) keeps the gap small. Two switches that do interact must say so in
their designs and add a test for the pair.

**The request budget.** `e2e-auth/request-budget.spec.ts` signs in a counter and a
kitchen against the local stack, seeds a realistic rail (eight open orders, two
kitchens' worth of dishes), leaves both idle, and counts requests to the Supabase
origin for a measured minute after a settle period — REST and RPC requests; the
Realtime socket is one connection and is not counted. Then it ticks five dishes
and takes one payment, and counts requests per action. Budgets are measured from
the current build during implementation, set at 1.5× with the measurement and its
date in the test, and asserted in both switch states. The test is proved against
#74's build (`11bd95a7`), which must fail it. A later change that needs more
requests raises the budget in its own diff, where a reviewer can see it.

**Rejected: a static lint against short `setInterval`s.** It cannot tell a timer
that reads the network from one that reads local state (the apply loop's
one-second occupancy check, the kitchen's audio check), so it would be noisy and
easy to annotate away. The budget measures the thing that matters.

### D11. The life of a change, and of its switch

The owner asked for this order to be spelled out (2026-10-12). Each step names what
enforces it.

| # | Step | What happens | Enforced by |
|---|---|---|---|
| 1 | **Propose** | **The agent writes** the proposal's `## Release` section; the owner is not asked for it. By default *On* is the change and *Off* is the behaviour as it is today, and the agent words both as the sentences the Releases page will show. It also states how every database object the change touches stays compatible, or writes `No switch:` and why. It asks the owner only when Off cannot simply be today (D11a). | `lint:switches` (the section exists), in both CI tiers |
| 2 | **Demo approval** | The owner approves the screens in the demo, which runs the release on; the demo's Releases page turns it off to compare. Unchanged from today. | the change's own STOP task |
| 3 | **Apply** | The migration inserts the switch row, off. The off path is the existing code, untouched; the on path is new code and new `_v2` objects. Old tests are tagged, never rewritten. | `lint:migrations`, `lint:switches`, typecheck (undeclared keys do not compile) |
| 4 | **Verify** | Both states, the round trip, the budget. | `verify.yml`, both states |
| 5 | **Deploy** | A push. It ships **off**: every device keeps the old behaviour, so a deploy now changes nothing anyone can see except where a change declared `No switch:`. | `deploy.yml` |
| 6 | **Turn on** | The release workflow: the owner turns it on at a quiet hour (outside the 17:00–23:00 IST service window measured on the counters) and watches every tablet on the release page through the next service. | the `release` workflow; the release page |
| 7 | **Pull it once** | Soon after, at a quiet moment, the owner turns it off and back on, and watches the tablets follow both ways. A switch that has never been pulled in production is a switch nobody knows works. | the `release` workflow; archive refuses until the history shows an off after the first on |
| 8 | **Live with it** | Days of real use. Trouble means turn it off, fix behind the same switch (no new switch), deploy, turn on again. | — |
| 9 | **Archive** | After real use, as today: specs merge, docs land, and the retirement change is seeded with the switch's `retireBy`. | the archive workflow refuses before step 7 |
| 10 | **Retire** | A retirement change deletes the off path and the toggle points (the on path stays), moves the key to `RETIRED_SWITCHES`, deletes `@switch-off:` tests and drops the tag from `@switch-on:` ones. It is released like any change, and needs no switch of its own: the behaviour it keeps is the behaviour already on. | `lint:switches` (expiry); `/next-change` lists it as due |
| 11 | **Contract** | At least a week after every tablet's health report shows a build without the off path, a migration declaring `-- release: contract <key>` drops what only the off path used and sets `retired_at`. | `lint:migrations` (the key must be retired in code); the `retire-switch` workflow's telemetry check |

The owner's list was propose, apply, enforce, enable, archive, cleanup. What it was
missing, and this table adds: **demo approval** before apply, as today; **deploy
and enable as separate steps**, the whole point; **pulling the switch once** in
production before trusting it; **cleanup in two halves**, code first and database
a week later, because old builds stay on tablets; and the **ways out** (D17), so an
emergency does not mean bypassing everything by hand.

**Expiry and the cap.** `retireBy` is required; lint warns from the date and fails
fourteen days after it; extending it is a reviewed diff with a reason. At most five
`release` switches at once — Hodgson's inventory limit, sized to a team whose
every change is reviewed by one owner. `ops` switches have no expiry, are rare, and
each carries its reason in the declaration.

**`/next-change`** lists switches past or within seven days of `retireBy` as work
due before any new change — the garbage-collection loop the harness-engineering
practice calls for.

### D11a. The Release section is derived, not asked for

The owner asked (2026-10-12) whether they would have to say what On and Off mean
every time they ask for a change. They will not. *On* is what they asked for and
*Off* is how it works now; an agent that can write the proposal can write those two
sentences, and must not turn them into a question. The section exists so that the
agent writes them down — the release page shows them to the owner at the moment of
turning a release — and so that it checks Off really can be "as today".

An agent asks the owner only when that check fails, and says why:

- **The new path writes data the old path must live with** — Off after a week
  means old screens reading what the new one saved (#74's per-dish ticks). The agent
  proposes what the old path does with it and asks only if that is a product choice.
- **Off would be unsafe or wrong** — a security or money correction that must reach
  every device. The agent writes `No switch:` and the reason; it does not ask.
- **There is no behaviour to switch** — docs, tooling, a lint, or a new surface,
  which the gate registry already holds back. `No switch:` and the reason.

### D12. What the agent instructions say, and how they are enforced

The rules land where an agent meets them, in both agent trees (`lint:agents`
already fails a workflow present in one tree and not the other).

- **`AGENTS.md`** gains a hard-rule section, **Releases are reversible**, beside
  Tenancy and Money: the two layers (D1); every behaviour change to a live surface
  behind a switch, off; off means unchanged; expand-only migrations and `_v2`;
  queued work never stranded; never reuse a switch name; the request budget; the
  rollback ladder. Its Verification list gains the two lints and the two `on` jobs,
  because that list mirrors `verify.yml` by rule.
- **`CLAUDE.md`** names it as the third rule worth loading before touching
  anything.
- **Propose** (`.claude/commands/opsx/propose.md`, `.agents/skills/openspec-propose`)
  requires the `## Release` section and, in design, a version-skew paragraph for
  each database object touched.
- **Apply** (`apply.md`, `openspec-apply-change`): build the switch first; never
  edit an existing function or view; run `npm run lint:migrations` after writing a
  migration; tag, do not rewrite, old tests.
- **Archive** (`archive.md`, `openspec-archive-change`): refuses while the change's
  switch has never been on in production; seeds the retirement change.
- **Propose → apply → verify** (both trees): the verification loop runs both states
  and the budget, and the report states the switch and what Off was proved to mean.
- **Quickfix** (`.claude/skills/quickfix`): a fix that changes counter or kitchen
  runtime behaviour beyond copy and styling — polling, reads, the outbox's callers,
  timers — ships behind a switch or leaves the lane. The lane already refuses
  migrations.
- **Next change** (both trees): overdue retirements first.
- **Two new workflows, in both trees**: `release` (preconditions, the quiet-hour
  check, turning on, what to watch on the release page, pulling it once, when to
  turn off) and `retire-switch` (D11 steps 10 and 11, including the telemetry check
  before the contract migration).

**Lint messages are remediation.** Every failure from `lint:migrations` and
`lint:switches` prints: what is wrong, at `file:line`; why the rule exists, in a
sentence; what to write instead, concretely (the `_v2` name to create, the test tag
to add); and the `docs/RELEASES.md` anchor. An agent reading the failure in its own
loop should be able to fix it without opening anything else.

**A proposal cannot skip the question.** `lint:switches` fails an active change
folder, created on or after this change's baseline, whose `proposal.md` has no
`## Release` section. It does not judge the answer; it makes sure there is one.
`docs.yml` runs the same check, because a commit that adds only a proposal takes
the prose tier and would otherwise never meet it.

**What holds whichever agent writes the change.** The owner builds with Claude,
Codex and possibly others (asked 2026-10-12: "how are we making sure every future
change builds with this change gates even if I'm building with any other AI
agent"). Instructions are advice to whoever reads them; CI is the same for
everybody, because every push to `main` runs `verify.yml` before anything
publishes. So the line is drawn by what CI can check:

| Rule | Checked by CI, for every agent and every push | Left to instructions and review |
|---|---|---|
| Migrations only add; `_v2` instead of rewriting | yes — `lint:migrations` | — |
| A switch is declared in code and migration, with tests in both states | yes — `lint:switches` | — |
| Every proposal answers how it is released | yes — `lint:switches`, both tiers | whether the answer is honest |
| Old behaviour survives the new schema | yes — the off-state suites | — |
| New behaviour works | yes — the on-state suites | — |
| Turning off strands nothing | yes, where a round-trip test is declared | that `none:` is truthful |
| The counter stays cheap to run | yes — the request budget | — |
| A switch is retired on time; at most five | yes — `lint:switches` | — |
| A behaviour change to a live surface is actually behind its switch | **no** | `AGENTS.md`, the workflows, the owner reading the Release section |

The last row cannot be checked mechanically: no linter can tell that a changed line
of TypeScript changes behaviour. That gap is closed differently. **Whatever an agent
forgets, the migration lint holds**, and it is what keeps rung 2 of the ladder —
republishing the previous build — always safe. An unswitched mistake costs minutes,
not the evening of 12 October.

`AGENTS.md` is the place every agent looks: Codex, Cursor, Copilot, Gemini CLI and
others read it by convention, and `CLAUDE.md` points Claude at it. The rules go
there first, the workflow files second.

### D13. Device health

**What is counted.** The single Supabase client (`src/data-access/supabase.ts`)
is created with an instrumented `fetch` when the `device-health` switch was on at
boot. Per request it records the resource — `rest/v1/<table>` or
`rest/v1/rpc/<function>`, or `auth`, `functions/v1/<name>` — never the query string,
headers or body; whether it failed (network error, timeout, or a 5xx; a 4xx is the
server answering and is counted separately only if it is 408 or 429); and its
duration. A sixty-second ring holds the counts. Accounting is wrapped so that its
own failure can never fail the request.

**What is reported.** The counter's and the kitchen's existing one-minute
heartbeat timers also call `report_device_health` with the build, the switches
this page booted with, the window's requests, failures and slowest duration. A
page that just booted reports at once, so after a switch the owner sees the
tablet's new state within seconds of its reload. Reporting failures are swallowed,
like the heartbeat's.

**Where it shows.** The release page lists every tablet, grouped by outlet, with
these as live readings (dots allowed, by the owner's convention for live states): build, whether
the tablet is running the release, failed of total in the last minute, slowest,
and how long ago it reported. A tablet silent for more than two minutes reads as
stale.

**Privacy.** Resource names and counts only. No phone number, name, amount, order
or payload can enter a report, because the reporter never sees a URL's query or a
body. `docs/SECURITY_AND_PRIVACY.md` says so.

### D14. No automatic switch-off, yet

An automatic rule ("a tablet failing more than N requests a minute within two
hours of a release, turn it off") is attractive because off is always safe by
construction, so a false positive costs only the feature. It is deferred because
its thresholds would be guesses: one outlet, no control group, and no recorded
incident under switches to tune against. Trigger: the first time the owner turns a
release off because of tablet health. Recorded in `openspec/todos/` at archive.

**Also deferred: trying a release on one device** (owner, 2026-10-12, "let's skip
try on one device for now, this can be an addition later"). The owner asked whether
a query parameter could turn a release on for their session alone, to try it in
production before everyone. **A query parameter was rejected**: anyone can type
it, including a biller on the counter; the features worth trying run on tablets,
which are not signed in as the owner; and one that survives a reload ends up stuck
on a tablet nobody remembers. The shape agreed for later is **Try here** on the
release page: the owner picks a tablet (or their own account), that device alone
runs the release at its next free moment, it shows a marker that cannot be
dismissed, the release page lists it, and it expires by itself at the business-day
cutover. Server-side, owner-only, per device — a small table with its own isolation
test, and the store taking a device's answer over the business one until it
expires. With more than one counter device per outlet already supported, a spare
tablet set up as a second counter is where it would be used. Trigger: the first
release the owner wants to see on real orders before the staff do. Recorded in
`openspec/todos/` at archive.

### D15. The demo

The demo shows every declared release switch on. **The Releases page is the demo's
switch panel too**: in demo mode it is served by the mock adapter, so **Turn off**
and **Turn on** change only the demo's local answers, take effect on reload, and
reset with the demo scenario — one page, not a page and a separate panel. Its mock
tablets show every state: running, waiting for a free moment, stale, failing.

**How the demo reaches it: by its address, `/demo/owner/releases`.** The real app
opens Releases from the account menu (D18), but the demo tree deliberately leaves
the shell's account slot empty — a demo shell offering Sign out would offer to end
a session that does not exist (`src/auth/account-menu.tsx`). A stripped-down demo
account menu was considered and dropped (owner, 2026-10-12: "it's okay to leave that
out, we can remember the link directly for demo settings"). The demo adds no menu,
no banner control and no navigation entry; the address works as every demo deep
link does, reconstructing the owner role from the URL. `docs/DEMO_MODE.md` records
the address.

### D16. What this change switches about itself

- **`release-probe`**: when on, the build stamp reads `Build 1a2b3c4 ·
  probe`. Nothing else. It proves the whole path on production devices with no
  product risk, and is then retired by this change's own last section — so the
  retirement path has run once before a real change needs it.
- **`device-health`**: the instrumented fetch and the reporter run only
  when this was on at boot. The instrumented fetch wraps every request the app
  makes, so a fault in it could hurt the counter; it is switched like any other
  new behaviour. It is retired later, by its own retirement change, once trusted.
- **Unswitched, deliberately:** the switch store, its read, the Realtime
  subscription and the apply path. They are the floor the switches stand on. They
  are kept small, fail towards keeping the current answer, and are covered by unit
  tests for every failure branch. The Releases page is a new surface, so it is
  gated `demo` then `live` like any surface.

### D17. The ways out: Republish, Hotfix, and the escape hatches

A rule with no way out in an emergency is bypassed by hand, which is what happened
on 12 October: `.github/workflows/emergency-rollback.yml` was written mid-incident
and builds and publishes any ref with no check at all. The owner asked for a way
out for hotfixes to stay (2026-10-12: "there should be a way out for hotfixes like
last night's rollback"). So every rule gets one exit, each exit is loud, recorded
and as narrow as it can be, and the incident's workflow is replaced by two.

**`republish.yml` — going back to a build that was verified.**

- `workflow_dispatch` with one input, a commit SHA.
- First step: ask the GitHub API whether a **Deploy** run for exactly that SHA
  concluded successfully. If not, stop with a sentence saying so. Only a build the
  full suite once passed can be republished without it.
- Then build that commit and publish to Pages. No migration, no Edge Function
  deploy — the forward schema stays, which is what the expand-only rule makes safe.

**`hotfix.yml` — going forward with a build that was not.**

- `workflow_dispatch` with a commit SHA on `main` and a reason.
- The publishing jobs run in a GitHub **environment, `production-hotfix`, whose
  required reviewer is the owner**. GitHub pauses the run until the owner taps
  Approve — on the phone, in the GitHub app — so no agent can ship one alone.
  Environment reviewers are free for public repositories.
- A short gate first: `npm run lint` (including both new lints, which accept an
  `-- release: emergency` migration), typecheck, unit tests, build. About three
  minutes. The browser and database suites are what it skips.
- Then the same order as Deploy: migrate, functions, publish.
- The commit is pushed to `main` as normal, so **Deploy runs the full suite on the
  same commit anyway** and republishes it a quarter of an hour later. If that run
  goes red, the hotfix is live and wrong in a way the suite can describe, and the
  next fix goes through Deploy.
- The hotfix's change folder records the reason, the approval and the full suite's
  result afterwards. `/quickfix` stays the lane for an ordinary fix; this is for the
  counter being down.

**Concurrency.** Deploy's `pages` concurrency group is set at the workflow level
today, which would queue a hotfix behind a running Deploy for its whole fifteen
minutes. The group moves to the publishing job in Deploy, Republish and Hotfix, so
publications still never overlap while a gate run does not block an emergency.

**The escape hatches in code**, each printed on every lint run:

| Rule | Way out |
|---|---|
| A behaviour change ships behind a switch | `No switch:` and the reason, in the proposal |
| Migrations only add | `-- release: emergency <reason>` on the migration; or `-- release-lint: allow <rule> — <reason>` on one statement |
| The full suite before publishing | Republish (verified builds), Hotfix (owner approval) |
| Retire by the date | Extend `retireBy` with a reason, a reviewed diff |

Tests pin the shapes, in the style of `check-release-order.test.mjs`:
`scripts/check-republish.test.mjs` (the verification step precedes the build; no
migrate or functions step) and `scripts/check-hotfix.test.mjs` (every publishing
job uses the `production-hotfix` environment; the gate precedes migrate; migrate
precedes functions precedes publish). The environment's reviewer is set in the
repository's settings, which no file can prove — the runbook in
`docs/OPERATIONS.md` says how to check it, and the production rehearsal in the tasks
confirms it.

### D18. UI

**Where it lives** (owner, 2026-10-12): the account menu, top right — the profile
menu that today holds the name, the roles, **View Demo**, **Sign out** and the build
stamp. Releases is a business-wide setting, not an outlet's and not an everyday
surface, so it sits beside the other things that are about the app rather than the
business, and the navigation does not grow. The surface `owner-releases` (path
`releases`) has **no `nav` entry** in the gate registry, as `ledger/categories`
already has none; the menu's link is its only way in. The link shows for a holder of
`super_admin` only, as **View Demo** does.

```
                                    ┌──────────────────────────┐
                                    │ Abhishek                 │
                                    │ Super Admin              │
                                    │ ──────────────────────── │
                                    │ Releases            ›    │
                                    │ View Demo           ›    │
                                    │ ──────────────────────── │
                                    │ [       Sign out       ] │
                                    │ ──────────────────────── │
                                    │  Build 1a2b3c4 · probe   │
                                    └──────────────────────────┘
```

The page itself: a list like Team; each row opens the release's own page; facts as
tiles; buttons say the verb; live readings may carry dots, settings read as words
(the owner's conventions, 2026-09-26). Back from the list returns to wherever the
owner opened the menu. Expect a demo round; the page's name is the owner's to
change there.

```
┌ Releases ─────────────────────────────┐
│ Dish ticks                       On    │
│ #74                                    │
├────────────────────────────────────────┤
│ Device health                    On    │
│ #75                                    │
├────────────────────────────────────────┤
│ Probe                            Off   │
│ #75                                    │
└────────────────────────────────────────┘
```

```
‹ Releases
Dish ticks
each-dish-is-ticked-off

ON MEANS
Each dish is ticked off on its own, and the kitchen marks food Ready.
OFF MEANS
The counter and kitchen as they were before #74.

STATE                                           [Turn off]
On · since 12 Oct, 22:10 · you

TABLETS · KALYANI CAFE
● Counter 1   9e91664 · running    0 of 38 failed · slowest 0.4 s · 20 s ago
● Kitchen     9e91664 · waiting    0 of 6 failed  · slowest 0.3 s · 35 s ago

HISTORY
12 Oct 22:10   On    you   quiet hour, first trial
12 Oct 17:26   Off   you   counter freezing
```

*Running* — the tablet booted with the release in its current state. *Waiting* —
the state changed and the tablet has not reloaded yet. Confirmation sheet on Turn
off: *Turn off Dish ticks? Every tablet switches at its next free moment, within a
minute.* — optional reason — **Turn off**. Turn on is the same shape. With more
than one trading outlet, each outlet's tablets are a group of their own under the
one state.

## Risks

| Risk | Mitigation |
|---|---|
| A reload at a "free moment" lands during service | The same rule already governs every deploy; the settle delay re-confirms; the owner chooses when to turn a switch, and the release workflow says to do it at a quiet hour. |
| Realtime silently dead | The 60-second read; foreground and reconnect reads. |
| Owner's phone app broken by a release | The Releases page is never behind a switch and lists from the database; the dashboard SQL in `docs/OPERATIONS.md` is the last resort. |
| Expand-only bloats the schema with `_v2` | Retirement drops the old ones; the cap of five bounds the debt. |
| The off path rots while on | Every suite still runs it until retirement; retirement is due by date. |
| An agent writes a lint exception to get green | Exceptions print on every run, need a reason, and need the owner's agreement in the design; review sees them. |
| The instrumented fetch breaks requests | It is behind `device-health`, its accounting cannot throw into the request, and it is unit-tested for every failure branch. |
| Two switches interact | Their designs must say so and add a pair test; the cap keeps pairs few. |
| Hotfix becomes the habit | It needs the owner's approval each time, records a reason, and the full suite still runs on the commit; `/quickfix` stays the ordinary lane. |
| An agent writes `No switch:` to avoid the work | The answer is in the proposal the owner reads; the request budget and Republish bound the cost of a wrong one. |

## Open questions

- **The request budget's numbers** are measured during implementation, not chosen
  here. Record the measurement in the test.
- **Whether `device-health` should become permanent** (an `ops` switch, or no
  switch) is decided at its retirement, from how it behaved.
- **Per-outlet switching, and a Franchise Admin turning releases at their own
  outlet**, are closed for now (owner, 2026-10-12). Either would be its own change,
  and D3 says how per-outlet switching would be added without breaking anything.
