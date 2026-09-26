# Design: attendance-reads-its-staff-directly

## Context

Measured on production on 2026-09-25 (proposal, *Why*). The Attendance surface's
first effect is

```ts
Promise.all([outletsAdapter.listOutlets(), accounts.listAccounts()])
```

and the day view only mounts once both have landed. `listAccounts` is itself two
reads in parallel — `profiles` with `assignments` through PostgREST (~0.4 s), and
the `admin-accounts` function's `identifiers` action (6–10 s) — and keeps only the
profiles the function returned.

Inside the function, `identifiers` is:

```
listUsers                       1 call
account_emails (owner only)     1 call   ─┐ sequential, though independent
live account_invites            1 call  ─┘
for each auth user:
  loadAccount(user.id)          1 call   ─┐ sequential, per account
  account_state_fingerprint     1 call   ─┘
```

so its cost is `3 + 2N` round trips from the function to the database.

The effect's dependencies are `[outletsAdapter, accounts, isOwner, mine]`, where
`mine = useMemo(() => sessionOutlets(session), [session])`. The adapters are
created once (`real-root.tsx`), but the session object is replaced on
revalidation, so `mine` is a new array with the same contents and the effect runs
again. The day view waits on the last run.

## Decisions

### D1. Attendance reads a roster, not accounts

`AccountsAdapter` gains

```ts
/**
 * Everybody the caller may see, with what the roll-call needs to place them:
 * name, job title, active flag and assignments. No identifier, invite or
 * fingerprint — those are People's, behind the privileged function.
 */
listRoster(): Promise<RosterPerson[]>
```

with `RosterPerson = Pick<AccountSummary, 'id' | 'fullName' | 'roleTitle' | 'isActive' | 'assignments'>`.

- **Live adapter**: one `profiles` select with the embedded `assignments`, the
  same `PROFILE_COLUMNS` minus `phone`, ordered by `full_name`, mapped by the same
  assignment mapping `toSummary` uses. No call to `admin-accounts`.
- **Mock adapter**: the demo accounts projected onto the same five fields, so the
  demo roll-call is unchanged.

`OutletAttendance` and everything under it that takes `AccountSummary` for a
person on the roll-call — `people`, `manualFor`, `recordManual`, the by-staff
axis — take `RosterPerson` instead. The fields they read are exactly those five
(`id`, `fullName`, `roleTitle`, `isActive`, `assignments` through `isStaffAt` and
`wasStaffAtOn`), so the narrower type is a compile-time proof that Attendance
never needed the rest.

**Who is listed changes in one case, deliberately.** Today the roll-call's people
are the profiles the reader may *see* intersected with the accounts they may
*manage*. For the owner the two are the same set. For a Franchise Admin the
intersection drops anybody holding an assignment at an outlet they do not run —
somebody who works at both shops. After this change the roll-call's people are
those the reader may see, which is what `profiles_select`
(`app_may_see_person`: a shared live outlet) and the `assignments` policy already
answer. That is what the attendance spec has always required (*A manager reviews
the outlet's attendance day*: "every person holding a live staff assignment at an
outlet in scope"); the delta adds the scenario that pins it.

Nothing is widened: the reader could already read these rows through
`listAccounts`'s own `profiles` read; the intersection discarded them client-side
afterwards. And the manager still sees only the assignment at the outlet they
share with the person, not the other outlet's.

**RLS, called out:** no policy changes. The read is an ordinary `authenticated`
select through `profiles_select` and the `assignments` select policy.

### D2. The outlets-and-people read is keyed on what it depends on

The effect's dependency on the session becomes the sorted outlet-id string
(`mine.join(',')`) and `isOwner`, both primitives. A revalidated session with the
same assignments no longer re-reads; one whose assignments did change still does.

### D3. `identifiers` in a fixed number of round trips

Rewritten as:

1. **Wave 1, concurrently**: `listUsers`, the owner-only `account_emails`, the
   live `account_invites`, and **one** `profiles` select of `id, is_active,
   assignments(role, outlet_id, ended_on)` for every profile — the columns
   `loadAccount` reads, mapped through the same live-only rule. `loadAccount`'s
   mapping is extracted to a shared `toTargetAccount` in `_shared/authority.ts`
   so the per-account and bulk paths cannot drift.
2. The visible set is computed in memory with the unchanged `mayManage` rule and
   the caller's own id, exactly as the loop decides it now; a user with no profile
   row is skipped exactly as `loadAccount` returning null skips it now.
3. **Wave 2, concurrently**: `account_state_fingerprint` for each visible
   account. Any error or non-string result still fails the whole response with
   `lookup_failed`, as now.

Two waves regardless of N. The response object is built in the same user order
with the same fields.

**Rejected: a batched `account_state_fingerprints(uuid[])` SQL function.** One
round trip instead of N concurrent ones, but it is a migration and a second
definition of the fingerprint to keep equal to the first. N concurrent calls
from the function to the database, in the same region, cost about one round
trip; the migration buys nothing measurable at thirty accounts. Revisit if the
account count reaches the hundreds.

**Rejected: calling the fingerprint only for People's edit path.** The fingerprint
is part of the list response People renders from and sends back on every edit;
moving it is a contract change to the privileged function and to People, for a
cost D3 already removes.

### D4. Rejected for Attendance

- **Keep `listAccounts` and start the day read without waiting for it.** Faster
  to first paint, but the roll-call cannot be drawn without the people, so the
  screen would still sit on its skeleton for the same eight seconds — and it
  would keep the manage-filter defect.
- **Read people inside `attendance`'s own adapter.** Staff membership is an
  accounts question; `AttendanceAdapter` stays about attendance rows. The roster
  sits beside `listAccounts` so the two projections of one table are next to each
  other.
- **Cache the People list for Attendance.** A second place a deactivation could
  be stale, and still eight seconds on the first open of the day.

## Testing

- **Surface** (`outlet-attendance.test.tsx`, mock adapters): opening Attendance
  calls `listRoster` once and `listAccounts` never; re-rendering under a new
  session object with the same assignments does not call `listRoster` again.
  Written first and proved to fail against the current surface.
- **REST** (`account-flows.test.ts`, local stack): signed in as the Kalyani
  Franchise Admin, the roster read lists the seeded split-outlet staff member
  with their Kalyani staff assignment and without their Kanchrapara one, while
  `identifiers` still omits them. Signed in as the owner, the roster covers every
  profile `identifiers` covers.
- **Identifier contract** (same file): the `identifiers` response for the owner
  and for the Kalyani Franchise Admin — which accounts, which carry an account
  email, and that fingerprints are the ones `account_state_fingerprint` returns —
  pinned against the current function **before** D3 and kept green after it.
- **Adapter** (`supabase-adapters/accounts` unit test with a fake client):
  `listRoster` makes one request, to `profiles`, and never invokes a function.
