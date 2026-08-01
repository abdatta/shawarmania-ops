## 1. Reachability, as a second question

- [x] 1.1 Add `reachableRoles(session)` to `src/session/session.ts` beside `heldRoles`: held roles, plus `franchise_admin` for a session holding `super_admin`, ordered by the existing seniority order (D1). Document at the definition that it governs shells and navigation only and confers nothing, and that `heldRoles` remains the answer to "which roles does this person hold".
- [x] 1.2 Unit-test `reachableRoles`: an owner with no assignment reaches the manager surfaces; an owner who also manages an outlet reaches the same set with no duplicate; a manager, a biller and an employee each reach exactly what they hold; nobody reaches `biller` or `employee` by reaching alone.
- [x] 1.3 Switch the three gates to reachability: `visibleSurfaces(reachableRoles(session), mode)` in `src/shell/phone-shell.tsx`, the surface lookup in `src/routes/gated-surface.tsx`, and the role-path check in `src/auth/real-root.tsx`. The landing redirect and the shell choice keep using the **held** primary role, so the owner still lands on `/owner`.
- [x] 1.4 Leave `src/shell/counter-shell.tsx` and `src/auth/account-menu.tsx` on `heldRoles`, and add a test that the account menu of an owner holding no outlet assignment names the owner role only (D1).
- [x] 1.5 Update `src/gates/registry.test.ts` and the shell tests so the owner's navigation and routes are asserted against the new rule rather than the old one: an owner with no assignment gets the outlet-level entries and reaches `admin-attendance`; a biller still gets not-found for a manager path.
- [x] 1.6 Link navigation entries inside the shell the reader is in (D1a, found during implementation and decided by the owner on 2026-08-01): the owner's Attendance is `/owner/attendance`. A home keeps its own role's segment, and `visibleSurfaces` takes the held roles so a merely reachable role contributes no second home.
- [x] 1.7 Test the addressing rule: the owner's entries all sit under their own shell and there is one home; a demo owner's manager surfaces keep the owner persona; a manager who is also staff keeps both homes and their own check-in surface stays reachable.

## 2. The drawer boundary, unmoved and asserted

- [x] 2.1 Confirm `useOutletScope().managed` still derives from `franchise_admin` assignment membership only, and add a comment tying it to D2: reaching a surface is not managing the outlet.
- [x] 2.2 Add a test that an owner holding no assignment sees the cash surface's day with neither a close nor a withdrawal offered, and the expenses surface narrowed to its non-cash path, exactly as an owner-not-managing sees today.

## 3. The attendance roll-call is a staff question

- [x] 3.1 Add `isStaffAt(account, outletId)` to `src/data-access/adapters.ts` — a live `employee` assignment at that outlet — documented against D3. Keep the assignment-shaped predicate for the people surfaces and rename it so the two rules are not mistaken for each other; drop the unused twin.
- [x] 3.2 Use `isStaffAt` for the attendance surface's people list, so a Super Admin or Franchise Admin appears only when they also hold a staff assignment there.
- [x] 3.3 In the day view, list anybody carrying a record on the day shown who is not on the staff list, rendered from `AttendanceRecord.personName` with no extra read (D4). Offer Approve on such a row; do not offer Record arrival.
- [x] 3.4 Keep the by-person picker to staff only (D5), and confirm the person-range read still names its outlet explicitly.
- [x] 3.5 Test the roll-call rules in `src/features/attendance/outlet-attendance.test.tsx`: a manager with no staff assignment is absent from the day and present on People; a manager who is also staff is listed; a non-staff person carrying a waiting row is listed and approvable, and the badge that counted them clears; the by-person picker offers staff only.

## 4. One remembered outlet

- [x] 4.1 Add the remembered-outlet store used by `src/features/outlet-scope.tsx`: one `localStorage` key namespaced by the signed-in person's id, a separate namespace for demo, read on initialise, written on change, and every storage failure swallowed so a browser refusing storage degrades to today's behaviour (D6).
- [x] 4.2 Validate on read against the outlets the caller may see: a remembered outlet not in that list is replaced by the existing default and rewritten, never rendered and never left blank.
- [x] 4.3 Clear the remembered outlet when the session ends, in the same path that ends the session.
- [x] 4.4 Test: a choice on one surface is what the next surface opens on; a choice survives a remount; a remembered outlet the person may no longer see falls back to the default; signing out forgets it; and the selection still changes nothing about what a write may do.

## 5. The demo walks it

- [x] 5.1 Keep the demo owner's Franchise Admin assignment at Kalyani (D10) and confirm the persona now reaches Kanchrapara's outlet-level surfaces without one.
- [x] 5.2 Give the demo dataset a waiting arrival at Kanchrapara the owner can approve, so the owner's unassigned reach is walkable rather than asserted.
- [x] 5.3 Confirm the demo owner appears on neither outlet's attendance day, holding no staff assignment at either, and update any demo test that expected them.
- [x] 5.4 Walk the four-role demo end to end and confirm the trading day still reconciles. Walked by `npm run test:e2e` (170 passing, including the four-role demo, owner console and counter specs) plus a look at the built app.

## 5a. What the built app showed

- [x] 5a.1 `PageHeader` wraps rather than squeezing (D9a): beside a wide outlet selector on a 390 px phone the title column collapsed and its subtitle wrapped down the screen. Found by looking at the built app; fixed in the one component, with the wide layouts unchanged.

