# Design: A Release Can Be Switched Off

## Read this first

This change is infrastructure that every later change builds on, and it is
implemented in a fresh session from this folder alone. The decisions most often
got backwards:

1. **A gate is decided once per page load, never live.** A turned gate is
   applied by reloading at a free moment through the existing update path (D6).
   Do not make components re-render into the other behaviour while open.
2. **Unknown means off, and off means the old behaviour.** A device that has never
   read a gate, or cannot read one, runs the change with its gate off. Nothing in
   this change may make "on" the fallback (D5).
3. **The outbox is never behind a gate.** Writes queued while a gate was on
   are delivered after it turns off. Dispatch code for a command type lives
   outside every toggle point (D7).
4. **This change obeys its own lint.** Every migration here is additive. The
   health reporter it adds is itself behind a gate, `tablet-health`, off until
   the owner turns it on (D16). The gate machinery is the one thing that cannot
   be switched, so it is kept small and fails towards "keep what you have".
5. **The surface-gate registry is not changed.** Surface gates say whether a surface exists;
   change gates say which behaviour a live surface runs. Do not add runtime
   state to `src/gates/registry.ts` (D1).
6. **The Change gates page lists gates from the database, not from the build**, so
   an old build on the owner's phone can still turn off a gate a newer build
   added (D4).
7. **Lint messages are written for an agent to act on**: what is wrong, why the
   rule exists, what to write instead, which doc to read (D12).
8. **Only the owner turns a change gate** (owner, 2026-10-12). Not a Franchise Admin,
   not for their own outlet.
9. **Staging is a separate Supabase project in a separate Supabase account**, not
   tables, a schema or a test outlet inside production (owner, 2026-10-12; D19).
   It never holds production data, and it never holds a production secret.
10. **Nothing is pushed to `main` any more.** Work is pushed to `stage`, which
    publishes to staging; `main` moves only by a fast-forward to a commit staging
    already verified, through the owner's approval in GitHub (D20). Promotion moves
    the same SHA; it never merges, squashes or rebuilds from a different commit.

11. **The name is "change gate", and it is the owner's** (2026-10-12): "a toggle
    to apply/remove a change dynamically". Every other *gate* in this repo is
    written with its qualifier — a **surface gate** in `src/gates/registry.ts`, a
    change's **phase gate** — and a change gate is never called a switch, a flag or
    a release in new text.
12. **Several gates are on at once, and a gate may depend on several others**
    (owner, 2026-10-12 and -13; D21). It runs only while every gate it depends on,
    at any depth, is on; turning any of them off turns it off; turning that one
    back on does not turn it back on. Not a tree: the list is flat.
13. **The build number reads as it always did**, and a tap copies the line with the
    *build code* — `c1f19c32·DT-KR` — in place of the build. It shows at the foot of every
    screen without an account menu, not on every screen (D16).

> **Added 2026-10-12, after implementation had started.** Items 9 and 10, D19, D20,
> and tasks section 9 were written into this folder after section 1 was already in
> progress in the main checkout. Nothing already built changes. Sections 2–8 are
> unaffected except where a task now says "staging"; the production section moved
> from 9 to 10 and now runs through promotion.

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

**What would have changed the outcome.** A gate would have ended the incident
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

**The failure mode of a missing gate is well documented.** Google Cloud's 12
June 2025 outage report says the change that crashed Service Control globally
"was not feature flag protected", that flags are how Google enables a feature
region by region, and that with one the issue would have been caught in staging.
The code path never ran during the binary's staged rollout because only a data
change triggered it. *Taken:* every behaviour change to a live surface ships
switched off (D11), including changes whose risk only shows under load.

**Old gates and dead code are their own hazard.** Knight Capital lost about
$440 million in 45 minutes in 2012 when a repurposed flag woke code that had sat
dead for years on one server that missed a deploy. *Taken:* a gate name is
never reused, enforced by a primary key in the database (D3); the off path is
deleted by a retirement change rather than left callable (D11).

**Rollback first, then canaries.** Google's SRE Workbook chapter on canarying puts
the ability to roll back as the foundation, separates feature enablement from
binary release, expands a release in stages, and notes that engineers stop seeing
problems in graphs — detection should compare the canary with a control
automatically. *Taken:* the rollback ladder (D9); a quiet hour first and the
gate pulled once before it is trusted (D11); health
shown per tablet, beside the gate (D13). Automated comparison is deferred (D14):
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

**Kill gates must be validated and fail safe.** Cloudflare's 18 November 2025
outage spread a malformed configuration file globally within minutes, and its
remediation list reportedly included a global kill switch and stricter
validation of what is propagated. *Taken:* a gate's state is a boolean per
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
as remediation (D12); the proposal's mandatory Change gate section and an agent-facing
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

### D1. Surface gates and change gates are two layers, and the surface-gate registry stays as it is

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

| | Surface gate | Change gate |
|---|---|---|
| Answers | does this surface exist, and is it real? | which behaviour does a live surface run? |
| Lives in | `src/gates/registry.ts`, build-time | `change_gates` rows + `src/change-gates/gates.ts` |
| Changed by | a reviewed one-line diff and a deploy | the owner, on the Change gates page |
| Lifetime | permanent | until its retirement change |

D3's three costs are each answered rather than waved away: the fetch is one small
read a minute and rides the existing Realtime connection (D6); the failure mode
fails towards the cached or the off answer, never towards a broken page (D5);
and production may disagree with the repo only in a way the repo declares — each
gate is declared in code with its expiry and reported back by every tablet (D4,
D13). `docs/DEMO_MODE.md` records D3 as narrowed, not reversed.

### D2. Built on Postgres and Realtime, with no flag service

