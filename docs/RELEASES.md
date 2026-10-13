# Releases

How a change reaches the counters, how it is switched on, and how it is switched
off again. The rules are short and live in [`AGENTS.md`](../AGENTS.md) → *Every
change can be turned off*; this page is the reasoning and the runbooks.

## Deploy is not release

A **deploy** puts code on the counters. A **release** makes people use it. Here
they are separate steps on purpose.

A push to `main` deploys: the whole suite runs, migrations apply, the build is
published (see [Operations](OPERATIONS.md#a-push-to-main-publishes-once-the-suite-agrees)).
Every behaviour change in that build ships **off**, so a deploy changes nothing
anyone at a counter can see. The release is later, when the owner turns the
change's gate on from their phone at a quiet hour, and it can be undone in
seconds by turning it off.

This exists because of 12 October. Roadmap #74 deployed and released in one
step; under the first real service its counter screen made about 600 requests a
minute instead of about 40, the smallest database compute ran out of CPU, and
the counters froze. Nothing could switch the change off. The fix took an hour
through CI, and the rollback was a workflow written during the incident that
published with no checks at all.

## Change gates

A **change gate** applies or removes one change while the app runs. The owner
turns it from the **Change gates** page — the account menu, top right →
**Change gates** — and every counter, kitchen and phone follows. It is one answer
for the whole business, not per outlet.

Three things in this repository are called a gate. Always write which:

| | What it decides | Changed by | Lives in |
|---|---|---|---|
| **Change gate** | which behaviour an existing screen runs | the owner, on the Change gates page | `src/change-gates/gates.ts` and a `change_gates` row |
| **Surface gate** | whether a screen exists: `hidden`, `demo`, `live` | a deploy | `src/gates/registry.ts` |
| **Phase gate** | whether a change's checkpoint has passed | the owner, in `tasks.md` | `openspec/changes/<name>/tasks.md` |

**Each change gate is declared twice.** The migration that serves it inserts its
row, off, with the words the Change gates page shows — its title and what *On*
and *Off* mean — so the gate exists in production before any build reads it.
The code declares the same key in `src/change-gates/gates.ts`, so a toggle
point names a key the compiler knows, with what only the repository needs: its
kind, its code, its change, the gates it depends on, when it must be retired and
how turning it off was proved safe. `npm run lint:change-gates` fails when the
two disagree.

**Codes.** Each gate has a two-character code — capitals or digits, at least one
a letter — unique among gates not yet retired. A screen's **build code** is its
build and the codes of the gates it loaded with on, like `c1f19c32·DT-KR`. The
build number on the screens with no account menu (signed out, the counter, the
kitchen, tablet setup) becomes a button while any gate is on, and opens the
build code with a Copy button; "which changes is that tablet running?" is one
line read off its screen. A retired gate's code may be given out again; its
**key never is** — `RETIRED_CHANGE_GATES` holds every retired key, and the
database keeps every row.

**Dependencies.** A gate may depend on others. It can be turned on only while
all of them are on; turning any of them off turns it off too, each with its own
line in the history; turning that one back on does not bring the others back —
coming back is one change at a time. A page runs a gate only while every gate it
depends on, directly or through another, is on.

**How a page reads a gate.** Once, when it loads: the answers this device last
saved, frozen for the life of the page. A toggle point,
`useChangeGate('<key>')`, never asks the network. **Unknown is off** — a gate a
device has never heard of, or one this build does not declare. Each device
re-reads the answers on a live change, on coming back to the foreground, on
reconnecting and every minute, and when an answer differs from what the page
loaded with, it reloads into it at its next free moment — the same moment the
app already uses to apply an update, never in the middle of a bill. Offline, a
device keeps its last answer.

**The outbox never reads a gate.** A bill queued under one answer is sent under
the other. Anything the new path saves must survive the gate turning off: a gate
is declared `roundTrip: 'tested'`, with a browser test that does new work, turns
that one gate off and finishes the work on the old path, or `roundTrip: 'none: …'`
saying why nothing can be stranded.

## The life of a change

| # | Step | What happens | Held by |
|---|---|---|---|
| 1 | Propose | The agent writes the proposal's **`## Change gate`** section: the key, the code, and *On* and *Off* each in one sentence — On is the change, Off is today. The owner is asked only when Off cannot simply be today. Or `No gate:` and why. | `lint:change-gates`, in both CI tiers |
| 2 | Demo approval | The owner approves the screens in the demo, which runs every gate on; the demo's Change gates page turns one off to compare. | the change's own STOP task |
| 3 | Apply | The gate and its row (off) first. The off path is untouched; the on path is new code and new `_v2` database objects. Old tests are tagged, never rewritten. | `lint:migrations`, `lint:change-gates`, typecheck |
| 4 | Verify | Both states, the round trip, the request budget. | `verify.yml` |
| 5 | Stage | A push to `stage`. The suite runs, then staging is migrated and published. Safe at any hour: no tablet at an outlet reads staging. | `staging.yml` |
| 5a | Try on staging | The owner turns the gate on in staging's Change gates page and runs the fake outlet — a laptop as the counter, a laptop as the kitchen, their phone as owner. Trouble: fix, push to `stage` again. | the owner; `npm run test:e2e:staging` |
| 5b | Promote | The owner approves a Promote of that exact commit; `main` fast-forwards to it and Deploy publishes it, **off**. Promotion is the release, so it happens in the owner's deploy window. | `promote.yml`, the `main` ruleset, `deploy.yml` |
| 6 | Turn on | The owner, at a quiet hour, watching every tablet on the gate's page through the next service. | the `release` workflow |
| 7 | Pull it once | Off and on again, at a quiet moment, watching the tablets follow both ways. | archive refuses without it |
| 8 | Live with it | Real use. Trouble: off, fix behind the same gate, deploy, on again. | — |
| 9 | Archive | Specs merge, docs land, the retirement change is seeded. | the archive workflow |
| 10 | Retire | The off path and the toggle points go; the key moves to `RETIRED_CHANGE_GATES`; `@cg-off:` tests go and `@cg-on:` tags come off. | `lint:change-gates` (expiry) |
| 11 | Contract | A week after every tablet runs a build without the off path, a migration declaring `-- release: contract <key>` drops what only the off path used and retires the row. | `lint:migrations`; the `retire-gate` workflow's telemetry check |

**Expiry and the cap.** Every `change` gate carries `retireBy`; lint warns from
that date and fails fourteen days after. At most five `change` gates that depend
on nothing are declared at once — every live gate doubles what must be tested.
An `ops` gate is a permanent switch, rare, and its declaration says why.

## Migrations only add

A migration is published before the build that uses it, and it stays published
when a gate turns off or an earlier build is republished. `deploy.yml` pushes
forward only, and a migration cannot be turned off. So **every migration must
leave every published build working.** `npm run lint:migrations` holds this for
every migration after `20261017000000`, and each failure says what is wrong,
why, and what to write instead.

| Object | A migration may | To change behaviour instead | Only a contract migration may |
|---|---|---|---|
| Table | create | — | drop |
| Column | add, nullable or with a default | add a new column; the on path writes it | drop, rename, retype, set not null, change a default |
| Constraint on an existing table (a unique index counts) | — | enforce it in the on path's function | add |
| Index | create | — | drop |
| Function or view a build calls | — no `create or replace`, `alter`, overload or `revoke` | `name_v2(...)`, called only by the on path | drop the old one |
| Trigger on an existing table | create, if its function checks `app_change_gate('<key>')` for the migration's own gate | — | drop, enable, disable |
| Policy on an existing table | add a permissive one whose expression checks `app_change_gate('<key>')` | — | drop, alter, or switch RLS |
| Grant | grant | — | revoke |
| Enum | add a value only the on path writes | — | — |
| Data | insert gate rows; backfill a column this migration added | — | — (only retiring its own gate's row) |
| Publication, cron job | add | — | remove, reschedule |

A function or view **first created by a migration declaring the same
`-- change-gate: <key>`** may be replaced by a later migration declaring it too:
only that gate's on path calls it. A `do` block runs at migration time, so its
body is linted statement by statement, `execute '…'` included. What the lint
cannot see is a `select` calling a function that writes, and SQL assembled at
run time; review carries those, as it does every Edge Function, where a
behaviour change is a new function or reads `app_change_gate` with the service
role.

**The header declarations:**

```sql
-- change-gate: dish-ticks            -- this migration serves that gate's on path
-- release: contract dish-ticks       -- a retirement's contract migration
-- release: emergency <reason>        -- a corrective migration the owner authorised
```

A contract migration may drop, rename, retype, revoke and replace; it still moves
no data except retiring its own gate's row, and its key must already be in
`RETIRED_CHANGE_GATES`. An emergency migration admits everything and prints a
loud notice on every run.

**One statement's exception**, printed on every run, with a reason of at least
twenty characters and the owner's agreement recorded in the change's design:

```sql
-- release-lint: allow drop, constraint — widens the check so the on path can
-- write 'dish_ready'; old builds never write it
alter table public.billing_commands drop constraint c, add constraint c check (…);
```

## The version-skew states

At any moment several builds are live: the one just published, the one on a
tablet that has not reloaded yet, and possibly an older one being republished.
Every pairing of a build with the schema must work.

| Build | Schema | Gate | Works because |
|---|---|---|---|
| new | new | off | the off path is the old code, against objects that were only added to |
| new | new | on | the on path is what the suite tested with gates on |
| old | new | — | migrations only add; nothing the old build calls changed |
| republished older | new | — | the same rule, which is what makes Republish safe |
| new, on a tablet offline | new | last known | the frozen snapshot; the outbox replays whichever path queued the work |

## Tests in both states

- **Unit and component tests** run with every gate off, as production does.
  `describeChangeGate('<key>', (on) => …)` runs a block once per state.
- **Browser suites run twice.** `npm run test:e2e` and `npm run test:e2e:auth`
  run with every gate off; `npm run test:e2e:on` and `npm run test:e2e:auth:on`
  with every gate on, as two parallel CI jobs that skip when no gate is
  declared. Each spec takes `test` from its suite's `./test`, which seeds the
  run's state before any page loads; ESLint refuses Playwright's own.
- **Tags decide what runs where.** `@cg-on:<key>` runs only with gates on;
  `@cg-off:<key>` only with gates off — and adding that tag is the only change an
  existing test may receive when a gate changes what it asserts.
  `@cg-round-trip:<key>` runs with gates on, turns its own gate alone off
  mid-test, and finishes the work on the old path. Untagged tests run both ways.
- **Why not every combination.** With several gates there are 2ᴺ
  configurations. Most gates do not interact; off is production's default and
  the fallback, on is every release. Two gates that do interact say so in their
  designs and add a test for the pair.

## The request budget

`e2e-auth/request-budget.spec.ts` signs in a counter and a kitchen against the
local stack, rings eight orders, leaves both idle, and counts every request to
the Supabase origin for a measured minute — then one ACK at the kitchen and one
payment at the counter. The Realtime socket is one connection and is not
counted. The budgets were measured on the build before any gated change and set
at one and a half times the worst reading; the readings, their date and commit
are in the test. It runs in both states, and #74's build fails it. A change
that needs more requests raises the budget in its own diff, where a reviewer
sees the number move.

## Tablet health

With the **Tablet health** gate on, each counter and kitchen counts its own
requests: per request, when it finished, whether it failed (a network error, a
timeout, a 5xx, a 408 or a 429) and how long it took — never the URL's query, a
header or a body. Each minute, and once as it loads, it reports its build, the
gates it loaded with on, and the last minute's requests, failures and slowest
request. Every gate's page lists every tablet, grouped by outlet: *running* this
gate's current answer or still *waiting* for a free moment to reload into it,
*38 requests · 0 failed · slowest 0.4 s · 20 s ago*, or *Silent* after two
minutes without a report.

The numbers are not about any one gate. For most changes they sit at their
normal values and say nothing. They matter for the change that does something to
the network — the one nobody expects to — and on 12 October they would have read
*600 requests* long before anything else went wrong.

## The ways out

A rule with no way out in an emergency is bypassed by hand. Each rule has one
exit, as narrow as it can be, and each is loud.

### 1. Turn the gate off

The owner: account menu → **Change gates** → the gate → the switch → a reason →
confirm. Every tablet reloads into the old behaviour at its next free moment,
usually within a minute or two. Gates that depend on it go off with it; the
confirmation names them.

If the owner's phone cannot load the app, the same turn from the Supabase
dashboard's SQL editor, which runs as the database owner:

```sql
select public.change_gate_force('dish-ticks', false, 'Counter frozen; turned off from the dashboard');
```

It records the turn in the history as an operator turn, with no person.

### 2. Republish a verified build

**Actions → Republish → Run workflow**, with the full SHA of a build Deploy once
published. It first asks GitHub whether a Deploy run succeeded on exactly that
commit, and stops if none did. Then it builds that commit and publishes it, with
no migration and no Edge Function deploy: the forward schema stays, which is
safe because every migration only adds. A tablet picks the build up at its next
update check.

### 3. Hotfix

For the counter being down, not for an ordinary fix. **Actions → Hotfix → Run
workflow**, with the full SHA of the fix and a reason.

1. A short gate: lint (both release lints included, which admit an
   `-- release: emergency` migration), typecheck, unit tests. About three
   minutes; the browser and database suites are what it skips.
2. The fix must carry everything already on `main` — `main` must be its
   ancestor — and the run's summary lists every commit it carries.
3. The run pauses at **the owner approves** until the owner approves it in
   GitHub, on their phone if need be. That job runs in the `production-hotfix`
   environment, whose required reviewer is the owner, and nothing that changes
   production can start before it. Approving also cancels any Deploy run still
   going for another commit, so it cannot republish an older build over the fix.
4. Then Deploy's order: migrate, Edge Functions, publish.
5. Last, **main follows the fix**: `main` fast-forwards to it with the deploy key,
   which GitHub holds for the owner's approval once more. Deploy then runs on
   that push, finds no Staging run for the commit, runs the full suite and
   republishes it.

Once `stage` exists, the fix must already be on it. The hotfix's change folder
records the reason, the approvals and the full suite's result afterwards.

To check that the environment's reviewer is set — no file can prove it:

```bash
gh api repos/abdatta/shawarmania-ops/environments/production-hotfix --jq '.protection_rules'
```

It must list a `required_reviewers` rule naming the owner.

### 4. Fix forward

Through the normal path: a change behind the same gate, verified, deployed off,
turned on.

### The exits in code

| Rule | Way out |
|---|---|
| A behaviour change ships behind a gate | `No gate:` and the reason, in the proposal |
| Migrations only add | `-- release: emergency <reason>` on the migration; `-- release-lint: allow <rule> — <reason>` on one statement |
| The full suite before publishing | Republish (verified builds); Hotfix (the owner's approval) |
| Retire by the date | move `retireBy`, with the reason, in a reviewed diff |

## Staging

A separate Supabase project, in a separate Supabase account, on the same plan and
compute size as production, published from the `stage` branch to
`stage-ops.shawarmania.in`. Every screen carries the band **Staging · not a real
outlet**, and the installed app is called *Shawarmania Ops (staging)*. Its data is
synthetic and at production's scale; no production row is ever copied there; and
it holds none of the third parties' secrets, so it can text no phone and reach no
restaurant account ([Operations](OPERATIONS.md#never-configured-on-staging)).

**How a commit gets there.** Every commit is pushed to `stage`. Staging runs the
suite, migrates the staging project, seeds it if it holds no Test Cafe, deploys its
Edge Functions, publishes a staging build, and runs the smoke suite against it. A Free project pauses after a
week without a push; Staging then stops with one sentence saying to resume it from
the staging account's dashboard.

**Running the fake outlet.** On staging, from the owner's phone: create an outlet
— or use *Test Cafe*, which the seed made — and on Outlets → the outlet → Tablets,
issue a setup code; type it on laptop 1 at the staging address and it becomes the
counter. Do the same for laptop 2 as a kitchen. Open each one's shift with the
handshake: the laptop asks for a username and shows four digits, which the person
types on their own phone. Then turn the gate under test on from staging's Change
gates page and ring orders, acknowledge them and take payments as staff would, for
as long as it takes to trust it. With **Tablet health** on, the gate's page shows
both laptops' requests a minute beside the budget's numbers.

**How an agent verifies on staging.** Not by typing a password into a browser:
`npm run test:e2e:staging`, with `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`
and `STAGING_TEST_PASSWORD` in the environment. It walks the owner, a manager, a
counter and a kitchen through one order, one acknowledgement, one payment and one
change-gate turn on *Test Cafe*, checking the band on each, and leaves both shifts
at the end.

**Promoting.** Actions → Promote → Run workflow, with the commit's full SHA, or
nothing for `stage`'s tip. It refuses a commit no Staging run passed and one `main`
cannot fast-forward to, then lists every commit it would carry with its change
folders. GitHub holds the push until the owner approves it in the
`production-promote` environment. Deploy then finds Staging's run for the commit,
skips the suite, and migrates, deploys functions and publishes in a few minutes.
Because history is linear, a promotion carries everything beneath its commit;
because every behaviour change ships off, carrying a change staged but not yet tried
is safe, and the summary lists it.

**Starting over.** Actions → Staging reset wipes staging's database, re-applies every
migration on `stage`, and re-runs `scripts/seed-staging.mjs`: *Test Cafe*, a test
account for every role, a counter and a kitchen tablet, and about three thousand
bills rung through the counter's own command.

**Reading the protections.** No file can prove them, so read them:

```bash
gh api repos/abdatta/shawarmania-ops/rulesets
gh api repos/abdatta/shawarmania-ops/environments/production-promote --jq '.protection_rules'
```

The `main` ruleset must refuse direct pushes, force pushes and deletion, with the
deploy key its only bypass; `stage`'s must refuse force pushes and deletion; and
`production-promote` and `production-hotfix` must each name the owner as required
reviewer.

## Retiring a gate

The `retire-gate` workflow, in two halves. **Code first**: a retirement change
keeps every toggle point's on branch and deletes the rest, moves the key to
`RETIRED_CHANGE_GATES`, deletes `@cg-off:` and `@cg-round-trip:` tests and drops
the `@cg-on:` tags. It needs no gate and no migration; it changes no behaviour.
**Database a week later**: once every tablet's health report has shown the
retirement build or later for a week, a migration declaring
`-- release: contract <key>` drops what only the off path used, keeps the `_v2`
names, and sets the row's `retired_at`.

## What is not here yet

No automatic gate-off from tablet health, no trying a change on one device, and
no per-outlet gating — each has a note in `openspec/todos/` with the shape
already agreed. See [Limitations](LIMITATIONS.md).
