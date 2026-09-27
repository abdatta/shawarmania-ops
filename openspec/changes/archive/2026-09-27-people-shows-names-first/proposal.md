# Proposal: people-shows-names-first

> **Model**: Opus · **Roadmap**: deliberately unlisted — this corrects a shipped
> surface rather than sequencing new capability, so it takes a change folder and
> no row · **Gate**: on production, signed in as the owner, People's names, jobs
> and outlets are on screen within one round trip of the page's first reads — in
> under 1.5 s on a cold open — before the account function has answered; the
> account function's `identifiers` answer settles in under 1.5 s warm on the
> connection that measured 2.4 s on 2026-09-26, making two database round trips
> whatever the number of accounts; a row's username, status and actions appear
> when that answer lands and never before; a Franchise Admin's People lists every
> person holding a live assignment at an outlet they manage, with actions only on
> the accounts they may manage; and the identifier response — which accounts,
> usernames, account emails, invites and fingerprints — is unchanged.

## Why

After `attendance-reads-its-staff-directly` shipped, People was measured on
production on 2026-09-26 in the owner's browser:

| Reading | Time |
|---|---|
| People's `identifiers` call, just after a deploy | 4.5 s |
| The same, warm | 2.4–3.4 s |
| A one-query function in the same project, first call | 2.0 s |
| The same, warm | 0.52–0.58 s |

**Each database call the function makes costs about 0.3 s, and `identifiers`
makes four in a row**: it verifies the token, loads the caller's account, reads
the users, emails, invites and profiles, and then asks for each account's
fingerprint. Production holds seven accounts, so collapsing the per-account loop
in the previous change saved little; the waves are the cost.

**And the function is usually cold.** People is opened rarely, so the first open
of a session pays about 1.5–2 s of start-up that no change inside the function can
remove. The list of people waits for all of it, although its names, jobs and
outlets are one ordinary read the client already makes for Attendance.

Reading the surface for this found the same defect Attendance had, on People:
a Franchise Admin's People lists only the accounts they may *manage*, so somebody
who also works at another outlet is missing from their outlet's list. The
attendance spec (*A manager maintains the outlet's staff list*) says that person
appears on both outlets' lists; the identity spec (*Admins manage accounts from a
task-based surface scoped to their authority*) says the Franchise Admin's list
holds only accounts they may manage. The code follows the second and breaks the
first.

## What changes

**People shows its people first.** Names, job titles and where each person works
come from the roster read Attendance already uses and are on screen as soon as
it lands. Each row's username, status and actions fill in when the account
function answers; until then the status is a placeholder in its own shape and the
row offers no actions. If the account function fails, the list stays and says it
could not load sign-in details.

**The account function answers in two round trips.** One new server function
returns, for every account, exactly what the list needs — the sign-in alias, the
last sign-in, the account email, the live invite, the active flag, the live
assignments and the fingerprint (computed by the existing definition, so an edit
can never disagree with it). The function verifies the caller's token and then
makes that one call; who is answered for, and with what, is decided exactly as
now.

**A manager's People lists everybody at their outlets.** Every person holding a
live assignment at an outlet a Franchise Admin manages is listed. Those they may
not manage — somebody who also works at an outlet they do not run — are listed
without a username or actions, and the row says the owner manages that account.

## Non-goals

- **No change to who may manage whom**, or to what the identifier response
  contains or refuses. Usernames, account emails and invites still leave the
  database only through the privileged function, to the same callers.
- **No keep-warm pinging** of the function. It would cost invocations forever to
  hide a start-up that names-first already takes off the critical path.
- **No change to the People screen's layout, columns, menus or sheets.**
- **No change to `callerFrom` for any other action.** Only `identifiers` takes
  the shorter path.
- **No offline path.** People has never worked offline.

## Docs to update before archiving

- `docs/SCREENS.md` — the People paragraph: names first, sign-in facts after, and
  a manager's list is their outlets' people.
- `docs/LIMITATIONS.md` — the entry added by `attendance-reads-its-staff-directly`:
  People's figures, and that a rarely used function starts cold.
- `docs/DATA_MODEL.md` — the new service-only function, beside
  `account_state_fingerprint`.
- `openspec/specs/identity-and-access/spec.md` — via the delta in this folder.

## How to run the gate

- `npm run format`, then `npm run lint`, `npm run typecheck`,
  `npm run functions:typecheck` (Deno at `~/.deno/bin`), `npm test`,
  `npm run contrast`, `npm run build`, `npm run test:e2e`.
- Reset the shared local stack; `npm run test:db`, `npm run test:rls`,
  `npm run test:e2e:auth`; regenerate `database.types.ts` and inspect the diff.
- On production after the owner picks the deploy window, in the owner's browser:
  People cold and warm, recording when the rows appear and when `identifiers`
  settles.
