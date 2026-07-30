# Proposal: username-sign-in-and-owner-recovery

> **Model**: **GPT-5.6 Sol** · **Wave**: D · **Depends on**: #23 · **Gate**: **an admin creates an ordinary person without an email, the person opens one activation link, types the username shown there and the same new password twice, the form exposes Chrome-compatible semantics for saving that username/password pair, and the person signs in with it; an account with an associated email may also sign in with that email, every Super Admin has one and can self-recover through it, and every existing account, assignment, password, session, invite and attendance row survives the move.**

## Why

Most Shawarmania staff do not reliably have an email address, and an address
invented only to satisfy the authentication provider is not a real business
identifier. Requiring one makes hiring depend on data the person may not own,
stores unnecessary PII, and gives a manager another value to mistype before
somebody can start work.

The business wants the identifier it can actually hand over and support: a
short username chosen by the admin who creates the person. Super Admins are the
one required exception for email collection because the business must never
depend on a second administrator being reachable when its owner is locked out.
That associated account email remains a valid alternate sign-in identifier and
is also the Super Admin's self-recovery destination. The data model permits an
email to be associated with another role later without changing sign-in again,
but ordinary People creation does not collect one in this change.

This belongs immediately after `multi-outlet-hiring` because that change
finishes the one-person/one-login creation flow this one changes. It should
land before more live staff are onboarded and before counter-device work has to
carry the temporary personal Biller login forward.

## What Changes

- **BREAKING — every human account receives a username.** Sign-in accepts that
  username, never an `@username` spelling. If the account also has an associated
  email, the same password works with either identifier. This is permanent
  behavior, not a migration compatibility mode.
- The create-person form requires name, username, role, and the role-appropriate
  outlet selection. Phone, job title, and joined date remain optional. A
  Super Admin additionally requires an account email; every other role omits
  email from the form. The private schema can associate one later without
  making it required for that role.
- Usernames use one business-wide namespace and an Instagram-handle-like shape
  without the `@`: 3–30 canonical lowercase characters from `a–z`, `0–9`, `.`
  and `_`; no spaces or hyphens; no leading, trailing, or consecutive periods.
  The database or privileged identity boundary, not merely the form, refuses a
  case-insensitive collision.
- The admin chooses the username. The system may suggest and normalize a value,
  but it never silently substitutes a different available name after the admin
  submits; a collision is returned for that admin to resolve knowingly.
- The activation/reset link continues to carry only the single-use code. Once
  opened, it displays the current username and presents exactly three fields:
  username, new password, and repeat password. The person must type the shown
  username and matching passwords before the code is redeemed.
- A username mismatch is specific and does not consume the code. Unknown,
  expired, spent, superseded, or inactive-account codes remain
  indistinguishable and bounded by the existing endpoint rate limit.
- Successful activation signs the person in and removes the form through a
  real client-side navigation. The username field is marked for password
  managers as `username`, both activation password fields as `new-password`,
  and the ordinary sign-in password as `current-password`, so Chrome and other
  conforming managers can offer to save and later fill the credential.
- An authorized admin can see and correct the username from People. A username
  change preserves the account UUID, password, assignments, sessions, history,
  and outstanding invite; a link opened afterwards displays and accepts the
  latest username.
- The existing admin-issued one-time link remains first-run activation and the
  complete forgotten-password path for Franchise Admins, Billers and
  Employees. The current authority rule remains: a Franchise Admin may act
  only when they manage every outlet where the target person has a live
  assignment; otherwise a Super Admin is required.
- A Super Admin carries a required, private account email in addition to their
  username. It is a permanent alternate sign-in identifier. A public,
  enumeration-safe recovery request sends a single-use
  password-reset link only for an active account that currently holds a live
  Super Admin assignment. The link returns to the canonical production origin
  and uses the same username-plus-two-password-fields reset screen.
- No activation, admin-issued reset, username change, or sign-in sends email.
  Super Admin recovery and security notifications are the only outbound
  authentication mail introduced by this change.
- Existing human accounts are migrated in place. Non-Super-Admin personal
  emails and placeholder addresses are removed from live Auth identity data;
  Super Admin email is retained as private account data. The two existing
  production usernames stay only in the operator-reviewed, gitignored mapping
  and are never committed. User IDs, password hashes,
  refresh sessions, profiles, assignments, attendance, and outstanding invites
  are not recreated.
- The `Needs an address` account state disappears. A person without an
  outstanding invite is sign-in-capable once an authorized admin issues one;
  nobody needs an email address merely to exist on People or Attendance.
- Forward-looking roadmap seeds, todos, docs, fixtures, tests, and comments are
  reconciled so no future design quietly assumes staff email. Archived change
  folders remain immutable historical context.

## Non-goals

- No self-service Profile or Settings surface for changing a username or a
  known password. Those remain later roadmap work; this change keeps the
  admin correction path needed to repair onboarding mistakes.
- No SMS, WhatsApp, social-login, magic-link, phone-number, passkey, or
  `@username` sign-in. Email sign-in exists only when the account has a private
  associated email.
- No MFA enrollment or enforcement. The Super Admin's associated email enables
  self-recovery and can support a later security design; a future second factor
  is expected to use an authenticator or another explicitly designed factor,
  not to smuggle role authority into the token.
- No role, assignment, tenancy, deactivation, session-lifetime, counter-device,
  or one-time-code security weakening.
- No redesign of People beyond the identifier-dependent fields and states, and
  no redesign of the role shells.

## Capabilities

### New Capabilities

None. Username sign-in, activation, account administration, and password
recovery remain one identity-and-access contract rather than a second auth
system.

### Modified Capabilities

- `identity-and-access`: replace email-required and placeholder-address accounts
  with admin-chosen usernames for every human role; make an associated email
  private and optional except that every Super Admin requires one; allow either
  identifier to authenticate the same account when email exists; require
  username confirmation on activation/reset; preserve the existing invite,
  authority, deactivation, session, and one-person/one-login guarantees through
  migration.

## Impact

- **Schema and Auth identity data**: username uniqueness and normalization,
  private optional account email with a Super Admin requirement, current Auth
  users/identities, legacy
  placeholder accounts, generated database types, and migration verification.
- **Privileged functions**: `admin-accounts`, `redeem-invite`, a narrowly scoped
  `email-sign-in` bridge, the recovery-mail path, shared authority checks, and
  identity normalization helpers. The
  service-role credential remains server-only.
- **Frontend auth**: sign-in, activation/reset, recovery request and callback,
  session bootstrapping, routing, browser-password-manager metadata, and
  account-menu wording.
- **Adapter seam and People**: account types, Supabase and mock adapters,
  fixtures, create/edit/code panels, account states, and demo safety.
- **Operations**: canonical `https://ops.shawarmania.in` recovery redirects,
  production email delivery, sender-domain configuration, secrets, rate limits,
  abuse handling, owner-recovery runbook, and a reversible live-account
  migration.
- **Verification**: component and auth-screen tests, REST and pgTAP identity
  tests, RLS impersonation probes, authenticated Playwright for all four roles,
  demo walkthroughs, migration rehearsal, and phone/tablet light/dark review.

Before archive, this change updates `docs/ARCHITECTURE.md`,
`docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`,
`docs/SECURITY_AND_PRIVACY.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md`,
`docs/TESTING.md`, and `docs/LIMITATIONS.md`, plus the authentication model in
`AGENTS.md`. It also reconciles `openspec/changes/ROADMAP.md`,
`openspec/todos/`, and every non-archived active or seeded change whose future
language assumes email.
