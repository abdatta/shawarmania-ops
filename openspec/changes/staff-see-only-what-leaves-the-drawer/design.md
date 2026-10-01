# Design: staff-see-only-what-leaves-the-drawer

## Context

`public.expenses` carries three policies today, read from the production catalog
on 2026-10-01:

- **`expenses_select`**: the counter-shift branch
  `outlet_id = app_counter_shift_outlet()`, OR an active account that is the owner,
  manages the outlet, or holds `biller`/`employee` there. No method predicate.
- **`expenses_insert`**: the same reach, with `recorded_by = auth.uid()` on the
  person branch.
- **`expenses_update`**: the owner, a manager, or the row's own recorder holding
  `biller`/`employee` there. The guard adds "on the running day" for staff.

`public.expense_guard()` (BEFORE INSERT OR UPDATE, `expenses_guarded`) already
resolves the two facts this change needs:

- `v_operator`: the counter tablet's shift operator
- `v_is_staff`: not the owner, not a manager here, but a biller or employee here

`public.effective_expenses` is `security_invoker`, so it inherits whatever
`expenses_select` allows. The three drawer readers (`drawer_cash_expenses_paise`
and its siblings) are `security definer` behind `app_may_reach_drawer()`, so they
bypass the policy by design and are unaffected.

## D1. The read rule is a policy predicate, added to the two staff branches only

```sql
using (
  (outlet_id = (select public.app_counter_shift_outlet()) and is_cash)
  or (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        (public.app_has_role_at('biller', outlet_id)
         or public.app_has_role_at('employee', outlet_id))
        and is_cash
      )
    )
  )
)
```

The owner and manager disjuncts are untouched. A person who is a manager *and* a
biller at the same outlet reads everything, through the manager branch. Someone
who manages outlet B and bills at outlet A reads only cash at A.

**Why a policy and not the screen.** The point is to keep a salary from being
read. A screen filter leaves the row one REST call away from any staff session,
and AGENTS.md demands that every restriction hold "via a hand-crafted API request
with a valid session". This is the same class of rule as outlet isolation and is
tested the same way.

## D2. The write rule lives in both the guard and the policies

- **The guard raises a sentence.** On INSERT or UPDATE, when `v_operator is not
  null` or `v_is_staff`, and `new.is_cash` is false:
  *"staff record only what leaves the drawer; a manager or the owner records the
  rest"*, with `errcode = '42501'`. A BEFORE trigger runs before the policy's
  `WITH CHECK`, so the operator reads this sentence and not the generic RLS
  refusal. The counter's outbox stores the server's words verbatim
  (`offline-billing-resumption`), so the words matter.
- **The policies carry the same predicate**: `and is_cash` on the counter branch
  and the staff branches of `expenses_insert`, and on the staff branch of
  `expenses_update` (both `USING` and `WITH CHECK`). The guard holds the message.
  The policy holds the boundary, so a later rewrite of the guard cannot silently
  open it. `24_counter_tablet_expense.sql` already pins the policy set by name.

A staff UPDATE that flips their own cash row to non-cash is therefore refused
twice. Without the refusal, the row would vanish from its recorder's list
mid-edit, which reads as data loss.

## D3. The staff form has no method field; the full-reach form has no default

`ExpenseList` already receives `viewer.mayTouchAnyRow`: true for the owner, a
manager and the Drawer's breakdown popup, false for staff and the counter.

- **`mayTouchAnyRow === false`**: the **Paid with** field is not rendered.
  `draft.isCash` is fixed at `true`, and a muted line where the field was says
  *Cash, out of the drawer.* The form has three fields.
- **`mayTouchAnyRow === true`**: `ExpenseDraft.isCash` becomes `boolean | null`.
  `BLANK_EXPENSE.isCash` is `null`. The select gets a leading
  `<option value="" disabled>Choose…</option>` and `required`. `submit()` refuses
  `null` with *"Choose how it was paid."* before any network call. Opening an
  existing expense for correction seeds the draft from that row's `isCash`, so a
  correction never asks again for a choice already made.

