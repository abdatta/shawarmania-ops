# Proposal: Counter Device And Local Durability

> **Model**: Fable · **Wave**: D · **Depends on**: #4, #21, #22, #24, #26, #30 · **Gate**: each outlet enrolls exactly one billing device; it reaches only its billing context; normal credentials create a daily billing grant without retaining personal authority; revocation is immediate and locally accepted writes survive logout and restart.

## Why

The initial counter needs a trusted outlet machine without turning an FA or SA
login into a reusable personal admin session. It also needs the smallest durable
local foundation that prevents a transient request failure from losing money.

## What Changes

- Let an FA enroll the current device for their outlet and an SA enroll one for
  any outlet; enforce at most one active registered billing device per outlet.
- Replace the personal session after enrollment with a long-lived machine
  credential and a billing-only shell.
- Replace counter PINs with normal username/password verification that creates
  a device-, outlet-, operator-, and business-day-bound billing grant without
  persisting the person's ordinary session.
- Preserve one assignment per person/outlet while making `biller` include
  Employee attendance capabilities on personal devices.
- Permit outlet Billers, that outlet's FA, and any SA to open a billing grant;
  ordinary Employees cannot.
- Expire the operator grant at cutoff and require online reauthentication;
  device registration persists until revoked.
- Add device status, last-seen and pending-count telemetry, immediate revocation,
  and authenticated upload-only recovery for historically valid accepted writes.
- Establish a versioned IndexedDB operation store that commits locally before
  UI success, survives logout/restart, elects one page drain leader, retries
  transient failures, and preserves rejected entries for review.

## Capabilities

### New Capabilities

- `counter-device-sessions`: Enrollment, machine credentials, daily billing
  grants, single-active-device enforcement, revocation, and recovery authority.
- `offline-operation-store`: Durable device-scoped operation storage, queue
  states, local acknowledgement, leader election, and lifecycle persistence.

### Modified Capabilities

- `identity-and-access`: Biller becomes an Employee-capable hierarchy role and
  credential verification may issue a billing-only grant without a personal session.
- `app-shell`: A registered device renders only its billing context regardless
  of the eligible operator's personal role.
- `outlet-tenancy`: Machine credentials and billing grants are outlet-bound;
  revocation and recovery are enforced at the database boundary.
- `counter-billing`: Shift opening uses account credentials instead of a PIN
  and a shift belongs to one device and business day.

## Impact

Auth/session adapters, role capability helpers, enrollment/revocation functions,
device and grant schema, RLS helpers, Counter shell routing, Devices UI,
IndexedDB infrastructure, generated types, seeds, and auth/RLS/E2E tests change.

## Non-goals

- Real order/bill persistence or live menu/customer adapters.
- More than one active billing device per outlet.
- Deliberate offline restart or prolonged offline trading; roadmap change #34
  adds that capability after Billing V1.
- Attendance from the tablet, inactivity auto-lock, or emergency personal-device billing.
- Printing, GST, digital receipts, or partial payments.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/ROLES_AND_PERMISSIONS.md`,
`docs/OFFLINE_AND_SYNC.md`, `docs/OPERATIONS.md`, `docs/SCREENS.md`,
`docs/SECURITY_AND_PRIVACY.md`, and `docs/LIMITATIONS.md`.
