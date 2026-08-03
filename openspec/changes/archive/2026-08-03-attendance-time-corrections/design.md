## Context

Attendance attempts are immutable evidence. A settled day points at an outcome attempt and copies its time into `attendance.check_in_at` as the canonical read model used by every attendance surface and lateness calculation. Manager corrections are append-only `attendance_decisions`, but they currently change only outcome or retry state and the contract explicitly forbids inventing another arrival time.

The requested correction is administrative testimony about when the person actually arrived, not a replacement phone/GPS claim. It therefore needs to change the effective read-model time while preserving the original attempt and its evidence.

## Goals / Non-Goals

**Goals:**

- Let a Super Admin correct any settled arrival time and a Franchise Admin correct one at their assigned outlet.
- Support historical settled days and repeated corrections.
- Preserve the original attempt while recording every previous/effective time, actor, database time, and reason.
- Recompute all derived readings, especially lateness, from the latest effective time.
- Keep the command idempotent, race-safe, and enforced at the database boundary.

**Non-Goals:**

- Editing an immutable attempt or its GPS/manual evidence.
- Moving attendance to another outlet, person, business date, or arrival-deadline rule.
- Correcting a waiting attempt or expanding correction authority.
- Introducing a generic audit service.

## Decisions

### D1. Append a time-correction decision and update only the canonical effective time

Add `correct_time` to `attendance_decision_kind` and nullable `previous_check_in_at` / `new_check_in_at` `timestamptz` columns to `attendance_decisions`. A successful correction appends one decision and updates `attendance.check_in_at`; it never updates `attendance_attempts.attempted_at`, source, location, or enterer.

This keeps the original evidence independently readable while allowing existing screens and lateness calculations to consume the effective value without a second query or client-side event fold.

Rejected alternatives:

- Updating `attendance_attempts.attempted_at` destroys evidence and contradicts its immutability guard.
- Appending a synthetic manual attempt falsely claims a second arrival and either loses or misrepresents the original GPS evidence.
- Computing effective time by folding decisions in every client duplicates domain logic and makes old clients disagree with new ones.

### D2. Extend the existing correction command and adapter action

Extend `attendance_correct` with an optional corrected timestamp and add `time` to the typed correction action. The command remains keyed by a client UUID and expected state version. For `time`, it requires a non-null value; for every other action, it refuses one. The decision records the current and replacement time and keeps `previous_status` and `new_status` equal.

The existing `Correct attendance` sheet adds `Change check-in time`; selecting it conditionally reveals the mandatory time input. The existing mandatory reason applies unchanged.

Rejected alternative: a second RPC would duplicate authorisation, locking, idempotency, and stale-state rules that already define one correction boundary.

### D3. Validate business time in Postgres

The database requires a settled record with an outcome attempt and a current effective time. The replacement must not be in the future and `app_business_date(replacement, outlet.business_day_cutover)` must equal the row's explicit `business_date`. Historical dates remain valid; "future" is checked against database time.

The client converts the selected Asia/Kolkata wall time with the existing business-day/cutover helper for immediate feedback, but the database is authoritative.

### D4. Keep tenancy and visibility unchanged

The command re-derives the actor from `auth.uid()`: owner across outlets, Franchise Admin only through `app_has_role_at('franchise_admin', outlet_id)`. No new table or RLS policy is required. Employees retain read access to their own decision history, so the original and corrected time are visible to the person affected.

### D5. Preserve evidence while labeling effective time clearly

The primary `Arrived` reading and all late/tally calculations use `attendance.check_in_at`. History continues to show the immutable attempt at its captured time and adds a decision entry describing `old time → new time`, actor, decision time, and reason. The correction does not alter approval evidence or status.

## Risks / Trade-offs

- **A correction can change whether a day is tagged late** → Derive lateness solely from the canonical corrected time and the attempt's stamped deadline; test both directions.
- **The primary event combines corrected time with original location evidence** → History explicitly distinguishes the captured attempt from the effective-time correction; source and coordinates remain untouched.
- **Concurrent corrections could overwrite one another** → Keep expected-version locking and increment `state_version` for every successful correction.
- **An admin could move a time across the midnight cutover accidentally** → Validate the replacement against the explicit business date using the recorded outlet's cutover.
- **Postgres enum changes are forward-only in ordinary rollback** → Roll back application use first; leave the enum value/nullable columns in place if database rollback is required.

## Migration Plan

1. Add the enum value and nullable audit columns with constraints.
2. replace the correction RPC with the extended signature and grants.
3. Regenerate database types and deploy the compatible client changes.
4. No backfill is needed because existing decisions are not time corrections.

## Open Questions

None. Product decisions are fixed: historical records are eligible, only settled records can be corrected, and existing owner/outlet-admin authority remains.
