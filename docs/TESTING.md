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
npm run lint      # ESLint (incl. layer boundaries) + the no-hex-outside-tokens check
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

**Editing an Edge Function? Restart the runtime.** The bundled edge-runtime container caches function modules, so a change to anything under `supabase/functions/` is invisible until `docker restart supabase_edge_runtime_shawarmania-ops` (or a full `db:stop`/`db:start`). A test that keeps failing against code you have already fixed is almost always this.

`npm test` runs `.test.ts` / `.test.tsx` under `src/` in a jsdom environment and `.test.mjs` under `scripts/` in a node environment. The shared setup file guards its DOM work, so the build-tooling suites do not need a second Vitest project to live alongside the app suites.

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
- A revoked counter device **cannot** read or write anything.
- A deactivated account **cannot** read or write anything, without waiting for token expiry.
- An Employee can read **only their own** attendance rows.

**A new outlet-scoped table without a case in this suite is an incomplete change.** The suite enforces this itself: it enumerates the tables from the database catalog and fails, naming the table, on any it cannot classify as outlet-scoped, child-scoped, or tenancy-root, or that lacks Row-Level Security — nobody has to remember.

### 3. The offline path

End-to-end, with the network genuinely disabled rather than mocked away.

- Go offline, ring up several bills, come back online → **exactly** that many bills land, with no duplicates.
- Reload the page mid-queue → the outbox survives and still drains.
- Force a duplicate submission of the same client UUID → one row.
- Bill numbers are assigned by the server, are sequential per outlet, and never collide across two devices.
- A bill settled at 00:20, synced at 09:00, carries the **previous** business date.
- A malformed bill is quarantined and surfaced, not silently dropped.

The app-shell half of this already runs (`e2e/offline.spec.ts`): load, install the worker, cut the network, reload, and assert the shell and its self-hosted fonts still render. Two details there are worth knowing before writing more offline tests.

**A worker must control the page before it intercepts anything.** `clientsClaim` is deliberately off, so the worker installed on the first load does not take over that page — it serves from the next load onward. That is the safe choice: a worker claiming an open page would, on an update, start serving new-build assets to old-build code mid-shift. Offline tests therefore prime with an online load, a reload, and only then go offline.

**`page.waitForFunction` does not await a returned Promise** — it sees a truthy Promise object and resolves immediately. Waiting on service-worker readiness that way silently races, and the test fails later and somewhere else. Use `page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))`, which does await.

## Verification before calling a change done

- `npm test` green, `npm run lint` clean, `npm run typecheck` clean. CI runs all of these, plus `npm run format:check`, `npm run contrast`, the production build, and the Playwright suite, on every push and pull request.
- **Tenancy-touching changes**: the isolation suite passes, including new cases for any new table.
- **Migration changes**: after `db:reset`, run `npm run db:types` and include any generated schema change. Once it is staged, `git diff --exit-code src/data-access/database.types.ts` must be clean; ordinary TypeScript checking cannot detect a stale but internally valid generated snapshot.
- **Billing or offline changes**: the offline E2E path passes.
- **UI changes**: run the app and look at it — phone viewport and tablet viewport, light and dark themes.
- **PWA install changes**: check an eligible Chromium browser, iOS Safari's manual instructions, installed display mode, and an ineligible browser. The app-owned action must survive public-to-real navigation, disappear after use, and remain absent in demo mode.
- **Theme changes**: the contrast validator passes. AA is the floor.
- **Schema changes**: migrations apply cleanly to a fresh database *and* to a copy with existing data.
- **Production deployment changes**: Pages depends on the `production-database` migration job; a failed or missing migration credential blocks publication, an up-to-date schema is a no-op, and manual frontend rollback leaves forward migration history untouched.
- **Authentication/identity changes**: run username and associated-email sign-in, three-field
  activation, admin reset, alias-rename/session-survival, hand-crafted
  email-change refusal, uniform email-sign-in failure, no-response transport
  classification, and all-role browser paths. Transport tests use provider
  error types and response status rather than matching provider message text;
  they prove a received refusal is not mislabeled as unreachable. A migration
  release additionally runs the local
  `auth:usernames:rehearse` sequence, proves the readiness invariant refuses
  legacy/misaligned identity states and missing owner email, records the
  production postflight, and requires `auth:readiness` before static upload.
- **Password-manager behavior**: inspect the real forms in a normal Chrome
  profile with password saving enabled. DOM names/autocomplete tokens,
  submission and navigation are acceptance evidence; Chrome's optional native
  save prompt is an observation, never a deterministic gate.

### Attendance denial, retries and corrections

An attendance change is not covered by a happy-path component test alone. Run
the reset migration and prove each of these layers:

- migration/backfill preserves approved on-site, approved away, legacy present,
  manual, waiting, late, leave, half-day and rowless days without inventing GPS
  or changing person/date/outlet counts;
- command tests cover default-open and prevented denial, blank reasons,
  outside/unverifiable repeated retry, inside and approved-day locks,
  wrong-outlet recovery, cutover disagreement, stale versions, exact UUID replay
  and changed-payload reuse. Time-correction cases additionally cover historical
  settled rows, repeated old-to-new audit entries, future and cross-cutover
  refusal, immutable attempts, preserved approval/retry state and both directions
  across the stamped late deadline;
- concurrent approve/deny and retry/decision calls leave one outcome, one current
  attempt, one waiting outlet and complete append-only history;
- RLS and authenticated REST probes include forged actor, unassigned/cross-outlet
  requests, former-manager bounded history, unrelated employee refusal, subject
  full history and owner reach;
- component tests cover the exactly-two-input denial sheet, unchecked default,
  editable prefills, no-location denial/absent/retry correction, present
  correction location, the conditional mandatory check-in-time input, employee
  visibility of attributed old-to-new history, compact discoverability, every material-change
  confirmation combination, cancel-without-write and stale reload;
- waiting/notification tests prove retry transfers a count between outlets,
  zero badges stay absent, foreground refresh is fresh and a switched outlet
  never renders the previous outlet's rows under a new label.

Finally walk live and demo at phone and tablet widths in both light and dark:
ordinary row density, approve/deny, denial sheet, retry confirmation,
absent-plus-waiting wording, full history, compact correction action, badges and
multi-outlet switching. Demo network capture must remain within the app origin.

## Fixtures

- **Never use real customer or employee data.** Seed data is synthetic: invented names, obviously fake phone numbers.
- The seed set covers the real menu and both real outlets, because those are business facts rather than personal data.
- Seeds must produce at least two outlets. A single-outlet fixture set cannot catch isolation bugs, which is the whole point of having them.
- **Give a dated row one clock.** `current_date` is the database's UTC calendar date; a business date is an IST day that opens at the outlet's 04:00 cutover. For the ninety minutes between 04:00 and 05:30 IST the two are a day apart, so a row that takes its `business_date` from `app_business_date(now(), …)` and its timestamp from `now() - interval 'N days'` is describing two different days for that hour and a half every night. `validate_business_date` refuses the mismatch, or the row lands on a date the seed already holds and one row per person per day refuses it instead. State the business date the row belongs to and build its timestamp from that date, or take both from the same call. A suite that is green at 17:00 and red at 04:30 is a suite that fails whenever somebody pushes late.

## Honesty

If a gate was not run, say so. A change reported as verified when the offline path was never exercised is worse than one reported as unverified — it spends trust that has to be repaid later, usually at a counter with a customer waiting.
