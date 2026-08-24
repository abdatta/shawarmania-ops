# Testing

> The harness landed with `project-foundations`; the database-policy suites landed with `data-model-and-tenancy`.

Testing effort follows risk, and in this app risk is concentrated in three places: **money arithmetic**, **tenancy isolation**, and **the offline path**. Those get disproportionate coverage. A settings form does not.

## Commands

```bash
npm test          # Vitest: unit, component, and build-tooling suites
npm run test:e2e  # Playwright: shell, demo and the offline path, against a real build
npm run test:e2e:auth # Playwright: sign-in, provisioning, deactivation (needs the local stack)
npm run test:db   # pgTAP: isolation + write-contract suites (needs the local stack)
npm run test:rls  # REST probes: real sign-ins, hand-crafted cross-outlet requests
npm run lint      # ESLint + no-hex + backlog/spec indexes + Edge Function config
npm run typecheck # tsc --noEmit, strict
npm run contrast  # WCAG validator over the token file, both themes

npm run db:start  # bring up the local Supabase stack (Docker)
npm run db:reset  # apply every migration and the seed to a fresh database
npm run db:types  # regenerate src/data-access/database.types.ts (CI fails on drift)
npm run auth:usernames:rehearse # local-only migration, interruption, rollback, forward repair
npm run auth:readiness # hosted read-only pre-publication identity readiness probe
```

`test:db`, `test:rls` and `test:e2e:auth` need the local stack running with the seed applied (`db:start`, then `db:reset`). They are excluded from plain `npm test` so unit feedback stays instant; CI runs them in their own job against a fresh stack.

`test:e2e:auth` has its own Playwright config and its own port, because it is the one browser suite that needs a **real backend** — everything in `e2e/` runs against a build wired to a deliberately unreachable Supabase, which is what lets `npm run test:e2e` work on a laptop with no Docker. That unreachable build also proves sign-in shows connection guidance without implying whether an identifier or password is valid. The real-backend suite separately proves unknown usernames and wrong passwords keep identical refusal copy. Keeping the ports apart means a preview server left running by one suite can never be reused by the other.

**Running `test:rls` twice in a row will fail, and the failure lies about why.**
The suite signs real users in through GoTrue, which rate-limits the token
endpoint over a rolling window and answers with an empty error body — so a
sign-in that trips it surfaces as `sign-in failed for owner@…: {}` and the
suite reports twenty assertions failing on their content rather than one on its
credentials. CI never meets this because it starts a fresh stack per run. Locally,
run it once and read the result; if you must run it again, take the whole stack
down and up (`npx supabase stop && npm run db:start`) rather than restarting the
auth container on its own — Kong resolves its upstreams at startup, so a
restarted GoTrue behind a running Kong answers `502` on every request and looks
exactly like a broken suite.

**A new function needs the stack restarted, not just the runtime.** Adding a
directory under `supabase/functions/` gets a `404` until Kong has seen it, which
means a full `db:stop`/`db:start`.

**Editing an Edge Function? Restart the runtime.** The bundled edge-runtime container caches function modules, so a change to anything under `supabase/functions/` is invisible until `docker restart supabase_edge_runtime_shawarmania-ops` (or a full `db:stop`/`db:start`). A test that keeps failing against code you have already fixed is almost always this.

`npm test` runs `.test.ts` / `.test.tsx` under `src/` in a jsdom environment and `.test.mjs` under `scripts/` in a node environment. The shared setup file guards its DOM work, so the build-tooling suites do not need a second Vitest project to live alongside the app suites.

**`import.meta.url` is not a file URL under the runner.** Vitest rewrites it, so `fileURLToPath(new URL('../x', import.meta.url))` resolves against the drive root and throws or reads the wrong path. Two escapes, depending on which side of the seam the code is on: a **check script** resolves its paths inside its CLI entry rather than at module load, keeping the exported rule importable and the filesystem the entry point's business; a **test** reading repo files resolves from `process.cwd()`, which the runner sets to the repo root. Both shapes are in `scripts/` if you need an example.

