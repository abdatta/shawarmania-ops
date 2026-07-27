# Design: data-model-and-tenancy

## Context

`project-foundations` (#1) left a working scaffold: Vite/React app with a test
harness, `supabase/config.toml` for the local stack (Postgres 17, auth with
signup disabled), CI on GitHub Actions, and a `data-access` layer whose
Supabase client is deliberately untyped, waiting for this change. There are no
migrations, no schema, no policies, and no generated types.

This change is the write contract for everything downstream: the full schema
described in `docs/DATA_MODEL.md`, Row-Level Security on every outlet-scoped
table, the JWT claims hook, generated TypeScript types, seed data for both real
outlets, and an isolation test suite structured so a forgotten policy is caught
by enumeration rather than by memory.

Operating constraints that bind every decision below:

- **Outlet isolation is a database boundary.** A Franchise Admin, Biller or
  Employee session must not read or write another outlet's rows even via a
  hand-crafted API request with a valid session.
- **Money is integer paise (`bigint`), never floats.** Timestamps are
  `timestamptz` (UTC). `business_date` is an explicit `date` column resolved
  from a per-outlet cutover, never derived from a timestamp at read time.
- **Counter writes are idempotent inserts keyed by client-generated UUIDs.**
  Bills are append-only once settled; bill lines snapshot name and price.
- **Everything runs on the local stack.** No hosted project exists yet, and the
  Supabase account contains an unrelated project that must never be linked
  (`docs/OPERATIONS.md`). Nothing in this change may run `supabase link` or
  target a remote project.
- Owner-confirmed outlet parameters (2026-07-26): business-day cutover 04:00
  and geofence radius 150 m for both outlets. Coordinates are not yet captured;
  seeds carry clearly-approximate placeholders (they become load-bearing in
  attendance, #5, not here).

## Goals / Non-Goals

**Goals:**

- Every table, enum, constraint, index and trigger from `docs/DATA_MODEL.md`,
  as numbered migrations under `supabase/migrations/`.
- RLS enabled on **every** table in `public`, with policies implementing the
  capability matrix in `docs/ROLES_AND_PERMISSIONS.md`.
- The custom access-token hook injecting `app_role` and `app_outlet_id`,
  avoiding the RLS recursion trap.
- Server-side per-outlet bill-number allocation, gapless and race-safe.
- Structural enforcement of the two modelling traps: derived figures are
  snapshotted where a human signs off (daily cash) and cached-with-ledger where
  the ledger is truth (inventory).
- Generated TypeScript types wired into the Supabase client, plus a drift gate.
- Synthetic seed data: both real outlets, the real 7-item menu, fake people.
- The isolation suite: pgTAP over every table (enumerated from the catalog, so
  an uncovered table fails the suite) plus REST-level probes with real signed-in
  sessions — the literal roadmap gate.
- CI job running the database suite against a fresh local stack.

**Non-Goals:**

- No UI, no auth *flows* (sign-in screens, provisioning — #4), no device
  enrolment (#9), no outbox or settlement sync path (#9/#10).
- No Edge Functions. The privileged operations that need them (provision
  account, enrol device) belong to the changes that build those flows.
- No customer-aggregate maintenance (`bill_count`, `total_spend_paise` updates
  land with billing-live), no reconciliation-exception surfacing (UI concern),
  no P&L queries.
- No hosted environment. Staging/production provisioning is a later,
  deliberate operations step.

## Decisions

### D1 — Claims in the JWT via a custom access-token hook; status checks via `security definer` helpers

A `public.custom_access_token_hook(event jsonb)` reads `profiles` and injects
`app_role` and `app_outlet_id` into every access token. Policies read the
claims through two tiny stable functions, `app_role()` and `app_outlet_id()`
(`stable`, reading `auth.jwt()`), so no policy ever sub-queries `profiles` for
scope — that is the recursion trap `docs/ARCHITECTURE.md` warns about, and it
would also cost a lookup per row.

Deactivation must take effect **immediately**, not at next token refresh, so
policies additionally call `app_account_active()` — a `security definer`
function that checks `profiles.is_active` for `auth.uid()`, bypassing RLS for
that one lookup. Same pattern for device revocation (D2).

- *Rejected: claims only.* Revocation would wait out the token TTL (up to an
  hour). The roadmap gate for #4 explicitly requires deactivation to bite
  without waiting for expiry; building the schema any other way now would be
  rework then.
- *Rejected: sub-querying `profiles` inside every policy.* Recursion on
  `profiles` itself, and a per-row subquery on every read of every table.

The hook is registered in `supabase/config.toml`
(`[auth.hook.custom_access_token]`), executable by `supabase_auth_admin` only,
and revoked from `authenticated`/`anon` — a client must not be able to call it.

### D2 — A counter device *is* an auth user: `counter_devices.id = auth.users.id`

`profiles.id` already equals `auth.users.id`; counter devices reuse the same
convention. The enrolled tablet's long-lived session belongs to a machine auth
user whose id is the `counter_devices` row id. Billing-table policies then
enforce immediate revocation with `app_device_ok()` (`security definer`):
non-device sessions pass; a session whose uid matches a `counter_devices` row
passes only while `revoked_at is null`.

- *Rejected: a separate `device_user_id` column.* Two ids for one identity,
  and every policy needs a join to translate.
- *Rejected: a device claim in the JWT.* Revocation is the one operation that
  must not wait for token refresh — a lost tablet is a real incident
  (`docs/ROLES_AND_PERMISSIONS.md`).

Enrolment itself (creating the machine user, minting the session) is #9's job;
this change ships the table, the convention, and the policies that make
revocation instant.

### D3 — Bill numbers: per-outlet counter row + `before insert` trigger, in-database

A `bill_number_counters` table (one row per outlet, `last_number bigint`) is
updated with `update … set last_number = last_number + 1 returning` inside a
`before insert` trigger on `bills`. The trigger assigns `bill_number`
unconditionally — a client-supplied value is overwritten, never trusted.

Why this shape:

- **Server-assigned** — two offline tablets cannot agree on a sequence; the
  number is allocated only when the insert reaches Postgres.
- **Gapless** — the counter update and the bill insert commit or roll back as
  one transaction. A failed insert (e.g. a duplicate client UUID retrying —
  the outbox treats the 409 as success) rolls the allocation back too. This is
  what satisfies "no gaps attributable to the client".
- **Race-safe without a lock that hurts** — the cost is a row lock on that
  outlet's counter for the remainder of a single-statement insert transaction,
  milliseconds at worst. At quick-service counter scale (single-digit writes
  per second per outlet at peak) contention is unmeasurable.

- *Rejected: native per-outlet sequences.* Requires dynamic DDL per outlet
  (adding outlet seven must be a data operation, not DDL), and sequences do
  not roll back — every failed retry would burn a number.
- *Rejected: `max(bill_number) + 1`.* Racy under two devices; serializable
  isolation to fix it costs more than the counter row.
- *Rejected: the "issue bill number" Edge Function sketched in
  `docs/ARCHITECTURE.md`.* An extra network hop that cannot be atomic with the
  insert; the trigger gives the same server-side authority with strictly
  better failure behaviour. **This is a deliberate divergence from the
  architecture page — record it in the docs update at archive.**

`unique (outlet_id, bill_number)` stays as the belt-and-braces constraint.

### D4 — `current_quantity` is a trigger-maintained cache; the movements ledger is append-only

An `after insert` trigger on `inventory_movements` (a `security definer`
function, so column grants don't block it) applies `quantity_delta` to
`inventory_items.current_quantity` and stamps `last_updated_at`. Movements are
append-only: no client `update`/`delete` policy, plus a trigger that rejects
both outright so not even a future policy mistake can mutate history. A
correction is a new `correction` movement with a note, exactly as documented.

Clients cannot write `current_quantity` directly: the `update` grant to
`authenticated` on `inventory_items` enumerates every column *except* it.

- *Rejected: a plain view over `sum(quantity_delta)`.* The stock list is a hot
  admin read and the ledger grows without bound; recomputing per read scales
  with history, not with the menu.
- *Rejected: a materialized view.* Needs refresh orchestration and is stale
  between refreshes — worse than a transactional trigger on every axis here.

The invariant (`current_quantity = sum(deltas)`) is asserted in the test suite,
which is only meaningful because the ledger is genuinely append-only.

### D5 — Signed-off figures are snapshotted structurally: day close is an RPC, and clients cannot write the snapshot table

`daily_cash_records` can only be written through `close_business_day(outlet,
business_date, opening_cash_paise, actual_closing_paise, notes)` — a
`security definer` RPC that, inside one transaction:

1. asserts the caller is an **active Franchise Admin of that outlet** (the
   capability matrix gives day-close to Franchise Admins only — deliberately
   not even the Super Admin);
2. computes `cash_sales_paise` (settled `cash` bills), `cash_expenses_paise`
   (`cash` expenses) and `cash_withdrawn_paise` for that outlet and business
   date **server-side**;
3. writes the snapshot with `expected_closing` and `difference` derived from
   the invariant, and rejects a duplicate close for the same day.

There are **no** client `insert`/`update` policies on `daily_cash_records`;
the RPC is the only path. `check` constraints pin the arithmetic
(`expected = opening + sales − expenses − withdrawn`,
`difference = actual − expected`) so even a future privileged writer cannot
store an inconsistent record. A late-syncing bill changes nothing already
signed off — it is visible as an exception precisely because the record does
*not* recompute (surfacing it is a UI concern for a later change).

- *Rejected: client-computed snapshot validated by trigger.* The validation
  would recompute server-side anyway; accepting the client's copy adds a
  trust-the-client seam for the one number a human signs their name to.
- *Rejected: recompute on read.* Explicitly the trap documented in
  `docs/DATA_MODEL.md` — a late bill silently rewriting a counted drawer.

Bills get the same structural treatment: an `update` trigger permits only the
`settled → void` transition and only the void columns (`status`, `voided_by`,
`voided_at`, `void_reason`); every other column is frozen at settlement, and
`delete` is denied to all client roles. `bill_items` are immutable once
written. Voiding is role-gated by policy (Franchise Admin own outlet, Super
Admin anywhere).

### D6 — `profiles` and `employees` stay separate (settled once, here)

The proposal asks for this seam to be examined once. Examined: they do not
merge. `employees` is the HR roster — salary, employment status, joining date
— and a roster row must exist before, or entirely without, an app login
(`profile_id` is nullable). `profiles` is the auth mirror — role, outlet,
active flag — read by the token hook on every sign-in and by
`app_account_active()` on every policy check. Merging would put salary PII in
the row every auth path touches, force the hook through HR data, and make
"person who can log in" and "person on the payroll" the same thing when the
business says they are not. `employees.profile_id` is `unique` where not null;
that FK is the entire coupling.

### D7 — `business_date` is validated at write time against the outlet cutover

A trigger on `bills` (and `shifts`, `attendance` via the same function)
validates that the stated `business_date` equals the date obtained by shifting
`created_at` (client clock — the same clock the device resolved the date from)
into Asia/Kolkata and subtracting the outlet's `business_day_cutover`. A
mismatch is a malformed write and is **rejected**, not repaired — the server
never rewrites what the device asserted; it refuses what cannot be true.
This encodes the integrity check listed in `docs/DATA_MODEL.md` as a
constraint rather than a hope. The timezone is fixed app-wide
(`Asia/Kolkata`), so the rule is deterministic.

### D8 — Postgres enums for every constrained value

`app_role`, `payment_method`, `pricing_mode`, `bill_status`, `movement_type`,
`inventory_unit`, `expense_category`, `attendance_status`, `check_in_source`,
`employment_status`, `alert_category`, `alert_priority`, `alert_status` — as
in `docs/DATA_MODEL.md`. An invalid value is a constraint violation, and the
generated TypeScript types carry the unions into every mock downstream.
Adding a value later is `alter type … add value`, which is online-safe.

### D9 — The isolation suite is pgTAP with catalog enumeration, plus REST probes with real sessions

Two layers, because they prove different halves of the gate:

**Layer 1 — pgTAP (`supabase/tests/*.sql`, run by `supabase test db`).**
Exhaustive per-table matrix using PostgREST's exact mechanism: `set local role
authenticated; set local request.jwt.claims = '<claims json>'`. For every
outlet-scoped table and every scoped role: outlet-A session reads zero
outlet-B rows; cross-outlet insert/update is denied (including supplying B's
`outlet_id` directly); Super Admin reads across; a revoked device and a
deactivated account are blocked without token expiry; an Employee reads only
their own attendance.

**Coverage is enumerated, not remembered**: a test derives the outlet-scoped
table list from the catalog (`information_schema.columns where column_name =
'outlet_id'` plus the child tables `bill_items` and `alert_responses`, which
scope through their parent FK), asserts every `public` table has RLS enabled
**and** appears in the suite's explicit coverage list, and fails on any table
it cannot classify. Adding a table without extending the suite fails CI.

**Layer 2 — REST probes (Vitest, `npm run test:rls`).** Signs in seeded users
through real GoTrue password grants and issues hand-crafted PostgREST requests
(explicit `outlet_id` filters and payloads for the *other* outlet) with the
resulting JWTs. This is the roadmap gate stated literally: a valid Franchise
Admin session, a hand-crafted request, zero rows back. It also proves the
token hook actually ran (claims present in a decoded real token), which pgTAP
by construction cannot.

- *Rejected: Vitest/REST only.* Cannot enumerate tables from the catalog
  cheaply, needs a signed-in session per role per case, and is an order of
  magnitude slower — the exhaustive matrix belongs in the database.
- *Rejected: pgTAP only.* Simulated claims prove policy logic, not that the
  deployed auth stack injects those claims into real tokens.

Both run in a new CI job (`db`): `supabase start` → `supabase test db` →
`test:rls` → types-drift check. The CLI is a pinned devDependency so local
and CI always run the same version. Ubuntu runners have Docker; the job is
independent of the existing `verify`/`e2e` jobs.

### D10 — Generated types are committed, wired in, and drift-gated

`npx supabase gen types typescript --local` writes
`src/data-access/database.types.ts` (committed — mocks and adapters import it
without needing a running stack). `getSupabaseClient()` becomes
`SupabaseClient<Database>`. New npm scripts: `db:start`, `db:reset`,
`db:types`, `test:db`, `test:rls`. The CI `db` job regenerates types and fails
on `git diff` — a migration that changes the schema without refreshing the
committed types cannot merge. This is the compile-time seam the whole UI
programme leans on: a mock that drifts from the schema fails to compile.

### D11 — Seed data is synthetic, two-outlet, and includes real business facts only

`supabase/seed.sql` seeds: both real outlets (owner-confirmed 04:00 cutover,
150 m radius; **placeholder coordinates clearly marked** — real ones are
captured standing at each counter before #5); the real 7-item menu in paise
(₹139–₹250, veg/non-veg modelled); synthetic people with obviously fake names,
contact details, and example.com emails; auth users (via `auth.users` inserts
with hashed passwords, local-only, email pre-confirmed) for: one Super Admin,
one Franchise Admin per outlet, one enrolled
device per outlet, one Employee per outlet — the personas the REST probes sign
in as; a deactivated account, a revoked device, and a second outlet's worth of
every scoped record so isolation tests have something real to fail against;
sample bills/shifts/movements/expenses/attendance/withdrawals and one closed
day per outlet exercising every enum.

Real outlet facts (addresses, cutover, radius, menu, prices) are business
facts, not PII, and belong in seeds per `docs/TESTING.md`. No real person, no
real customer, no real coordinates.

## Risks / Trade-offs

- **[Trigger-heavy schema — behaviour hidden from the caller]** → Every
  trigger has explicit pgTAP cases (allocation, cache maintenance, append-only
  rejection, business-date validation, void transition), and
  `docs/DATA_MODEL.md` is updated at archive to document each. No trigger
  contains business policy beyond what a constraint could not express.
- **[`security definer` functions widen the attack surface]** → All definer
  functions are small, single-purpose, `set search_path = ''`, owned by
  `postgres`, and `execute` is revoked from `public`/`anon` (and from
  `authenticated` where only auth internals call them, e.g. the hook).
- **[Simulated claims in pgTAP could drift from real GoTrue tokens]** → The
  REST-probe layer signs in for real and decodes the real token; drift fails
  there. The claim *names* live in one place (`app_role()`/`app_outlet_id()`).
- **[Per-outlet counter row serializes settlement within an outlet]** →
  Accepted: the lock spans a single-statement transaction at single-digit
  writes/sec. If a franchise ever rings hundreds of bills a second, revisit
  with a proposal (allocation is one trigger function to swap).
- **[Seeded auth users with known passwords in the repo]** → Local stack only;
  signup is disabled; phones are obviously fake; production provisioning is an
  Edge Function with real secrets in #4. Seeds never run against a hosted
  project in this change (none exists, and linking is forbidden).
- **[CI now depends on Docker + Supabase start time]** → Isolated in its own
  job so lint/unit feedback speed is unchanged; CLI pinned via
  `supabase/setup-cli`; the stack is started once per run.
- **[Placeholder outlet coordinates in seeds]** → Marked in-row (comment) and
  already tracked in `docs/BUSINESS_CONTEXT.md`; they gate #5, not this
  change.
- **[Postgres 17 vs pgTAP availability]** → `supabase test db` provisions
  pgTAP in the local image; verified during implementation before writing the
  suite (fallback: plain-SQL assertion scripts run through `psql`, same
  enumeration structure).

## Migration Plan

Numbered migrations under `supabase/migrations/`, applied in order by
`supabase db reset` (fresh) and `supabase migration up` (incremental):

1. Extensions & enums.
2. Helper functions (`app_role`, `app_outlet_id`, `app_account_active`,
   `app_device_ok`) and the access-token hook (+ `config.toml` registration).
3. Tables in dependency order — outlets → profiles → counter_devices → menu →
   customers → shifts → bills → bill_items → inventory → expenses → employees
   → attendance → cash → alerts — each with its indexes, constraints, RLS
   **enabled in the same migration**, and its policies. (Not `force row level
   security`: the owner-bypass is what lets seeds and the `security definer`
   helpers work; clients never connect as the owner.)
4. Triggers: bill-number allocation (+ counter table), inventory cache,
   append-only guards, void transition, business-date validation,
   `updated_at`.
5. `close_business_day` RPC and grants cleanup (revoke what clients must not
   touch, column-scoped grants for `inventory_items`).
6. `seed.sql`.

Rollback: pre-production, so roll-forward only; local recovery is
`supabase db reset`. The "applies to a copy with existing data" gate from
`docs/TESTING.md` is trivially true (no existing database), but migrations are
still written to be order-safe for the hosted future. **At no point is any
remote project linked or touched.**

## Open Questions

- The exact `config.toml` stanza for registering the hook on CLI 2.109
  (`[auth.hook.custom_access_token]` with a `postgres://` function URI) —
  verified against the running CLI during implementation, not guessed.
- Whether `supabase test db` on CI needs the seed applied first (REST probes
  do; pgTAP builds its own fixtures inside a transaction where possible) —
  settled during implementation; both orderings are supported by the CLI.

## Settled during implementation

Facts the running stack decided, recorded so nobody re-litigates them from
memory:

- **Clients get no data privileges by default.** The current Supabase images
  ship hardened default ACLs: new tables in `public` grant `authenticated`
  nothing usable. Every client capability is therefore an explicit grant in
  the final migration — a deliberate verb manifest under the RLS row
  boundary. DELETE is granted nowhere.
- **Auth identifier is email, not phone (owner-confirmed 2026-07-26).** The
  documented phone+password model turned out to require a configured SMS
  provider just to allow password *sign-in* (GoTrue's provider flag gates
  both), forcing a dummy-Twilio workaround. When this surfaced, the owner
  chose email+password instead: admin-provisioned accounts with the address
  pre-confirmed, no mail ever sent, and self-service password reset becomes
  possible later. Google OAuth can be layered onto the same email identity
  in auth-and-roles (#4). Seeds, local auth config, and the REST probes use
  email; `profiles.phone` remains as plain contact data. The auth sections
  of `docs/ROLES_AND_PERMISSIONS.md` and `AGENTS.md` are amended when this
  change archives.
- **`bills.bill_number` carries `default 0`.** The allocation trigger
  overwrites it unconditionally; the default exists only so the generated
  Insert types treat the column as server-supplied. Without it, every
  client (the offline outbox above all) would be forced to invent a number
  just to satisfy the type.
- **The generated types file is prettier-ignored.** It must stay
  byte-identical to what `npm run db:types` emits or the CI drift check
  would fight the formatter.
