# Tasks: attendance-reads-its-staff-directly

Order matters: every behavioural test is written **first** and proved to fail
against the current code, and the identifier contract is pinned against the
current function before it is rewritten, so the rewrite is proved not to move it.

## 1. Pin the behaviour before changing it

- [x] 1.1 `outlet-attendance.test.tsx`: opening Attendance calls
  `accounts.listRoster` once and `accounts.listAccounts` never; re-rendering
  under a new session object with the same assignments calls `listRoster` no
  more times. Run it and record that it fails against the current surface.
  *Before (2026-09-26):* with `listAccounts` counted instead, the current surface
  read it **3 times** for one open under two session revalidations — the count
  production showed.
- [x] 1.2 `supabase/tests/rest/account-flows.test.ts`, against a freshly reset
  local stack: the `identifiers` response for the owner and for the Kalyani
  Franchise Admin — the exact set of account ids, which carry an account email,
  and each fingerprint equal to `account_state_fingerprint` for that id — green
  against the **current** function.
- [x] 1.3 Same file: signed in as the Kalyani Franchise Admin, a roster read
  (`profiles` with embedded `assignments`, as design D1) lists the seeded
  split-outlet staff member with their Kalyani Employee assignment and not their
  Kanchrapara one, while `identifiers` omits them; as the owner, every id in
  `identifiers` is in the roster.

## 2. The roster read (design D1)

- [x] 2.1 `adapters.ts`: `RosterPerson` and `AccountsAdapter.listRoster()`, with
  the doc comment from design D1.
- [x] 2.2 `supabase-adapters/accounts.ts`: `listRoster` — one `profiles` select
  of the roster columns with `assignments`, ordered by `full_name`, sharing the
  assignment mapping with `toSummary`; no function call.
- [x] 2.3 Unit test with a fake client: `listRoster` makes one request, to
  `profiles`, and invokes no function.
- [x] 2.4 `mock/accounts.ts`: `listRoster` projecting the demo accounts onto the
  five fields; a mock test that the demo roster matches `listAccounts` on them.
- [x] 2.5 Any other `AccountsAdapter` implementation or test double the
  typechecker names gains the method.

## 3. The surface (design D1, D2)

- [x] 3.1 `outlet-attendance.tsx`: load `listRoster` instead of `listAccounts`;
  `people`, `manualFor`, `recordManual` and the by-staff axis take
  `RosterPerson`. Update the file's header comment, which names `listAccounts`.
- [x] 3.2 Key the outlets-and-people effect on `isOwner` and the sorted outlet-id
  string rather than the `mine` array (D2).
- [x] 3.3 Task 1.1 green; the rest of `outlet-attendance.test.tsx` green without
  weakening an assertion.

## 4. The account function (design D3)

- [x] 4.1 `_shared/authority.ts`: extract `loadAccount`'s row mapping into an
  exported `toTargetAccount`, used by `loadAccount` unchanged.
- [x] 4.2 `admin-accounts/index.ts` `identifiers`: wave 1 concurrently
  (`listUsers`, owner-only `account_emails`, live invites, one bulk `profiles`
  read mapped through `toTargetAccount`); the visible set in memory by the
  unchanged rule; wave 2 the fingerprints concurrently, any failure still
  `lookup_failed`. Response shape and order unchanged.
- [x] 4.3 Task 1.2 and 1.3 green against the rewritten function (served locally
  from the working tree), and the rest of `account-flows.test.ts` green.

## 5. Docs and gate

- [x] 5.1 `docs/SCREENS.md` Attendance paragraph and `docs/LIMITATIONS.md` entry,
  per the proposal.
- [x] 5.2 `npm run format`, `lint`, `typecheck`, `functions:typecheck`, `test`,
  `contrast`, `build`, `test:e2e`.
- [x] 5.3 `test:db` and `test:rls` against a freshly reset local stack (shared;
  reset again if another session touched it mid-run).
  *Done:* reset, then `test:db` 67 files / 2,603 assertions; `test:rls` all six
  phases green (account-flows 56/56 with the three new cases); `test:e2e:auth`
  31/31; generated types clean. `identifiers` for the owner over 107 local
  accounts: 240–280 ms, against 1.7–2.3 s for the old loop.
- [x] 5.4 Browser check on the production build in demo mode as the owner and as
  a manager, phone and desktop, light and dark: the roll-call and the by-staff
  axis read as before; the network log shows no `admin-accounts` request from
  Attendance; zero console errors.
  *Done against the local stack instead of demo mode*, because only the live path
  can show the request: the production build signed in as the seeded Kalyani
  Franchise Admin. Attendance made 14 requests, **none** to `admin-accounts`; the
  day read started straight after the roster read; *Synthetic Two Outlets* was on
  the roll-call as *Counter staff*, not marked off the list. People loaded through
  the rewritten function (one call, 200). No failed request on either page. Demo
  mode is covered by the surface tests and `test:e2e` (both themes, phone and
  desktop); the change has no visual difference to inspect.
- [ ] 5.5 GATE — the proposal's Gate line proved literally, clause by clause,
  naming what proved each. The production timings are taken only after the owner
  picks the deploy window (**no push while the counter trades**), in the owner's
  own browser, repeating the 2026-09-25 table. This change carries no ROADMAP.md
  row on purpose, and is not archived until the owner has used it in production
  and calls it.
  *Proved locally 2026-09-26:* no `admin-accounts` request from Attendance
  (browser, network log; surface test); one outlets-and-people read per open under
  revalidation (surface test, failing 3× before); the manager's roll-call lists the
  split-outlet staff member (browser; REST test); People's identifiers unchanged
  by rule (REST tests pinned green before the rewrite and after) in two waves (code
  and 107-account timing). **Outstanding:** the production timings — Attendance
  under 2.5 s cold and People — wait for the owner's deploy window.
