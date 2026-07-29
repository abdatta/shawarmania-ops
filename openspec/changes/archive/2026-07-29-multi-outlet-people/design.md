# Design: multi-outlet-people

## Context

Today a person's authority is a pair of columns on their account —
`profiles.role` and `profiles.outlet_id` — copied into the access token by
`custom_access_token_hook` and read back by every policy through two claim
helpers, `app_role()` and `app_outlet_id()`. That pair is a function, in the
mathematical sense: one person maps to exactly one role at exactly one place.
The business stopped being that shape on 2026-07-29, on both counts at once —
a staffer began splitting shifts across Kalyani and Kanchrapara, and the owner
began day-running one outlet.

The owner rejected the todo's original sketch (grants, one "active hat" per
session, a deliberate switching step) the same day, as needless complexity for
non-technical users. What survives is the substance: one login per person,
explicit per-outlet authority, attribution that never blurs. What is gone is
everything session-scoped.

So the pair becomes a relation, and the question every policy asks changes from
*"what does this token claim?"* to *"does this person hold the right assignment
at this row's outlet?"*. That is a rewrite of every policy in the schema —
about 130 claim-helper references across fifteen migrations — but a uniform
one: the shapes below map one-to-one onto the shapes already there.

Two smaller things ride along by the same 2026-07-29 decisions: staff codes
retire, and the owner gains a bounded remote write path.

Constraints inherited from the proposal and not relitigated here: one login per
person (account-per-outlet stays rejected); no role hierarchy; no session
modes, hats, or switchers; nothing cash from the owner's remote path;
attribution on every row exactly as today.

## Goals / Non-Goals

**Goals:**

- `assignments` (person × role × outlet) replaces `profiles.role` /
  `profiles.outlet_id`, and every policy resolves scope by membership.
- Nothing about authority is carried in the access token. An assignment change
  bites at the next request, the way deactivation already does.
- A person with two assignments checks in and out at each outlet from their own
  phone, with the geofence deciding which — nothing to pick, nothing to switch.
- The owner, assigned as a manager, does that outlet's operational writes; and
  separately, as owner, records non-cash expenses and stock corrections at any
  outlet, each visibly theirs.
- Ending one assignment leaves the person's other assignments and their account
  untouched.
- Staff codes are gone from schema, UI, and tests.
- The four-role demo walkthrough still walks.

**Non-Goals:**

- No session modes, no active hat, no role switcher, no "acting as".
- No role hierarchy — seniority never widens what you may attest to.
- Never account-per-outlet.
- No cash from the owner's remote path: no cash expense, no withdrawal, no day
  close, no drawer.
- No change to the biller/device path beyond restating its policies against
  assignments; the tablet-is-dead case remains #9's question.
- No aggregator-settlement entry screen (D14).

## Decisions

### D1 — `assignments` is the relation, and ending one is a date, not a delete

```sql
create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.profiles (id),
  role        public.app_role not null,
  outlet_id   uuid references public.outlets (id),
  started_on  date not null default current_date,
  ended_on    date,
  created_at  timestamptz not null default now(),
  constraint assignments_outlet_matches_role
    check ((role = 'super_admin') = (outlet_id is null)),
  constraint assignments_ended_after_started
    check (ended_on is null or ended_on >= started_on)
);
```

The outlet-matches-role check is today's `profiles_outlet_matches_role`, moved
verbatim: only the Super Admin is outlet-less, and every scoped role must be
scoped.

**Ending is `ended_on`, never a delete.** The schema-wide rule is that records
are voided, deactivated or corrected rather than removed, with `outlets` the
single named exception. An ended assignment is also the only honest reading of
history: attendance rows written last month were written under an assignment,
and deleting the row would leave them unexplained.

**One live assignment per person per outlet**, by two partial unique indexes
(one for outlet-scoped roles, one for the outlet-less Super Admin, because
`null` outlet ids do not collide in a plain unique index):

```sql
create unique index assignments_one_live_per_person_outlet
  on public.assignments (person_id, outlet_id)
  where ended_on is null and outlet_id is not null;
create unique index assignments_one_live_owner
  on public.assignments (person_id)
  where ended_on is null and outlet_id is null;
```

A person therefore holds one job at a shop, and may re-join after leaving —
the partial predicate leaves ended rows out of the way.

**Rejected: keeping `profiles.role`/`outlet_id` as a denormalised "primary"
assignment.** Two sources of truth for the same question, and the drift is
silent and security-relevant. They are dropped.

### D2 — Membership helpers, and why two shapes

Policies get a **set-returning** helper; triggers and functions get a
**scalar** one. This is not duplication for its own sake — it is the difference
between one lookup per query and one per row.

