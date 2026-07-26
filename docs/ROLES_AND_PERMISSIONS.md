# Roles And Permissions

> Describes the model as designed. No policies have been written yet.

Four roles. The governing rule: **a role's scope is enforced by Row-Level Security in Postgres, and the UI merely reflects it.** If the two ever disagree, the database is right and the UI is a bug.

## The roles

| Role | Scope | Device | Primary job |
|---|---|---|---|
| **Super Admin** | All outlets | Own phone | Runs the business; compares outlets; manages outlets and admins |
| **Franchise Admin** | Exactly one outlet | Own phone | Runs one shop; menu, stock, expenses, cash, staff |
| **Biller** | Exactly one outlet | Shared counter tablet | Rings up customers |
| **Employee** | Own records only | Own phone | Marks attendance |

## Capability matrix

`✓` full · `R` read-only · `—` no access · `self` own records only

| Capability | Super Admin | Franchise Admin | Biller | Employee |
|---|---|---|---|---|
| **Outlets** |
| View outlet list | ✓ all | R own | — | — |
| Create / edit / deactivate outlet | ✓ | — | — | — |
| Switch active outlet | ✓ | — | — | — |
| **People** |
| Manage Franchise Admins | ✓ | — | — | — |
| Manage Billers and Employees | ✓ | ✓ own outlet | — | — |
| Enrol / revoke counter device | ✓ | ✓ own outlet | — | — |
| **Menu** |
| View menu | R all | ✓ own outlet | R own outlet | — |
| Add / edit / disable items and prices | ✓ | ✓ own outlet | — | — |
| **Billing** |
| Create a bill | — | — | ✓ own outlet | — |
| View bills | R all | R own outlet | R own shift | — |
| Void a bill | ✓ | ✓ own outlet | — | — |
| **Inventory** |
| View stock and low-stock warnings | R all | ✓ own outlet | — | — |
| Record movements | — | ✓ own outlet | — | — |
| **Expenses** |
| View | R all | ✓ own outlet | — | — |
| Record | — | ✓ own outlet | — | — |
| **Attendance** |
| Check in / out | — | ✓ self | — | ✓ self |
| View attendance | R all | ✓ own outlet | — | R self |
| Override a failed geofence check | ✓ | ✓ own outlet | — | — |
| **Daily cash** |
| View | R all | ✓ own outlet | — | — |
| Record withdrawal, close the day | — | ✓ own outlet | — | — |
| **Profit and loss** |
| View outlet P&L | R all | R own outlet | — | — |
| Compare outlets | ✓ | — | — | — |
| **Alerts** |
| Raise an alert | — | ✓ own outlet | — | — |
| View and respond | ✓ all | R own alerts | — | — |

Two deliberate asymmetries worth noting. **The Super Admin cannot create bills** — billing is a counter action tied to an enrolled device and a shift, and letting the owner ring up a sale from their phone would corrupt attribution and cash reconciliation. **The Biller only sees their own shift's bills**, not the outlet's whole history; reviewing the day is a manager's job, and it keeps a shared tablet from exposing the outlet's takings to whoever is standing at it.

## Authentication

### Personal smartphones — phone number + password

Super Admins, Franchise Admins and Employees sign in with their phone number and a password they set themselves.

Accounts are **admin-provisioned**: an admin creates the person's record, the system issues a one-time code, and the admin passes it on (in practice over WhatsApp, which the business already uses). The person signs in with phone + code and sets a password. Sessions are long-lived; a field employee should not be re-authenticating weekly.

Supabase creates these users with a pre-confirmed phone, which means **no SMS provider and no TRAI/DLT sender-ID registration is needed**. That is not a minor convenience — DLT registration for transactional SMS in India is weeks of paperwork, and it would have blocked the whole project on an unrelated approval.

Password reset in v1 is admin-initiated: the admin regenerates a one-time code. Self-service reset needs an SMS or WhatsApp channel and is deferred.

### Counter tablet — device enrolment + shift PIN

Two layers, because a shared device has a different threat model than a personal one:

1. **Enrolment (once per tablet).** A Franchise Admin or Super Admin signs in on the tablet and enrols it as that outlet's counter device. The device receives a long-lived session whose RLS scope is exactly one outlet. This is the real credential.
2. **Shift unlock (per biller).** The biller picks their name and enters a short PIN. This opens a shift and determines bill attribution. **The PIN is not the security boundary** — it prevents casual misattribution and walk-up use, nothing more. A 4-digit PIN alone would be far too weak to protect outlet data, which is exactly why it does not.

Why not full logins on the tablet: a shared device holding personal credentials is *worse* security, not better — sessions get left open, passwords get typed on a greasy counter screen dozens of times a day, and every biller learns every other biller's password within a week.

The honest trade-off: **the tablet's session is the credential, so a lost tablet is a real incident.** Mitigations are built in from the start, not retrofitted — `counter_devices.revoked_at` is checked by policy so revocation is immediate, the device is scoped to one outlet and to billing surfaces only, and `last_seen_at` makes a missing device visible. Losing the tablet exposes one outlet's billing screen; it never exposes another outlet, admin functions, or the owner's cross-outlet view.

## Attendance and location

Employees check in from their own phones. The browser's Geolocation API supplies coordinates; the app computes the distance to the outlet's stored position.

**Policy: block outside the geofence, with a Franchise Admin override.** A check-in beyond the radius is refused and offers to request an override; the manager approves from their phone, and the approval is recorded on the attendance row with who approved it and why.

The counter tablet is the **secondary check-in path** and the practical escape hatch. If an employee's phone is dead, out of data, or cannot get a GPS fix, they check in on the tablet — which is unambiguously in the shop. This is what makes hard-blocking survivable in daily use: there is always a way to clock in that does not depend on one person's phone behaving.

Every attendance row stores the captured coordinates, the GPS accuracy, the computed distance, and the source. Storing the inputs beside the verdict is what makes a disputed check-in reviewable — "the app said no" is not an acceptable answer to an employee about their pay.

**What location does and does not prove** is in [Limitations](LIMITATIONS.md), and it matters: browser geolocation is spoofable. This raises the bar; it is not evidence.

## Implementation notes

- `app_role` and `app_outlet_id` are injected into the JWT by a custom access-token hook. Policies read the claims; they do not sub-query `profiles` (see the RLS recursion trap in [Architecture](ARCHITECTURE.md)).
- Claims refresh with the token, so a role change takes effect at next refresh. Anything needing immediate effect — deactivating an account, revoking a device — is a status check inside the policy, not a claim.
- Role checks in Edge Functions re-derive the caller's role from their JWT. Being an Edge Function is not authorisation.
- Every outlet-scoped table gets read and write policies in the migration that creates it, plus a case in the isolation test suite. See [Testing](TESTING.md).