**`npm run lint` gates the behaviour backlog's index.** `openspec/todos/README.md` carries each item's trigger to promote, so a note the index does not mention is not deferred work but lost work — nothing looks broken while it goes unread, which is how one sat unlisted for two days. The check fails in both directions: a note no link mentions, and a row pointing at a note that is gone. The index stays authored, since no tool can derive a trigger.

**`npm run lint` also gates the living-spec capability index.**
`openspec/specs/README.md` must link every direct capability directory containing
`spec.md`, and every capability link must still resolve to such a file. The
checker names missing and dangling capabilities but never generates or rewrites
their hand-authored summaries. The prose workflow runs both index checks because
an archive can add or remove a living capability without changing executable
code.

**A new database command family proves what survives JSON.** A test must inspect
the payload after `JSON.stringify` round-tripping whenever a required fact can be
empty or unknown, asserting that the key remains with an explicit null. The same
variant must then succeed over the real HTTP transport and assert its intended
row or result. Mock-adapter coverage or a direct SQL call cannot prove this:
JavaScript silently removes `undefined`, while PostgREST resolves an RPC from the
function name and the JSON keys it actually receives. Omission is valid only for
a parameter whose final database signature declares a default.

**`npm run lint` also gates Edge Function configuration.** Every directory under `supabase/functions/` except `_shared` must carry a `[functions.<name>]` block in `supabase/config.toml`. A function with no block does not fail — it silently receives `verify_jwt = true`, and the gateway then refuses every unauthenticated request before the function's own code runs. That is correct for three of the five functions and fatal for the two that exist to answer a caller holding no token, where it surfaces as a rejected invite code or a rejected tablet setup code, blaming the one thing that was not at fault. The check asserts the judgement was made, never which way it went; whether the platform honoured it needs a live probe, which `docs/OPERATIONS.md` carries in the first-deploy runbook.

**`scripts/check-release-order.test.mjs` gates the shape of a release.** A release is the schema, then the Edge Functions that call it, then the bundle that calls those — an order held entirely in `needs:` edges that GitHub evaluates silently. Reverse or drop one and nothing errors; the workflow goes green and publishes a bundle before the thing it calls exists. That is not hypothetical: Edge Functions had no edge at all until 2026-08-11, and two of them sat undeployed for two days behind a live bundle that called them.

`npm run test:e2e` builds the app and serves the build — never the dev server. The service worker only exists in a real build, and the offline gate is the whole point of that suite. Browsers install once with `npx playwright install chromium`. The install-affordance browser cases dispatch a controlled `beforeinstallprompt` capability because Playwright does not own Chromium's native install UI; they prove capture, route persistence, single consumption, installed-mode suppression, and demo omission. `test:e2e:auth` carries that same capability through sign-in into both the phone and counter shells against a real session.

## The layers

| Layer | Tool | Covers |
|---|---|---|
| Domain unit tests | Vitest | Money maths, expected cash, business-date resolution, P&L, geofence distance |
| Database policy tests | pgTAP (`supabase/tests/`) + REST probes | RLS isolation and the write contract, on every outlet-scoped table |
| Identity migration/tooling | Vitest + local rehearsal + deployment probe | Canonical namespace, private approval seal, permanent dual sign-in, drift refusal, password/session/history preservation, rollback, fail-closed publication |
| Component tests | Vitest + Testing Library | Interactive components, especially the billing surface |
| End-to-end | Playwright | The critical paths, including username activation/reset and offline billing |
| Design-system checks | Node scripts | Contrast in both themes; no hex literal outside the brand layer |
| Architecture boundaries | ESLint | Only `data-access` imports Supabase; `domain` imports nothing |

The last two rows are worth stating explicitly. They enforce rules that would otherwise depend on reviewer memory, and rules enforced by memory decay. Both fail the build with a message naming the file and what to do instead.

## The three suites that matter

### 1. Money arithmetic