```sql
-- Parameterless: wrapped as (select public.app_is_owner()) in a policy, it
-- becomes an InitPlan evaluated once per query.
create function public.app_is_owner() returns boolean ...

-- Non-correlated in a policy: `outlet_id in (select public.app_outlets_for(
-- 'franchise_admin'))` hoists to a hashed SubPlan, evaluated once per query.
create function public.app_outlets_for(required public.app_role)
  returns setof uuid ...

-- Scalar, for trigger bodies and security-definer functions, where there is
-- one row anyway and readability wins.
create function public.app_has_role_at(required public.app_role, outlet uuid)
  returns boolean ...
```

All three are `stable security definer set search_path = ''`, exactly like
`app_account_active()` — the definer rights are what keep a policy on
`assignments` from recursing into itself.

`app_role()` and `app_outlet_id()` are dropped, and the hook is unregistered
from `config.toml`. A claim nobody reads is a claim that will be read again by
mistake.

`custom_access_token_hook` itself is **emptied to a no-op rather than
dropped**, and that is a deployment decision rather than a design one: a
deployed project registers its hook in its own auth settings, so dropping the
function while that registration stood would fail every token issue and lock
everybody out — including whoever would go and turn it off. It injects nothing,
so the property holds either way, and a later one-line migration drops the stub
once no project points at it.

The mechanical translation, applied about 130 times:

| Today | After |
|---|---|
| `app_role() = 'super_admin'` | `(select public.app_is_owner())` |
| `app_role() = 'franchise_admin' and outlet_id = app_outlet_id()` | `outlet_id in (select public.app_outlets_for('franchise_admin'))` |
| `app_role() = 'biller' and outlet_id = app_outlet_id()` | `outlet_id in (select public.app_outlets_for('biller'))` |
| `app_role() in ('franchise_admin','biller') and outlet_id = app_outlet_id()` | `outlet_id in (select public.app_outlets_for('franchise_admin') union all select public.app_outlets_for('biller'))` |
| `app_role() not in ('franchise_admin','super_admin')` (trigger) | `not (public.app_is_owner() or public.app_has_role_at('franchise_admin', new.outlet_id))` |

**Rejected: a single `app_may(action, outlet)` capability oracle.** It reads
well and hides which branch refused, which is exactly the thing an isolation
test needs to see. The two-branch shape above is the shape already in the file,
which keeps the diff reviewable as a translation rather than a redesign.

### D3 — `app_profile_has` becomes an assignment check

`app_profile_has(profile, role, outlet)` validates attribution references on
billing writes without granting the writer read access to `profiles`. It keeps
its name and signature and changes its body: the person must hold a *live*
assignment in that role at that outlet, and their account must still be active.

### D4 — Attendance is one row per person per outlet per business day

`attendance_one_per_person_day unique (person_id, business_date)` becomes
`unique (person_id, outlet_id, business_date)`. A morning at Kalyani and an
evening at Kanchrapara are two rows, which is what they are.

"My attendance" lists days across every outlet worked, each row naming its
outlet — a person who only ever works one place sees exactly what they see
today, because one assignment yields one outlet name. The manager's outlet day
view is already outlet-filtered and needs no change.

### D5 — The fence is the only chooser, and nearest-assigned is the tiebreak

Check-in resolves the outlet, never the person:

1. Take the person's live outlet-scoped assignments (employee, franchise_admin).
2. One assignment → that outlet. Identical to today's behaviour.
3. More than one → take a position reading, and pick the assigned outlet whose
   geofence contains it. If several do, the nearest.
4. Inside no fence → the **nearest** assigned outlet, written `absent` and
   awaiting the manager override that already exists. There is always a row for
   the override to point at, and it lands at the outlet they are closest to.
