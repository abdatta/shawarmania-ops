## Context

Shawarmania currently gives every human account a Supabase Auth email identity,
even though many staff members do not have an address they reliably control.
The application already avoids sending that address anything: an admin creates
the account with the address pre-confirmed, hands over a one-time activation
link, and remains the password-reset path. That flow is secure, but its sign-in
identifier is still the wrong business fact and placeholder addresses have
become an account state the People surface must explain.

This change follows `multi-outlet-hiring`. Its starting point is therefore one
person with one Auth user, one profile, any number of assignment rows, and one
outstanding invite at most. Authority remains assignment-derived at the
database and privileged-function boundaries; neither a username nor an email
ever becomes a role claim.

Supabase password authentication accepts an email or phone identifier, not a
first-class username. The design must bridge that provider constraint without
making staff invent email, exposing the service-role key, proxying ordinary
passwords through a custom server, or creating a second user record. It must
also preserve current user IDs, password hashes, refresh sessions, assignments,
attendance history, and outstanding invites during cutover.

Super Admin recovery is deliberately different from staff activation and
admin-issued resets. It is the only flow in this change that sends mail, and it
must remain available when no second administrator can help. A recovery email
is private contact data, never the everyday sign-in name.

The browser-password-manager goal is semantic, not a promise about Chrome UI.
The page can provide the field names, autocomplete tokens, form submission, and
post-success navigation that let Chrome recognize a credential. Chrome retains
the final decision based on user settings, profile policy, prior dismissals,
incognito mode, and its own heuristics.

## Goals / Non-Goals

### Goals

- Make an admin-chosen username the only human-facing sign-in identifier for
  all four roles.
- Require only name, username, role, and role-appropriate outlet selection to
  create ordinary staff; keep the existing optional facts optional.
- Keep username syntax small, predictable, case-insensitive, and unique across
  the whole business.
- Make activation and admin-issued reset ask for the displayed username plus
  the same new password twice, without weakening code secrecy or rate limits.
- Give only active Super Admins an enumeration-safe email recovery path.
- Make Chrome and other conforming password managers able to recognize the
  submitted username/password credential, while never claiming that a save
  prompt is guaranteed.
- Preserve every existing account and its operational history in place.
- Keep username, recovery contact, and provider-only aliases off
  outlet-readable tables and shared counter devices.
- Leave a concrete later seam for self-service username and known-password
  changes without building that Settings surface now.

### Non-Goals

- Email, phone, `@username`, social, passkey, magic-link, or SMS sign-in.
- MFA enrollment or enforcement.
- A custom password-authentication proxy or custom session format.
- Self-service username changes or known-password changes.
- Any change to assignment-derived authority, tenancy policy, role shells,
  offline billing, money storage, business dates, or counter-device enrollment.
- Sending activation or admin-reset links automatically.

## Decisions

### D1. Username is a canonical, business-wide identifier

The canonical username is lowercase and 3–30 characters long. Input is trimmed
and lowercased before validation. The canonical value accepts only ASCII
`a`–`z`, `0`–`9`, period, and underscore. A period may not be first, last, or
adjacent to another period. Spaces inside the value, hyphens, non-ASCII
lookalikes, and an `@` prefix are refused.

The client may lowercase input and suggest a handle from the person's name, but
the submitted value remains visible to the admin. The privileged boundary
validates it again and returns a named conflict; it never silently appends a
number or chooses another available value. Usernames share one namespace across
every outlet and role because a person has one login however many assignments
they hold.

The rule is implemented once in a small shared username module, with equivalent
Postgres checks for any persisted recovery/migration data that includes a
username. Tests use the same acceptance and rejection table in the frontend,
Edge Functions, migration tooling, and database probes.

Alternatives rejected:

- Per-outlet usernames fail as soon as one person works at several outlets.
- Display-case-preserving usernames add no business value and make collision
  and support behavior harder to explain.
- Automatically choosing a suffix after submission can hand over a credential
  the issuing admin never reviewed.