| Alternative | Why not |
|---|---|
| LaunchDarkly, Statsig, Flagsmith Cloud, ConfigCat | Paid beyond small free tiers, and the owner ruled out paying. A second vendor in the counter's path is a second thing that can be down at the counter. |
| PostHog feature flags (free tier) | Free, but every gate read then depends on a second service, and its client evaluates in the browser from a payload it fetches — the same fetch this design makes against a database the counter already depends on. PostHog stays the analytics direction only. |
| Self-hosted Unleash, Flagsmith, GrowthBook, Flipt, flagd | Needs a server running somewhere, always; no free host keeps one up with a guarantee, and it would have to be monitored itself. |
| OpenFeature SDK with a custom provider | A standard interface for several providers; with one provider it is a dependency for its own sake. Its semantics are adopted (never throw, the caller's default on error, an evaluation context) so a provider could be slotted in later without rewriting a toggle point. |
| Build-time flags (`VITE_*`) | Changing one is a build and a deploy — the thing a gate exists to avoid. |
| Server-side gating only (RPCs read a flag) | The #74 incident was entirely client code — loops in the browser. A gate must be able to change which client code runs. |

Postgres holds the state, Realtime nudges devices, the heartbeat already reaches
every tablet, and the owner's phone already writes through RPCs that re-derive
authority. Nothing new has to be running.

### D3. Data model

Three tables, all created in this change's migration; nothing existing is
altered.

**A gate is one answer for the whole business** (owner, 2026-10-12: "making it
per outlet is not necessary, we can enable for entire app at once"). Per-outlet
gating was designed first and dropped: it is what made gate state
outlet-scoped data — a second table, its own RLS and isolation tests, two typed
forms of every read, and a button per outlet on the gate's page — and with Kalyani
Cafe trading alone for the coming months it would turn nothing that one gate does
not. **Adding it later is additive**, so it obeys the rules this change sets: a new
`change_gate_outlets (gate_key, outlet_id, enabled)` table, with its policy and
isolation test, read as an override of the business answer by a new
`change_gates_for(outlet)`, behind a gate of its own.

**`public.change_gates`** — one row per gate ever declared, never deleted,
holding its declaration and its current answer.

| Column | |
|---|---|
| `key text primary key` | `^[a-z][a-z0-9-]{2,62}$`. A primary key, so a retired name can never be declared again (Knight Capital). |
| `code text` | Two characters, capitals or digits, at least one a letter (`^(?=.*[A-Z])[A-Z0-9]{2}$`), e.g. *DT* — 36² is plenty for the handful of gates alive at once (owner, 2026-10-13). **Unique among gates not yet retired** (a partial unique index where `retired_at is null`), so it is checked the moment a gate is declared and a retired code may be given out again; the key is what is never reused. The build code lists the codes of the gates a page loaded with on (D16). |
| `kind text` | `change` (temporary) or `ops` (permanent kill switch, rare, needs a stated reason in the code declaration). |

| `title text` | Owner-facing name, e.g. *Dish ticks*. |
| `on_means text`, `off_means text` | One sentence each, owner-facing. |
| `change_name text` | The OpenSpec change folder that introduced it. Every gate has one, whether or not the change has a roadmap row (owner, 2026-10-12). |
| `change_number int null` | Its roadmap number, which is how the owner knows a change — the list shows *#74* under *Dish ticks*. Null for a tooling change with no row. Added during section 1. |
| `enabled boolean not null default false` | The current answer. A migration declares a gate off; only the owner turns it. |
| `changed_at`, `changed_by` | The last turn. |
| `created_at`, `retired_at timestamptz` | `retired_at` is set by the contract migration of its retirement change; a retired gate reads off and cannot be turned. |

**`public.change_gate_dependencies`** — `(gate_key, depends_on)`, both
referencing `change_gates(key)`, primary key on the pair (D21). Inserted by the
migration that declares the dependent gate and never changed. A check refuses a
gate depending on itself and a trigger refuses a row that would close a loop.
Readable by every authenticated principal, like the gates; no client writes.

**`public.change_gate_events`** — append-only history: gate, the state set,
who, when, the optional reason (≤ 200 characters), and how (`app` or `operator`).
An append-only trigger refuses update and delete, in the pattern the repo already
uses for receipts. Keyed by text, not a cascading foreign key, so history outlives
retirement.

**`public.device_health`** — one row per tablet, overwritten by each report:
`device_id` (the `counter_devices` row), `outlet_id`, `build`, `booted_gates
text[]` (the keys this page loaded with on), `window_seconds`, `requests`,
`failed`, `slowest_ms`, `reported_at`. Latest snapshot only; history of requests
is what Supabase's own logs are for.

**RLS.**

- `change_gates`: readable by every authenticated principal — every person,
  every counter and kitchen device. It holds no outlet data, so it is not
  outlet-scoped; the same select policy is what lets Realtime deliver its changes to
  every device. Not readable by `anon`.
- `change_gate_events`: owner only.
- `device_health` carries `outlet_id` and **is** outlet-scoped: the owner and that
  outlet's Franchise Admins read; it gets its isolation test in this change.
- **No client role writes any of the three tables directly**; every insert, update
  and delete is refused and tested as refused. Only migrations insert gate rows.

**Functions** (all new; `security definer`, empty `search_path`, explicit grants,
as every privileged function in the repo):

- `set_change_gate(p_key, p_enabled, p_reason)` — re-derives `app_is_owner()`
  from the caller's own token and refuses everybody else with one sentence; refuses
  an unknown or retired key; **refuses turning a gate on while any gate it depends
  on is off**, naming them; writes the answer and an `app` event in one statement,
  and **turning a gate off turns off every gate that depends on it, at any depth,
  that is on**, each with its own event (reason *Turned off with <title>*), in the
  same transaction. Setting
  the current answer records an event and changes nothing else.
- `change_gate_force(p_key, p_enabled, p_reason)` — the same write for an
  operator in the Supabase dashboard when the app cannot be opened; executable by
  `postgres` and `service_role` only, revoked from `anon` and `authenticated`;
  records an `operator` event.
- `app_change_gate(p_key text) returns boolean` — `stable`, for triggers and
  policies, which have no caller to choose a path (D8). True only when the gate and
  every gate above it are on; false for an unknown key or a retired one.
- `report_device_health(...)` — writes the calling device's own row, the device and
  outlet derived from `app_counter_device()` and `app_counter_device_outlet()`,
  never from arguments.

Devices read gates with a plain select of the non-retired rows through the
adapter; no read function is needed.

### D4. Each gate is declared twice, and a lint holds the two together

The migration that introduces a gate inserts its `change_gates` row, so the
gate exists in production before any bundle that reads it (the deploy order is
migrate → functions → publish). The code declares the same key in
`src/change-gates/gates.ts`, which gives toggle points a typed key and carries what
only the repo needs:

```ts
export const CHANGE_GATES = {
  probe: {
    kind: 'change',    code: 'PB',
    change: 'a-release-can-be-switched-off',
    retireBy: '2026-11-30',
    roundTrip: 'none: the probe changes nothing but its code in the build stamp',
  },
  'tablet-health': {
    kind: 'change',
    code: 'TH',
    change: 'a-release-can-be-switched-off',
    retireBy: '2026-11-30',
    roundTrip: 'none: a health report is overwritten every minute and read by no other path',
  },  // How #74 is expected to declare a gate that depends on another:
  // 'kitchen-ready': { kind: 'change', code: 'KR', dependsOn: ['dish-ticks'], … },
} as const satisfies Record<string, ChangeGateDeclaration>

/** Tombstones: keys never declared again. Codes are unique among live gates only. */
export const RETIRED_CHANGE_GATES: readonly string[] = []
```

`lint:change-gates` fails when: a declared key has no migration inserting it; a key
inserted by a migration is neither declared nor retired; a retired key is
declared; a declared gate's `kind`, `code` or `dependsOn` disagrees with its
migration rows; a code is malformed or repeats another live gate's; a dependency is
undeclared, retired, or leads round in a loop; a gate is retired while a gate that
depends on it is still declared; more than five `change`-kind gates that depend on
nothing are declared; a `retireBy` has passed by
more than fourteen days (it warns from the day it passes); a declared gate has
no unit test calling `describeChangeGate('<key>'` and no browser test tagged
`@cg-on:<key>`; a gate whose `roundTrip` is not a `none:` sentence has no
browser test tagged `@cg-round-trip:<key>`; or an active change folder created
on or after this change's baseline has no `## Change gate` section in its proposal
(D12).

**Why the Change gates page reads the database and not the code.** In an incident the
owner's phone may still be on the build before the one that added the gate. If
the page listed gates from its own code, the gate they need would be
missing. Titles and the *On means* / *Off means* sentences live in the row for the
same reason.

### D5. How a page reads a gate

**One answer per page load.** At boot, before the router renders, the gate
store reads the last answers this device saved (local storage; booleans only).
That snapshot is frozen for the life of the page. A toggle point reads the frozen
snapshot, never the network: `useChangeGate('tablet-health')`, typed so an
undeclared key does not compile.

**Unknown is off.** A key with no saved answer reads off. An error anywhere in the
read path reads off for keys never seen, and the last saved answer for keys that
were. Reads never throw (OpenFeature's rule).

**A gate is off whenever anything it depends on is off.** The snapshot is
computed, not copied: each gate's own answer, then off for any gate with a
dependency off at any depth (D21). The database already turns dependents off with
the gate they need, so this only matters if the two ever disagree — and then the
page runs the safer answer.

**Decisions are named, not scattered.** Following Hodgson's "decouple decision
points from decision logic", a feature exposes a named decision —
`dishTicksEnabled()` — and components receive its result as a prop or
through the feature's provider, rather than calling the gate store from deep in
the tree. A gate with several toggle points uses a strategy: the old and new
implementations behind one interface, chosen once. This is what makes the
retirement change a mechanical deletion (D11).

**The demo** reads gates from the mock adapter: every declared change
gate on by default, so the walkthrough shows the newest behaviour, and the
demo's own Change gates page turns one off locally to compare. It resets with the demo
and never reaches the backend. (D15.)

### D6. How a turned gate reaches a tablet, and when it takes effect

**Discovery.** The store refreshes by reading the non-retired `change_gates`
rows:

- on a Realtime change to `change_gates`;
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

**Rejected: blocking first paint until gates are fetched.** The counter never
blocks on the network. A brand-new device renders off, learns the answer, and
reloads once at a free moment if it differs.

### D7. Queued work is never stranded

The outbox (`src/outbox/`) delivers every command it holds, whatever the gates
say. Command types and their dispatch are registered outside every toggle point,
so a tablet switched off can still deliver a `prepare_order_lines` it queued while
on. On the server, the on path's RPCs are not removed while the gate
exists (D8), so they are there to accept it.

Command envelopes change additively: new command types and new optional fields,
never a changed meaning of an existing one — the billing command contract already
requires older queued commands to settle, and #74's rollback depended on exactly
that.

Every gate whose on-path persists anything carries a **round-trip test**: with
the gate on, do the new work (including something queued offline); turn the
gate off; reload; finish the order on the old path — pay it, prepare it, cancel
it — and assert it settles exactly once with nothing lost. The old path must cope
with rows the new path wrote; that is a design question each change answers in
its own design, and this test is where the answer is proved.

### D8. Migrations only add — the compatibility rules and their lint

A migration is published before the bundle that uses it, and stays published when
a gate turns off or an earlier bundle is republished. So every migration must
leave every published build working. The rules, per object:

| Object | An ordinary migration may | To change behaviour instead | Only a contract migration may |
|---|---|---|---|
| Table | create | — | drop |
| Column | add, nullable or with a default | add a new column; the on-path writes both or the new one | drop, rename, retype, set not null, change default |
| Existing column | — (no rename, retype, `set not null`, default change, drop) | new column | as above |
| Constraint on an existing table | — (an old build's write might now fail) | enforce it in the new path's function | add |
| Index | create | — | drop |
| Function a build calls | — (no `create or replace`, `alter`, `drop`, overload of the name, or `revoke`) | `name_v2(...)`, called only by the on path | drop the old one |
| View | — (same as a function) | `name_v2` | drop |
| Trigger on an existing table | create, **only if** its body checks `app_change_gate('<key>')` for the gate the migration declares | — | drop |
| Policy on an existing table | add a permissive policy whose expression checks `app_change_gate('<key>')` | — | drop or replace |
| Grant | grant | — | revoke |
| Enum | add a value only the on-path writes | — | — |
| Data | insert gate rows; backfill a column this change added | — | update or delete existing rows |
| Realtime publication, cron job | add | — | remove, reschedule |

Two declarations in a migration's header drive the lint:

```sql
-- change-gate: dish-workflow     -- this migration serves that gate's on-path
-- release: contract dish-workflow   -- a retirement's contract migration
```

**A function or view first created by a migration declaring the same
`change-gate`** may be replaced by a later migration declaring it too: only that
gate's on-path calls it, so the gate still protects it. Anything else is
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
gates in place it should not be needed.

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
a new function or reads `app_change_gate` with the service role. No lint, because
there is no cheap reliable way to tell a behaviour change in TypeScript; review and
the round-trip test carry it.

**Rejected:**

- *pgroll.* It would replace the Supabase CLI's migration flow with its own JSON
  format and serve each schema version through views — which PostgREST would
  expose and RLS would have to be written twice for. Its instant rollback is what
  the gate provides at the application layer, for far less machinery, at a scale
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

At any moment production is some combination of bundle, schema and gate. Every
one of these must work, and each is covered by a named test:

| Bundle on the tablet | Schema | Gate | When | Proved by |
|---|---|---|---|---|
| old | new | — | after migrate, before a tablet takes the new build (minutes to hours) | lint:migrations; the off-state suites against the new schema |
| new | new | off | the new build has arrived, the owner has not released | every suite in the off state |
| new | new | on | released | every suite in the on state |
| new → reload | new | on → off | turned off | the round-trip test |
| older, republished | new | — | rung 2 below | lint:migrations (the republished bundle is an "old bundle") |
| new | new, contracted | retired | after retirement | the retirement change's own suites |

**The rollback ladder**, in the order to reach for it:

1. **Turn the gate off** — the owner's phone, under a minute, no deploy. For
   anything behind a gate, which from now on is every behaviour change to a live
   surface.
2. **Republish an earlier verified build** — Actions → Republish, about two to
   three minutes plus the tablets' update check (at most five minutes while open).
   For a change nobody put behind a gate. Safe only because rung-2 bundles meet
   an expand-only schema.
3. **Hotfix** — a new fix, unverified, through a short gate and the owner's
   approval in GitHub, in about five minutes; the full suite runs on it afterwards
   (D17). For when neither the gate nor an earlier build is the answer — a fault
   in the gate machinery itself, or a bug that was already in the previous build.
4. **Fix forward** — a new commit through the full suite and Deploy, about fifteen
   minutes. The ordinary way, whenever there is time.

The incident would have ended on rung 1 at 16:16 IST. Without a gate, rung 2
would have ended it by about 16:25 — had the migration been additive. Codex's
correct repair would have reached the counter on rung 3 about fifty minutes sooner
than it did.

### D10. Testing in both states, the round trip, and the request budget

**Unit and component.** Tests run with every gate off by default, as production
does. `describeChangeGate('<key>', (state) => …)` runs a block once per state, and is
how a toggle point's own tests cover both.

**Browser suites run twice.** `CHANGE_GATES=off|on` selects the state:

- *Demo suite* (`npm run test:e2e`): `off` sets the demo's local override to all-off
  before load (an init script); `on` leaves the demo's default, all on.
- *Auth suite* (`npm run test:e2e:auth`): `on` runs a global setup that turns every
  declared gate on through the service role; `off` sets nothing.
- Tags decide what runs where: `@cg-on:<key>` runs only in `on`;
  `@cg-off:<key>` only in `off` — **adding that tag is the only change an
  existing test may receive** when a gate changes what it asserts; untagged tests
  run in both. `@cg-round-trip:<key>` runs in `on`: with every other gate on,
  it does new work, turns **its own gate alone** off, and finishes the work on the
  old path. That is the state the owner creates when one of several live changes
  misbehaves (D21), and it is the state all-off and all-on never reach. For a gate
  with children, turning it off turns them off too, and the test asserts their work
  settles as well.

`verify.yml` runs the `off` suites in the existing jobs and the `on` suites as two
new parallel jobs — `e2e browser tests (gates on)` and `auth browser tests
(gates on)` — so wall time does not grow. Both skip in a few seconds when no
change gate is declared. The repository is public, so runner minutes are free.

**Why not every combination.** With N gates there are 2ᴺ configurations;
Hodgson and the testing literature agree most flags do not interact, and recommend
the production configuration, the release configuration and the fallback. Off is
production's default and the fallback; on is every release. The cap of five
gates (D11) keeps the gap small. Two gates that do interact must say so in
their designs and add a test for the pair.

**The request budget.** `e2e-auth/request-budget.spec.ts` signs in a counter and a
kitchen against the local stack, seeds a realistic rail (eight open orders, two
kitchens' worth of dishes), leaves both idle, and counts requests to the Supabase
origin for a measured minute after a settle period — REST and RPC requests; the
Realtime socket is one connection and is not counted. Then it ticks five dishes
and takes one payment, and counts requests per action. Budgets are measured from
the current build during implementation, set at 1.5× with the measurement and its
date in the test, and asserted in both gate states. The test is proved against
#74's build (`11bd95a7`), which must fail it. A later change that needs more
requests raises the budget in its own diff, where a reviewer can see it.

**Rejected: a static lint against short `setInterval`s.** It cannot tell a timer
that reads the network from one that reads local state (the apply loop's
one-second occupancy check, the kitchen's audio check), so it would be noisy and
easy to annotate away. The budget measures the thing that matters.

### D11. The life of a change, and of its gate

The owner asked for this order to be spelled out (2026-10-12). Each step names what
enforces it.

| # | Step | What happens | Enforced by |
|---|---|---|---|
| 1 | **Propose** | **The agent writes** the proposal's `## Change gate` section; the owner is not asked for it. By default *On* is the change and *Off* is the behaviour as it is today, and the agent words both as the sentences the Change gates page will show. It also states how every database object the change touches stays compatible, or writes `No gate:` and why. It asks the owner only when Off cannot simply be today (D11a). | `lint:change-gates` (the section exists), in both CI tiers |
| 2 | **Demo approval** | The owner approves the screens in the demo, which runs the change on; the demo's Change gates page turns it off to compare. Unchanged from today. | the change's own STOP task |
| 3 | **Apply** | The migration inserts the gate row, off. The off path is the existing code, untouched; the on path is new code and new `_v2` objects. Old tests are tagged, never rewritten. | `lint:migrations`, `lint:change-gates`, typecheck (undeclared keys do not compile) |
| 4 | **Verify** | Both states, the round trip, the budget. | `verify.yml`, both states |
| 5 | **Stage** | A push to `stage`. The full suite runs, then staging is migrated and published (D20). Safe at any hour: no tablet at an outlet reads staging. | `staging.yml` |
| 5a | **Try on staging** | The owner turns the gate on in **staging's** Change gates page and runs it as a fake outlet — a laptop as the counter, a laptop as the kitchen, their phone as owner (D19). An agent runs the staging smoke suite. Trouble means fix and push to `stage` again; production has not moved. | the owner; `test:e2e:staging` |
| 5b | **Promote** | The owner approves a promotion of that exact SHA in GitHub; `main` fast-forwards to it and Deploy publishes it to production. It ships **off**: every device keeps the old behaviour, so a promotion changes nothing anyone can see except where a change declared `No gate:`. Promotion is the release, so it happens in the owner's deploy window. | `promote.yml` and the `main` ruleset; `deploy.yml` |
| 6 | **Turn on** | The release workflow: the owner turns it on at a quiet hour (outside the 17:00–23:00 IST service window measured on the counters) and watches every tablet on the gate's page through the next service. | the `release` workflow; the gate's page |
| 7 | **Pull it once** | Soon after, at a quiet moment, the owner turns it off and back on, and watches the tablets follow both ways. A gate that has never been pulled in production is a gate nobody knows works. | the `release` workflow; archive refuses until the history shows an off after the first on |
| 8 | **Live with it** | Days of real use. Trouble means turn it off, fix behind the same gate (no new gate), deploy, turn on again. | — |
| 9 | **Archive** | After real use, as today: specs merge, docs land, and the retirement change is seeded with the gate's `retireBy`. | the archive workflow refuses before step 7 |
| 10 | **Retire** | A retirement change deletes the off path and the toggle points (the on path stays), moves the key and code to `RETIRED_CHANGE_GATES` — a gate's children first, or in the same change, never after it — deletes `@cg-off:` tests and drops the tag from `@cg-on:` ones. It is released like any change, and needs no gate of its own: the behaviour it keeps is the behaviour already on. | `lint:change-gates` (expiry); `/next-change` lists it as due |
| 11 | **Contract** | At least a week after every tablet's health report shows a build without the off path, a migration declaring `-- release: contract <key>` drops what only the off path used and sets `retired_at`. | `lint:migrations` (the key must be retired in code); the `retire-gate` workflow's telemetry check |

The owner's list was propose, apply, enforce, enable, archive, cleanup. What it was
missing, and this table adds: **demo approval** before apply, as today; **deploy
and enable as separate steps**, the whole point; **pulling the gate once** in
production before trusting it; **cleanup in two halves**, code first and database
a week later, because old builds stay on tablets; and the **ways out** (D17), so an
emergency does not mean bypassing everything by hand. Later the same day the owner
added the step their list had been reaching for: **trying it on staging before
production** (steps 5–5b; D19, D20). Before that, a change could be seen live only
in the demo or at the outlet, which is why #74 was first run under real load at
Kalyani Cafe.

**Expiry and the cap.** `retireBy` is required; lint warns from the date and fails
fourteen days after it; extending it is a reviewed diff with a reason. At most five
`change` gates that depend on nothing at once (a gate depending on another does
not count; D21) —
Hodgson's inventory limit, sized to a team whose
every change is reviewed by one owner. `ops` gates have no expiry, are rare, and
each carries its reason in the declaration.

**`/next-change`** lists gates past or within seven days of `retireBy` as work
due before any new change — the garbage-collection loop the harness-engineering
practice calls for.

### D11a. The Change gate section is derived, not asked for

The owner asked (2026-10-12) whether they would have to say what On and Off mean
every time they ask for a change. They will not. *On* is what they asked for and
*Off* is how it works now; an agent that can write the proposal can write those two
sentences, and must not turn them into a question. The section exists so that the
agent writes them down — the gate's page shows them to the owner at the moment of
turning a release — and so that it checks Off really can be "as today".

An agent asks the owner only when that check fails, and says why:

- **The new path writes data the old path must live with** — Off after a week
  means old screens reading what the new one saved (#74's per-dish ticks). The agent
  proposes what the old path does with it and asks only if that is a product choice.
- **Off would be unsafe or wrong** — a security or money correction that must reach
  every device. The agent writes `No gate:` and the reason; it does not ask.
- **There is no behaviour to gate** — docs, tooling, a lint, or a new surface,
  which the gate registry already holds back. `No gate:` and the reason.

### D12. What the agent instructions say, and how they are enforced

The rules land where an agent meets them, in both agent trees (`lint:agents`
already fails a workflow present in one tree and not the other).

- **`AGENTS.md`** gains a hard-rule section, **Every change can be turned off**, beside
  Tenancy and Money: the two layers (D1); every behaviour change to a live surface
  behind a gate, off; off means unchanged; expand-only migrations and `_v2`;
  queued work never stranded; never reuse a gate name; the request budget; the
  rollback ladder. Its Verification list gains the two lints and the two `on` jobs,
  because that list mirrors `verify.yml` by rule.
- **`CLAUDE.md`** names it as the third rule worth loading before touching
  anything.
- **Propose** (`.claude/commands/opsx/propose.md`, `.agents/skills/openspec-propose`)
  requires the `## Change gate` section and, in design, a version-skew paragraph for
  each database object touched.
- **Apply** (`apply.md`, `openspec-apply-change`): build the gate first; never
  edit an existing function or view; run `npm run lint:migrations` after writing a
  migration; tag, do not rewrite, old tests.
- **Archive** (`archive.md`, `openspec-archive-change`): refuses while the change's
  gate has never been on in production; seeds the retirement change.
- **Propose → apply → verify** (both trees): the verification loop runs both states
  and the budget, and the report states the gate and what Off was proved to mean.
- **Quickfix** (`.claude/skills/quickfix`): a fix that changes counter or kitchen
  runtime behaviour beyond copy and styling — polling, reads, the outbox's callers,
  timers — ships behind a gate or leaves the lane. The lane already refuses
  migrations.
- **Next change** (both trees): overdue retirements first.
- **Two new workflows, in both trees**: `release` (preconditions, the quiet-hour
  check, turning on, what to watch on the gate's page, pulling it once, when to
  turn off) and `retire-gate` (D11 steps 10 and 11, including the telemetry check
  before the contract migration).

**Lint messages are remediation.** Every failure from `lint:migrations` and
`lint:change-gates` prints: what is wrong, at `file:line`; why the rule exists, in a
sentence; what to write instead, concretely (the `_v2` name to create, the test tag
to add); and the `docs/RELEASES.md` anchor. An agent reading the failure in its own
loop should be able to fix it without opening anything else.

**A proposal cannot skip the question.** `lint:change-gates` fails an active change
folder, created on or after this change's baseline, whose `proposal.md` has no
`## Change gate` section. It does not judge the answer; it makes sure there is one.
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
| A gate is declared in code and migration, with tests in both states | yes — `lint:change-gates` | — |
| Every proposal answers how it is released | yes — `lint:change-gates`, both tiers | whether the answer is honest |
| Old behaviour survives the new schema | yes — the off-state suites | — |
| New behaviour works | yes — the on-state suites | — |
| Turning off strands nothing | yes, where a round-trip test is declared | that `none:` is truthful |
| The counter stays cheap to run | yes — the request budget | — |
| A gate is retired on time; at most five | yes — `lint:change-gates` | — |
| A behaviour change to a live surface is actually behind its gate | **no** | `AGENTS.md`, the workflows, the owner reading the Change gate section |

The last row cannot be checked mechanically: no linter can tell that a changed line
of TypeScript changes behaviour. That gap is closed differently. **Whatever an agent
forgets, the migration lint holds**, and it is what keeps rung 2 of the ladder —
republishing the previous build — always safe. An ungated mistake costs minutes,
not the evening of 12 October.

`AGENTS.md` is the place every agent looks: Codex, Cursor, Copilot, Gemini CLI and
others read it by convention, and `CLAUDE.md` points Claude at it. The rules go
there first, the workflow files second.

### D13. Device health

**What is counted.** The single Supabase client (`src/data-access/supabase.ts`)
is created with an instrumented `fetch` when the `tablet-health` gate was on at
boot. Per request it records the resource — `rest/v1/<table>` or
`rest/v1/rpc/<function>`, or `auth`, `functions/v1/<name>` — never the query string,
headers or body; whether it failed (network error, timeout, or a 5xx; a 4xx is the
server answering and is counted separately only if it is 408 or 429); and its
duration. A sixty-second ring holds the counts. Accounting is wrapped so that its
own failure can never fail the request.

**What is reported.** The counter's and the kitchen's roots run a one-minute
reporter that calls `report_device_health` with the build, the gates this page
booted with, the window's requests, failures and slowest duration. It has its
own timer rather than riding the outbox's heartbeat, because that heartbeat
lives in `src/outbox/`, which never imports the gate store (D7); the cost is the
same one call a minute, and only while the gate is on. A
page that just booted reports at once, so after a turn the owner sees the
tablet's new state within seconds of its reload. Reporting failures are swallowed,
like the heartbeat's.

**Where it shows.** The gate's page lists every tablet, grouped by outlet, as
live readings (dots allowed, by the owner's convention for live states): its
build; whether it is *running* this gate's current state or still *waiting* for a
free moment to reload into it; and *38 requests · 0 failed · slowest 0.4 s · 20 s
ago*. A tablet silent for more than two minutes reads *Silent · last heard …*.

**Generic, on purpose** (the owner asked whether these numbers matter for most
changes, 2026-10-12). They are not about any one gate: they are how the tablet is
talking to the server over the last minute, whichever changes it runs, and every
gate's page shows the same numbers for the same tablet. For most changes they sit
at their normal values and say nothing. They matter for the change that does
something to the network — which is exactly the change nobody expects to: on 12
October they would have read *600 requests* before anything else went wrong, then
*41 failed · slowest 36 s*, and then, after the repair, normal again. That is why
they sit on the page the owner has open while turning a gate off.

**Privacy.** Resource names and counts only. No phone number, name, amount, order
or payload can enter a report, because the reporter never sees a URL's query or a
body. `docs/SECURITY_AND_PRIVACY.md` says so.

### D14. No automatic gate-off, yet

An automatic rule ("a tablet failing more than N requests a minute within two
hours of a release, turn it off") is attractive because off is always safe by
construction, so a false positive costs only the feature. It is deferred because
its thresholds would be guesses: one outlet, no control group, and no recorded
incident under gates to tune against. Trigger: the first time the owner turns a change gate off because of tablet health. Recorded in `openspec/todos/` at archive.

**Also deferred: trying a change on one device** (owner, 2026-10-12, "let's skip
try on one device for now, this can be an addition later"). The owner asked whether
a query parameter could turn a change gate on for their session alone, to try it in
production before everyone. **A query parameter was rejected**: anyone can type
it, including a biller on the counter; the features worth trying run on tablets,
which are not signed in as the owner; and one that survives a reload ends up stuck
on a tablet nobody remembers. The shape agreed for later is **Try here** on the
gate's page: the owner picks a tablet (or their own account), that device alone
runs the change at its next free moment, it shows a marker that cannot be
dismissed, the gate's page lists it, and it expires by itself at the business-day
cutover. Server-side, owner-only, per device — a small table with its own isolation
test, and the store taking a device's answer over the business one until it
expires. With more than one counter device per outlet already supported, a spare
tablet set up as a second counter is where it would be used. Trigger: the first
release the owner wants to see on real orders before the staff do. Recorded in
`openspec/todos/` at archive.

### D15. The demo

The demo shows every declared change gate on. **The Change gates page is the demo's
gate panel too**: in demo mode it is served by the mock adapter, so **Turn off**
and **Turn on** change only the demo's local answers and reset with the demo
scenario — one page, not a page and a separate panel. **A demo turn takes effect at
once**, decided during section 1: the demo's screens remount under the new answers,
which is what a real page's reload does, while the demo's data stays — a real reload
of the demo would rebuild its orders, and a walkthrough comparing the two behaviours
needs the same orders on both sides. The answers and their history are kept in the
tab's session storage, so a demo reload keeps them too. Its mock
tablets show every state: running, waiting for a free moment, stale, failing.

**How the demo reaches it: by its address, `/demo/owner/change-gates`.** The real app
opens Change gates from the account menu (D18), but the demo tree deliberately leaves
the shell's account slot empty — a demo shell offering Sign out would offer to end
a session that does not exist (`src/auth/account-menu.tsx`). A stripped-down demo
account menu was considered and dropped (owner, 2026-10-12: "it's okay to leave that
out, we can remember the link directly for demo settings"). The demo adds no menu,
no banner control and no navigation entry; the address works as every demo deep
link does, reconstructing the owner role from the URL. `docs/DEMO_MODE.md` records
the address.

### D16. What this change gates about itself

**The build stamp, and where it shows** (owner, 2026-10-12, during section 1).
Implementation found that only the signed-out screens and the account menu showed
the build: the counter and the kitchen showed none, so a tablet's build and its
gates could not be read off its screen. The owner asked for it on those screens,
and then narrowed it: "only for screens which do not have the top right profile
menu dropdown which already shows this … mainly for screens which do not have a
bottom navbar". So it sits at the foot of the signed-out screens, the counter
(below Expenses, so the till keeps its height), the counter's setup and
shift-start screens, the kitchen, and the Change gates pages; every other phone
page shows it inside the account menu. It is chrome, not behaviour, and ships
ungated.

**It reads as it always has, and a tap copies it** (owner, 2026-10-13). The stamp
stays *Build 1a2b3c4 · 13 Oct 2026, 03:15 am* and is always a button. A tap copies
that line with the **build code** in place of the build —
*Build c1f19c32·DT-KR · 13 Oct 2026, 03:15 am*: the build, a middle dot, then the
codes of the gates the page loaded with on, in declaration order, joined by dashes
— and the stamp reads *Copied* for two seconds. Where the clipboard is refused, as
over plain http on a phone, the full line is shown and selected instead and nothing
claims a copy. Only declared gates are listed — a gate the build does not know has
no toggle point in it to run. Two rounds came first. One put the codes in the stamp
itself (*Build 1a2b3c4 · DT KR PRB*); the owner preferred the stamp unchanged. The
next made the stamp a button only while a gate was on, opening a pop-up with the
code and a Copy; the owner dropped the pop-up the same day, after using it on
staging: one tap is the whole job, and the copy should carry the time too.

- **`probe`** (*PB*): has no toggle point at all. Its code appearing in the build
  code is its whole effect, and proves the whole path on production devices with
  no product risk. It is then retired by this change's own last section — so the
  retirement path has run once before a real change needs it.
- **`tablet-health`**: the instrumented fetch and the reporter run only
  when this was on at boot. The instrumented fetch wraps every request the app
  makes, so a fault in it could hurt the counter; it is gated like any other
  new behaviour. It is retired later, by its own retirement change, once trusted.
- **Ungated, deliberately:** the gate store, its read, the Realtime
  subscription and the apply path. They are the floor the gates stand on. They
  are kept small, fail towards keeping the current answer, and are covered by unit
  tests for every failure branch. The Change gates page is a new surface, so it is
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

- `workflow_dispatch` with a commit SHA on `stage` and a reason. Since D20 the fix
  is pushed to `stage` like any commit, so staging receives it too; Hotfix does not
  wait for staging.
- An **`approve` job runs in a GitHub environment, `production-hotfix`, whose
  required reviewer is the owner**, and every job that changes production needs
  it. GitHub pauses the run until the owner taps Approve — on the phone, in the
  GitHub app — so no agent can ship one alone. Environment reviewers are free for
  public repositories. *Corrected during apply:* this said the publishing jobs
  themselves run in `production-hotfix`, but migrate and functions read their
  secrets from `production-database` and `production-functions`, and a job has one
  environment; one approval job that all of them need gates the same thing without
  copying secrets.
- Approving also **cancels any Deploy run still going for another commit**, which
  would otherwise republish an older build over the fix once its suite finished.
- A short gate first: `npm run lint` (including both new lints, which accept an
  `-- release: emergency` migration), typecheck, unit tests, build. About three
  minutes. The browser and database suites are what it skips.
- Then the same order as Deploy: migrate, functions, publish.
- Hotfix is the **only path other than Promote that moves `main`** (D20). After its
  publish it fast-forwards `main` to the SHA with the same deploy key Promote uses,
  under the same approval. Deploy then runs on that push; it finds no successful
  Staging run for the SHA, so it **runs the full suite on the same commit** and
  republishes it a quarter of an hour later. If that run goes red, the hotfix is
  live and wrong in a way the suite can describe, and the next fix goes through
  `stage` and Promote.
- `main` must be an ancestor of the SHA, as for Promote, so a hotfix carries
  whatever `stage` already held beneath it. That is acceptable because every
  behaviour change on `stage` ships switched off; the run's summary lists every
  commit it would carry onto `main`, so the owner sees them before approving.
  `stage` is never rewritten to make a hotfix narrower.
  *Rejected:* committing the fix on a branch from `main`'s tip and rebasing `stage`
  onto it afterwards. It needs a force push to a protected branch during an
  incident, and whoever is working on `stage` at that moment loses their base.
- The hotfix's change folder records the reason, the approval and the full suite's
  result afterwards. `/quickfix` stays the lane for an ordinary fix; this is for the
  counter being down.

**Concurrency.** Deploy's `pages` concurrency group is set at the workflow level
today, which would queue a hotfix behind a running Deploy for its whole fifteen
minutes. The group moves to the publishing job in Deploy, Republish and Hotfix, so
publications still never overlap while a gate run does not block an emergency.
Deploy keeps a workflow-level group of its own, `deploy`, so two pushes still never
interleave their migrations or publish out of order, and Deploy's and Hotfix's
migrate jobs share `production-migrations`.

**The escape hatches in code**, each printed on every lint run:

| Rule | Way out |
|---|---|
| A behaviour change ships behind a gate | `No gate:` and the reason, in the proposal |
| Migrations only add | `-- release: emergency <reason>` on the migration; or `-- release-lint: allow <rule> — <reason>` on one statement |
| The full suite before publishing | Republish (verified builds), Hotfix (owner approval) |
| Retire by the date | Extend `retireBy` with a reason, a reviewed diff |

Tests pin the shapes, in the style of `check-release-order.test.mjs`:
`scripts/check-republish.test.mjs` (the verification step precedes the build; no
migrate or functions step) and `scripts/check-hotfix.test.mjs` (every job that
changes production needs the `approve` job in `production-hotfix`; the gate precedes
migrate; migrate precedes functions precedes publish). The environment's reviewer is set in the
repository's settings, which no file can prove — the runbook in
`docs/OPERATIONS.md` says how to check it, and the production rehearsal in the tasks
confirms it.

### D18. UI

**Where it lives** (owner, 2026-10-12): the account menu, top right — the profile
menu that today holds the name, the roles, **View Demo**, **Sign out** and the build
stamp. Change gates is a business-wide setting, not an outlet's and not an everyday
surface, so it sits beside the other things that are about the app rather than the
business, and the navigation does not grow. The surface `owner-change-gates` (path
`change-gates`) has **no `nav` entry** in the surface-gate registry, as
`ledger/categories` already has none; the menu's link is its only way in. The link
shows for a holder of `super_admin` only, as **View Demo** does.

**The name** (owner, 2026-10-12): "Change Gates … that's how I see them — toggle to
apply/remove a change dynamically". It replaced *Releases*, the name the first demo
round showed.

```
                                    ┌──────────────────────────┐
                                    │ Abhishek                 │
                                    │ Super Admin              │
                                    │ ──────────────────────── │
                                    │ [ ⏻  Change gates      ] │
                                    │ [ ▷  View Demo         ] │
                                    │ ──────────────────────── │
                                    │ [       Sign out       ] │
                                    │ ──────────────────────── │
                                    │ Build 1a2b3c4 · 13 Oct … │  ← a button while a gate is on
                                    └──────────────────────────┘
```

**The list**: like Team; each row opens the gate's own page; facts as tiles;
settings read as words; live readings may carry dots (the owner's conventions,
2026-09-26). It is **flat**: a gate comes after the gates it depends on, and names
them by code on its row (owner, 2026-10-13 — nesting was the first round's answer,
and cannot draw a gate with two dependencies).

```
Change gates
┌──────────────────────────────────────────┐
│ CHANGE GATE                     STATUS   │
│ Dish ticks  [DT]                  On   › │
│ #74 · each-dish-is-ticked-off            │
│ Kitchen Ready  [KR]               On   › │
│ #74 · each-dish-is-ticked-off            │
│ Dependent on [DT]                        │
│ Probe  [PB]                       On   › │
│ #75 · a-release-can-be-switched-off      │
│ Tablet health  [TH]               On   › │
│ #75 · a-release-can-be-switched-off      │
└──────────────────────────────────────────┘
        Build 1a2b3c4 · 13 Oct 2026, 03:55 am
```

**A gate's page** leads with its state and a switch (owner, 2026-10-13: "a toggle
switch button not a button that says Turn on or off so loudly … move the state and
the button to the top"), then the code, the meanings, **Dependent on** and **Needed
by** as rows drawn exactly as the list draws them, then the tablets and the history.

```
‹  Kitchen Ready
   #74 · each-dish-is-ticked-off

┌──────────────────────────────────────────┐
│ Off · since Today, 03:56 am · Demo Owner  (○──)│   switch, disabled
└──────────────────────────────────────────┘
Turn on Dish ticks first: this is dependent on it.

CODE        KR
ON MEANS    The kitchen marks its food Ready …
OFF MEANS   The kitchen has ACK only, as before #74.

DEPENDENT ON
┌──────────────────────────────────────────┐
│ Dish ticks  [DT]                  Off  › │
│ #74 · each-dish-is-ticked-off            │
└──────────────────────────────────────────┘

TABLETS
Shawarmania Kalyani
● Counter tablet   9e91664 · waiting
  38 requests · 0 failed · slowest 0.4 s · now
…

HISTORY
Today, 03:56 am   Off   Demo Owner · Turned off with Dish ticks
```

*Running* — the tablet loaded with the gate in its current state. *Waiting* — the
state changed and the tablet has not reloaded yet. Flipping the switch opens the
confirmation: *Turn off Dish ticks?* — *Every tablet switches at its next free
moment, within a minute.* — and, where gates that depend on it are on, *This also
turns off Kitchen Ready, which depends on it.* — an optional reason — **Turn off**.
Turn on is the same shape without that line. The switch shows the state until the
turn is confirmed.

### D19. Staging — a fake outlet the owner runs on their own devices

**Why it exists** (owner, 2026-10-12). #74 could only be tried in the demo, which
has no server, or at Kalyani Cafe, which is the business. The owner has two
laptops and a phone and asked to run them as an outlet — a counter, a kitchen and
the owner — against something production-shaped that no other owner or staff
member can see. `docs/OPERATIONS.md` has listed a staging environment since
July; it was never provisioned. This change provisions it, because the life of a
change (D11) now runs through it.

**What it is.**

| Part | Production | Staging |
|---|---|---|
| Supabase project | `iefcidjbfnmsiqithqbj`, the owner's main Supabase account | a new project in a **separate Supabase account**, made by the owner with a different email |
| Plan and compute | as provisioned (Free at the time of writing) | **the same plan and compute size as production**, confirmed in a task and re-confirmed whenever production's changes |
| Frontend | GitHub Pages, from `main` | Cloudflare Pages project `shawarmania-ops-staging`, from `stage` |
| Data | real | synthetic only, at production's scale |
| People | staff | the owner and test accounts only |
| Third-party secrets | Zomato, Swiggy, Hyperpure, MSG91, the receipt Worker | **none, ever** |

**Why a separate project, and not tables in production.** A Supabase project is
more than its tables: one Auth (staging accounts would sit beside staff accounts
and appear on the owner's screens), one database server (staging load would land
on the CPU the counter uses — the exact failure of 12 October), one set of Edge
Function secrets and Vault entries (the aggregator syncs and SMS would act on real
accounts), and one schema every migration and policy is written against. A second
copy of the schema in the same database would mean rewriting every migration.

**Why a separate account.** The main account is at the Free plan's limit of two
active projects, and its second project is in use by something else (owner,
2026-10-12). That project must never be linked to this repo
(`docs/OPERATIONS.md`), so pausing it was not an option either. A separate
account has a useful side effect: a staging access token **cannot reach
production at all**, so no staging workflow can deploy to the wrong project even
by mistake. Its credentials are the owner's and never enter the repo; GitHub
holds them as environment secrets (D20). The Supabase account's email is recorded
in `docs/OPERATIONS.md`; nothing else about it is.

**Why the same compute size.** The #74 freeze was load on the smallest compute,
not a logic error. On a laptop's local stack it would not have happened: a
developer machine is far faster than production's database. A staging project on
the same size freezes where production would.

**Why production-scale data.** The reads that saturated production cost what they
cost because of how many rows sit behind them — the payments view at 168 ms is a
function of every payment since July. A staging database with ten bills would
answer in milliseconds and prove nothing about load. `scripts/seed-staging.mjs`
generates a synthetic history sized to production's row counts (bills, order
lines, payments, attendance days, per outlet), read from production as **counts
only** and recorded in the script with their date. Names are generated, phone
numbers come from a reserved fictional range, amounts are plausible integer paise.
**No production row is ever copied into staging**, the menu included — the script
generates a menu of the same shape (items, kitchens, categories).

**Free-plan pausing.** A Free project pauses after a week without activity. Every
push to `stage` migrates it, which normally keeps it awake; when it has paused,
`staging.yml`'s first step detects it and fails with one sentence saying to
resume it from the staging account's dashboard, rather than failing obscurely
inside `db push`.

**Starting over.** Staging's data is disposable, and a change abandoned on `stage`
leaves its migration behind on staging (migrations are forward-only). `staging-reset.yml`,
dispatched by hand, wipes staging's database, re-applies every migration on
`stage`'s tip, and re-runs the seed. Implementation confirms the CLI's remote
reset against the staging project and refuses any URL whose project reference is
production's — the same derive-the-ref-from-the-URL guard Deploy's `functions` job
uses, inverted.

**How it is told apart.** A staging build is built with
`VITE_APP_ENVIRONMENT=staging` and shows a permanent band — **Staging · not a real
outlet** — on every surface, in every role, and its web manifest names the app
*Shawarmania Ops (staging)*, short name *Staging*, under its own icon: the same mark
with the wrap and flame recoloured blue on the same black field, chosen by the owner
on 2026-10-13 from mock-ups of new fields, flame colours, hazard tape and a blueprint
line drawing. A whole new field colour read as a different app rather than a sibling;
a blue flame alone was too small a change to see at launcher size. A tablet at an
outlet that somehow opened the staging address could not mistake it for the counter. Production builds have no band and
no code path for one beyond the build-time constant. This is a build
configuration, not a change gate: production never runs the band.

**Who can get in.** The staging address is public, as production's is; the anon
key in its bundle is staging's. Nobody can sign in without an account in staging's
Auth, and only the owner creates them — the owner's own Super Admin, bootstrapped
the way production's was, and test accounts for each role. Production accounts do
not exist there. No other owner and no staff member is ever given a staging
account.

**Third parties stay out.** Staging's Vault never receives the receipt Worker URL
or secret, the aggregator credentials, or the MSG91 key; its Edge Functions are
deployed without those secrets. Implementation proves each function and each
scheduled job (`bill-receipt-recovery` and the aggregator jobs) fails closed or
does nothing when its secret is absent — with a test where one is missing — so a
bill rung on staging can never text a real phone number and a sync can never reach
a real restaurant account.

**How the owner runs the fake outlet.** The runbook in `docs/RELEASES.md`: on
staging, the owner (phone) creates an outlet named *Test Cafe*, sets up laptop 1 as
its counter with a one-time code and opens a shift through the two-device
handshake, signs in laptop 2 as its kitchen, and turns the gate under test on
from staging's Change gates page. The laptops' screens are the tablets'; the owner
rings orders, ticks dishes and takes payments as staff would, for as long as it
takes to trust it. The request budget's numbers can be read off staging's own
logs with the staging account's Management API token, the same way production's
were read on 12 October.

**How an agent verifies on staging.** Not by typing credentials into a browser:
staging is not a local development host, so an agent's browser tools may not
sign in there. Instead `npm run test:e2e:staging` — a Playwright smoke suite
(`e2e-staging/`) that signs in as the staging test accounts, whose passwords come
from the environment (`STAGING_*` variables locally, the `staging-smoke` GitHub
environment in CI) and never from the repo. `staging.yml` runs it after each
publish; an agent runs it locally when asked to verify on staging.

It works only at *Smoke tests*, an outlet the seed makes for it with its own
Franchise Admin and Biller, never at *Test Cafe*: the manager sets up a counter and
a kitchen tablet with setup codes, the two meet through one order, one
acknowledgement and one payment, both shifts are left and both tablets removed, and
any a crashed run left are removed first. Then the owner turns a change gate on and
back off, restoring what it found, with the band visible on every screen. The owner
asked for this on 2026-10-13, during the first fake-outlet walkthrough: a push could
otherwise ring an order onto the owner's counter, press *Leave counter* on a shift
the owner held through the same test Biller, or leave two permanent test tablets in
Test Cafe's list. The gate turn is the one thing still shared, because gates are
business-wide. Nothing at *Smoke tests* is pruned: a run leaves about one bill and a
few small rows, around 20 kB, and staging held 39 MB of the Free plan's 500 MB when
that was measured. Rejected: seeded tablets the suite signs in as by password (the
first version), which also skipped the setup-code path every real tablet takes.

**Rejected:**

- *Tables, a schema or a hidden test outlet inside production.* For the reasons
  above. A hidden outlet in particular: the owner reads every outlet by design
  (#28), so hiding one means a filter on every owner surface, total and sync, and
  one missed filter puts fake money in real reports; its load lands on the
  counter's database; and change gates are business-wide (D3), so turning a
  release on for the test outlet turns it on at Kalyani Cafe.
- *Only the local stack, served to the owner's devices over the LAN.* A laptop's
  database is far faster than production's, so load problems hide; and a phone
  reaching `http://192.168.x.x` is not a secure context, so the service worker
  and geolocation (attendance's geofence) do not run.
- *Pausing the account's other project to stay inside one account.* It is in use.
- *Upgrading to Pro for a second project.* Costs money the owner chose not to
  spend; a separate free account gives the same isolation. Worth revisiting when
  production moves to Pro for its own reasons.
- *Supabase Branching.* A paid feature, and a branch per change is more than one
  outlet's worth of changes needs.
- *A second GitHub repository to host staging's Pages site.* A second repo to
  keep in step. Cloudflare already hosts the receipt Worker, so a Pages project
  there adds no new vendor.

### D20. The `stage` branch, promotion, and a protected `main`

**The flow** (owner, 2026-10-12: "a new stage branch where all the things get
pushed, and main becomes protected, and we only push to main after testing things
on staging").

```
agent / owner ──push──▶ stage ──staging.yml──▶ suite ▶ migrate ▶ functions ▶ publish ▶ smoke
                          │                                     (staging)
                          │  owner tries it on the fake outlet
                          ▼
                   Promote(SHA) ──owner approves in GitHub──▶ main fast-forwards to SHA
                                                                │
                                                     deploy.yml ▼ migrate ▶ functions ▶ publish
                                                                  (production; suite skipped,
                                                                   staging already ran it on SHA)
```

**Promotion moves the same commit.** `main` is only ever fast-forwarded to a SHA
that is already on `stage`. Nothing is merged, squashed or rebased on the way, so
the commit production runs is byte-for-byte the commit staging ran, and its
build stamp says the same seven characters on both. *Rejected: a pull request
from `stage` to `main`.* GitHub's merge, squash and rebase buttons each create new
commits, so the SHA staging verified would not be the SHA production publishes.

**`promote.yml`.** `workflow_dispatch` with one input, the SHA (default: `stage`'s
tip). Before anything else, two checks, each stopping with one sentence if it
fails:

1. a **Staging** run for exactly that SHA concluded successfully — the suite
   passed, staging was migrated and published, and the smoke suite passed;
2. `main` is an ancestor of the SHA — a fast-forward is possible.

The run's summary then lists every commit between `main` and the SHA, with each
one's change folder, so the owner reads what they are releasing. The job that
pushes runs in the GitHub environment **`production-promote`, whose required
reviewer is the owner**: GitHub pauses it until the owner taps Approve. It then
pushes the SHA to `main` with a **deploy key** held only in that environment. A
deploy key, not `GITHUB_TOKEN`: a push made with `GITHUB_TOKEN` does not trigger
other workflows, so Deploy would never run.

**The first promotion is a direct push** (corrected during apply, before anything was
pushed). GitHub starts a hand-run (`workflow_dispatch`) workflow only from the default
branch, so Promote, Staging reset, Republish and Hotfix cannot run until this change is
on `main`. This change therefore reaches `main` by one last direct push, of the SHA
staging verified, in the owner's window; the `main` ruleset goes on straight after, and
every later change goes through Promote. Until then nothing can seed staging by hand, so
the Staging workflow seeds a project that holds no Test Cafe itself, after migrating, and
leaves a seeded one alone.

**`main` is protected by a repository ruleset**: no direct pushes, no force pushes,
no deletion. The one bypass actor is that deploy key. The owner is not a bypass
actor: an owner who needs `main` moved approves a Promote or a Hotfix like anyone
else, and turning the ruleset off is a repository setting, never a step in any
runbook. `stage` gets its own ruleset: no deletion; anybody with write access may
push to it. Force pushes stay allowed, at the owner's request (2026-10-13): the
owner keeps history short by squashing commits on `stage` before promoting them.
Only commits above `main`'s tip may be rewritten, because a promotion only
fast-forwards; Staging's first job refuses a `stage` that no longer contains
`main`, and Promote refuses a commit `main` is not an ancestor of. A squash makes
new commits, and Promote accepts only a commit Staging verified, so the new tip
needs its own Staging run. The force push starts one like any push: GitHub reads
the paths of the commits pushed, not the net change, so even a squash that leaves
every file as it was runs Staging, and Promote waits for it. Rejected: accepting a commit
whose tree matches one Staging verified. It saves that run, but production's build
stamp would then name a commit staging never published.

**Every commit goes to `stage`**, change folders and docs included, so `main` is
always an ancestor of `stage` and promotion is always a fast-forward. Agents push
`git push origin HEAD:stage` from whatever local branch they work on; the local
`main` checkout's name does not change. A rewrite of `stage` that drops a commit
already on `main` fails Staging's first job, and Promote refuses it too.

**Deploy does not run the suite twice.** `deploy.yml`'s first job looks up a
successful Staging run for the pushed SHA. When it finds one, the gate is
satisfied and Deploy goes straight to migrate → functions → publish — a promotion
reaches production in a few minutes. When it finds none (a Hotfix, D17) it runs
the full suite as today. `check-release-order.test.mjs` pins both branches.

**What a push means now.** A push to `stage` reaches staging only; it is safe at
any hour, including during service. A **promotion** is the release, and inherits
every rule a push to `main` had: the owner's deploy window, never during trading.

**Unpromoted work on `stage`.** `stage`'s tip may hold a change still being tried
while an earlier one is ready. Promote takes a SHA, so the owner can promote the
earlier commit and leave the later one on `stage`. Because history is linear, a
promotion carries everything beneath its SHA; because every behaviour change ships
switched off, carrying a change that was staged but not yet tried is safe, and the
summary lists it.

**Promote's default is the newest verified commit, not the tip.** Every commit goes
to `stage`, docs included, and a docs-only commit starts no Staging run, so `stage`'s
tip is often a commit Promote must refuse. Given no SHA, Promote walks `stage` down
from its tip to the first commit above `main` with a successful Staging run, and lists
what it leaves behind; the docs wait for the next promotion, and production still runs
exactly the commit staging ran. Rejected: accepting a docs-only commit on top of a
verified one, which would put a build stamp on production naming a commit staging
never published (decided by the owner, 2026-10-13).

**Workflows after this change.**

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | pull request into `stage` or `main` | the suite |
| `docs.yml` | prose-only push to `stage`, pull request | the prose tier, including the Change-gate-section check |
| `staging.yml` (new) | push to `stage` (deploy's path filter) | suite → migrate → functions → build (staging) → publish → smoke |
| `staging-reset.yml` (new) | manual | wipe, re-migrate, re-seed staging |
| `promote.yml` (new) | manual, owner-approved | fast-forward `main` to a staged SHA |
| `deploy.yml` | push to `main` | gate (skipped if Staging passed the SHA) → migrate → functions → publish |
| `republish.yml` (D17) | manual | an earlier verified build, no suite |
| `hotfix.yml` (D17) | manual, owner-approved | short gate → migrate → functions → publish → fast-forward `main` |

`check-workflow-path-tiers.test.mjs` is extended so every path is covered on
`stage` exactly as it was on `main`: a prose-only push to `stage` meets `docs.yml`;
any other push meets `staging.yml`.

**Credentials.** Staging gets its own GitHub environments, mirroring production's
split so no job holds more than it needs: `staging-database` (the staging pooler
URL), `staging-functions` (the staging account's access token), `staging-pages`
(a Cloudflare API token scoped to the one Pages project), `staging-smoke` (test
account passwords). Staging's public URL and anon key are repository variables
beside production's, named `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY`.
The `functions` job's derive-the-ref guard is reused, so staging's functions go
to the project its bundle talks to.

**What it changes for other sessions.** Today agents push straight to
`origin/main`, including the "push the branch ref to `origin/main`" habit for
releasing without touching a local `main`. From the moment the ruleset is on, that
push is refused. `AGENTS.md`, every workflow in both agent trees that mentions
pushing, and `docs/OPERATIONS.md` change to `stage` in the same commit that turns
the ruleset on, so no session meets the refusal without the instruction beside it.

### D21. Several gates at once, and gates that depend on others

**Asked for by the owner** (2026-10-12): "at any point of time we can have multiple
independent or dependent Change Gates running … if a CG is dep on another CG, that
can only be turned on when its dependent is on"; and (2026-10-13) "a CG can be
dependent on multiple other CGs (which makes me question the nested approach in
the main table UI now …)".

**Several at once.** Every page's snapshot holds every declared gate; each is
independent unless it declares dependencies. The build code lists every code that
is on. The cap (D11) counts gates that depend on nothing, so a change split into a
gate and two that depend on it uses one slot.

**Dependencies are a graph, not a tree.** A gate lists any number of gates it
depends on (`dependsOn` in code, `change_gate_dependencies` in the database). The
first round allowed one parent and drew the list as nesting; it was replaced
because a change can genuinely need two others, and a nested list cannot draw that.
The list is flat instead, ordered so a gate follows the gates it depends on, each
row naming its dependencies by code. Loops are refused, by lint and by a database
trigger.

**The rules, enforced in the database and repeated on the device:**

| Action | Rule |
|---|---|
| Turn a gate on | Refused while any gate it depends on is off, naming them. |
| Turn a gate off | Every gate that depends on it, at any depth, that is on is turned off too, each recorded as its own turn with the reason *Turned off with <title>*, in one transaction. The confirmation names them first. |
| Turn a dependency back on | The gates that depend on it stay off. Each is turned on again by itself — what comes back after an incident is the owner's choice, one change at a time. |
| A page loads | It runs a gate only while that gate and every gate it depends on, at any depth, are on (D5), whatever the rows say. |
| Retire a gate | Every gate depending on it is retired first, or in the same change. |
| Declare a gate | Its dependencies are declared and live; no loops (lint and trigger). |

**Why cascade rather than "effective only".** Leaving a dependent's own answer on
while a gate it needs is off would make turning that gate back on silently restore
the dependent too — which, the morning after an incident, is the surprise nobody
wants. A cascade makes every state on the page the state that is running.

**Testing.** All-off and all-on are always valid states. A gate's round trip runs
with everything else on and turns only that gate off — and so every gate depending
on it (D10). Two independent gates that do interact must say so in their designs
and add a test for the pair.

## Risks

| Risk | Mitigation |
|---|---|
| A reload at a "free moment" lands during service | The same rule already governs every deploy; the settle delay re-confirms; the owner chooses when to turn a gate, and the release workflow says to do it at a quiet hour. |
| Realtime silently dead | The 60-second read; foreground and reconnect reads. |
| Owner's phone app broken by a release | The Change gates page is never behind a gate and lists from the database; the dashboard SQL in `docs/OPERATIONS.md` is the last resort. |
| Expand-only bloats the schema with `_v2` | Retirement drops the old ones; the cap of five bounds the debt. |
| The off path rots while on | Every suite still runs it until retirement; retirement is due by date. |
| An agent writes a lint exception to get green | Exceptions print on every run, need a reason, and need the owner's agreement in the design; review sees them. |
| The instrumented fetch breaks requests | It is behind `tablet-health`, its accounting cannot throw into the request, and it is unit-tested for every failure branch. |
| Two gates interact | Their designs must say so and add a pair test; the cap keeps pairs few. |
| Hotfix becomes the habit | It needs the owner's approval each time, records a reason, and the full suite still runs on the commit; `/quickfix` stays the ordinary lane. |
| An agent writes `No gate:` to avoid the work | The answer is in the proposal the owner reads; the request budget and Republish bound the cost of a wrong one. |
| A staging bill texts a real customer, or a staging sync reaches a real restaurant account | Staging never holds a third-party secret (D19); each function and job is proved to do nothing without one. |
| Staging drifts from production's size or settings, and stops predicting it | A task confirms plan, compute and Auth settings match; `docs/OPERATIONS.md` lists them side by side, and changing either side's means changing both. |
| Staging is paused when a change is pushed | `staging.yml` says so in one sentence; the runbook says how to resume. |
| A session pushes to `main` out of habit | The ruleset refuses it; the instructions change in the same commit that turns the ruleset on (D20). |
| Promotion becomes a rubber stamp | The run lists every commit and change folder it carries; behaviour still ships off, so a careless promotion changes nothing until a gate is turned on. |
| A staging account or URL reaches staff | Accounts are created only by the owner; the band says *not a real outlet* on every screen. |

## Open questions

- **The request budget's numbers** are measured during implementation, not chosen
  here. Record the measurement in the test.
- **Staging's address.** `shawarmania-ops-staging.pages.dev` unless the owner
  wants a subdomain of their own domain; asked when the Pages project is created.
- **Whether `tablet-health` should become permanent** (an `ops` gate, or no
  gate) is decided at its retirement, from how it behaved.
- **Per-outlet gating, and a Franchise Admin turning change gates at their own
  outlet**, are closed for now (owner, 2026-10-12). Either would be its own change,
  and D3 says how per-outlet gating would be added without breaking anything.
