# Proposal: a-biller-is-staff

> **Model**: Opus 5 · **Kind**: production bug fix, not a roadmap change · **Gate**: a person holding a live Biller assignment at an outlet appears on that outlet's attendance roll-call and in its by-staff picker exactly as an Employee does, and is reported as accounted-for elsewhere when their day was worked at another outlet.

## Why

`identity-and-access` already requires that "a live Biller assignment SHALL
confer personal attendance and Employee surface capabilities at that outlet",
and that promoting an Employee to Biller leaves their attendance history
unchanged. Two role checks never learned it, and both read `employee` alone.

This is live. Arpita at Kalyani was moved from Employee to Biller on 2026-08-12
and left the attendance surface that day: absent from the by-staff picker, and
absent from the roll-call on every date she carries no record. Her twelve
attendance rows are intact and readable; only the two checks that decide who is
listed disagree that she is staff. A manager reading the day cannot tell a
Biller who did not turn up from a Biller the screen forgot, which is a false
claim about somebody's pay.

## What Changes

- The attendance roll-call and the by-staff picker list people holding a live
  **Employee or Biller** assignment at the outlet. Today they list Employees
  only, so a Biller appears only on dates they already carry a record, labelled
  as not on the staff list.
- The elsewhere answer covers Billers. A Biller on the reader's own staff list
  who worked at another outlet that day reads as working elsewhere rather than
  as an unexplained blank.
- The rule is written as the two roles it admits rather than as "every role that
  is not a manager or an owner", so a role added to the enum later cannot join
  an outlet's roll-call without somebody deciding that it should.
- No change to who may bill. A Biller assignment still confers billing only on
  an enrolled counter tablet holding a live shift, and `personalNavigationRoles`
  still keeps billing off a personal phone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: the term "staff assignment", which the roll-call,
  the by-staff picker and the elsewhere answer are all specified in terms of, is
  defined as a live Employee **or Biller** assignment at the outlet. The
  requirement was already implied by `identity-and-access`; leaving it unstated
  here is what let two implementations read it as Employee alone.

## Impact

- `src/data-access/adapters.ts` — `isStaffAt`, which the roll-call, the by-staff
  picker, the lateness clock and the manual-entry outlet list all consult.
- `supabase/migrations/` — one forward migration replacing
  `public.attendance_elsewhere`, whose staff-list check filters on
  `s.role = 'employee'`. Function body only: no policy, grant, column or data
  change.
- `src/features/attendance/outlet-attendance.test.tsx` — the picker test asserts
  that managers and owners are excluded and says nothing about Billers, so it
  has been green for the wrong reason.
- `supabase/tests/` — the elsewhere coverage gains a Biller case.
- Docs updated before archive: `docs/ROLES_AND_PERMISSIONS.md`, whose attendance
  paragraph states the rule as "the people holding a live Employee assignment
  there", and whose `attendance_elsewhere` paragraph inherits the same scope.

## Non-goals

- **No ROADMAP.md row.** This corrects shipped behaviour and sequences no
  planned capability.
- Not a role hierarchy. A Biller gains nothing a manager or owner holds, and a
  Biller assignment at one outlet still confers nothing at another.
- Not billing on a personal device. Only the staff half of a Biller assignment
  is at issue.
- No change to who may approve, deny or correct attendance.
- No change to what the elsewhere answer discloses. It stays person ids and
  nothing else: not the outlet, the time, the status, the evidence, the
  approver, or whether the day was approved.