### D2. Supabase Auth stores a non-deliverable login alias, not a personal email

Supabase remains the password and session authority. The canonical username is
encoded deterministically as:

```
<username>@login.shawarmania.invalid
```

The `.invalid` top-level domain is deliberately non-deliverable. This value is
provider plumbing: it is called an **Auth alias** in code and documentation,
never an email address in the product. It is not copied onto `profiles`,
fixtures, analytics, or exports.

Ordinary sign-in normalizes and validates the username locally, derives the
Auth alias, and calls Supabase `signInWithPassword` directly. Passwords
therefore travel on the existing client-to-Supabase Auth path and never through
an application Edge Function. The failure remains one uniform “username or
password” response.

`auth.users.email` is the single source of truth for the current username
alias. The privileged account function lists and parses aliases for authorized
People surfaces, activation SQL parses the live alias for the code holder, and
the Auth uniqueness constraint is the final case-insensitive collision
boundary. An alias outside the reserved suffix or whose local part is not a
canonical username is treated as an integrity error, not displayed as a
username.

Secure Email Change stays enabled. The Send Email Auth Hook added by this
change fails closed for `email_change` and every action except approved Super
Admin recovery. Consequently, an authenticated user cannot complete a
hand-crafted change to the hidden Auth alias; username changes remain an admin
operation. An authenticated user changing only their password directly does
not widen authority, but the product does not expose that UI until the later
account-settings change.

Alternatives rejected:

- A public username-to-real-email lookup would be an enumeration surface and
  would retain staff email.
- A custom Edge Function that accepts every sign-in password would add a
  sensitive credential-processing layer and a second session-mint path.
- Mirroring the username onto `profiles` would make colleagues' credentials
  ambient on the future shared counter tablet.
- Storing both a username row and an Auth alias as equal sources of truth would
  create a cross-system dual-write failure on every rename.

### D3. Recovery email lives in a private Super Admin-only contact table

`public.account_recovery_contacts` contains:

- `profile_id uuid primary key` referencing `profiles(id)`;
- `email text not null`, normalized to lowercase and bounded in length;
- timestamps for operational audit.

The normalized email is unique so one recovery request resolves to at most one
account. The table is not outlet-scoped because its subject may hold the
business-wide role, but it is private: RLS is enabled, `anon`,
`authenticated`, and `public` receive no table privileges or policies, and
only narrowly scoped security-definer functions plus service-role Edge
Functions can read or write it. It never joins an outlet-readable response.

A deferred database constraint checks the completed transaction:

- every person with a live Super Admin assignment has exactly one recovery
  contact;
- a person without a live Super Admin assignment has none.

Provisioning a Super Admin, granting that role, ending its final live
assignment, and changing another owner's recovery email therefore update the
assignment and recovery row in one privileged transaction. A direct,
hand-crafted assignment write cannot create an owner without recovery contact
or leave former staff carrying owner recovery data.

An authorized Super Admin may read and correct another Super Admin's recovery
email. A Super Admin may see their own recovery email read-only so they can
verify it, but changing one's own recovery email belongs to the later
self-service account-settings surface. Franchise Admins, Billers, and Employees
can neither request nor read recovery contact data.

### D4. Provisioning writes one Auth user and one atomic application account

The `admin-accounts` `provision` action accepts:

- required `fullName`, `username`, `role`, and the role-appropriate
  `outletIds`;
- optional `phone`, `roleTitle`, and `joinedOn`;
- required `recoveryEmail` only when `role` is `super_admin`.

The existing authority module re-derives the caller and validates the complete
outlet set before any write. The function validates the username and recovery
shape, creates one pre-confirmed Auth user at the derived alias with an unknown
random password, then calls one database RPC that atomically inserts the
profile, optional recovery contact, all requested assignments, and the hashed
invite. The one-time code is returned only after that transaction commits.

If the database transaction fails, the Edge Function deletes the just-created
Auth user. A cleanup failure is logged by opaque user ID only and returns an
operational error; the orphan has no profile, no authority, and cannot pass
active-account RLS. No request or log includes a password, invite code,
recovery email, or former staff email.

