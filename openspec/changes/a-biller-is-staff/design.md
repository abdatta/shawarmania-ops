# Design: a-biller-is-staff

## Context

Four roles exist. Two of them, Employee and Biller, describe somebody who works
a shift at a shop; the other two manage or own it. `session.ts` already states
the consequence at [`reachableRoles`](../../../src/session/session.ts): a Biller
"is a person who works at the shop and therefore turns up to it: they mark their
own attendance and record what they spent, and the database already reads their
assignment that way."

Most of the system agrees. `attendance_submit_attempt` accepts `employee` or
`biller` at the outlet. `manual_ledger_guard` and `manual_ledger_people` admit
both. `expense_categories_insert` admits both. A sweep of the live production
database found **no RLS policy** naming `employee` without also naming `biller`.

Two checks disagree, and both are the same mistake:

1. `isStaffAt` in `src/data-access/adapters.ts` filters live assignments to
   `role === 'employee'`. Every attendance surface that asks "who belongs on
   this outlet's list" consults it.
2. `public.attendance_elsewhere` scopes its answer to people on the caller's own
   staff list with `s.role = 'employee'`.

Neither is theoretical. The production account moved from Employee to Biller on
2026-08-12 disappeared from the by-staff picker entirely, and from the roll-call
on any date carrying no record. On dates she does carry a record she still
appears, through the off-list fallback, labelled "not on this outlet's staff
list" — which is a screen contradicting the assignment it is reading.

## Goals / Non-Goals

**Goals:**

- A live Biller assignment puts its holder on that outlet's attendance roll-call
  and in its by-staff picker, on the same terms as an Employee.
- A Biller who worked at another outlet reads as elsewhere rather than as a
  blank.
- The rule survives a fifth role being added to the enum without anybody
  revisiting it.
- One statement of the rule, so the two implementations cannot drift apart
  again.

**Non-Goals:**

- Billing from a personal device. `personalNavigationRoles` strips `biller` from
  phone navigation deliberately, so a personal login cannot become a second
  counter, and that stays exactly as it is.
- Any change to attendance authority: who may approve, deny, correct, or record
  a manual entry.
- Widening what `attendance_elsewhere` discloses.
- Putting managers or owners on a roll-call.

## Decisions

### D1. Name the two roles rather than excluding the other two

`isStaffAt` becomes "a live `employee` **or** `biller` assignment at this
outlet".

**Rejected: invert to "any live assignment that is not `franchise_admin` or
`super_admin`".** It reads more elegantly and needs no edit when a role is
added, which is precisely the objection. A fifth role would join every outlet's
roll-call the moment it existed, with no decision taken and no test failing; a
manager would discover it as an unexpected name on their morning list. The
function's own docstring already argues this: it is "stated as a rule rather
than as a list of roles that are not staff, so a role added to the enum does not
silently join the roll-call". The bug is that the list was one item short, not
that it is a list.

### D2. The database repeats the rule rather than importing it

`attendance_elsewhere` gets `s.role in ('employee', 'biller')` inline, matching
how `attendance_submit_attempt` and the manual-ledger guard already spell it.

**Rejected: a shared `app_is_staff_role(app_role)` helper.** One predicate over
four call sites is tempting, but three of them are `security definer` bodies
with `search_path = ''` where the existing spelling is two words and a reader
sees the rule without a jump. A helper would also become a new object whose
`stable`/`immutable` marking and grants need to be right for the planner to keep
hoisting these checks. The duplication is two words; the coupling is not worth
it. What stops drift is the spec definition in D3 plus the tests, not a shared
function.

### D3. Define "staff assignment" in the attendance spec

Every affected requirement is already written in terms of a "staff assignment",
and `identity-and-access` already says a Biller assignment confers personal
attendance. Nobody wrote down that these are the same claim, and two
implementations independently guessed Employee.

The delta adds the definition to `attendance-and-location` and the scenarios
that pin it. This is what makes the fix stick: the next reader of either call
site can check the term rather than infer it.

### D4. A forward migration replacing one function body

`create or replace function public.attendance_elsewhere` with the corrected
predicate. Same signature, same `security definer`, same `search_path = ''`,
same grants, so no `revoke`/`grant` churn and nothing to reorder.

**No RLS policy is touched.** The function is `security definer` precisely
because the calling reader cannot see rows at the other outlet; its own two
opening gates (`app_account_active`, `app_device_ok`) and its scope intersection
are unchanged. The change is strictly *which people the answer may mention*,
widened from Employees on the reader's staff list to Employees and Billers on
it. It cannot reveal a person the reader does not already see on their own
roll-call, because after this change the roll-call includes exactly that set.

**No money arithmetic and no offline semantics** are involved. Attendance
reads are online reads; nothing here enters the outbox.

### D5. Fix the test that was green for the wrong reason

`offers only staff in the by-person picker` asserts a manager and an owner are
absent and an Employee present. It never mentions a Biller, so it passed
throughout the bug. The fixtures already carry `Demo Morning Biller`, live at
Kalyani, so the case costs one assertion.

## Risks / Trade-offs

- **A Biller appears on a roll-call where a manager did not expect them** →
  Intended, and it is the state before 2026-08-12 for anybody promoted since.
  The alternative is the current screen, which lists them as "not on this
  outlet's staff list" on the days they *did* attend, which is worse: it
  contradicts their live assignment to the manager's face.
- **The rule is now written in three places** (helper, migration, spec) → D3 is
  the mitigation: the spec is the single statement, and both call sites are
  pinned by tests that name a Biller explicitly.
- **The elsewhere answer mentions more people than before** → Bounded by the
  same staff-list scope it always had; that scope simply now matches the
  roll-call it exists to explain. Disclosure is unchanged: person ids only.
- **A fifth role is added and nobody updates the list** → Accepted, and chosen
  over the inverse failure in D1. Not appearing is visible and reported; silently
  appearing is not.

## Migration Plan

1. App change and its tests; the picker test tightened.
2. Forward migration replacing `attendance_elsewhere`, plus a Biller case in the
   pgTAP elsewhere coverage.
3. CI gates the migration and the publish as usual.

**Rollback:** the migration is a function-body replacement with no data or
schema change, so reverting is the same statement with the previous predicate.
Nothing to undo in either direction.

## Open Questions

None.
