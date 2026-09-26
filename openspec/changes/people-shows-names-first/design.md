# Design: people-shows-names-first

## Context

Measured on production on 2026-09-26 (proposal, *Why*). People's first effect is
`Promise.all([accounts.listAccounts(), outlets.listOutlets()])`, and nothing
renders until both land. `listAccounts` is a `profiles` read (~0.4 s) joined
client-side with the `admin-accounts` function's `identifiers` answer, keeping
only the profiles that answer names. Inside the function:

```
callerFrom:   auth.getUser(token)                       hop 1
              loadAccount(caller)                        hop 2
identifiers:  listUsers ‖ account_emails ‖ invites ‖ profiles   hop 3
              account_state_fingerprint × visible        hop 4
```

A warm call is ~2.4 s against ~0.55 s for a function making one database call,
which puts each hop at about 0.3 s. A cold call adds 1.5–2 s of start-up.

## Decisions

### D1. The list renders from the roster; sign-in facts join it later

People makes three independent reads at once: `listOutlets`, `listRoster` (from
`attendance-reads-its-staff-directly`, now also carrying `phone`, which Edit
needs), and the new `listIdentities`. It renders rows as soon as the roster and
outlets are in. Each row's username, account email, status and actions render
only once identities are in; before that the status cell is a placeholder the
height of its text and the actions cell is empty. A failed identities read
leaves the rows on screen and states *Could not load sign-in details*; the rows
offer no actions, because every action needs the fingerprint or the lifecycle.

The two halves meet in one pure function, `joinAccount(person, identity)` in
`adapters.ts`, which builds an `AccountSummary` with `deriveAccountLifecycle`
exactly as `listAccounts` does today. `listAccounts` becomes that join over the
two reads, so the People surface, the mock and every existing caller agree on one
definition.

After an action, `refresh` re-reads roster and identities together and keeps the
rows on screen while it does — a refresh never returns the list to a skeleton.

**Rejected: keep one read, show a skeleton until the function answers.** The
function is the slow part and usually cold; the names are not.

**Rejected: cache the last identities in the browser.** A username or invite
shown from a cache after it changed is a wrong status on a screen whose job is
account readiness (identity-and-access, *Every People surface states account
readiness truthfully*).

### D2. Who People lists

- **Owner**: every profile the roster returns, as today.
- **Franchise Admin**: every person on the roster holding a live assignment at an
  outlet they manage. A person the identities answer omits — the Franchise Admin
  may not manage them, because they also work at an outlet the Franchise Admin
  does not run — is listed with name, job and the assignments the Franchise Admin
  can see, no username and no actions, and the status *Managed by the owner*.

This resolves a contradiction between two requirements in favour of the more
specific one: *A manager maintains the outlet's staff list* (attendance) already
requires a two-outlet person on both managers' lists; *Admins manage accounts
from a task-based surface scoped to their authority* (identity) is amended by
this change's delta to say the **controls** are authority-scoped and the **list**
is the outlet's people. Nothing is widened: the manager could already read these
rows through `profiles_select` and the `assignments` policy, which is what
Attendance's roster does.

Membership is decided from the roster, not from the identities answer, so the
list never changes shape when the answer lands.

### D3. One database call for every account's identifier facts

A migration adds

```sql
public.account_identifier_facts()
returns table (
  profile_id uuid, auth_email text, last_sign_in_at timestamptz,
  account_email text, invite_purpose text, invite_expires_at timestamptz,
  is_active boolean, live_assignments jsonb, state_fingerprint text
)
language sql stable security definer set search_path = ''
```

over `profiles join auth.users` (the join `account_state_fingerprint` uses),
left-joined to `account_emails` and to the one live invite
(`consumed_at is null and superseded_at is null and expires_at > now()`, which
`account_invites_one_live_per_profile` makes unique). `live_assignments` is the
`role` and `outlet_id` of every assignment with `ended_on is null`, exactly what
`toTargetAccount` builds. `state_fingerprint` is
`public.account_state_fingerprint(p.id)` — the one definition, called per row
inside the database rather than restated, so the list and every edit's
stale-state check cannot disagree. `revoke all … from public, anon,
authenticated; grant execute … to service_role`, as the fingerprint is.

**RLS, called out:** the function is security definer and reads `auth.users`, so
it is service-only and never reachable by a client. It does not decide who may
see what; the edge function still filters every row through `mayManage` and the
account-email rule, unchanged.

**Rejected: parallel per-account fingerprint calls in the first wave.** They need
the account ids, which are the first wave's answer, so they are a second wave by
construction.

### D4. `identifiers` in two hops

`_shared/authority.ts` splits `callerFrom` into `verifiedUserId(req, service)` —
the token check alone, with the same `session_invalid` / `backend_failure`
classification — and the existing `loadAccount` step. `callerFrom` composes the
two and is unchanged for every other action.

The handler resolves `identifiers` before the general path: verify the token
(hop 1), then call `account_identifier_facts()` (hop 2). The caller is the row
whose `profile_id` is the verified user; no row, or `is_active` false, is
`session_invalid`, exactly as `loadAccount` returning null or inactive is. Every
other row goes through the unchanged `mayManage` and account-email rules, and the
username through `authAliasToUsername` as now. `too_many_accounts` still applies
at 1,000 rows.

The request body is read before the token is verified, as now for every action;
nothing privileged runs before the token is verified.

### D5. Testing

- **pgTAP** (`61_people_reads_in_one_call.sql`): the function returns one row per
  profile with an auth user; `state_fingerprint` equals
  `account_state_fingerprint` for every row; the live invite is the one live
  invite and an expired or consumed one is absent; `live_assignments` omits ended
  rows; `anon` and `authenticated` cannot execute it.
- **REST** (`account-flows.test.ts`): the rules pinned by the previous change stay
  green unchanged against the rewritten action — which accounts, which carry an
  email, and fingerprints that do not depend on the asker.
- **Surface** (`accounts-surface.test.tsx`, mock adapters): with identities held
  pending, the names render and no username, status text or action does; releasing
  it renders them; a failed identities read leaves the rows and states the
  failure; a manager's list includes a two-outlet person with *Managed by the
  owner* and no actions. Written first and proved to fail.