Auth alias collision produces `username_unavailable`. Recovery-contact
collision produces `recovery_email_unavailable`. Contradictory Super Admin
outlets, missing ordinary-role outlets, invalid optional facts, and
out-of-authority requests remain all-or-nothing refusals.

### D5. People receives identifiers only through the privileged account boundary

The current `emails` and `set-email` account actions become `identifiers` and
`set-username`. `identifiers` returns:

- the canonical username for every account the caller may manage;
- the caller's own username;
- recovery email only where D3 permits it.

`set-username` re-derives caller authority, refuses self-change, validates the
new canonical value, and updates the Auth alias through the Admin API. The
Auth user ID, password hash, identities, profile, assignments, refresh tokens,
attendance, and invite rows are not replaced. The provider uniqueness check
makes the rename atomic from the sign-in boundary: after success the old
username fails and the new one works. The outstanding invite remains attached
to `profile_id`; a later preview shows the current username.

The adapter changes `AccountSummary.email` to `username` and adds a narrowly
scoped nullable `recoveryEmail` only to the Super Admin management view.
`NewAccount` follows D4. Demo fixtures contain usernames but no simulated
personal email for ordinary roles.

The People status model removes “placeholder address” and “needs an address.”
It continues to distinguish deactivated, outstanding activation, no live
assignment, and ready accounts. A missing/malformed Auth alias is an integrity
warning for an owner, not a contact-data prompt.

### D6. Activation previews username and redeems code + username + password

The activation URL remains origin-relative and contains only the one-time code.
`preview_account_invite` returns the canonical username parsed from the current
Auth alias when and only when the code is live. It consumes nothing and keeps
all dead-code states indistinguishable.

The page says “Your username is `<username>`. Type it below,” then presents one
form with:

1. username;
2. new password;
3. repeat new password.

The client checks password equality before any request. `redeem-invite`
receives the code, username, and one password after that check. The database
transaction verifies the current username and consumes the invite only when it
matches.

There are three refusal classes:

- canonical username mismatch: a specific correction message, no code
  consumption;
- weak/mismatched password or endpoint rate limit: the existing specific
  request-level messages, no accidental consumption;
- unknown, expired, spent, superseded, or inactive-account code: the existing
  single `invalid_code` response.

After the Auth Admin password update succeeds, the client signs in through the
ordinary username path and performs a real route navigation. If Auth password
update fails after database consumption, the existing explicit
`activation_failed` support path remains: the code is spent and an admin must
issue another. Password-manager behavior does not justify weakening the
consume-before-password-update security boundary.

### D7. Admin-issued reset remains the staff recovery path

Reissuing an invite remains the complete forgotten-password flow for Franchise
Admins, Billers, and Employees. It also remains available to one Super Admin
acting for another. `mayManage` continues to require a Franchise Admin to
manage every live outlet assignment held by the target; cross-outlet people and
Super Admins require an owner.

The reset link is the same link and the reset screen is the same
username-plus-two-password form as first activation. Assignment changes still
replace an outstanding invite transactionally after the new assignment set
exists. Nothing in this path sends mail.

### D8. Super Admin self-recovery uses Supabase recovery plus a Send Email Hook

The public recovery form accepts a recovery email and always returns the same
accepted response. A new `owner-recovery` Edge Function:

1. normalizes the address and hashes the client IP;
2. calls an attempt-limited database function that resolves only an active
   profile with a live Super Admin assignment and matching private recovery
   contact;
3. derives that user's Auth alias server-side and asks Supabase Auth to begin a
   password recovery to the canonical production callback;
4. returns the same response whether the address resolved, was rate-limited,
   was inactive, or did not exist.

