# Tasks: people-shows-names-first

Behavioural tests come first and are proved to fail against the current code; the
identifier contract pinned by `attendance-reads-its-staff-directly` stays
unchanged across the rewrite.

## 1. Pin the behaviour

- [x] 1.1 `accounts-surface.test.tsx`: with the identities read held pending,
  names and outlets render and no username, status or action does; releasing it
  renders them; a rejected identities read keeps the rows and shows *Could not
  load sign-in details*; a manager's People lists a two-outlet person as *Managed
  by the owner* with no actions. Record the failures against the current surface.
  *Before:* all three failed; the manager case for the real reason — the demo
  offered full actions on the two-outlet person.

## 2. Database (design D3)

- [x] 2.1 Migration `20260926040000_people_reads_in_one_call.sql`:
  `account_identifier_facts()`, security definer, `search_path = ''`, service-role
  only, with a `comment on function`.
- [x] 2.2 pgTAP `61_people_reads_in_one_call.sql` per design D5.
- [x] 2.3 Reset the local stack, regenerate `database.types.ts`, inspect the diff.
  *Done:* the diff is exactly the new function's entry. pgTAP: 10 assertions.

## 3. The account function (design D4)

- [x] 3.1 `_shared/authority.ts`: `verifiedUserId`, with `callerFrom` composing it
  and `loadAccount` unchanged in behaviour.
- [x] 3.2 `admin-accounts`: `identifiers` resolved in two hops from
  `account_identifier_facts()`; `listUsers`, the three table reads and the
  per-account fingerprint calls removed from it.
- [x] 3.3 `account-flows.test.ts` green, the pinned identifier rules included.
  *Done:* 56/56. `identifiers` over 107 local accounts: 80–150 ms, against
  240–280 ms for the previous two-wave version.

## 4. Adapters and surface (design D1, D2)

- [x] 4.1 `adapters.ts`: `phone` on `RosterPerson`; `AccountIdentity`;
  `AccountsAdapter.listIdentities()`; the pure `joinAccount`.
- [x] 4.2 Live adapter: `listIdentities` calls the function; `listRoster` reads
  `phone`; `listAccounts` is the join of the two. Mock adapter likewise, with
  the existing mock behaviour unchanged.
- [x] 4.3 `accounts-surface.tsx`: three independent reads; rows from the roster
  with D2's membership; per-row placeholders; the failure message; refresh keeps
  the rows.
- [x] 4.4 Task 1.1 green; the rest of `accounts-surface.test.tsx` and the e2e
  suites green without weakening an assertion.
  *One e2e rewritten, not weakened:* `setup.spec.ts` asserted a manager's
  People offers *Show people who have left*. Only the demo ever did — its mock
  was unscoped; the database lets a manager read only people live at their
  outlets, and the attendance spec says a manager's list is exactly those. The
  departed toggle is now asserted as the owner, where it is true, and its
  absence as the manager. Two roster tests from the previous change updated for
  `phone`, still refusing any username, email or invite column.

## 5. Docs and gate

- [x] 5.1 `docs/SCREENS.md`, `docs/LIMITATIONS.md`, `docs/DATA_MODEL.md` per the
  proposal.
- [x] 5.2 `format`, `lint`, `typecheck`, `functions:typecheck`, `test`,
  `contrast`, `build`, `test:e2e`.
- [x] 5.3 Reset; `test:db`, `test:rls`, `test:e2e:auth`; types clean.
  *Done:* `test:db` 68 files / 2,613; `test:rls` six phases green;
  `test:e2e:auth` 31/31, then 29/31 on the rerun after the layout fix with the
  two billing specs (offline, two tablets) failing in a 7.4-minute run on the
  shared stack — both green on a fresh reset, and neither touches People.
- [x] 5.4 Browser check of the production build against the local stack as the
  owner and a Franchise Admin, phone and desktop, light and dark: rows before
  sign-in details, the placeholders, the manager's two-outlet row, zero console
  errors.
  *Done as the seeded Kalyani Franchise Admin* (the owner's view is covered by
  the surface tests and `test:e2e:auth`). With the account function held back
  3 s in the page: 50 rows listed, no usernames, a placeholder on every row;
  after it answered, 43 usernames and statuses, and *Synthetic Two Outlets* as
  *Managed by the owner* with Kalyani only and no menu. Phone dark and tablet
  light inspected by screenshot. **Found and fixed:** rows grew by 4 px when the
  menus landed; the menu's box and the username's line are now reserved, and
  46 of 50 rows keep their height exactly — the four that move carry synthetic
  usernames long enough to wrap. No failed request on a clean load.
- [ ] 5.5 GATE — the proposal's Gate line proved clause by clause. Production
  timings after the owner picks the deploy window, in the owner's browser. No
  ROADMAP.md row; not archived until the owner calls it.
  *Measured on production 2026-09-27* (deployed as 8293a0c, owner's browser,
  `/owner/team`): the roster read settled at 1.29, 2.48 and 1.57 s after
  navigation start, so names were on screen before the sign-in details every
  time; the account function took 3.27 s on the first call after the deploy,
  then 2.51 s and 1.75 s warm, against 2.4–3.4 s warm before. Names first holds;
  **the under-1.5 s warm clause does not** — two hops did not bring the function
  near the 0.55 s one-query baseline, so most of its time is not database
  round trips. Left unticked until that is understood.
