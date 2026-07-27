# Roles And Permissions

> The policies exist and are enforced (`data-model-and-tenancy`), and all four roles now sign in against them (`auth-and-roles`). The counter tablet's own story — device enrolment and shift PINs — is still as designed; see the note under [Counter tablet](#counter-tablet--device-enrolment--shift-pin).

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

### Personal smartphones — email + password

Super Admins, Franchise Admins and Employees sign in with their email address and a password they set themselves.

*(Owner-confirmed 2026-07-26, replacing an earlier phone+password design. Phone sign-in turned out to drag in an SMS-provider dependency even with no OTP flow — the auth service gates password sign-in behind the provider flag — while email carries no external dependency at all: addresses are pre-confirmed at provisioning and no mail is ever sent. Phone numbers remain on profiles as contact data only.)*

Accounts are **admin-provisioned**: an admin creates the person's record with the email pre-confirmed, the system issues a one-time code, and the admin passes it on (in practice over WhatsApp, which the business already uses). The person redeems it at *Set your password*, and is signed in from there. No SMS provider and no TRAI/DLT registration is involved anywhere, and no mail is ever sent — not even a confirmation.

**The one-time code, as built.** Ten Crockford-base32 characters shown as `XXXXX-XXXXX` (50 bits; the letters I, L, O and U are absent so nothing can be misread). Valid seven days, redeemable once, dead after five wrong attempts, and superseded the instant a replacement is issued — so exactly one code per account is ever live. It is stored only as a hash, in a column no client role can read at all, which is why an admin sees it once and never again. Every way redemption can fail produces one identical response: an unauthenticated endpoint must not become a way to find out which addresses have accounts.

**Sessions are long-lived** — access tokens last an hour and refresh silently, with no inactivity timeout. A delivery employee who opens the app fortnightly should not be re-authenticating, and there is no self-service reset to rescue them if they are. Ending a session early is an administrative act, not a timer: deactivate the account.

**Deactivation and reassignment bite immediately.** A deactivated account cannot read even its own profile row, because every policy is gated on the active check — and the client uses exactly that as its signal, ending the open session within five minutes (sooner if the tab is returned to) rather than waiting an hour for the token. A role or outlet change makes the token's claims stale; the client refreshes once, and signs out with an explanation if the mismatch survives, because rendering an admin's shell on an employee's claims would show empty screens that look like data loss.

Password reset in v1 is admin-initiated: the admin issues a new one-time code. Self-service reset was considered and deliberately not shipped, and neither was changing a password you still know — both are recorded in [`openspec/todos/`](../openspec/todos/README.md). Google sign-in mapped to the same email address is a possible later convenience, not a commitment.

**Who may provision whom** is re-derived inside the privileged function from the caller's own session, never from the request:

| | Super Admin | Franchise Admin |
|---|---|---|
| Create an account | any role, any outlet | Biller / Employee, own outlet only |
| Issue a new code | any account but their own | own-outlet Billers and Employees |
| Deactivate / reactivate | any account but their own | own-outlet Billers and Employees |

Nobody manages their own account. Locking the only Super Admin out has no in-app recovery, and re-issuing your own code is meaningless while you are signed in.

### Counter tablet — device enrolment + shift PIN

> **Not built yet.** Device enrolment and shift PINs arrive with `counter-devices-and-offline`. In the meantime a Biller signs in on the tablet with their own email and password, which is exactly the arrangement this section argues against — accepted briefly and on purpose, and recorded in [Limitations](LIMITATIONS.md). RLS scopes them to one outlet's billing surfaces either way.

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
- Outstanding invitations are outlet-scoped rows with their own policy and isolation cases, written only by the privileged function and readable only by the two roles that issue codes.
- Issuing and redeeming a code are each a **single database function**, so "supersede then insert" and "check then consume" happen in one transaction. Doing that across several round trips from an Edge Function would leave a race, and the race is the attack.
- Claims refresh with the token, so a role change takes effect at next refresh. Anything needing immediate effect — deactivating an account, revoking a device — is a status check inside the policy, not a claim.
- Role checks in Edge Functions re-derive the caller's role from their JWT. Being an Edge Function is not authorisation.
- Every outlet-scoped table gets read and write policies in the migration that creates it, plus a case in the isolation test suite. See [Testing](TESTING.md).