The Supabase Send Email Hook verifies its Standard Webhooks signature and
accepts only a `recovery` action. It re-derives the user's active profile and
live Super Admin assignment at send time, reads the private recovery contact,
and sends the token link there through Resend. It never sends to the hidden
Auth alias. Every other Auth mail action fails closed, which also prevents
user-initiated alias changes. Sender DNS, `RESEND_API_KEY`,
`SEND_EMAIL_HOOK_SECRET`, redirect allow-list, and hook enablement are
deployment prerequisites, not browser configuration.

The callback verifies the Supabase recovery token, reads the username from the
session's reserved Auth alias, and presents the same username/new
password/repeat-password form. Username mismatch does not update the password.
On success, Supabase updates the password and the recovery session continues
into the ordinary app. A stale link whose user has been deactivated or lost the
Super Admin role is stopped by the callback's fresh profile/assignment check
before password update.

This is the only additional session-mint path: it is Supabase's native,
single-use recovery session, available only to an active Super Admin. Ordinary
activation still returns no session.

Alternatives rejected:

- Sending custom invite codes directly would require inventing a parallel mail
  token lifecycle and provider retry contract.
- Making recovery email the Auth primary email would require a public
  username-to-email password proxy for everyday sign-in.
- Using Supabase SMTP without a hook would send to the non-deliverable Auth
  alias and could not enforce the live-owner check at delivery time.

### D9. Browser password-manager semantics are explicit and testable

Ordinary sign-in uses a navigable `<form>` whose username control has a stable
`name`, `autocomplete="username"`, and whose password control has
`autocomplete="current-password"`.

Activation and recovery use a navigable `<form>` whose username control has
`autocomplete="username"` and whose two password controls both use
`autocomplete="new-password"`. The repeated field remains a separate named
control. Successful submission results in a session plus client-side
navigation that removes the credential form; validation failures leave the form
and entered username visible.

Component and Playwright tests assert the DOM metadata, submitted values,
session, and navigation. A manual Chrome check records whether an ordinary,
non-incognito profile with password saving enabled offers the prompt, but the
acceptance gate does not assert browser-owned UI.

### D10. Migration is staged, owner-reviewed, and preserves account identity

The schema and application first deploy in a transitional state that can sign
in with either the current email or a canonical username. This compatibility
branch is explicitly temporary and is removed before the change is complete.
No new account can be created with staff email once the transitional release is
live.

An operator-only migration tool uses the service-role key outside the browser:

1. list all Auth users and live assignments;
2. propose a canonical username from each current address local-part, or from
   the profile name for a placeholder;
3. emit a local, access-restricted mapping file and stop on every collision,
   malformed suggestion, missing profile, or missing live-owner email;
4. require the owner to review and edit every username, then validate the
   complete business-wide namespace before `--apply`;
5. for each user, retain a real current address as private recovery contact
   only if the person holds a live Super Admin assignment, update the same Auth
   user to the derived alias through the Admin API, and leave password,
   identities, sessions, profile, assignments, attendance, and invites in
   place;
6. verify that every Auth user now has a canonical reserved alias, every and
   only live Super Admin has a recovery contact, no ordinary-role personal or
   placeholder address remains in live identity/contact data, and every
   outstanding invite previews the approved username.

The tool is idempotent and checkpoints by user ID. It never prints passwords,
invite hashes/codes, or recovery addresses to CI logs. The reviewed mapping is
sensitive migration material: it is not committed, is stored only in the
approved operator location during the rollback window, and is securely removed
after final verification.

After verification, the final release removes legacy email sign-in, email form
types and labels, placeholder-address states, and transitional tooling from
the runtime. Existing open sessions remain usable because authority is read
from assignments rather than the stale identifier claim in a token.

### D11. Rollout and rollback have an explicit point of no return

Rollout order:

1. Rehearse the mapping and cutover against a production-shaped local backup.
2. Configure and test sender DNS, Resend, the signed Send Email Hook, canonical
   callback URL, and recovery rate limits.
3. Deploy schema/functions plus the transitional sign-in release.
4. Generate, owner-review, and apply the production username mapping.
5. Run account, invite, RLS, and all-role authenticated probes; hand every
   active person their approved username.
