# Design: attendance-approved-on-site

## Context

Attendance is the one capability running in production, live since
2026-07-27 and restated twice since: `staff-as-accounts` (#21) rekeyed rows
onto `profiles`, and `multi-outlet-people` (#22) let the fence resolve which
outlet a person is standing at. What exists today:

- `attendance`, one row per person per outlet per business date, carrying
  check-in and check-out evidence independently (coordinates, accuracy,
  database-computed distance, source), plus `override_by` / `override_by_name`
  / `override_reason` / `override_at`, held together by a CHECK that all of
  the first, third and fourth are present or none are.
- `attendance_evaluate_geofence()`, which recomputes distance from the stored
  coordinates on the arrival of each leg and downgrades a claimed `present` to
  `absent` when the reading is beyond the radius, absent entirely on a phone
  check-in, or the outlet is not trading.
- `attendance_guard()`, which freezes identity and captured evidence, refuses
  an employee changing their own status, stamps the manual-entry enterer and
  the approver's name, and gates manual entry to a Franchise Admin or Super
  Admin on the outlet's current business day at a non-future time.
- A client that reads a position, judges it locally, and only then decides
  what to show: an out-of-fence check-in writes nothing at all until the
  person asks for an override.
- Two surfaces: the Employee's check-in card, and the manager's day view with
  its override sheet and manual-entry sheet.

Constraints that bind everything below:

- Location data is employee monitoring. Capture only in direct response to an
  action, store the minimum, and this change extends that duty to a new
  subject: the approving manager.
- The employee's own history must show exactly what their manager sees.
- Outlet isolation is enforced in RLS, and a Franchise Admin must not reach
  the other outlet's rows even by hand-crafted request. This change adds a
  read shaped by person rather than by outlet, which is precisely the shape
  that leaks if the outlet is left implicit.
- Screens depend on the adapter interface, never the Supabase client.
- Attendance is an online path. The Dexie outbox is the counter's, and
  nothing here queues.
- Whatever ships must render in demo mode, because the Employee's entire demo
  experience is attendance.

## Goals / Non-Goals

**Goals:**

- A check-in counts only once a human approves it, and the record shows
  whether that human was standing at the outlet when they did.
- One approval rule for every approver, cheap when honest and self-documenting
  when not.
- Arrival is judged against a per-outlet deadline that cannot rewrite history
  when it is later edited.
- Attendance is readable as a pattern (one person, a range) as well as a
  roll-call (one outlet, a day), with identical facts either way.
- Check-out ceases to exist, in schema, adapter, UI and spec.
- Nothing already recorded changes its meaning.

**Non-Goals:**

- No rostering, no weekly offs, no leave workflow.
- No payroll consequence for lateness.
- No notifications. Counts on surfaces only.
- No offline or queued attendance writes.
- No new authority: who may approve is exactly who may override today.

## Decisions

### D1 — Pending stays derived from the evidence, not a new status value

This continues the original attendance design's D1 rather than reopening it.
`attendance_status` is a payroll verdict (`present`, `absent`, `half_day`,
`leave`) and "waiting for a manager" is not one. A pending day is:

```
pending  ≡  check_in_at is not null and approved_at is null and status <> 'leave'
```

carrying `status = 'absent'`, because a day nobody has vouched for is not a
day credited present. Approval sets `present` in the same update.

**Rejected: adding `pending` to `attendance_status`.** Every consumer of the
enum (payroll counting, the month summary, future exports) would have to
learn that one of the four payroll outcomes is not an outcome, and a row
stranded in `pending` forever would be a fifth kind of absence that reads as
neither. The evidence already answers the question.

**What changes from today** is only the trigger's default: a bare in-fence
check-in used to survive as `present` and now does not. The downgrade branch
in `attendance_evaluate_geofence()` becomes unconditional for an unapproved
check-in, which makes the function smaller rather than larger.

### D2 — One approval rule, not a role branch

An approval requires a reason **unless** the approver's reading is inside the
outlet's fence **and** the approval happens on the row's own business day.
Out of fence, no position at all, and settling a closed day are one case and
cost one sentence. This holds for a Franchise Admin and the Super Admin
alike; the only difference between them stays what it already is, which
outlets they can reach.

The rule lives in `attendance_guard()`, not in the form. A hand-crafted
approval missing its reason is refused by the database.

**Rejected: hard-blocking an out-of-fence approval, with the Super Admin as a
fallback** (the owner's 2026-07-31 revision of an earlier draft of this
design). It produced three concepts where one would do, and its failure mode
was a manager phoning the owner rather than recording anything, which is the
workaround you cannot see. A visible off-site approval with a typed reason is
better oversight than a refusal that gets routed around.

**Rejected: always requiring a reason.** A manager approving eight people
every morning writes "ok" eight times, and a field that always says "ok" is
noise that hides the entries that matter.

**Rejected: never requiring a reason.** Then nothing distinguishes the
manager who was there from the one who was not, and the change loses its
point.

### D3 — The approval carries its own evidence, and "on site" is derived

Four columns beside the existing approval columns, mirroring the check-in
leg exactly: `approver_lat`, `approver_lng`, `approver_accuracy_m`, and
`approver_distance_m`, the last recomputed by the database from the first two
against the outlet's position, never accepted from the client. The same
reason `check_in_distance_m` is not the client's to state.

On-site is then derivable and is not stored:

```
on site  ≡  approver_distance_m is not null and approver_distance_m <= geofence_radius_m
```

**Rejected: an `approval_kind` enum column.** Two sources of truth that can
disagree, and the one that would be believed is the one a client wrote.

An unsurveyed outlet has no position to judge anyone against, so every
approval there reads as unverified rather than on-site. That is honest, and
it matches how check-ins already behave at an unsurveyed outlet.

### D4 — `override_*` is renamed to the approval it now is

`override_by` / `override_by_name` / `override_reason` / `override_at` become
`approved_by` / `approved_by_name` / `approval_reason` / `approved_at`, and
`AttendanceRecord.override` becomes `.approval`. An override was the
exception path; once every day goes through it, the word describes nothing.

The rename is semantically faithful to existing production rows: every
historic override carried a reason and an approver, which is exactly what an
off-site approval is under the new rule. Nothing is reinterpreted.

**Rejected: keeping the old names.** Column names are the contract the
adapter matches error strings against and the first thing the next reader
sees. A schema that calls the normal path an override teaches everyone who
touches it the wrong model.

### D5 — The arrival deadline is stamped on the row, not read live

`outlets.arrival_deadline` (`time`, not null, default `13:00`) is the rule.
`attendance.arrival_deadline` is the rule **that applied**, stamped by
`attendance_guard()` from the outlet when a check-in first lands, frozen with
the rest of the captured evidence.

Late is then derived from two facts the row holds, and the comparison is done
in the outlet's local reckoning, never as a UTC hour:

```
late  ≡  check_in_at > (business_date at arrival_deadline, Asia/Kolkata)
```

A check-in at 01:30 belongs to the previous business date under a 04:00
cutover, and is therefore late against that date's 13:00, which is both
correct and what a manager would say out loud.

**Rejected: deriving late from the outlet's current deadline.** Moving the
outlet's rule from 13:00 to 12:00 would silently relabel every historic day
recorded in between. This repo already snapshots for exactly this reason:
line-item prices, the approver's name, the enterer's name.

**Rejected: a `was_late` boolean.** It answers less for the same write. The
stamped time lets a row say "arrived 14:20, the deadline was 13:00" years
later, under whatever rule the outlet keeps by then.

A manual entry is stamped the same way, so an admin recording a 14:20 arrival
records a late one.

### D6 — Absent by deadline is derived, never written

No scheduled job. The rule lives in one module beside `isAwaitingOverride`
and every surface asks it:

- A stored row wins. A day marked `leave` stays leave; a row with a check-in
  is whatever its approval says.
- No row, and the outlet's deadline for that business date has passed:
  absent.
- No row, and it has not: not yet arrived.
- Bounded by the person's assignment window at that outlet
  (`assignments.started_on` / `ended_on`), so no day before they joined or
  after they left is painted at all.

For a day with no row there is no stamped deadline, so the outlet's current
one is used. Acceptable, and stated in the spec: whether somebody was absent
does not turn on the exact minute the rule was set to.

**Rejected: a cron or Edge Function writing `absent` rows at each outlet's
deadline.** It manufactures a row per assigned person per day whether or not
anything happened, needs a backfill for every past day, races the late
check-in it is trying to describe, and puts the app's core record at the
mercy of a scheduler nobody watches. Deriving costs one function.

### D7 — Two reads, each meaning one thing

- `listPersonRange(personId, outletId, from, to)` for a manager. The outlet
  is explicit and required, exactly as `getDay` made it explicit: a read
  shaped by person is the one that leaks, and RLS should be the second line
  of defence rather than the only thing making the query correct. A Franchise
  Admin therefore cannot even express "this person's days everywhere", and the
  policy refuses it as well.
- `listHistory(personId, from, to)` for the person themselves, spanning every
  outlet they work or worked at, because the spec already requires that their
  own history does.

**Rejected: one method with an optional outlet.** The optional argument is
the leak: omitted by a caller who meant "my outlet", it silently becomes
"everywhere the policy allows", and for a Super Admin viewing a Franchise
Admin's screen it would return more than the screen claims to show.

### D8 — A batch approval is one statement

The client reads a position once and issues a single update over the selected
ids (`.in('id', ids)`), so the batch is one round trip and one transaction.
The trigger stamps each row's approver name and evaluates each row's distance
independently.

**Rejected: a loop of single-row updates.** A partial failure leaves half a
morning approved with nothing on screen saying which half.

**Rejected: an RPC.** Nothing here needs privilege the caller lacks, and a
`security definer` function would move an authorisation decision out of RLS
where the isolation suite tests it.

### D9 — Enforcement is in the database, listed

`attendance_guard()` gains, and the isolation and write-contract suites
assert, that:

- An approval may be written only by a Super Admin or by a Franchise Admin
  holding a live assignment at the row's own outlet, resolved by membership
  through `app_has_role_at` / `app_is_owner` as everything else is. Unchanged
  from today, restated because the path is no longer exceptional.
- `approved_by` is the writing session, never the request body.
- An approval requires a check-in on the row. Approving a day nobody claimed
  is meaningless.
- `approval_reason` is required unless the approval is on-site and on the
  row's own business day, and may never be blank.
- Approver evidence is frozen once written, like every other captured fact.
- The arrival deadline stamp is taken from the outlet, never from the client.

RLS itself is unchanged in shape: the existing `attendance_select`,
`attendance_insert` and `attendance_update` policies already resolve scope by
assignment membership, and this change adds no table and no new reader.

### D10 — Existing rows keep their status, and their history

The migration renames columns and drops the check-out ones. It does not
recompute a single verdict. Every day already recorded keeps the status it
has, with empty approver evidence, and the surfaces read a row with no
approval and a check-in before the migration as recorded under the old rule
rather than as pending.

**Rejected: back-filling an approver onto historic present days.** It would
fabricate the exact artefact this change exists to make real.

## Risks / Trade-offs

**Dropping the check-out columns destroys production data** (owner decision,
2026-07-31, taken with the cost stated) → a full `pg_dump` of the production
database is task one, verified restorable into a scratch database before the
migration runs, stored outside the repo under the existing snapshot
procedure. The app can never show those times again; the dump is the record.

**Every working day now needs a manager action, and a manager who forgets
leaves people looking absent** → the honest path is deliberately the cheapest
one (on site, same day, one tap, no typing); pending counts appear on the
manager's day view, on the person view, and per outlet on the owner's side;
and settling a forgotten day later stays possible for anyone with authority,
at the price of a sentence.

**A new subject enters the monitoring surface: the manager** → their position
is read only in direct response to pressing approve, stores the same four
minimal fields a check-in stores, is visible to the employee it vouches for,
and is documented in `docs/SECURITY_AND_PRIVACY.md` in the same change. No
background reads, for anybody.

**A genuine weekly off reads absent**, since nothing in this app knows a
roster → recorded in `docs/LIMITATIONS.md`, with marking leave as the answer
today and rostering named as the change that would fix it properly.

**A person assigned to two outlets, and the person view** → the manager's
read is outlet-explicit by D7 and covered by an isolation case that a
Franchise Admin's range query returns no row worked at the other outlet.

**The demo dataset drifts** → the Employee's demo day is the whole demo for
that role, so the fixtures move in this change: an approved arrival, a
pending one, a late one, and an absent day, so the month view demonstrates a
pattern instead of a single row.

## Migration Plan

1. Dump production, verify the restore, store outside the repo.
2. Migration, in one file: rename the approval columns; add approver
   evidence and both deadline columns; drop the ten check-out columns and
   every constraint, guard branch and index referencing them; rewrite
   `attendance_evaluate_geofence()` and `attendance_guard()`.
3. Regenerate database types, which fails the build wherever a mock or screen
   still references check-out. That compile error is the migration checklist.
4. Adapters, shared derivation module, then the two surfaces.
5. Isolation, write-contract and geofence suites extended before the UI is
   called done.

**Rollback**: the migration is destructive by decision, so rollback is a
restore from the task-one dump, not a down migration. Everything else in the
change is client-side and reverts with the deploy.

## Open Questions

- Should a late day default to `half_day` rather than `present`? Deferred to
  the manager's judgment for now; a rule can follow once the business has
  seen a month of real lateness.
- Does the owner want a pending-approval alert once notifications exist? Out
  of scope here, and worth a todo when the first manager forgets.
