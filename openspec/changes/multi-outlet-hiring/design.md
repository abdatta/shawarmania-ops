## Context

Account creation currently accepts one `outletId`, inserts one assignment, and
then issues the activation code. That ordering is safe for the first
assignment, but it makes the natural two-step multi-outlet flow unsafe: adding
the second assignment fires `assignments_supersede_invites`, so the code the
admin just handed over stops working without any replacement being shown.

The change crosses the People surface, the typed account adapter seam, the mock
and Supabase implementations, the `admin-accounts` Edge Function, its
session-derived authority helpers, and the assignment/invite database
contract. The constraints that shape it are:

- authority remains a set of live `assignments`; no role or outlet is trusted
  from the request or copied into the access token;
- a Franchise Admin may provision only Biller or Employee assignments and only
  at every outlet they manage;
- the existing reassignment trigger remains the rule that an activation code
  never survives an authority change;
- a code is returned once and stored only as a hash;
- demo mode must exercise the same adapter contract without reaching Supabase;
- the form must remain usable on a phone, and the common one-outlet manager
  flow must not gain extra decisions.

No money, timestamp, business-day, billing, or offline-counter behavior changes
in this work. The People surface is online administration, so it does not join
the billing outbox.

## Goals / Non-Goals

**Goals:**

- Create one account with one role at one or more outlets, with every
  assignment present before one activation code is issued.
- Validate the complete requested outlet set from the caller's verified
  assignments before creating anything.
- Keep a one-outlet Franchise Admin's preselected, disabled outlet control
  behavior unchanged.
- Replace an outstanding activation code automatically and visibly when a
  permitted assignment grant or end changes that person's authority.
- Preserve the assignment supersession trigger and make assignment change plus
  conditional replacement invite one database transaction.
- Keep the real and demo adapters behaviorally aligned and prove the four-role
  demo walkthrough still works.

**Non-Goals:**

- Selecting a different role per outlet during creation.
- Bulk creation, CSV import, or more than one person per submission.
- Device enrollment or deciding which physical counter tablet a Biller uses.
- Weakening, disabling, or bypassing invite supersession on assignment change.
- Moving the existing assignment grant/end lifecycle controls into the create
  form.
- Making People administration work offline.

## Decisions

### D1. The create contract carries `outletIds`, with an empty set only for the owner role

`NewAccount` and the `provision` request use `outletIds: string[]`. A
`super_admin` request is valid only with an empty array; every outlet-scoped
role requires one or more distinct non-empty UUID strings. The old singular
`outletId` request is not retained because every caller is deployed from this
repository in the same release. Rejecting the old shape also prevents an
ambiguous compatibility rule from silently dropping outlets.

The Edge Function parses and validates the whole set before creating the auth
user. `mayProvision` accepts the set and requires every requested outlet to be
within the caller's live Franchise Admin assignments unless the caller is a
Super Admin. It does not trust the UI's filtering.

For a scoped role, all assignments are inserted in one Postgres statement and
the invite is issued only after that insert succeeds. Any profile, assignment,
or invite failure uses the existing auth-user deletion compensation; the
profile, assignments, and invites cascade with that cleanup. This is the
smallest cross-system all-or-nothing boundary available because Supabase Auth
and Postgres cannot share one client transaction.

Alternatives rejected:

- Repeatedly calling today's single-outlet provision path would create several
  accounts or expose a code between assignment writes.
- Keeping `outletId` beside optional `outletIds` would create two sources of
  truth and unclear conflict behavior.
- Issuing the code first and exempting the following assignment inserts from
  the trigger would let a handed-over credential outlive an authority change.

### D2. Multi-outlet creation uses an accessible checkbox group only when there is a choice

The form derives provisionable outlets from authority, not merely from every
outlet the session can see: all active outlets for a Super Admin, and only
`franchise_admin` assignment outlets for a Franchise Admin. With more than one
provisionable outlet it renders a fieldset of phone-sized checkbox rows under
the plural label **Outlets** and requires at least one selection. With exactly
one it keeps the existing singular, preselected, disabled select. A
`super_admin` target role hides the outlet control and submits an empty set.

The selected role stays singular and the optional joined date applies to every
created assignment. This matches the owner's decision that mixed-role people
are created with one role and receive any later mixed-role grant from the row
action.

Alternatives rejected:

- Native `<select multiple>` is hard to discover and awkward on a phone.
- Chips alone obscure checkbox state and need more custom keyboard behavior.
- Showing all outlets to a mixed-role Franchise Admin and relying on the Edge
  Function to refuse the wrong one would teach a capability they do not have.

### D3. Multi-outlet Billers remain representable; device enrollment owns the physical constraint

The form permits the same Biller role at several selected outlets. Assignments
describe the person, while `counter-devices-and-offline` will bind a physical
tablet to exactly one outlet. Constraining people here would prematurely encode
a device rule on the wrong entity and would make relief or cross-outlet Billers
need duplicate logins, contradicting the one-person/one-login model.

The present limitation that Billers sign in personally until device enrollment
remains documented; this change does not broaden a device session.