## 6. The database proof

- [x] 6.1 Extend the isolation suite (`supabase/tests/`) with an owner holding **no** assignment anywhere: they read an outlet's attendance, approve a waiting day there, and record a manual entry there (D8).
- [x] 6.2 In the same suite, assert that the same session is refused a cash withdrawal and a day close at that outlet, by direct statement rather than through the UI (D2).
- [x] 6.3 Confirm no migration and no policy change were needed, and say so in the change's verification notes rather than leaving it implied. **Confirmed**: `supabase/migrations/` is untouched by this change; `17_owner_reach.sql` is the only database file added, and it asserts branches that already existed.

## 7. Production, checked and cleaned (2026-08-01)

Run against the production project rather than deferred, on the owner's authorisation, hours before go-live. Reads first, then one guarded write, then a rolled-back proof.

- [x] 7.1 Attendance rows whose subject holds no staff assignment at the row's outlet: **none.** Production holds 2 attendance rows, both for staff at their own outlet, so D4's clause is insurance rather than load-bearing. Recorded in [`counter-devices-and-offline`](../counter-devices-and-offline/proposal.md) (#9), where the biller half of the question still waits.
- [x] 7.2 Self-granted owner assignments: **four found, all four deleted** — both Super Admins held Franchise Admin at both outlets, appointed only to reach the screens this change now reaches without them. Deleted rather than ended, by owner decision on a database with no trading data (the never-delete invariant is about keeping written rows explicable, and nothing had been written under these). Every account was left untouched: 7 profiles before and after, 8 live assignments remaining, all of them staff. A restorable snapshot of all 14 assignment rows was taken first, and no table references `assignments` by foreign key.
- [x] 7.3 Prove the owner's reach **on production**, under real policies, for each owner at each outlet: they read that outlet's attendance, approve a waiting arrival on a closed business day from off site (the strictest path the rule has), record a manual arrival, and are refused a cash withdrawal. Run inside a transaction that was rolled back: production ended with the same 2 attendance rows, 1 approval, 8 live assignments and 0 withdrawals it started with.
- [x] 7.4 Note the consequence rather than paper over it: **no live Franchise Admin assignment exists at either outlet now.** Nothing is blocked today — approvals run on the owner branch, and every cash surface is still demo-gated in real mode — but the drawer becomes unreachable for everybody the moment #12 promotes it. Recorded there as part of that change's own boundary question.

## 7a. A calendar trap the final run walked into

- [x] 7a.1 Nine tests began failing mid-session with no code change — five in Vitest, four in Playwright — because the demo's business day rolled over to **1 August** while every attendance fixture is authored as business days back from today and both person views default to this month. Confirmed pre-existing by stashing this change and reproducing on `HEAD`, in both suites.
- [x] 7a.2 Fixed in the tests, not in the product (owner, 2026-08-01): **the current-month default stays, empty or not** — on the 1st of a month there really are no days yet, the screen names the month it shows, and the previous one is a tap away. The four range-reading scopes now pin `Date` themselves: two Vitest scopes via fake `Date` with real timers, two Playwright specs via `page.clock.setFixedTime`, each with the reason written at the pin. Anything asserting *today* was left alone.
- [x] 7a.3 The remaining weakness is the demo's fixtures rather than any surface, so it is recorded as [a demo-data item](../../todos/month-boundary-empties-fixture-ranges.md) with the three ways out, not carried here.

## 8. Docs

- [x] 8.1 `docs/ROLES_AND_PERMISSIONS.md` — the owner reaches every outlet's operational surfaces without an assignment, and the drawer boundary that survives it; the capability-matrix rows that currently say a Franchise Admin checks in for themselves become "only when also staff".
- [x] 8.2 `docs/SCREENS.md` — who appears on the attendance day, and the outlet selector being remembered across surfaces.
- [x] 8.3 `docs/ARCHITECTURE.md` — reachable roles beside held roles, and why they are different questions.
- [x] 8.4 `docs/DEMO_MODE.md` — the owner's walk at both outlets, and what differs between them.
- [x] 8.5 `docs/LIMITATIONS.md` — the remembered outlet is per device and per browser profile; a non-staff person's recorded rows are reachable by day and not through the by-person view.

## 9. Verification

- [x] 9.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, `npm run test:e2e`.
- [x] 9.2 Docker-backed: `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls`, `npm run test:e2e:auth`. The auth suite is in the blast radius: this change edits what every role's navigation and role paths resolve to.
- [x] 9.3 Run the app and look at it on a phone viewport and a tablet viewport, in both themes: the owner's navigation, an outlet's attendance day, and the outlet selector remembering across two surfaces and a reload.

## 10. PHASE GATE

- [x] 10.1 **Gate**: a Super Admin holding no outlet assignment opens any outlet's attendance from their own navigation, approves a waiting day there, and records a manual entry there; the same session is offered neither a day close nor a withdrawal at that outlet and the database refuses both, proved by a hand-crafted request; no Super Admin or Franchise Admin appears on an outlet's attendance day unless they hold a staff assignment at it, while a person carrying a recorded row on the day shown still appears so the count that named them can be cleared; an outlet chosen on one outlet-scoped surface is the outlet every other one opens on, after a reload, and is gone after signing out; and the four-role demo walkthrough still walks.
