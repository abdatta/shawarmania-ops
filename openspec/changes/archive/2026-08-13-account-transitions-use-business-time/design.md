## Context

The People editor already sends new assignment start dates in Asia/Kolkata. Its atomic database commands currently end replaced assignments with PostgreSQL `current_date`, whose value follows the database session timezone. Between 00:00 and 05:30 IST that is the preceding UTC date, so ending an assignment started on the Kolkata date violates the assignment date-range check and rolls back the command.

This is a forward-migration correction to security-sensitive account commands, so the database, RLS/HTTP, and live-backend auth gates all remain required even though authority policy does not change.

## Goals / Non-Goals

**Goals:**

- Use one explicit Asia/Kolkata calendar date for every assignment ended by the two atomic account-transition commands.
- Prove the boundary independently of wall-clock test execution.
- Preserve transactional rollback, assignment history, authority checks, and account-active-state behavior.

**Non-Goals:**

- Make assignment timezone configurable by outlet.
- Change attendance business-day cutovers or operational business dates.
- Change RLS, account Edge payloads, adapters, or UI.

## Decisions

### D1. Transition functions carry an explicit database-local timezone

Each service-only transition function receives a function-local `TimeZone=Asia/Kolkata` setting. PostgreSQL applies that setting for the invocation, so the existing transaction-stable `current_date` expressions use the Kolkata calendar and every ended row in one atomic command receives the same date. Applying configuration to the functions preserves their bodies, signatures, locks, grants, and security guards byte-for-byte.

The state fingerprint function receives its own function-local `TimeZone=UTC`. A live invitation contributes a `timestamptz` to the opaque JSON digest; canonical UTC prevents the same account state from hashing differently when the fingerprint is computed before the command and again inside its Kolkata-scoped transaction.

**Rejected:** send the end date from the browser. That would make a client-controlled field part of historical authority and would not repair Mark as left, whose request intentionally carries no date. Also rejected: set the database session timezone globally, which could change unrelated date defaults. Replacing both large function bodies only to change two date expressions creates a wider review and regression surface than a function-local setting.

### D2. The regression controls the transaction clock

The pgTAP proof asserts the deterministic UTC-to-Kolkata boundary conversion, inspects both deployed functions for their local timezone setting, and exercises both transitions with Kolkata-calendar dates while the surrounding test session remains UTC. Existing history and active-state assertions continue to prove the complete commands.

**Rejected:** rely only on the browser E2E failure. It is a valuable end-to-end gate but is time-dependent. The database proof instead fails deterministically when either function loses its Kolkata setting.

### D3. Authority and isolation stay unchanged

The replacement functions retain their existing signatures, grants, row locks, complete-set validation, final-owner guard, and service-only execution. No table or policy changes, no money arithmetic, and no billing/offline semantics are involved.

## Risks / Trade-offs

- **[Function configuration changes timestamp rendering inside stale-state checks]** → Pin the fingerprint helper itself to canonical UTC and prove the same live-invite state hashes identically across the command boundary.
- **[A test clock override fails to affect `now()`]** → Assert the controlled timestamp and derived Kolkata date before exercising the commands.
- **[Production rollback cannot remove a forward migration]** → Keep the migration signature-compatible; any correction is another forward migration while the prior frontend remains compatible.

## Migration Plan

1. Add a forward migration applying a function-local Asia/Kolkata timezone to `edit_account_assignment_set` and `mark_account_as_left`.
2. Add deterministic database regressions for both commands in the UTC/Kolkata gap.
3. Reset and test the complete local stack, regenerate types, and run all frontend/browser gates.
4. Push to `main`; deployment applies the migration before publishing the already-compatible frontend.

## Open Questions

None.
