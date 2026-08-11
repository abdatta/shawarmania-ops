# Design: Edge Functions Ship With The Release

## Context

Three things are wrong and only one of them is a bug in the ordinary sense.

**The release is incomplete.** `deploy.yml` runs `gate` (the shared verification
suite), `build`, `migrate` (`supabase db push`) and `deploy` (Pages). Edge
Functions appear nowhere. They are deployed by hand, from step 4 of the
production runbook, which names `admin-accounts`, `redeem-invite` and
`email-sign-in` and has not been touched since `email-sign-in` was added. When
#9 added two functions it added no deploy step to its tasks, and nothing
reconciles the runbook against the directory, so the omission was invisible.

The consequence sat in production for two days: the tablet handshake is fully
built, fully tested and entirely unreachable, because the two functions it needs
answer 404.

**The classifier lies about whose fault it is.** `failureCode` reads
`body.error` out of the Response supabase-js attaches, and returns null for
anything else. Three call sites then treat null as evidence of something it is
not:

```ts
// counter.ts — every unrecognised failure becomes the connection message
const code = (await failureCode(error)) ?? 'unavailable'
//                                       ^ MESSAGES.unavailable is
//                                         "Could not reach Shawarmania."

// auth.ts — every non-transport failure becomes a dead code
const reason = await failureCode(error)
if (reason === 'tablet_exists') { ... }
throw new CounterSetupError('invalid_code', DEAD_SETUP_CODE)
```

The gateway's 404 body is `{"code":"NOT_FOUND","message":"..."}`. It has no
`error` key, so `failureCode` returns null, so the owner's phone reported a
connection problem for a request that got a clean HTTP response in a few
milliseconds. `setUpCounterDevice` would have gone on to blame the code. And
`counter-setup`'s own `{"error":"setup_failed"}` 500, which is raised before the
code is ever checked, is currently reported as a dead code too.

