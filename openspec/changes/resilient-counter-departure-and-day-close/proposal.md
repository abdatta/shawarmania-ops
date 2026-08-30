# Proposal: Resilient Counter Departure And Day Close

> **Model**: GPT-5.6 Sol · **Wave**: D · **Depends on**: #45 · **Gate**: Finish Day always opens one truthful readiness sheet, drains before deciding, explains every hard blocker and never waits out a tender-edit countdown; remote Leave counter ends the phone holder immediately while the tablet keeps delivering old work without a shift; a sale durably recorded after that remote departure is accepted exactly once under the departed shift's last-known operator context with an immutable after-departure flag, is never inherited by the next operator, remains financially included, and appears only in manager/owner audit—not as Priya's alert.

## Why

Production exposed three separate views of one tablet that did not agree. The
owner saw three unresolved operations, the counter showed no actionable warning,
and Finish Day refused without saying which local records were blocking or how
to clear them. The same lifecycle has a more serious attribution gap: an
operator can leave from their phone while the tablet is offline, so the tablet
may durably accept later sales under its last-known shift before learning that
the shift ended. Refusing those commands later hides money that was genuinely
taken; assigning them to the next operator blames somebody who was not there.

## What Changes

- Replace the opaque Finish Day attempt with a readiness sheet that immediately
  drains, obtains authoritative online state, separates hard blockers from the
  still-open tender-edit convenience, and names a resolution for every blocker.
- Make the five-minute tender-edit window advisory at day finish. An operator may
  review recent payments, keep billing, or finish immediately; finishing closes
  that edit opportunity but bypasses no unsent work, needs-attention command,
  open order, or unavailable server check.
- Rename the phone action to **Leave counter**, explain that it ends authority
  immediately, and keep ordinary **Hand over** on the tablet as the gap-free
  operator-change path.
- Keep the device-level outbox drain and telemetry reporter mounted when the
  tablet has no live shift, while keeping every new-work control unavailable.
- Accept delayed commands created after an `operator` remote end and before the
  next shift or cutover, preserve the departed shift and operator as last-known
  context, and stamp an immutable after-departure exception. A removed tablet,
  cutoff, deliberate Finish Day, or command overlapping a later shift remains
  refused.
- Include flagged bills in revenue and drawer figures. Never reassign them on a
  later sign-in. Exclude them from the incoming operator's My Shift and surface
  them in manager/owner billing history for explicit attributed review.
- Let an authorised manager/owner confirm the original operator, name another
  eligible person, or record that the operator cannot be established. Preserve
  the original flag and append the review rather than rewriting history.

## Capabilities

### Modified Capabilities

- `billing-delivery`: device-level background drain, explanatory Finish Day
  readiness, and a non-blocking tender-edit advisory.
- `billing-command-contract`: classified acceptance and immutable audit metadata
  for post-remote-departure delayed commands.
- `counter-device-sessions`: Leave counter semantics, handover distinction, and
  the exact boundary between the departed and incoming shifts.
- `counter-billing`: manager-visible attribution exceptions and append-only review.

## Impact

The billing command helper and end-of-day RPC, counter-shift end reasons, bills
and command receipts, a new attribution-review table/RPC, RLS tests, generated
types, live and mock adapters, the counter root/runtime, phone handshake card,
Finish Day sheet, manager billing history, and offline/browser coverage change.
No customer payload is added to command receipts or tablet telemetry.

## Non-goals

- Silent reassignment to the next operator.
- Letting a removed tablet, expired shift, or deliberately finished day continue
  creating valid work.
- Making the incoming operator acknowledge or resolve another shift's exception.
- Treating an attribution exception as an unresolved financial command or hiding
  it from the day's takings.
- Offline approval of a new operator or offline start of a new business day.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/OFFLINE_AND_SYNC.md`,
`docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, `docs/OPERATIONS.md`,
`docs/TESTING.md`, and `docs/LIMITATIONS.md`.
