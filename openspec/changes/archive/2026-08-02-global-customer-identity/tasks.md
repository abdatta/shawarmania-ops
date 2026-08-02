## 1. Migration preflight and global schema

- [x] 1.1 Add a read-only migration preflight for customer row count, invalid phones, equivalent duplicates, and conflicting duplicates without printing PII.
- [x] 1.2 Add canonical Indian-phone normalization and tests for accepted presentation variants and invalid/incomplete input.
- [x] 1.3 Migrate equivalent duplicates and foreign keys deterministically, abort conflicts, remove outlet/aggregate columns, and enforce one non-null globally unique canonical phone.
- [x] 1.4 Rewrite synthetic seeds and regenerate database types.

## 2. Narrow access paths

- [x] 2.1 Revoke direct customer-table access from outlet roles and machine sessions and add exact complete-phone lookup with minimal response fields.
- [x] 2.2 Add per-device/caller lookup rate bounds whose telemetry contains no raw/reversible phone PII.
- [x] 2.3 Add concurrency-safe create-or-get behavior that creates new phones automatically and never updates an existing profile from billing.
- [x] 2.4 Add the separate SA management read boundary without adding a profile-editing UI.

## 3. Tenancy and adapter contract

- [x] 3.1 Classify customers explicitly as global in the catalog-driven isolation suite and keep every customer-linked transaction outlet/child-scoped.
- [x] 3.2 Prove by hand-crafted DB/RLS requests that FA/Biller/device cannot list, prefix-search, direct-select, or use a known customer ID to read another outlet's transactions.
- [x] 3.3 Add typed lookup/create adapter methods with phone validation and no Supabase import from screens.
- [x] 3.4 Test concurrent first creation, existing-name conflict, exact lookup, rate refusal, SA access, and no cross-outlet bill leakage.

## 4. Documentation and verification

- [x] 4.1 Update `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/SCREENS.md`, and `docs/LIMITATIONS.md`, including the franchise shared-directory disclosure before #14.
- [x] 4.2 Update the data-retention interaction without prematurely promoting the general retention change.
- [x] 4.3 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [x] 4.4 Run `npm run db:start && npm run db:reset`, `npm run test:db`, `npm run test:rls`, and the relevant real-auth E2E path.
- [x] 4.5 PHASE GATE: one normalized phone identifies one global customer; billing can retrieve it only by complete exact phone; outlet roles cannot enumerate customers or read another outlet's transactions.

## Decisions recorded during implementation

- **Eligibility is `app_may_look_up_customer()`, and #9 tightens it.** The design
  says lookup requires "an active device and billing grant", but the daily
  billing grant does not exist until `counter-devices-and-offline` (#9), and this
  change depends only on #2 and #22. Eligibility today is therefore an unrevoked
  enrolled device **or** an account holding a live `biller` assignment — which is
  exactly the set of sessions that can ring a bill right now, given that billers
  still sign in personally (`docs/LIMITATIONS.md`). It is a named function rather
  than an inline clause so #9 adds one conjunct in one place.
- **A leading-zero trunk prefix (`09876543210`) is refused**, not normalized. The
  design lists three accepted shapes; adding a fourth would widen an identity
  rule on a guess. Refusing costs one retype, and a wrong normalization would
  merge two strangers.
- **`last_used_at` is moved by `customer_create_or_get`, and by nothing else.**
  The exact-lookup path deliberately does not touch it, so no caller can mark
  activity on a profile just by asking about it. The spec's "SHALL NOT change
  saved profile values" is read as name and phone; no billing caller can read
  `last_used_at` back.
- **`customers_phone_key` is a table constraint, not a bare unique index**, so
  `customer_create_or_get` can name it in `on conflict on constraint`. A bare
  `on conflict (phone)` is ambiguous against the function's own `phone` output
  column, and Postgres reports that at call time rather than at creation time.