6. Test owner recovery from an unauthenticated phone.
7. Deploy the final username-only release.
8. Verify no legacy email acceptance or ordinary-role email data remains, then
   close the rollback window and destroy the sensitive mapping copy.

Before step 8, rollback uses the reviewed mapping to restore Auth addresses via
the Admin API, removes recovery-contact rows, and returns to the transitional
email sign-in release. User IDs, hashes, and sessions still are not recreated.
After the mapping copy is destroyed and ordinary staff email is intentionally
gone, rollback is forward-only: repair usernames or recovery configuration
without attempting to resurrect deleted PII.

## Risks / Trade-offs

- **[A provider-shaped alias can be mistaken for real email]** → Use the
  reserved `.invalid` suffix, call it `authAlias` everywhere outside Supabase
  payloads, never display it, and add a repository sweep/test that fails on
  alias leakage.
- **[A hand-crafted Auth email update could bypass username administration]**
  → Keep Secure Email Change enabled, make the Send Email Hook fail closed for
  `email_change`, and add a real-backend probe proving the old/new alias does
  not change.
- **[Recovery email becomes high-value PII]** → Store it in a no-client-access
  table, never mirror or log it, reveal it only to the owner-management path,
  and re-check role/active state at both request and send/callback.
- **[Recovery requests can enumerate or harass the owner]** → Uniform public
  responses, hashed-IP/address cooldowns, Supabase recovery limits, no
  client-visible resolution result, and monitoring without raw addresses.
- **[The Send Email Hook is an external availability dependency]** → It affects
  only Super Admin self-recovery; ordinary sign-in and admin-issued reset
  remain local to Supabase and the app. Fail closed and document the owner
  fallback through another Super Admin or an operator.
- **[Changing Auth aliases one user at a time creates a mixed migration
  window]** → Deploy temporary dual sign-in first, checkpoint the tool, keep
  sessions alive, schedule a short supervised cutover, and remove compatibility
  only after a complete invariant report.
- **[Generated migration usernames can surprise staff]** → Suggestions are
  never applied automatically; the owner approves the full mapping and
  resolves every collision before `--apply`.
- **[Password-manager prompts vary by Chrome state]** → Contract only the
  standards-based form semantics and navigation under app control; record a
  manual Chrome observation without making browser UI an automated gate.
- **[Username changes leave a stale identifier in an already-issued JWT]** →
  JWT identity text is display-only and carries no authority. Database scope
  changes immediately; a later token refresh catches display metadata.
- **[A future username-domain change would invalidate deterministic aliases]**
  → Centralize the suffix and parser, version the migration tool, and treat any
  suffix change as another explicit identity migration.

## Migration Plan

The detailed operational sequence is D10–D11. Database migrations create the
private recovery-contact table, deferred Super Admin invariant, invite
username comparison, recovery attempt ledger/function, and hook permissions in
the same change. No outlet-scoped table is added; nevertheless, RLS/grant tests
must prove that anon, Employee, Biller, and Franchise Admin sessions cannot
read recovery contacts or obtain them through RPCs.

Generated TypeScript database types are refreshed after schema changes. Demo
fixtures migrate separately and contain invented usernames only. No production
email or migration mapping enters source control.

The change is not complete while any of these are true:

- a runtime sign-in path accepts a human email;
- a non-Super-Admin has a recovery-contact row;
- a Super Admin lacks one;
- an Auth identity lies outside the reserved alias domain;
- an activation/reset screen omits username confirmation or password-manager
  metadata;
- a future-facing roadmap/todo/seeded change still assumes ordinary staff email.

Money, business dates, billing immutability, offline outbox behavior, and all
outlet-scoped RLS policies are unchanged.

## Open Questions

None. Resend is the selected first transactional provider behind the Supabase
Send Email Hook; the hook boundary keeps a later provider swap operational
rather than architectural. The exact production usernames remain owner input
to the reviewed migration mapping, not an unresolved product decision.