Pure functions over integer paise, so they are trivially testable and there is no excuse for gaps.

- Bill totals: `total = subtotal − discount + tax`, across quantities and rounding edges.
- Expected closing cash: `opening + cash_sales − cash_expenses − cash_withdrawn`, including the cases that produce a negative expected balance.
- Cash difference sign convention — short is negative, over is positive. Assert it explicitly; it is exactly the kind of thing that silently inverts.
- P&L in both modes, with an explicit test that the two do **not** double-count raw materials.
- Formatting: paise → Indian-grouped rupees (`₹1,23,456`), including zero and negative values.
- Aggregator commission in the manual ledger *(temporary — #36)*:
  `(stated × bp + 5000) / 10000` with integer division, asserted to round half up
  **and to round symmetrically about zero** — truncation toward zero on a refunded
  day would leave a month a paisa out. Applied **per day** and summed, with an
  explicit test that one rate applied to a month's total gives a *different*
  answer, so the bug the per-day design forecloses cannot be reintroduced by
  moving the commission out of the loop.
- The manual ledger's month reconciling exactly against its own expenses by
  category — the guarantee that no category or marker is quietly excluded from the
  profit estimate.
- Swiggy daily gross: a timestamped Finance detail must derive pre-tax gross as
  `Total Customer Paid - GST Collected`, or as zero for the explicit
  cancelled/no-GST shape; missing/duplicate/malformed
  fields fail closed. A no-write rehearsal compares that result with payout
  annexure Net Bill Value at paisa precision, while tests assert that the reader
  never requests customer-paid list values or payout UTRs.

**No floating point anywhere.** A test that asserts a money value equals a float is itself a bug.

### 2. Tenancy isolation

The most important suite in the repo, because tenancy bugs are silent — nothing errors, a query just quietly returns more than it should.

Two layers, because they prove different halves: pgTAP impersonates each
database role/user and sweeps every table exhaustively; REST probes sign seeded
personas in through the real Auth service and hand-craft cross-outlet requests
over HTTP. Both prove that scope is resolved from live assignments rather than
token claims, and both include positive controls — a suite that passes because
a role can read *nothing at all* is a bug the controls catch.

For **every** outlet-scoped table, with sessions for each role:

- A Franchise Admin, Biller, or Employee scoped to outlet A **cannot read** outlet B's rows.
- The same session **cannot write** outlet B's rows, including by supplying B's `outlet_id` directly.
- A Super Admin **can** read across outlets.
- A removed counter tablet **cannot** read or write anything, and neither can a set-up one holding no live shift.
- The counter-operations snapshot admits only an active Super Admin or the
  requested outlet's Franchise Admin. Biller, Employee, tablet and cross-outlet
  hand-crafted calls are refused; corrected tender contributes once through the
  effective-allocation boundary, and every returned row shares one server
  reading time.
- A deactivated account **cannot** read or write anything, without waiting for token expiry.
- An Employee can read **only their own** attendance rows.

**A new outlet-scoped table without a case in this suite is an incomplete change.** The suite enforces this itself: it enumerates the tables from the database catalog and fails, naming the table, on any it cannot classify as outlet-scoped, child-scoped, or tenancy-root, or that lacks Row-Level Security — nobody has to remember.

**Owner-only tables need a case the sweep cannot express.** The manual ledger's
two tables *(temporary — #36)* carry `outlet_id`, so the enumeration finds them
and proves the ordinary claim: nobody reads across outlets. The real claim is
stronger — an outlet role is refused its **own** outlet's rows, at every verb —
and `supabase/tests/21_manual_ledger.sql` asserts it directly for a Franchise
Admin, a Biller and an Employee. `01_schema_coverage.sql` backs it with catalog
facts: every one of the eight policies names `app_is_owner()`, and **none** names
an outlet-role predicate, so a later migration that quietly adds a manager branch
fails by name rather than in whichever test somebody remembered to write.

### 3. The offline path

End-to-end, with the network genuinely disabled rather than mocked away.

- Go offline, ring up several bills, come back online → **exactly** that many bills land, with no duplicates.
- Reload the page mid-queue → the outbox survives and still drains.
- Drop the backend before local commit → the composer stays; drop it after local
  commit → the composer clears and the command remains not sent yet.
- Let the server commit and lose only the response → replay returns the same
  result and consumes no second bill number.
- Direct Mark Paid cannot drain during its six-second Undo window, and Undo
  restores lines, customer and exact tender allocation.
- Create → revise → pay/cancel remains dependency ordered while an unrelated
  order chain continues.
- End the shift, cross cutover and restart with queued work → old work remains
  deliverable, but no new work opens without the backend and a fresh shift.
- Remove a tablet with pending work → draining stops and the envelopes remain.
- Finish day refuses Undo-held, unsent, needs-attention and server-open work;
  after a clean drain it ends the shift and writes exactly one confirmation.
- Force a duplicate submission of the same client UUID → one row.
- Bill numbers are assigned by the server, are sequential per outlet, and never collide across two devices.
- A bill settled at 00:20, synced at 09:00, carries the **previous** business date.
- A malformed bill is quarantined and surfaced, not silently dropped.

The app-shell half of this already runs (`e2e/offline.spec.ts`): load, install the worker, cut the network, reload, and assert the shell and its self-hosted fonts still render. Two details there are worth knowing before writing more offline tests.

**A worker must control the page before it intercepts anything.** `clientsClaim` is deliberately off, so the worker installed on the first load does not take over that page — it serves from the next load onward. Offline tests therefore prime with an online load, a reload, and only then go offline.

That is all `clientsClaim` governs, and it is worth being exact because this page and `docs/OPERATIONS.md` both used to claim it also protected an open page from an update. It does not. An updated worker that skips waiting takes control of open pages by definition, which is what makes `controllerchange` fire. What protects an open page is `src/pwa/register-sw.ts` supplying `onNeedReload` so the app owns the reload; `e2e/update-adoption.spec.ts` proves it by publishing a real new build and asserting the page survives.

**`page.waitForFunction` does not await a returned Promise** — it sees a truthy Promise object and resolves immediately. Waiting on service-worker readiness that way silently races, and the test fails later and somewhere else. Use `page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))`, which does await.

## Verification before calling a change done

- `npm test` green, `npm run lint` clean, `npm run typecheck` clean. CI runs all of these, plus `npm run format:check`, `npm run contrast`, the production build, and the Playwright suite, on every push and pull request **that can change what is built, served or migrated**.
- **CI has two tiers, split by path.** A commit touching anything that can change the bundle, the schema or the policies runs the whole suite and gates the publish, exactly as it always has. A commit confined to prose — `docs/`, `openspec/changes|specs|todos/`, `.claude/`, root markdown — runs the `Prose` workflow instead: `format:check`, `lint:todos`, and `lint:specs`, the three gates that genuinely apply, and no database. It publishes nothing, because there is nothing in it to publish. `openspec/tools/` is **not** prose: it is linted JavaScript and takes the full suite. The two path lists are exact complements, so every commit matches at least one tier and none goes unchecked; `scripts/check-workflow-path-tiers.test.mjs` fails if they ever drift apart.
- **Dependency-advisory refreshes** record the vulnerable version and dependency path, whether it is browser-runtime reachable, and the compatible patched resolution. Verify the committed result with a clean `npm ci`, `npm ls` for every affected package, `npm audit`, the focused build/PWA tests, the production build, and the offline-shell/update-adoption browser cases. If no compatible fix exists, document the temporary safety case and a time-bounded review trigger rather than hiding the advisory.
- **Tenancy-touching changes**: the isolation suite passes, including new cases for any new table.
- **Migration changes**: after `db:reset`, run `npm run db:types` and include any generated schema change. Once it is staged, `git diff --exit-code src/data-access/database.types.ts` must be clean; ordinary TypeScript checking cannot detect a stale but internally valid generated snapshot.
- **Billing or offline changes**: the offline E2E path passes.
- **UI changes**: run the app and look at it — phone viewport and tablet viewport, light and dark themes.
- **PWA install changes**: check an eligible Chromium browser, iOS Safari's manual instructions, installed display mode, and an ineligible browser. The app-owned action must survive public-to-real navigation, disappear after use, and remain absent in demo mode.

- **PWA update changes**: `e2e/update-adoption.spec.ts` publishes a real new build by giving the built worker script one more byte, which is the whole of what a new version means to a browser, and asserts both halves — an occupied page is offered the action and is *not* reloaded, an unoccupied one reloads itself. Route interception cannot stand in for this: Playwright can observe the worker-script request but not fulfil it, because the browser rather than the page makes it. Mutating the artefact is safe because each test gets its own browser context and the original bytes are restored afterwards. **A unit test of the registration callbacks is not sufficient coverage here** — the bug this suite exists to catch was in the library's behaviour around callbacks that were themselves correct.
- **Theme changes**: the contrast validator passes. AA is the floor.
- **Schema changes**: migrations apply cleanly to a fresh database *and* to a copy with existing data. A narrowing migration needs an explicit dirty-history fixture proving it aborts rather than silently rewriting rows.
- **Production deployment changes**: Pages depends on the `production-database` migration job; a failed or missing migration credential blocks publication, an up-to-date schema is a no-op, and manual frontend rollback leaves forward migration history untouched.
- **Authentication/identity changes**: run username and associated-email sign-in, first
  activation, established-account reset, verified replacement-session handoff,
  purpose/expiry lifecycle states, atomic promotion/transfer/multi-outlet edit,
  guarded owner change, Mark as left, alias-rename/session-survival,
  hand-crafted email-change and authority refusals, invalid-session redirect,
  offline-session preservation, uniform email-sign-in failure, and all-role
  browser paths. Database and real-HTTP coverage must prove complete rollback,
  stale-edit refusal, final-owner safety, activation replacement, reset
  preservation, and the distinction between `session_invalid`, `forbidden`,
  and no-response transport failure. Transport tests use provider error types
  and response status rather than matching provider message text; they prove a
  received refusal is not mislabeled as unreachable. A migration release additionally runs the local
  `auth:usernames:rehearse` sequence, proves the readiness invariant refuses
  legacy/misaligned identity states and missing owner email, records the
  production postflight, and requires `auth:readiness` before static upload.
- **Password-manager behavior**: inspect the real forms in a normal Chrome
  profile with password saving enabled. DOM names/autocomplete tokens,
  submission and navigation are acceptance evidence; Chrome's optional native
  save prompt is an observation, never a deterministic gate.

### The application root, and resolving the session once

The root is a resolver, so its tests are about which of four states leads where,
not about anything rendered. All four are covered, and the one that earns the
suite is `unavailable`: with a stored session and a failing profile read, the root
must show the retry card and **must not navigate to sign in**. Being sent to a
password field for a session you still hold is the failure mode, and it is
invisible to a happy-path test because both states look like "no session yet".

Two structural properties are pinned rather than assumed, because both are the
kind that a later edit breaks silently:

- **One resolution per visit.** Opening the root as a signed-in person reads
  profile and assignments exactly once, not once for the root and again for the
  shell it hands off to. Asserted as a call count, and confirmed to fail when the
  shell resolves its own session, which is what it used to do.
- **Demo mode resolves no real session.** Mounting any `/demo` path must never
  reach `currentUser`. If the session holder were mounted above the demo branch,
  `getSupabaseClient()` would throw inside the demo tree and `resolveSession`
  would catch it and return `indeterminate` — so the tripwire would fire and be
  swallowed. A silent failure is worth a test that a loud one would not need.

Sign in and activation additionally prove they render **immediately** while the
session is still resolving. They need no session, they sit under the same
provider, and a placeholder in front of a login form would be worse than the flash
this replaced.

### Attendance denial, retries and corrections

An attendance change is not covered by a happy-path component test alone. Run
the reset migration and prove each of these layers:

- migration/backfill preserves approved on-site, approved away, legacy present,
  manual, waiting, late, leave, half-day and rowless days without inventing GPS
  or changing person/date/outlet counts;
- command tests cover default-open and prevented denial, blank reasons,
  outside/unverifiable repeated retry, inside and approved-day locks,
  wrong-outlet recovery, cutover disagreement, stale versions, exact UUID replay
  and changed-payload reuse. `supabase/tests/21_attendance_batch_decisions.sql`
  covers what only a whole set can prove: atomic refusal when one row is stale,
  the hundred-row bound, one row named twice, the enrolled-device condition
  against an otherwise authorised manager, one reading partitioned across two
  outlets, a set spanning two business dates, a closed day inside the fence, an
  unsurveyed outlet, a shared denial reason and retry choice applied per row, a
  denial discarding coordinates it was handed, one command identity across
  several decisions, exact replay settling once, and a spent decision identity
  carried into a new command. Time-correction cases additionally cover historical
  settled rows, repeated old-to-new audit entries, future and cross-cutover
  refusal, immutable attempts, preserved approval/retry state and both directions
  across the stamped late deadline;
- `supabase/tests/26_attendance_server_time.sql` proves a forward- or
  backward-skewed phone timestamp cannot choose the stored time, business date
  or late classification; a positionless arrival has the same server authority;
  exact retries retain their original canonical day across a cutover; and manual
  entry still preserves a manager's chosen historical time. The accompanying
  RLS probe proves the current-context read returns only outlets already in
  scope, while the real PostgREST adapter test proves the existing eight-argument
  submit shape remains accepted and the database, not the browser, overwrites
  its legacy time/date values;
- concurrent approve/deny and retry/decision calls leave one outcome, one current
  attempt, one waiting outlet and complete append-only history;
- RLS and authenticated REST probes include forged actor, unassigned/cross-outlet
  requests, former-manager bounded history, unrelated employee refusal, subject
  full history and owner reach;
- component tests cover selection — no bar until somebody is in a set, the mode
  entered and left by the set itself, only waiting rows selectable, a waiting row
  that cannot be closed, opening a settled row changing no selection, no control
  that adds more than one person by any name, `Clear`, the confirmation naming
  everybody before the write including a set of one from the bar and nobody from
  a per-row button, the confirmation quoting the reason back and stating the
  position reading and the retry choice both ways, cancelling writing nothing,
  the partition summary across two outlets, and a refusal keeping the surviving selection while naming who moved.
  Two of them count calls to the mocked `readPosition`: one action reads exactly
  once however many rows it settles, a second action reads again, and a denial of
  any size reads not at all;
- `e2e/attendance.spec.ts` drives the same rules through Playwright's own
  geolocation emulation rather than any hook in the app — on site, away from
  every outlet, inside one fence and outside another, and with no position at
  all — asserting both what the sheet said beforehand and what each row stored
  afterwards;
- component tests cover the two-input denial sheet, unchecked default,
  editable prefills, no-location denial/absent/retry correction, present
  correction location, the conditional mandatory check-in-time input, employee
  visibility of attributed old-to-new history, compact discoverability, every material-change
  confirmation combination, cancel-without-write and stale reload;
- waiting/notification tests prove retry transfers a count between outlets,
  zero badges stay absent, foreground refresh is fresh and a switched outlet
  never renders the previous outlet's rows under a new label. Employee check-in
  tests additionally pin distinct outlet cutovers, a wildly skewed GPS timestamp
  and foreground refresh: the submitted initial day comes from returned server
  context, and refreshing it does not read location merely because the app was
  brought forward.

Finally walk live and demo at phone and tablet widths in both light and dark:
ordinary row density, approve/deny, denial sheet, retry confirmation,
absent-plus-waiting wording, full history, compact correction action, badges and
multi-outlet switching. Demo network capture must remain within the app origin.

For billing, that walk additionally covers the three-column counter at tablet
and narrow widths, Cash/UPI only, local reference before server numbering,
offline banner, freshness after foreground and a reported change, manager void
with manual re-ring wording, ledger **from counter** labels, and a personal
Biller landing on staff navigation rather than a till.

Payment-correction coverage must include immediate and on-handover payments;
neutral Cash/UPI empty state and unchanged dialog geometry; exact prefilled
splits; the `5 min`, `1 min`, `59 sec` and zero boundaries; unchanged bill
identity; repeated revisions without a deadline reset; stale, late,
wrong-tablet, unsupported-method and bad-arithmetic refusals; effective shift,
drawer, manager-history and ledger totals; Finish day refusal; parent/correction
dependency order; restart with the chain unsent; response loss after each server
commit; and eventual exactly-once settlement. Database tests also prove original
and correction rows reject update/delete and remain outlet-isolated.

## What only the real transport can prove

`supabase/tests/rest/attendance-adapter.test.ts` runs the real adapters against the real stack, and it exists because of a class of bug no other layer can see. A command's payload is an object here and JSON on the wire, so **the mock adapter and the component suites are handed something the database never receives.** A key whose value is `undefined` survives the mock and vanishes over HTTP.

That is not hypothetical. Every attendance check-in and approval taken **without a position** failed in production for as long as those paths existed: with no reading, three coordinate arguments evaluated to `undefined`, JSON dropped them, and PostgREST could not resolve a function that declares no default for them. The screen said "try again in a moment" and nothing was written. Four suites were green throughout — the component tests drove the mock, pgTAP called the functions from SQL where a missing argument is unwritable, Playwright drove demo mode, and the one REST case that passed `reading: null` asserted only that it rejected, which it did, for the wrong reason.

Three habits follow, and they generalise past attendance:

- **Cover the empty and unknown variant of every command over the real transport**, not only the happy one with every field populated.
- **Assert refusals by error code, never by "it rejected".** A bare rejection cannot tell a policy refusing from an app incapable of asking.
- **A command test that never leaves the process proves the object, not the request.**

## Fixtures

- **Never use real customer or employee data.** Seed data is synthetic: invented names, obviously fake phone numbers.
- The seed set covers the real menu and both real outlets, because those are business facts rather than personal data.
- Seeds must produce at least two outlets. A single-outlet fixture set cannot catch isolation bugs, which is the whole point of having them.
- **A test that reads the demo store reads its dates from the store.** `createDemoStore` resolves today from the wall clock and materialises every seed as a `daysAgo` offset from it, so a date written down in a test is today on the day somebody types it and a seeded day the morning after. Ask for `store.today` and `store.businessDate(n)`; bind the input builders to the store so a date cannot be got wrong by omission. Where a test needs a date that is deliberately in the past, derive it backwards from the day under test rather than forwards — the day after yesterday is today, which is only in the past for part of the day. Pinning the clock with `vi.setSystemTime` is for a test whose subject *is* a particular moment, not a way to stop a suite rotting.
- **Give a dated row one clock.** `current_date` is the database's UTC calendar date; a business date is an IST day that opens at the outlet's 04:00 cutover. For the ninety minutes between 04:00 and 05:30 IST the two are a day apart, so a row that takes its `business_date` from `app_business_date(now(), …)` and its timestamp from `now() - interval 'N days'` is describing two different days for that hour and a half every night. `validate_business_date` refuses the mismatch, or the row lands on a date the seed already holds and one row per person per day refuses it instead. State the business date the row belongs to and build its timestamp from that date, or take both from the same call. A suite that is green at 17:00 and red at 04:30 is a suite that fails whenever somebody pushes late.

## Honesty

If a gate was not run, say so. A change reported as verified when the offline path was never exercised is worse than one reported as unverified — it spends trust that has to be repaid later, usually at a counter with a customer waiting.
