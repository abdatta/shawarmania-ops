# Proposal: Multiple Billing Devices

> **Model**: Opus · **Wave**: D · **Depends on**: #34 · **Gate**: two enrolled devices at one outlet bill concurrently online and offline; each keeps device-owned unpaid orders, official numbers remain unique and sequential, exact retries do not duplicate money, revoking one device leaves the other operating, every participating device must seal before sign-off, and no device crosses an outlet boundary.

## Why

V1 deliberately limits each outlet to one counter. After live billing and its
extended-offline behavior are proven, this change removes that enrollment limit
so a busy outlet can add counters without redesigning transaction integrity.

## What Changes

- Allow an FA or SA to enrol, name, inspect, and revoke several billing devices
  for one outlet while every device remains bound to exactly one outlet.
- Show per-device health, last contact, grant, pending/quarantined counts, and
  revocation state without exposing command payloads or customer PII.
- Preserve originating-device ownership for unpaid orders; another ordinary
  counter cannot edit/pay/cancel them merely because it shares the outlet.
- Let FA/SA transfer a stranded open order between active same-outlet devices
  through the existing attributed recovery flow.
- Coordinate concurrent online/offline delivery through server idempotency,
  optimistic versions, and transactional per-outlet bill numbering.
- Require every device that participated in a business date to reconcile and seal
  before the outlet can sign that date off.
- Remove the one-active-device database invariant only after concurrency and
  revocation isolation tests pass against two real device contexts.

## Capabilities

### New Capabilities

- `multi-device-billing-coordination`: Multi-device enrollment, per-device
  observability, concurrent delivery, order ownership, transfer, and revocation.

### Modified Capabilities

- `counter-device-sessions`: One outlet may hold several independently revocable
  enrolled devices and daily grants.
- `order-lifecycle`: Normal actions remain owning-device-only while audited
  same-outlet recovery transfer targets another active device.
- `billing-delivery`: Independent local queues may deliver concurrently without
  duplicate effects or global client-side coordination.
- `counter-billing`: Per-outlet numbering and shift/history views reconcile
  concurrent device results.
- `app-shell`: FA/SA management surfaces list and operate several devices.

## Impact

Enrollment constraints and UI, device management adapters, queue/status queries,
order recovery, database concurrency suites, RLS tests, demo fixtures, and
multi-browser offline tests change. Existing paid history and V1 device records
migrate in place.

## Non-goals

- Ordinary cross-device editing of open orders.
- Shared local storage or peer-to-peer sync between tablets.
- A fixed outlet device quota or automatic device approval.
- Emergency billing on an unenrolled personal device.
- Split tender, partial payment, refunds, printing, or GST.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`,
`docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/SECURITY_AND_PRIVACY.md`, and
`docs/LIMITATIONS.md`.
