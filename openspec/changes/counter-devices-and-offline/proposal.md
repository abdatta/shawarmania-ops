# Proposal: counter-devices-and-offline

> **Model**: Fable · **Wave**: D · **Depends on**: #4, #5 · **Gate**: an enrolled tablet reaches only its own outlet's billing surface and revoke takes effect immediately; offline → 20 bills → online → exactly 20 rows, zero duplicates; the queue survives reload and restart; a replayed client UUID inserts once; a malformed entry quarantines instead of vanishing; an employee whose phone cannot get a GPS fix checks in on the tablet.

## Why

Makes the counter tablet a **trusted, offline-capable device** — the prerequisite for taking real money on it. Both halves are about the same object, and both must be right before a single real bill exists.

Device trust and the outbox ship together because the outbox's security posture depends on the device session: a queued write drains under the device's credentials, and revoking a device with a pending queue has to do something sensible. Building them apart would mean designing that interaction twice.

Exactly-once semantics are brutal to retrofit onto a shipped queue, which is why this is proved by a harness **before** any screen depends on it.

## Scope

**Device trust** — enrolment (an admin signs in on the tablet and binds it to one outlet; the device receives a long-lived session scoped by RLS to that outlet and to billing surfaces only). Revocation enforced by a `revoked_at` check *inside* the policy, so it takes effect immediately rather than at token expiry. `last_seen_at` tracking so a device gone quiet during trading hours is visible. Shift open/close by biller PIN — selecting attribution, explicitly **not** a security boundary. The Devices management screen.

**The offline outbox** — Dexie/IndexedDB, durable across reload, app close and device restart. The drain loop with backoff and the full response matrix from `docs/OFFLINE_AND_SYNC.md` (2xx, 409 duplicate, other 4xx, network/5xx). Client-generated UUIDs with server-side upsert on that key — the whole duplicate-prevention story. Business-date resolution on the device at settlement, from the outlet's cutover. Menu caching with visible staleness. The sync indicator, including escalation when a backlog grows or an entry repeatedly fails.

**Attendance on the tablet** — the kiosk path that closes the loop opened in #5. An employee taps their name and PIN; the record is stamped `counter_tablet`, needs no geofence evaluation and no override, because the device is demonstrably in the shop. This is what makes hard-blocking humane, and it only becomes possible once devices exist.

## Non-goals

- No billing UI (#6 built it) and no real bills (#10).
- Manager and owner screens stay online-only. A deliberate design commitment, not an omission.
- Attendance from personal phones stays online-only: a queued check-in cannot be geofence-verified at the moment it happens, and one validated later can be gamed.

## Design questions to settle during `/opsx:propose`

- Quarantine semantics: what a manager can actually *do* with a rejected entry, since silently dropping it and blocking the queue are both unacceptable.
- Backoff schedule, and the threshold where a backlog becomes a visible warning rather than a quiet count.
- Whether the drain loop is driven by the service worker or the page, given the tablet is usually foregrounded.
- **Whether a device with a pending outbox can be revoked at all**, and what the admin is warned about — revoking a device holding unsynced bills destroys them.

## Docs to update before archiving

`docs/OFFLINE_AND_SYNC.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/OPERATIONS.md` (the lost-tablet runbook), `docs/SCREENS.md`.