5. **No reading at all** (permission refused, no fix) **and more than one
   assignment** → refuse, and say so: nothing can honestly choose, and the
   humane path is the manual entry an admin already has (#21). With a single
   assignment this case is unchanged — the row is written with null
   coordinates, exactly as today.

**There is no manual outlet picker.** Step 5 is the one place a multi-outlet
person is ever stopped, it is a degraded path rather than a routine one, and it
hands them to a human instead of to a control they would have to understand.

**Rejected: asking which outlet when the fence is ambiguous.** That is a
switcher wearing a different hat, on the exact screen the proposal wanted free
of them.

### D6 — One shell, chosen by highest role; navigation is the union

A person holds a set of roles. The shell they land in is the highest one they
hold live — `super_admin` > `franchise_admin` > `biller` > `employee` — and
their navigation is the **union** of the surfaces every live assignment
entitles them to. A manager of Kalyani who also grills at Kanchrapara gets the
admin shell, plus My attendance. The owner assigned as Kalyani's manager gets
the owner shell, plus the operational surfaces.

Routing follows: a session may render any role's path it holds a live
assignment for, and is redirected home from any it does not. That is the
existing rule with "its own role" restated as "a role it holds".

**Outlet-scoped surfaces take their outlet from a per-surface selector**,
defaulted to the person's single managed outlet and only rendered when they
manage more than one. This is a filter on a screen, like the period picker the
owner's console already has — it is scoped to the surface, is not remembered
across surfaces, and carries no authority. It is deliberately *not* the session
mode the proposal rejected, and the distinction is: nothing about it changes
what any other screen shows or what any write is permitted to do.

### D7 — Self-assignment: the one carve-out, drawn narrowly

The proposal leaves this open. Settled as follows, and the Gate line is amended
to match:

- **Nobody may grant themselves a `super_admin` assignment.** That is the only
  self-grant that confers authority the person does not already hold, and it is
  the definition of privilege escalation.
- **A Super Admin may grant themselves an outlet-scoped assignment**, and only
  a Super Admin may.
- **The last live `super_admin` assignment cannot be ended**, by anyone,
  including its holder.
- Managing your own *account* — role, active state, email, code re-issue —
  stays refused exactly as today.

The alternative was requiring a second Super Admin to do it.

**Correction, recorded at deploy time (2026-07-29):** this decision was first
argued on the premise that production held exactly one Super Admin, which the
pre-deploy dump showed to be false — it holds **two**, and the owner knew.

The premise was wrong; the decision was not. The owner's actual reason, given
when the discrepancy was put to them, is stronger and does not depend on how
many owners exist: **a Super Admin should be able to do everything standalone.**
Needing a second owner present to perform an act is a dependency the business
does not want, at any headcount.

It stays safe for the reasons the rest of this section gives: an outlet role
confers less than the owner role already does, `super_admin` remains refused as
a self-grant for everybody, and the last live Super Admin assignment remains
unremovable — so acting alone can never strand the business.

The Gate clause "nobody assigns themselves anything" becomes "nobody grants
themselves the owner role, and the last Super Admin cannot lose it".

### D8 — The owner's remote writes, bounded in the database

Two policies gain an owner branch, each bounded so that "never anything cash"
is arithmetic rather than etiquette:

```sql
-- expenses_insert
   outlet_id in (select public.app_outlets_for('franchise_admin'))
or ((select public.app_is_owner()) and payment_method <> 'cash')

-- inventory_movements_insert
   outlet_id in (select public.app_outlets_for('franchise_admin'))
or ((select public.app_is_owner()) and movement_type = 'correction')
```

**The surface for it** (owner decision, 2026-07-29) is the outlet selector D6
already introduced, rather than a screen of its own: `useOutletScope` offers a
Super Admin every outlet and reports whether they *manage* the one in scope, and
at one they do not the expense form drops `cash`, the stock form offers only
`correction`, stock-item creation is withdrawn, and the cash surface shows the
day while offering neither the close nor a withdrawal. Each says why, so the
bound is read rather than discovered by being refused. Reading the other
outlet's full lists is deliberate: adding to books you cannot see is a mistake
waiting to happen. A dedicated owner-entry screen was rejected as a duplicate of
two forms that `aggregator-settlement` would likely fold back together anyway.

`recorded_by = auth.uid()` is unchanged on both, so the row is the owner's
wherever it is read. A cash expense from the remote path is refused by the
policy, not by a form. `cash_withdrawals`, `close_business_day` and everything
else touching a drawer keep their franchise-admin-only shape — and because that
shape is now membership, the owner *assigned as a manager* passes it at that
outlet and nowhere else, which is exactly the intended reading.

Stock corrections rather than all movements: a correction is the entry that
needs to be possible from a distance ("the count is wrong"), and it already
carries a mandatory note. Adding and consuming stock is a thing done while
standing in the shop.

**Deferred, not rejected: an alert to the outlet's manager when the owner
writes into their books.** The gate's requirement is that such a row is
*visibly* the owner's, which the existing attribution and badge already deliver
at every read. A note needs two things this change should not carry: the
`alerts_insert` policy inverted (alerts run outlet → owner today, and this
would be the first case going the other way) and a new `alert_category` value.
Both alert surfaces are also still `demo`-gated, so a note raised now would
land where nobody can open it. Carried into `owner-console-live` (#13), which
is where alerts become real.

### D9 — Staff codes retire; `account_invites` loses its outlet

Dropped: `profiles.staff_code` with its unique and not-blank constraints, the
`profiles_issue_code` and `profiles_code_guarded` triggers, `issue_staff_code`,
`staff_code_guard`, `random_staff_suffix`, `outlets.staff_code_prefix` with its
unique/shape constraints, `derive_staff_code_prefix`, the prefix defaulting
trigger and `outlet_prefix_guard`. Same-name disambiguation falls back to role
title and joining date. One-time activation codes are untouched.

`account_invites.outlet_id` goes too: it was denormalised from the account's
single outlet, and an account no longer has one. Its only job was scoping the
select policy, which becomes `app_may_manage_person(profile_id)` — a
security-definer helper that answers "does the caller own the business, or
manage an outlet where this person holds a live assignment?". The table becomes
child-scoped rather than outlet-scoped, which the isolation suite classifies
from the catalog and therefore needs told once, in `01_schema_coverage.sql`.

`profiles.joined_on` and `profiles.left_on` move to the assignment as
`started_on` and `ended_on` — "when did you start *here*" and "when did you
leave *here*" are per-outlet questions, and the proposal's per-outlet leaving
is exactly this column. `role_title` **stays on the profile**: one person, one
job description, and a per-outlet title is speculation nobody has asked for.

### D10 — Departure, deactivation, and the lever board

Three independent levers, and the People surface names all three:

| Lever | What it does | What it leaves |
|---|---|---|
| Assignment ended (`ended_on`) | off that outlet's staff list and its new attendance days | every other assignment, the account, every recorded row |
| Account deactivated (`is_active`) | session dies now, signs in nowhere | every assignment, staff-list membership, today's attendance surface |
| No live assignments at all | off every staff list; the person has left the business | the account and every recorded row |

"Departed" is no longer a column — it is the derived state of holding no live
assignment. Ending a person's last assignment offers deactivation in the same
confirmation, which is #21's departure flow restated.

### D11 — The client stops reading claims

`useRealSession` currently compares the token's role/outlet against the profile
and ends the session on a persistent mismatch. With nothing authority-bearing
in the token there is nothing to compare, so that whole branch goes. The
session instead carries the person's live assignments, re-read on the same
revalidation cycle that already detects deactivation (5 minutes, plus every
visibility change). An assignment that ends while the app is open therefore
disappears within that interval — and the database refuses the write
immediately regardless, which is the boundary that matters.

`Session` gains `assignments: Assignment[]` and keeps `role`/`outletId` as
**derived** conveniences: the highest live role, and the single outlet when
there is exactly one. Every surface that reads `session.outletId` today keeps
working for the single-outlet person who is the overwhelming majority; the
surfaces that must handle several read `assignments`.

### D12 — Impersonation in the isolation suite gets stronger

`pg_temp.impersonate` sets `app_role`/`app_outlet_id` claims today, which means
the suite has been testing the policies against a *claimed* identity it
fabricates. With claims gone it sets only `sub`, and scope comes from the
seeded assignment rows — so the suite now exercises the same lookup path a real
session does. Nothing about the sweep's coverage changes; its fixtures get more
honest.

### D13 — Migration order, and what it must survive

One migration file, in dependency order: create `assignments`; backfill one row
per existing profile from its `role`/`outlet_id`; add the new helpers; rewrite
every policy and every trigger body; drop the claim helpers, the token hook,
the staff-code machinery, and finally `profiles.role`, `profiles.outlet_id`,
`profiles.joined_on`, `profiles.left_on`.

Dropping the columns last matters: the backfill reads them, and a policy that
still named them would fail to drop cleanly. The `supersede_invites_on_reassignment`
trigger moves from `profiles` to `assignments` — a reassignment is now an
assignment write — and supersedes on insert and on end alike.

Production holds two accounts, which is why this is the cheapest this migration
will ever be; it is nevertheless written to carry real data, per the precedent
#21 set.

### D14 — `aggregator-settlement` waits for its own graduation

Its todo permits "together, or this first". The owner's write path is what it
was blocked on, and that lands here; its entry screen is a separate surface
with its own commission arithmetic, and folding it in would put unreviewed
money maths inside a roles migration. It stays a todo, now unblocked.

## Risks / Trade-offs

- **Every policy in the schema changes at once.** Mitigated by the translation
  being uniform (D2), by the isolation suite deriving its table list from the
  catalog rather than a list anybody maintains, and by D12 making the suite's
  impersonation exercise the real lookup path.
- **Per-row policy cost.** Addressed by D2's set-returning shape plus an index
  on `assignments (person_id, role) where ended_on is null`; the policies do
  one hashed lookup per query rather than one per row.
- **A person could be left with no live assignment and an active account.**
  That is a real state — hired, not yet placed — and it renders as "no
  assignment yet" on the People surface rather than as an error.
- **The self-assignment carve-out (D7)** widens what one owner can do alone.
  Bounded to outlet-scoped roles, refused for the owner role itself, and
  reversible in one policy branch.

## Open Questions

None blocking. D7 is settled here and flagged for the owner to reverse if they
would rather mint a second Super Admin account.
