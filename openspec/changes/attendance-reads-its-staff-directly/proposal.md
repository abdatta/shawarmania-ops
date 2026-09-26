# Proposal: attendance-reads-its-staff-directly

> **Model**: Opus · **Roadmap**: deliberately unlisted — this corrects a shipped
> surface rather than sequencing new capability, so it takes a change folder and
> no row · **Gate**: on production, signed in as the owner, Attendance's
> roll-call starts reading its day within one round trip of the page's first
> reads rather than behind the account function, and settles in under 2.5 s cold
> on the connection that measured 9.7 s and 8.6 s on 2026-09-25; opening
> Attendance makes **no** request to `admin-accounts`; the outlets-and-people read
> runs once per page open, not again when the session is revalidated; a Franchise
> Admin's roll-call lists a staff member who also works at an outlet that
> Franchise Admin does not run; People lists the same accounts with the same
> usernames, invites and fingerprints as before, and its `identifiers` response
> costs a fixed number of database round trips whatever the number of accounts.

## Why

The owner reported on 2026-09-25 that Attendance, one of the most used screens,
loads very slowly. It was measured that day on production, in the owner's own
signed-in browser, twice:

| Reading | Load 1 | Load 2 |
|---|---|---|
| `admin-accounts` (the People list) | 8.2 s, requested 3 times | 6.0–7.1 s, requested twice |
| The day's attendance and who is elsewhere | 0.48 s | 0.50 s |
| The roll-call's day read **starts** at | 9.7 s | 8.6 s |

Roughly 95 % of the wait is one request the screen barely uses.

**Attendance loads the whole People list to learn who is staff.** The roll-call
needs, for everybody at the outlets in scope, a name, a job title, whether the
account is active, and the assignments. All of that is on `profiles` and
`assignments` and comes back in one ordinary read. But the screen asks
`listAccounts`, which also calls the `admin-accounts` function for usernames,
live invites and state fingerprints — what People needs to manage an account,
and nothing Attendance shows.

**That function makes two database calls per account, one after another.** For
each account it loads the account to decide whether the caller may manage it,
then asks for its fingerprint; about thirty accounts means about sixty sequential
round trips on every call. People pays the same eight seconds.

**The screen asks two or three times.** Its outlets-and-people read re-runs
whenever the session object is replaced — which a token refresh or a session
revalidation does — and the day waits on the last of them.

**And the manage filter hides people from managers.** `listAccounts` keeps only
the accounts the function returns, and the function returns only accounts the
caller may *manage* — for a Franchise Admin, somebody every one of whose
assignments is at an outlet they run. A staff member who also works at the other
outlet is somebody the Kalyani manager may not deactivate, correctly; but they
are also, today, silently missing from the Kalyani manager's roll-call, which the
attendance spec already says lists **every** person holding a live staff
assignment at an outlet in scope. The listed-because-recorded fallback shows
them once they check in, and hides them again on a day they did not.

## What changes

**Attendance opens without waiting for the account function.** It reads the
people it lists — name, job title, active flag, assignments — directly, in one
request, scoped by the same row-level policies that already decide who a reader
may see. Nothing on the roll-call or the by-staff axis reads differently, except
the next point.

**A manager's roll-call lists every staff member at their outlets**, including
somebody who also works elsewhere. Who is listed is decided by what the reader
may *see*, which the database already answers, not by what they may *manage*.

**The outlets and people are read once per open**, not again on a session
refresh that changes nothing about which outlets the reader works at.

**People loads in a fixed number of round trips.** The account function loads
every account's authority in one read and asks for the fingerprints together
rather than one after another. The response is identical: the same accounts,
the same usernames, the same invites, the same fingerprints, the same refusals.

## Non-goals

- **No change to who may see or manage anybody.** No policy, no function grant,
  no change to `mayManage` or to what the identifier response contains or
  refuses. The new read goes through the existing `profiles_select` and
  `assignments` policies.
- **No usernames, invites or account emails on Attendance.** They stay behind
  the privileged function (identity-and-access, *Login identifiers and account
  emails stay off the counter tablet*); the new read selects none of them.
- **No change to what the roll-call shows for a row**, its order, its actions or
  the by-staff axis.
- **No migration.** Fingerprints are fetched concurrently rather than through a
  new batched SQL function (design D3).
- **No caching of people across pages.** One read is cheap enough that a cache
  would only be a second place a deactivation could go stale.
- **No change to the People screen's own UI or its double read on refresh.**

## Docs to update before archiving

- `docs/SCREENS.md` — the Attendance paragraph: who is on the roll-call is who
  the reader may see at the outlets in scope.
- `docs/LIMITATIONS.md` — beside the ledger's measured entry: Attendance and
  People, the 2026-09-25 production figures, and the rule that a screen does not
  borrow another screen's privileged read for data it can read directly.
- `openspec/specs/attendance-and-location/spec.md` — via the delta in this change
  folder.

## How to run the gate

- `npm run format`, then `npm run lint`, `npm run typecheck`,
  `npm run functions:typecheck` (Deno lives at `~/.deno/bin`), `npm test`,
  `npm run contrast`, `npm run build`, `npm run test:e2e`.
- `npm run test:db` and `npm run test:rls` against a freshly reset local stack
  (the stack is shared with other sessions — reset before trusting it),
  including the new roster and identifier cases in `account-flows.test.ts`.
- On production after the owner picks the deploy window, in the owner's own
  browser: repeat the 2026-09-25 table — Attendance cold, twice — and People
  once, and compare.
