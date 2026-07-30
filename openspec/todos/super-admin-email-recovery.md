# Super Admin Email Recovery

**Type**: Feature · **Status**: Deferred by decision · **Area**: Auth

## Expectation

A Super Admin who cannot sign in with either their username or associated email
can eventually recover access through that private email without depending on
another administrator. If another role is deliberately given an associated
email in the future, the proposal may decide whether the same recovery path
applies to that account too; merely having an email must not grant a role or
broaden outlet authority.

This is not part of the username migration. Until this todo is promoted, every
forgotten-password incident—including one affecting a Super Admin—uses an
authorized admin-issued one-time link. One Super Admin helps another. If every
Super Admin is locked out at once, the operator follows the documented
break-glass procedure rather than relying on an unbuilt email path.

## Baseline after #24

`username-sign-in-and-owner-recovery` (#24) leaves the necessary identity
foundation without introducing mail delivery:

- every live Super Admin has a private associated email;
- username and associated email both sign in to the same Auth user with the same
  password;
- ordinary roles need no email;
- account email is absent from outlet-readable data and ordinary client
  responses;
- admin-issued activation/reset links already use the username plus two-password
  handover;
- Auth provider aliases remain non-deliverable and protected from direct
  signed-in changes.

## Scope a future proposal must settle

- Which accounts qualify: only active Super Admins, or every active account with
  an explicitly associated email.
- The transactional-email provider, verified sender domain, production secrets,
  bounce handling, delivery monitoring, and outage behavior.
- An enumeration-safe public request that returns the same response for unknown,
  inactive, ineligible, and rate-limited addresses.
- Per-address and per-network abuse limits without logging raw addresses or
  weakening the existing sign-in boundary.
- Single-use, expiring callbacks restricted to the canonical production origin,
  with active-account and current-role checks repeated before password change.
- Whether the callback should reuse the existing username/new-password/repeat
  password form and what sessions are revoked after success.
- How provider mail is prevented from reaching the hidden Auth alias or being
  used for signup, magic-link, invite, or unapproved email-change flows.
- The all-Super-Admins-locked-out operator procedure and how it is tested without
  changing production data during routine deployment verification.

## Constraints

- Do not make email required for Franchise Admins, Billers, or Employees.
- Do not expose whether an email is associated with an account, which role it
  holds, or which outlets it can reach.
- Do not move account email onto `profiles`, into tokens, or onto a shared
  counter device.
- Do not let email recovery become authority; successful recovery may only
  restore the existing account whose assignments are still resolved by the
  database.
- Do not select a provider merely because an earlier exploration named one.
  Provider choice must be justified against the live operational requirements.

## Trigger to promote

Promote this after the core live-operations roadmap unless repeated owner
lockouts make the admin-issued path materially painful, or before a future MFA
change requires reliable security-message delivery.

**Dependencies when seeded**: `username-sign-in-and-owner-recovery` (#24).
Coordinate with `self-service-account-settings` if both are promoted together.