Alternative rejected: refusing more than one outlet for Billers would appear
safer but would conflate attribution with the future tablet security boundary.

### D4. Assignment changes conditionally reissue inside one database transaction

The Edge Function generates a candidate code and hash before each permitted
grant or end, then calls a service-role-only database RPC that:

1. locks the target profile so concurrent assignment changes serialize;
2. records whether an unconsumed, unsuperseded invite exists;
3. inserts or ends the assignment, allowing the unchanged trigger to supersede
   that invite;
4. calls `issue_account_invite` with the candidate hash only when step 2 found
   an invite; and
5. returns the assignment identity plus the database-authored invite expiry.

The RPC is not executable by `anon` or `authenticated`; ordinary clients still
meet the assignment RLS policies and triggers directly, while the privileged
Edge path re-derives caller authority before invoking it. This preserves the
database boundary for direct client writes and prevents a hand-crafted
privileged request from naming an outlet beyond the verified caller's
assignments.

The RPC transaction is necessary because an Edge sequence of “change
assignment, then issue” has an observable failure gap: an invite outage after
the first request would leave the assignment changed and the displayed code
dead. An Edge compensation is also rejected: an ended assignment is immutable,
and deleting a newly granted assignment would violate the history model.

The candidate plaintext code is returned by the Edge Function only when the
RPC says a replacement invite was created. Otherwise it is discarded. The
database still stores only its hash.

### D5. Grant and end return an optional issued code through the adapter seam

`grantAssignment` and `endAssignment` return `IssuedCode | null`. `null` means
no outstanding invite existed, so the assignment changed with no handover.
When a code is returned, the People surface closes the lifecycle sheet and
opens the existing `IssuedCodePanel` with the person's name and sign-in
address. The mock adapter detects its in-memory pending invite before the
change, replaces it after the change, and returns the same shape.

The replacement is automatic rather than warn-then-confirm. The admin already
confirmed the assignment mutation, and a second confirmation would offer no
safe “keep the old code” choice because the trigger must invalidate it.
Lifecycle copy states that an outstanding activation link will be replaced and
the new one shown.

If ending the final assignment also deactivates the account, the replacement
is still shown to satisfy the no-silent-invalidation contract, with an explicit
notice that the account must be reactivated before the link can be used.

Alternatives rejected:

- Returning only a boolean would force a second reissue request and recreate
  the failure gap.
- Reusing the old code would weaken the trigger's security semantics.
- Asking the admin to visit the separate “New code” action afterwards would
  preserve the current trap under a different instruction.

### D6. Verification proves the literal Gate at each boundary

Component tests cover the multi-checkbox create payload, all created demo
assignments, the unchanged one-outlet manager control, and the code panel after
grant/end. REST tests cover a real two-outlet provision and activation, a
Franchise Admin hand-crafted cross-outlet request with no residual auth user,
assignment-change reissue where the old code fails and the returned code
works, and no code returned when none was pending. Database tests cover RPC
execute privileges, atomic invite replacement, and preservation of the
supersession trigger.

The authenticated Playwright suite performs the owner multi-outlet create and
activation and retains the manager authority case. The normal demo Playwright
suite plus phone/tablet light/dark inspection proves the four-role walkthrough
and the new control without real-data writes.

## Risks / Trade-offs

- **[Auth and Postgres cannot share a transaction]** → keep creation ordered as
  auth user, profile, one bulk assignment insert, then invite, and delete the
  auth user on any later failure exactly as the existing path does.
- **[A mixed-role manager may see outlets they cannot administer]** → derive
  the form's options from live Franchise Admin assignments and recheck the
  entire set in `mayProvision`.
- **[Concurrent assignment changes can supersede a just-returned code]** →
  serialize per person with a profile-row lock. A later completed authority
  change still legitimately replaces the earlier code.
- **[The service-role RPC could become a privilege escalation surface]** →
  revoke execution from `public`, `anon`, and `authenticated`, grant only
  `service_role`, and keep caller verification and set-wide authority checks
  in the Edge Function.
- **[A deactivated account receives a replacement link it cannot yet use]** →
  show that state explicitly and require reactivation before handover/use.
- **[Checkbox density grows with franchise count]** → use a compact scrollable
  phone-sized group now; a searchable selector is deferred until outlet count
  makes the current control measurably unwieldy.

## Migration Plan

1. Add the service-role-only transactional assignment RPC and its pgTAP
   privilege/behavior tests. No table shape or data backfill is required.
2. Deploy the Edge Function and frontend together with the singular request
   shape removed from both.
3. Regenerate and verify database types if the new RPC changes generated
   declarations.
4. Run the fresh-stack database, RLS/REST, authenticated browser, normal
   browser, and full CI-equivalent gates.

Rollback is one application/Edge rollback plus a forward migration that drops
the new RPC signatures. Existing assignment and invite rows need no data
rollback: their shape is unchanged, and every completed mutation remains valid
under the prior trigger semantics.

## Open Questions

None. The seeded questions are resolved by D1 (one request shape), D2
(checkbox group only when useful), D3 (multi-outlet Billers allowed), and D5
(automatic visible reissue).
