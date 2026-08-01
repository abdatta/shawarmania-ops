## Context

Billing V1 proves one device per outlet; #34 proves that device online and through
extended outages. The database command contract was deliberately built for
concurrency, but #9 still enforces a partial unique one-active-device invariant
and the management UI assumes a singleton. This change removes that rollout
limit without changing paid history or weakening device ownership.

## Goals / Non-Goals

**Goals:**

- Enrol and independently revoke several same-outlet billing devices.
- Preserve outlet isolation, per-device operator grants, and order ownership.
- Prove concurrent online/offline delivery produces exactly-once money history
  and unique per-outlet bill numbers.
- Give FA/SA useful PII-free health and recovery visibility per device.

**Non-Goals:**

- Ordinary cross-device order editing or a shared local queue.
- Peer-to-peer discovery/sync, fixed device quotas, or auto-enrollment.
- Local allocation of official bill numbers.

## Decisions

### Enrollment becomes one outlet to many independently revocable devices

Drop the partial unique active-device-per-outlet index. Each `counter_devices`
row retains one immutable outlet binding, machine Auth identity, display name,
enrollment/revocation attribution, and status. Device names must be unique among
active devices at one outlet for operators, but are not security identifiers.

Reusing one machine identity across tablets was rejected because one leak or
revocation would affect every counter and attribution would be ambiguous.

### The server remains the only cross-device coordinator

Each tablet keeps its own Dexie generations and command queue. Devices do not
read or write one another's local state. They converge through #33 RPC commands,
receipt UUID/hash checks, row locks, optimistic order versions, and transactional
bill-number allocation.

Peer-to-peer or shared-browser storage was rejected because it introduces a new
availability/security boundary and cannot preserve outlet isolation more strongly
than the existing server. Client-reserved bill-number blocks were rejected because
offline gaps and reuse become business-visible; official numbers remain assigned
only on accepted server payment.

### Open orders remain owned by exactly one device

Create records originating device. Normal revise/pay/cancel requires that device,
regardless of operator. Another same-outlet device may see manager-authorized
summary/history where permitted but cannot mutate the order. FA/SA transfer uses
the existing audited recovery command, names an active same-outlet target, carries
expected version and reason, and increments version.

Automatic takeover was rejected because simultaneous devices could both accept
changes and silently merge money. Outlet-wide ordinary edit was rejected for the
same reason and because the owner explicitly chose same-device control.

### Device management is PII-free and authority-scoped

FA sees only devices at assigned outlets; SA may see all. The management surface
shows display name, status, enrollment/revocation attribution, last successful
contact, current grant summary, and counts/oldest age for pending or quarantined
commands reported by the device. It never uploads payloads or customer phones for
health monitoring. Device-reported counts are advisory, not authority.

A central server query alone was rejected because it cannot see unsent local work.
Uploading queue contents was rejected because operational monitoring does not
justify replicating customer PII.

### Concurrent numbering is observed in server acceptance order

The existing per-outlet transactional allocator serializes successful bill inserts.
Numbers therefore follow server acceptance order, which may differ from customer
order time after offline devices reconnect. `ordered_at` and business date retain
economic chronology; official bill number remains unique, sequential, and never
reused. UI never sorts accounting history by bill number as a proxy for creation time.

Trying to force event-time numbering was rejected because disconnected devices
cannot agree on the next number without collisions or later renumbering.

### Revocation is isolated per device

Revoking one row immediately blocks that machine at the server and does not affect
other same-outlet devices or human assignments. A device offline at revocation may
continue local capture until it learns the state, but ordinary sync rejects it;
eligible pre-revocation work uses upload-only recovery. Post-revocation commands
remain rejected and visible for discard/investigation.

### Day sign-off requires every participating device

The #33 readiness query expands naturally: every device that held a grant or
submitted a command for the business date needs a current seal, and no device may
retain a live grant. One tablet's seal never represents another. Transfer,
recovery, or revocation does not erase the source device's blocker; its work must
be resolved and the server must record the appropriate terminal disposition.

Requiring only the last-active device was rejected because an offline second
counter could contain accepted local money. Aggregating device health counts was
rejected because health is advisory and can be stale.

## Risks / Trade-offs

- **Bill numbers do not reflect sale chronology after offline sync** -> show
  ordered/payment times and business dates explicitly; number only by acceptance.
- **Two devices create apparent duplicate customer orders** -> customer phone is
  not an order identity; operators reconcile business duplicates through void/
  replacement, while command UUID prevents technical duplication.
- **Device health counts become stale offline** -> label last report time and never
  infer that zero reported pending commands means the local queue is empty.
- **One missing device delays outlet sign-off** -> identify it precisely and use
  recovery/revocation disposition; never let another device silently stand in.
- **Concurrency tests miss production timing** -> run database stress plus two
  independent browser contexts with forced interleaving and response loss.

## Migration Plan

1. Add display/health metadata and multi-device UI while retaining the singleton index.
2. Prove existing V1 device rows and credentials migrate without re-enrollment.
3. Run two-device concurrency/RLS/revocation tests, then drop the singleton index.
4. Enrol a second device at one test outlet, verify online/offline coexistence,
   then enable multi-device enrollment for other outlets.

Rollback disables new enrollment but must not delete or merge device identities.
Already enrolled devices are revoked individually through normal operations.

## Open Questions

None.
