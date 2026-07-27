# Tasks: outlet-and-staff-setup

## 1. Database

- [x] 1.1 Migration `20260727000003_outlet_active_checkin.sql`: refuse a check-in
      whose outlet is `is_active = false`, in the attendance write path, leaving
      check-out and every existing verdict untouched (design D9)
- [x] 1.2 pgTAP `09_outlet_and_staff_setup.sql`: check-in refused at a
      deactivated outlet; check-out accepted at the same outlet; reactivation
      restores check-in
- [x] 1.3 pgTAP: linking authority — a Franchise Admin links within their own
      outlet; a cross-outlet link raises; a second link to an already-linked
      profile is refused by the unique constraint; a Franchise Admin cannot
      write a link on another outlet's roster row
- [x] 1.4 pgTAP: outlet writes — a Super Admin inserts and updates; a Franchise
      Admin's insert and update are both refused
- [x] 1.5 Regenerate `src/data-access/database.types.ts` if the migration changes
      any type surface (it should not — confirm rather than assume)

## 2. The adapter seam

- [x] 2.1 `DataActionError(code, message)` base in `adapters.ts`;
      `AccountActionError` and `AttendanceActionError` extend it with no change
      to their names or behaviour (design D8)
- [x] 2.2 `OutletsAdapter`: `createOutlet(NewOutlet)`, `updateOutlet(id, OutletPatch)`,
      and `listOutlets({ includeInactive })` so the owner's management view can
      see a deactivated outlet while assignment lists cannot
- [x] 2.3 `EmployeeSummary.linkedAccount: { id, fullName, isActive } | null`;
      `EmployeesAdapter.linkAccount(employeeId, profileId)` and
      `unlinkAccount(employeeId)`; `createEmployee` accepts an optional
      `profileId`
- [x] 2.4 Supabase outlets adapter: implement 2.2, mapping a duplicate `code` to
      a `DataActionError('code_taken', …)`
- [x] 2.5 Supabase employees adapter: embedded select for `linkedAccount`
      (design D7), link/unlink writes, `profile_id` on insert; map the
      same-outlet trigger and the `profile_id` unique violation to legible codes
- [x] 2.6 Mock outlets adapter: stateful create/update, code collision, and the
      `includeInactive` filter
- [x] 2.7 Mock employees adapter: `linkedAccount` resolved from the account
      fixtures, link/unlink, and the same refusals as the real adapter
- [x] 2.8 Mock accounts adapter: stop minting ids in the
      `d2000000-0000-4000-a000-…` range that collides with the employee
      fixtures (design D11)
- [x] 2.9 Demo fixtures: one Kalyani account with no roster row, one Kalyani
      roster row with no account, wired so both are visible in the walkthrough

## 3. Outlets — create, edit, deactivate

- [x] 3.1 `OutletsSurface`: "Add outlet" in the page header, "Edit" on each card,
      one `FormSheet` for both (design D1)
- [x] 3.2 Fields: code, name, location label, address, phone, business-day
      cutover, active state — with the note that changing the cutover cannot
      move history (design D10)
- [x] 3.3 Empty state carries the instruction and the primary action (design D2)
- [x] 3.4 Deactivate/reactivate with a `ConfirmDialog` that states what
      deactivation does *not* do (design D9)
- [x] 3.5 Component tests: first-outlet empty state; create; edit; duplicate code
      refusal; deactivation confirmation copy; nothing renders `outlets[0]`
      against an empty list

## 4. The link, from both directions

- [x] 4.1 `EmployeeRoster`: resolve the outlet from the session for a Franchise
      Admin and from a picker for the Super Admin (design D6); register
      `owner-employees` in the gate registry with nav, and route it
- [x] 4.2 Staff list shows the linked account, its active state, or why the
      person cannot check in
- [x] 4.3 Staff form: an account picker offering every active, unlinked account
      at that outlet (design D5); link on save
- [x] 4.4 Unlink with a `ConfirmDialog` naming both consequences — access stops,
      recorded days stay
- [x] 4.5 `AccountsSurface`: when the role is Employee, the three-way roster
      choice — add to roster with a staff code / link to someone already on the
      roster / leave off the roster (design D4)
- [x] 4.6 `AccountsSurface`: partial-failure path — show the code, say the person
      has an account but is not yet on the roster, point at Staff (design D3)
- [x] 4.7 `AccountsSurface`: the outlet select with zero outlets states that an
      outlet is needed first (design D2)
- [x] 4.8 Account list shows whether an Employee account is on the roster
- [x] 4.9 Component tests for 4.1–4.8, including both partial-failure branches
      and the zero-outlet form state

## 5. Attendance reachability

- [x] 5.1 `MyAttendance`: an Employee with no linked roster row is told they are
      not on the staff list, with no check-in control
- [x] 5.2 Surface the closed-outlet refusal as its own message rather than a
      generic failure
- [x] 5.3 Component tests for both

## 6. Verification against the real stack

- [x] 6.1 REST suite: create an outlet, provision an account, link it, and read
      `getOwnEmployee()` back as that person — the whole chain through the real
      adapters, from rows the test itself created
- [x] 6.2 REST suite: the embedded `linkedAccount` select resolves for an admin
      and for the linked employee's own call
- [x] 6.3 REST suite: check-in refused at a deactivated outlet, check-out allowed
- [x] 6.4 Playwright: the demo walk links an unlinked account to an unlinked
      roster row and both surfaces update; demo mode makes no off-origin request
- [x] 6.5 Playwright: create an outlet in demo mode

## 7. Documentation

- [x] 7.1 `docs/SCREENS.md`: Outlets gains create/edit; Staff gains the link and
      the owner's outlet picker; Access gains the roster choice
- [x] 7.2 `docs/OPERATIONS.md`: the onboarding runbook stops saying "by hand for
      now"; the "First production deploy" step 6 stops instructing SQL
- [x] 7.3 `docs/ROLES_AND_PERMISSIONS.md`: who may create an outlet and who may
      link an account to a roster row
- [x] 7.4 `npm run roadmap:sync`

## 8. The email address: visible, correctable, and off the counter tablet

- [x] 8.1 `admin-accounts` action `emails`: return `{ profileId: email }` for the
      accounts this caller may manage, derived from `mayManage` and nothing in
      the request. **Refuse a Biller or Employee outright** (design D12)
- [x] 8.2 `admin-accounts` action `set-email`: same `mayManage` matrix, marks the
      new address confirmed, maps a collision to `email_unavailable`, and leaves
      any outstanding code untouched (design D13)
- [x] 8.3 `AccountSummary.email: string | null`; `AccountsAdapter.changeEmail`.
      The list still degrades to names if the address lookup fails — an
      unreadable address must not blank the screen
- [x] 8.4 Mock accounts adapter: addresses on the fixtures, `changeEmail`, and
      the same duplicate refusal
- [x] 8.5 `AccountsSurface`: the address under each name; a *Change email* row
      action; the issued-code panel names the address the code belongs to
- [x] 8.6 Component tests: the panel reads back the address on provision and on
      reissue; correcting one; a duplicate refused; the list survives an address
      lookup that fails
- [x] 8.7 REST suite: a Franchise Admin reads their own outlet's addresses and
      no others; **a Biller is refused**; a cross-outlet `set-email` is refused;
      a corrected address signs in and the pre-existing code still redeems
- [x] 8.8 Confirm no email column reaches `public.profiles`, and that nothing in
      the client selects one
