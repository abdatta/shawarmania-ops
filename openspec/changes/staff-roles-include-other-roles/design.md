# Design: Staff Roles Include Other Roles

## The owner's words, 2026-10-21 and 22

> I thought biller was also basically an employee with some extra permission to
> open a billing session on a counter tablet … there's an employee role … then
> there is a waiter role, which is an employee who can take orders. And then a
> biller is an even superset role.

> I really like to do the role ladder change and like properly address it once
> and for all, so that in future this code smell doesn't stay and we can
> introduce new roles without changing 27 places or redesigning stuff.

> This should be able to generalize as a tree, not as a chain … roles are tree
> like even today if you think about it.

> This number thing is not a good solution … I would like direct definitions
> that this is a superset of this … Clear cut dependency.

Decisions, in order:

1. **Fix it properly, before the Waiter.** Chosen over the first #80 design,
   which stored a Waiter as an Employee with a grant beside it.
2. **Its own change, shipped first**, so the wait for its cleanup runs while #80
   is demoed and built (the agent's recommendation, accepted).
3. **#80's `waiter-orders` gate depends on this one**, so the two changes add two
   independent gates, not three, and fit the limit of five.
4. **The cleanup waits the ordinary three services** (D8).
5. **Roles are a tree written as "includes" rows, with no numbers** (owner,
   2026-10-22). The first build gave each role a rank, Employee 10 and Biller
   30, so that a higher number included a lower one. A rank is a line: every two
   roles are one above the other, so a Cook that includes a Waiter but not a
   Biller has no place on it, and the numbers read as arbitrary. Replaced before
   anything was committed.
6. **A role may include several roles.** A Head cook that does everything a
   Cook and a Biller do is two rows (owner, 2026-10-22).
7. **Managers and the owner stay out for now.** The owner includes a manager in
   spirit, but their authority runs through its own helpers across every manager
   policy; the rows can take them later without a redesign. *Where* a person
   holds a role, one outlet or several, is the assignments' job and unchanged.

## What names a staff role today

Read from the live local database built from `stage` on 2026-10-21
(`pg_policies`, `pg_proc`, constraints and views), so a policy whose table was
later dropped is not counted:

| Object | Names | Asks | Here |
|---|---|---|---|
| `attendance_submit_attempt` | employee, biller | acts as Employee | `_v2` |
| `attendance_elsewhere` | employee, biller | includes Employee | `_v2` |
| `attendance_record_manual` | employee, biller | includes Employee | `_v2` |
| `expense_people` | employee, biller | acts as Employee | `_v2` |
| `review_billing_attribution` | biller | includes Biller | `_v2` |
| `app_may_see_person` (read by `profiles_select`) | biller | includes Biller, or a manager | `_v2` |
| policies on `assignments` (insert, update) | employee, biller | staff roles a manager may grant | twin |
| policies on `expenses` (insert, select, update) | employee, biller | acts as Employee | twin |
| policy on `expense_categories` (insert) | employee, biller | acts as Employee | twin |
| policies on `menu_items`, `menu_categories`, `menu_discounts` (select) | biller | acts as Biller | twin |
| policy on `profiles` (select) | via `app_may_see_person` | includes Biller | twin |
| `expense_guard` (trigger on `expenses`) | employee, biller | acts as Employee | cleanup (D4) |
| `account_actor_may_replace_set` (read by the Team functions) | employee, biller | which roles a manager may set | cleanup (D4) |
| `app_may_hold_counter_shift` (read by six counter-shift functions) | biller | acts as Biller | cleanup (D4) |

**Not role checks**, though they contain `'biller'`: `create_billing_order_v2`,
`revise_billing_order_v2`, `pay_billing_now`, `record_paper_bill` and
`billing_points_shape_ok`. There `'biller'` is a **discount source**, the value
of `discount_row_source` meaning *a discount the biller typed*, and is out of
scope.

In the app: `STAFF_ROLES` and `isStaffRole` (`adapters.ts`), `ROLE_SENIORITY`,
`reachableRoles` and `personalHeldRoles` (`session.ts`: *if Biller, add
Employee*), the two `ROLE_ORDER`s, Team's `ORDINARY_ROLES` and its biller-or-
employee choices (`accounts-surface.tsx`), the demo's `ROLES`, `role-home.tsx`
and the billing mock's role type.

## D1. Staff roles, and which includes which

- **`staff_roles`** (`role app_role primary key`, with a check that it is not a
  manager role): the roles a person holds to work at an outlet. Seeded Employee
  and Biller.
- **`staff_role_includes`** (`role`, `includes`, both referencing
  `staff_roles`, primary key on the pair, with a check that they differ): one
  row says *this role can do everything that one can*. Seeded with one row,
  *biller includes employee*.
- **A loop is refused** by a trigger on `staff_role_includes`: a row whose
  `includes` already reaches its `role`, through any number of rows, raises
  `check_violation`. With the self check, the rows are always a tree that can be
  walked down and ends, possibly with a role reached by several paths.
- Both readable by `authenticated`, written by no client: a role is added by a
  migration.

Three helpers, `security definer`, `search_path = ''`, `stable`:

- **`app_role_includes(held, required)`**: whether the held role is the
  required one, or includes it through any number of rows (a recursive walk).
  False, never null, when either is not a staff role, so a manager check can
  never be written through it by mistake. The substitution for
  `role in ('employee', 'biller')` and `role = 'biller'` wherever the role is a
  row's, not the caller's.
- **`app_acts_as(required, outlet)`**: whether the caller holds a live
  assignment at that outlet whose role includes the required one. The
  substitution for a pair of `app_has_role_at` calls.
- **`app_outlets_acting_as(required)`**: the outlets where the caller does, for
  `outlet_id in (select …)` policies, in the set-returning shape
  `app_outlets_for` has.

## D2. Functions a build calls get a `_v2`

`attendance_submit_attempt_v2`, `attendance_record_manual_v2`,
`attendance_elsewhere_v2`, `expense_people_v2` and
`review_billing_attribution_v2`, which the app calls, and
`app_may_see_person_v2`, which the `profiles` twin reads. Each is generated from
its original's latest body with only the role comparison replaced, each
replacement asserted to match exactly as often as expected, and pgTAP checks
that each `_v2` differs from its original in exactly those lines.

## D3. Policies get a gated twin

Beside each of ten policies, a **permissive** twin named `<policy>_includes`:
the original's expression with the role comparison replaced, behind
`(select public.app_change_gate('role-includes')) and (…)`. That is the lint's
prescribed form for a policy on an existing table, and the scalar subquery is
evaluated once per statement rather than once per row. Permissive policies
combine by OR, so with the gate on a row is admitted if either admits it.
pgTAP proves each twin **alone**, with its original dropped inside a
subtransaction, admits exactly what the original alone admits, for nine
personas covering every kind of person the seed holds.

## D4. What waits for the cleanup

Three objects cannot be given a gated period without new versions of what calls
them, and are rewritten in place by the cleanup (D8), through the helpers this
change exercises in production first:

- **`expense_guard`**, a trigger. A trigger on an existing table can only be
  added beside, not replaced, so with the gate on the old guard still runs.
- **`account_actor_may_replace_set`**, read by `edit_account_assignment_set` and
  `mark_account_as_left`, which the `admin-accounts` Edge Function calls. A
  gated period would mean `_v2`s of both and an Edge Function reading the gate.
- **`app_may_hold_counter_shift`**, read by six counter-shift functions
  (request, confirm, setup, redeem, end of day, readiness). A gated period would
  mean `_v2`s of six functions every counter depends on, for an answer that
  cannot differ while nothing includes Biller.

For every role that exists each gives the same answer either way. **This is
where a new role waits for the cleanup**: until it runs, the old guard would
refuse a Waiter's expense and the old Team helper would refuse a manager making
someone a Waiter. #80 makes no Waiter before it.

## D5. The guard against the next one

**`npm run lint:roles`** (`scripts/check-roles.mjs`, in `npm run lint`):

- **In the app**, an array literal or a single line naming two staff roles fails:
  that is a staff list kept by hand. One role named to route to its own shell
  (`role === 'biller'` choosing the counter) passes. Tests, fixtures, the
  generated types and `role-includes.ts` itself are exempt.
- **In a migration after this one**, a role compared to a staff role by name
  (`role = 'biller'`, `role in ('employee', …)`, `'biller'::app_role`) and a staff
  role passed to `app_has_role_at` or `app_outlets_for` fail. `'biller'` as a
  discount source passes.
- A line that must name roles for another reason carries `roles-lint: allow
  <reason>` on it or the line above. One does today: the demo's ledger personas,
  keyed `owner`, `manager`, `biller`, `employee`.

One script for both halves, because the rule is one rule and the reader looking
for it should find it once.

## D6. Old builds and unknown roles

**A role the build does not know is ignored**, never an error: it is not a staff
role, includes nothing, `highestRole` never lands somebody on a shell for it,
and `reachableRoles` adds nothing for it. A build older than a new role shows
that person only what their known roles give, so a role added later cannot break
the shell of a phone that has not reloaded.

## D7. The app, and the gate

**`src/data-access/role-includes.ts`** holds `STAFF_ROLE_INCLUDES`, a map from
each staff role to the roles it directly includes (`biller: ['employee'],
employee: []`), listed most senior first, and the walks over it: `isStaffRole`,
`includes`, `rolesIncludedBy`, and their `…In(map, …)` forms, which the tests use
to walk a branching map of roles that do not exist yet. `STAFF_ROLES`,
`isStaffRole`, `highestRole` (a role that includes another is the more senior
shell; roles on separate branches go by the map's order), `reachableRoles`,
`personalHeldRoles`, both `ROLE_ORDER`s, Team's choices, the demo's roles and the
staff home are derived from it.

`src/data-access/role-includes.test.ts` keeps **frozen copies** of the functions
these replaced and asserts every derived answer is theirs for every set of live
assignments a person can hold at two outlets, owner or not; walks a branching
map (Cook and Biller both include Waiter, Head cook includes both); and reads
every migration's inserts into `staff_roles` and `staff_role_includes` and
asserts they say what the map says. Not gated: it changes no answer.

**`role-includes`** (*RI*), root, `retireBy` 2026-11-18. Toggle points: the five
adapter calls of D2 (`onRoleIncludes()` in `src/change-gates/role-includes.ts`,
read from the page's frozen snapshot as the request counting reads
`tablet-health`), and the ten twins in the database. `e2e-auth/role-includes.spec.ts`
(`@cg-on:role-includes`) proves the app reads through a `_v2` with the gate on.

**Round trip `none:`**: on and off admit the same people to write the same rows,
so a row written under either is read the same by both. Nothing is queued: none
of these writes goes through the outbox.

## D8. Release and cleanup, and the three services

The life of this gate, from `AGENTS.md`:

1. Promote, then turn it on at a quiet hour and watch a check-in, an expense and
   a Team change.
2. Pull it once, off and on. Its round trip is `none:`, so the owner may waive
   the pull as for `one-revenue` (`gate-pull-waivable-for-read-only-gates`).
3. **Retire** it: a change that deletes the off path in the app and tombstones
   the key. No migration. Promote.
4. **Cleanup** (the contract migration): rewrites the ten old policies, the three
   objects of D4 and each old function to ask the includes rows only, and drops
   the gated twins.

**Where the three services come from.** `docs/RELEASES.md` → *Retiring a gate*
waits for every registered tablet to report the retirement build **and** three
traded services since the Deploy that published it (owner, 2026-10-18). The
three services keep a **Republish** to an older build possible: a contract that
drops a function an older build calls would break that build if it were
republished.

**The cleanup waits the three services, as every cleanup does** (owner,
2026-10-21). The agent pointed out that this contract could be written to drop
nothing a build calls, so that a Republish to an older build would still work and
the three services would protect nothing. The owner chose the ordinary rule
anyway: a few days cost nothing here, and an exception made to go faster is a
risk taken for no need. The change ships first so the wait runs while #80 is
demoed and built.

The contract still rewrites rather than drops wherever it can, for the same
reason: it keeps Republish safe for longer than the rule requires. The old
bodies are left as thin calls to their `_v2` and are removed in an ordinary
cleanup later.

## Version skew

- **`staff_roles`, `staff_role_includes`, the loop trigger and the three
  helpers** are new.
- **Every `_v2`** is new. The originals are untouched until the cleanup, and keep
  serving every published build.
- **The ten policies** gain a gated twin each. The originals are untouched
  until the cleanup.
- **`expense_guard`, `account_actor_may_replace_set` and
  `app_may_hold_counter_shift`** are untouched until the cleanup (D4).
- **The `change_gates` row** is inserted off.
- **Turning the gate off** leaves nothing behind: no row was written that the off
  path cannot read.
- **Reverting the build** leaves the two tables, the helpers, the `_v2`s and the
  gated twins unread. The twins admit nothing with the gate off.

## RLS and authority

No new reach. Every twin admits exactly the rows its original admits for every
existing role, proved per policy by pgTAP with the gate on: an Employee, a
Biller, a Manager, the owner, another outlet's Biller, an ended assignment, a
deactivated account. Both tables are readable by `authenticated` and writable by
nobody, the owner included. `app_role_includes` returns false for
`franchise_admin` and `super_admin`, tested, and neither can be written into the
rows.

## Offline

None. Attendance, expenses and Team are online. The counter's menu reads are
answered by the twins with the same rows, and its outbox is untouched.

## Rejected alternatives

- **A Waiter as an Employee with a grant beside it** (#80's first design).
  Works without touching the 19 objects, but leaves the smell and stores a role
  that reads as something else. Refused by the owner.
- **Add `'waiter'` beside `'employee'` everywhere**, as `a-biller-is-staff`
  did for Biller. The smell, a third time.
- **A numbered ladder** (each role a rank, a higher rank including a lower one).
  Built first and replaced before it was committed: it cannot branch, and the
  numbers mean nothing to anyone reading them (decision 5).
- **A capability table** (role × *may check in*, *may take orders*, *may hold a
  counter*). Answers *what can this role do* directly, but every new role would
  list every capability again, and nobody thinks of the roles that way: they
  think *a Biller is a Waiter who also bills*. The includes rows say that, and a
  capability can still be added later if a role ever needs one alone.
- **Rewriting every object in place with no gate.** Fastest, and the answers
  would be the same. But a mistake in the new checks would stop check-ins and
  expenses until a Hotfix, about an hour, with no switch to flip. The gate costs
  a few days, run in parallel with #80.
- **A gated period for the three objects of D4**, through `_v2`s of the six
  counter-shift functions, the two Team functions and an Edge Function reading
  the gate. More new code on the counter's critical path than the swap it would
  guard, for answers the helpers it shares with the gated objects already prove.
- **Folding this into #80.** Its migration would then wait for #80's demo
  approval, and the cleanup's wait would start later.