The guard is not asked to enforce "the owner chose deliberately", because a
database cannot tell a deliberate `true` from a default `true`. That is a form
rule, and the form test pins it.

## D4. Offline and the counter outbox

The counter's queued expense envelope keeps its `isCash` field and its shape, so
the idempotency hash and every queued entry stay valid. The counter UI now only
ever writes `true`.

One edge: a tablet still running the previous build, or an envelope queued before
the deploy with `isCash: false`. The server refuses it with the D2 sentence. The
outbox marks it `needs_attention`, and the existing **Discard** action clears it.
Production has never held a staff non-cash expense, so this is a path that exists
rather than one expected to fire. Deploy in an owner-chosen window regardless.

## D5. Demo mode mirrors the rule in the mock adapter

`createMockExpensesAdapter` gains the same two rules for `isStaff`: list results
filter out non-cash rows, and create/update with `isCash: false` throw
`ExpenseActionError('refused', …)` with the D2 sentence. The demo fixtures already
hold non-cash rows at both outlets (`retirement-history.ts`), so the walkthrough
shows the difference between the Biller's and the owner's view without new data.

## D6. The owner-remote spec requirement is corrected, not enforced

`outlet-expenses` requires that an owner's remote expense is "never cash" and is
refused by the database. That requirement described the original, empty `expenses`
table. #12 dropped that table and promoted the notebook's in its place. The
notebook never refused remote cash: #38 D9 chose to allow it and mark it. The
guard has no such clause, and production holds 76 remote cash rows by the owner.

Enforcing the stale requirement now would break how the owner works. The delta
rewrites it to what ships: the owner records either method at any outlet, and a
remote **cash** entry is marked so the counter knows the drawer moved. It lands in
this change because D3's "always choose" rule depends on it. An earlier draft of
this conversation would have fixed the owner's remote method to non-cash, based
on the stale text.

## Rejected alternatives

- **Hide rows in the screen only.** One REST call from any staff session still
  reads every salary. It protects nothing, which is the one claim D2 of #38 got
  right.
- **A private flag per category ("Salary" never shown to staff, even cash).**
  It closes a leak the owner chose to accept: three cash advance rows since
  August, two of them ₹100 that staff recorded themselves. It costs a setting
  someone must remember per category, and a category typed fresh would default to
  visible. Rejected by the owner, 2026-10-01.
- **Hide by recorder (staff see only staff-recorded rows).** That hides a
  manager's cash purchase from the drawer, which is exactly what stops a biller
  from recording the same vegetables twice. It also still shows a staff-visible
  manager row whatever its method. The drawer is the line staff can actually see,
  so method is the right axis.
- **Shrink the staff window to today only.** A salary recorded today is still in
  today, and the policy would still allow any date.
- **A separate staff view or table.** It adds a second read path to keep in step
  with the policy for no gain: the predicate is one clause.
- **Default the full-reach form to non-cash instead of cash.** It moves the misfire
  to the other side: a manager's drawer purchase recorded as UPI overstates the
  drawer. The owner asked for an explicit choice every time.
- **Fix the owner's remote form to non-cash.** It rests on the stale requirement
  D6 corrects, and production shows the owner records remote drawer spends.

## Risks

- **Silent over-permission is the failure that passes every functional test.** The
  isolation test asserts by hand-crafted request as each of Biller, Employee and
  counter tablet, against a seeded non-cash row at their own outlet. It asserts
  absence, not just a count, and it asserts presence of the cash row alongside, so
  an over-narrowed policy also fails.
- **Existing database tests may seed a non-cash row and read it as a biller**
  (`21_manual_ledger.sql`, `24_counter_tablet_expense.sql`,
  `42_expenses_are_read_where_they_are_written.sql`). Those assertions encode the
  old rule. Update them deliberately and name each in the commit. Never loosen the
  new predicate to keep them green.