This is a known class in this repo, fixed twice already and not generalised.
`unreachable-backend-sign-in-error` (#30) established the rule for sign-in:
classify as unreachable **only on positive no-response evidence**.
`attendance-position-free-commands` established the vocabulary for the other
half: a request the backend cannot accept is `unsendable`, with the message
"This app could not send that action. Nothing was recorded. Please report this."
Neither was carried to the counter adapter.

**The runbook enumerates.** Any list of functions maintained by hand drifts the
next time a function is added. The fix is to stop having a list.

### Why the existing suite could not have caught any of it

Worth stating, because it decides where the new coverage goes.

- The component and adapter suites drive the **mock** adapter or a stubbed
  Supabase client. A function that does not exist in production is not a shape
  the client can express.
- The pgTAP suite calls SQL functions from SQL. Edge Functions are not in it.
- `supabase/tests/rest/counter-handshake.test.ts` calls the real
  `counter-devices` over REST, and passes, because it runs against the **local**
  stack where `supabase start` serves every function in the directory
  automatically. Local parity is exactly what hid the production gap.
- The Playwright walk drives demo mode, which reaches no backend at all.

So the gap is not a missing assertion in an existing suite. It is that nothing
in the repo has an opinion about what is deployed. That is what the workflow
change and the config-parity check add.

## Goals / Non-Goals

**Goals:**

- Every Edge Function in the repo is deployed by the release, in dependency
  order relative to the migration and the bundle.
- Adding a function requires no edit to any list, in any workflow or document.
- A function that would be served with the wrong gateway configuration fails the
  suite before it can be deployed.
- On the tablet path, a server-side fault is reported as a fault to report, a
  transport failure as a connection problem, and a refused code as a refused
  code.
- Enumeration safety across setup codes is unchanged.

**Non-Goals:**

- Deploying functions from a pull request, or to any preview environment. There
  is one project.
- Retrying, queueing or falling back when a function is missing. It is a defect
  to report, not a state to tolerate.
- Reworking `failureCode` itself, or the sign-in and activation paths #30
  already settled.
- The pending-tablet slot problem in
  `openspec/todos/tablet-setup-consumes-its-slot-before-it-is-proven.md`. It is
  a different failure with its own trigger (#35) and this change does not touch
  the invariant it turns on.
- Any migration, policy, money or offline change.

## Decisions

### D1: Functions deploy between the migration and the publication

The order is a dependency order, not a preference:

```
gate (verify) ──► migrate ──► functions ──► deploy (Pages)
      │                                        ▲
      └──► build ──────────────────────────────┘
```

A function calls the schema, and the bundle calls the function. Deploying in
that order means every intermediate state is one where the newer half is waiting
for callers, never one where a caller is waiting for the newer half. The window
between `functions` and `deploy` has new functions serving the previous bundle,
which is the same additive, forward-only shape `migrate` already relies on.

`functions` is a job of its own rather than a step inside `migrate`, because the
credentials are different classes: `migrate` holds a Postgres pooler URL scoped
to the `production-database` environment and must not gain an API token that can
deploy code. `functions` gets its own `production-functions` environment.

Running the two in parallel was rejected. `counter-setup` calls
`redeem_counter_device_setup_code`; a function deployed before the migration
that creates the RPC it calls is broken for as long as the race lasts, and the
previous bundle may be calling a changed function throughout that window. One
job's latency is a small price for an ordering that is true rather than usually
true.

A failed `functions` job blocks `deploy`, so the currently published build stays
live, matching the existing guarantee for a failed migration.

### D2: The release deploys all functions, and names none

`supabase functions deploy` with no arguments deploys every function in the
directory. That is the whole fix for the drift class: there is no list to
forget to update, in the workflow or anywhere else.

Naming them explicitly was rejected for the obvious reason. It reproduces the
exact defect this change exists to remove, in a new file, where it would be just
as invisible.

`--prune` is deliberately **not** used. It deletes functions present in the
project and absent locally, which turns a bad checkout or a partial clone into
production deletions.

Every deploy is a full deploy of all five functions, including unchanged ones.
That is accepted: deploys are idempotent, the job is off the critical path of
everything except publication, and conditioning on changed paths would
reintroduce a reconciliation nobody maintains. `_shared` is bundled into each
function at deploy time, so "unchanged" is a harder question than it looks:
`counter-devices-and-offline` added a file to `_shared` and, had the three live
functions depended on it, a path filter would have shipped three stale ones.

### D3: The project reference is derived from the URL the bundle is built against

`VITE_SUPABASE_URL` is `https://<ref>.supabase.co`, and it is already the
variable the published bundle is compiled with. The `functions` job extracts the
ref from it rather than reading a second variable.

This makes "functions are deployed to the project the app talks to" structurally
true instead of conventionally true. Two independent settings can disagree; one
setting cannot. It also means the owner adds one secret rather than a secret and
a variable, and there is no second place for a project ref to go stale.

The job fails loudly if the URL is absent or does not match the expected shape,
rather than deploying to whatever project the access token happens to default
to. A token that can reach two projects and a deploy with no explicit ref is the
one way this could put counter code on the wrong database.

### D4: A function with no gateway configuration fails the suite

`supabase/config.toml` declares `verify_jwt` per function. A function with no
`[functions.<name>]` block gets the platform default, `verify_jwt = true`, and
the gateway then rejects every unauthenticated request before the function runs.

For three of the five functions that is correct. For `redeem-invite` and
`counter-setup` it is fatal and silent: both exist precisely to answer a caller
who holds no token, and both would answer 401 to every legitimate request while
looking perfectly healthy in the dashboard. `counter-setup`'s 401 would surface
to a person at a counter as a rejected setup code, which is the same lie this
change is removing elsewhere.

So `scripts/check-edge-functions.mjs` asserts one thing: every directory under
`supabase/functions/` except `_shared` has a `[functions.<name>]` block. It does
not assert which value, because that is a judgement the config comments already
record; it asserts that the judgement was made.

Written as a check script with a pure exported rule and a sibling test, matching
`check-todos-index.mjs` and `check-no-hex.mjs`, and wired into `lint` as
`lint:functions` so it runs in both CI paths through the one verification
definition.

### D5: Three classifications, told apart by evidence and not by guesswork

The rule from #30, applied to the counter path: **classify only on positive
evidence, and default to the honest unknown rather than the specific-sounding
guess.**

| Evidence | Classification | What the person is told |
|---|---|---|
| `FunctionsFetchError`, or an Auth retryable error with no status | `unavailable` | Check the connection and try again |
| A response naming a reason this path knows | that reason | The existing specific message |
| A response naming a reason it does not know, or naming none, including a 404 | `unsendable` | The action could not be sent; nothing happened; report it |

The third row is the new one, and it is the whole fix. It replaces
`?? 'unavailable'` in `counter.ts` and the fall-through to `invalid_code` in
`setUpCounterDevice`.

`unsendable` is reused verbatim from `attendance-position-free-commands` rather
than given a new name, because it is the same condition with the same advice,
and a second vocabulary for it would be the beginning of a third.

### D6: Telling a missing endpoint from a refused code leaks nothing

The rule for setup codes is that every code-related failure is indistinguishable,
so that a response cannot confirm which codes exist. Distinguishing a 404 from a
refusal does not touch that, and the reason is worth writing down because it is
the obvious objection.

A 404 is a property of the **endpoint**, not of the code. It happens identically
for a valid code, an expired code, a consumed code and a string of nonsense,
because the request never reaches any code-checking logic at all. An attacker
learns that the function is not deployed, which they can learn by sending an
empty body, and which tells them nothing about any code.

The same holds for `setup_failed`, raised when the machine identity cannot be
created, before the code hash is compared to anything.

What must not become distinguishable is `invalid_code` against
`invalid_code`, and that is unchanged: every refusal the function raises after
it starts checking still returns one status and one body, and this change adds
no branch that inspects them.

### D7: The runbook stops listing, and states who deploys now

`docs/OPERATIONS.md` step 4 becomes one command with no function names, plus the
sentence that the release does this on every push and the manual command is for
bootstrapping a project that has no CI yet.

The existing verification instruction for `redeem-invite` is kept and extended
to `counter-setup`: an unauthenticated POST with a junk code must answer 400 and
not 401. That check is what proves `verify_jwt = false` actually took effect at
the gateway, which D4 can only assert was intended, not that the platform
honoured it.

## Risks

- **The owner must add `SUPABASE_ACCESS_TOKEN` before the release can deploy
  functions.** Until then the `functions` job fails, and because `deploy` needs
  it, *publication stops too*. That is a deliberate hard failure rather than a
  skip: a release that silently omits half the backend is what caused this
  change. It is called out in the report as a blocking prerequisite so it is
  done in the same sitting, and the two missing functions still need one manual
  deploy to unblock the counter today regardless.
- **`--use-api` bundles server-side instead of through Docker.** It is faster
  and removes a Docker dependency from the publication path. If it ever
  misbehaves, dropping the flag falls back to local Docker bundling with no
  other change; `ubuntu-latest` has Docker.
- **The config-parity check can be satisfied without being correct.** A block
  with the wrong `verify_jwt` passes. That is why D7 keeps a live 400-not-401
  probe in the runbook: the static check catches the omission, the probe catches
  the wrong answer, and neither claims to do the other's job.
