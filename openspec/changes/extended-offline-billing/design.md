## Context

Billing V1 durably saves every accepted command and survives transient connection
loss, but after a reload it requires online authentication and current server
reads before reopening the counter. That is an intentional launch boundary, not
the final offline promise. This change expands the already-proven local store and
command protocol so the one enrolled device at each outlet can reconstruct its
current daily counter offline.

Daily operator authentication remains online-only and expires at outlet cutoff.
The device's long-lived machine session and a cached grant are not permission to
start another business day. Server RLS and command validation remain the final
authority for every delayed write.

## Goals / Non-Goals

**Goals:**

- Resume the current verified counter after browser/app restart without a backend.
- Keep direct payment and unpaid-order work usable for the rest of that grant.
- Make cached provenance, pending state, and reconciliation risk unmistakable.
- Reconnect through the existing exactly-once, versioned command protocol.

**Non-Goals:**

- Offline credential verification or a grant beyond cutoff.
- Multiple active counter devices at one outlet.
- Peer-to-peer sync, local official bill-number allocation, or global-directory browse.

## Decisions

### Offline bootstrap uses one atomic verified-state generation

After each successful online hydration, Dexie stores a generation containing the
device/outlet identity, grant ID and bounds, server-observed time, cutover,
menu snapshot/version, known open-order projections/versions, cached exact-phone
results, and schema version. A generation becomes active only after every required
record commits. Offline startup uses the newest complete compatible generation.

Updating independent caches in place was rejected because a crash could combine
a new menu with old grant/order metadata. Service-worker response caching alone
was rejected because it cannot express transactional domain versions or provenance.

### Cached grant state opens UI but never replaces server authorization

Offline restart is allowed only when the stored device matches the installation,
the cached grant was successfully issued to an eligible operator on that device,
and local time remains before its explicit cutoff. Commands continue to carry the
real device/grant IDs and original timestamps; the server later verifies the
immutable grant and revocation facts exactly as in #33.

A browser-side role token or custom authority claim was rejected because authority
is assignment rows, not token state. Cryptographically signing a second offline
credential was rejected for now because it would not solve undetectable revocation
or local clock tampering and would duplicate server authorization. Tampering can
at most open local UI; it cannot make the backend accept an unauthorized command.

### Offline data is an explicit projection, never silent current truth

Every offline screen carries a persistent banner with last successful sync time.
Menu lines show the cached menu generation. Open orders combine their last server
projection with this device's accepted local command chain. Cached customer matches
are used only after the exact same normalized full phone was resolved online and
are labelled cached; an unknown number remains unresolved until sync.

Pretending all customer lookups are available offline was rejected because it
would create a browsable copy of global PII and cannot know a number first seen at
another outlet. Blocking all offline customer details was rejected because they
are optional snapshots and previously resolved exact matches can be reused safely.

### Local command reduction reconstructs device-owned open orders

A pure reducer applies accepted local create/revise/cancel/pay commands over the
cached server projection using the same integer-paise and version rules as the
domain adapter. It never invents official bill numbers. Paid commands show a
provisional reference until server acceptance. Rejected/quarantined ancestors
block only their descendants.

A separate mutable offline database was rejected because it would create two
sources of truth. Replaying immutable commands makes restart deterministic and
keeps exact reconciliation evidence.

### Cutoff is a hard local and server boundary

The app stores the explicit grant expiry/cutoff and stops accepting new commands
when reached. Offline startup after that point shows pending/recovery status only.
The next operator must reconnect, authenticate, and hydrate a new generation.
Historical commands remain deliverable under #33 grant validation.

Grace periods and offline PIN renewal were rejected because the owner explicitly
requires online re-sign-in after cutoff. Client-clock rollback remains detectable
at sync through received time and grant bounds and cannot create valid server work.

### Reconnection refreshes, drains, then reconciles projections

On a real backend response the app refreshes device/grant status, freezes ordinary
drain if revoked, delivers dependency chains, then fetches authoritative menu,
orders, bills, and customer matches needed by the visible work. Exact replay is
success; optimistic/idempotency conflicts follow V1 quarantine/correction flows.

Discarding the offline projection before delivery was rejected because it can
hide unsent work. Merging conflicting order versions was rejected because money
edits require explicit operator action.

### An offline device cannot declare the day settled

Extended capture does not weaken the #10/#33 finish-day contract. The device must
reconnect, verify registration, drain or explicitly resolve every command for the
date, end its grant, and receive the server seal. Until then #12 sign-off remains
blocked even if the local UI currently appears empty.

An offline local seal was rejected because another device cannot verify it and a
later accepted command would make it stale. Treating cutoff as an automatic seal
was rejected because cutoff expires authority but does not prove delivery.

## Risks / Trade-offs

- **Device is revoked while fully offline** -> it may keep capturing local work,
  but the backend grants no access and accepts only eligible pre-revocation work
  through authenticated recovery; the banner shows revocation cannot be checked.
- **Local clock is wrong** -> display the last server-observed time/skew warning,
  stop at the locally known cutoff, and let server grant bounds reject invalid work.
- **Persisted customer facts increase PII exposure** -> cache only exact lookups
  actually used on that device, encrypt-at-rest only if the platform can protect
  keys meaningfully, exclude payloads from logs, and add a documented retention cap.
- **A schema update cannot read an old generation** -> keep compatible readers
  through the pending-command horizon and refuse offline billing rather than erase it.
- **Extended outage delays cash sign-off** -> show the device as an explicit
  blocker and require reconnect/reconciliation; correctness outranks convenience.

## Migration Plan

1. Add generation stores and compatible readers without enabling offline bootstrap.
2. Hydrate and verify generations during ordinary V1 online sessions.
3. Exercise restart, extended outage, cutoff, clock skew, update, and reconnect in
   a test outlet with one device.
4. Enable offline bootstrap per outlet; retain a remote gate that can return the
   device to V1 online-resume behavior without deleting local work.

Rollback disables offline bootstrap but keeps all generation and command data so
V1 can drain it after online sign-in.

## Open Questions

None.
