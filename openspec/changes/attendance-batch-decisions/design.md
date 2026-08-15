## Context

Attendance approval is a human attestation. A check-in is a claim; only a
recorded approval makes a day count. That model is settled and this change does
not touch it. What it changes is how a manager expresses one decision about
several people.

Today the roll-call already asks the adapter for a multi-row approval and the
adapter fakes it. `attendance.approve()` takes an array of attendance ids, and
`src/data-access/supabase-adapters/attendance.ts` satisfies that array by looping
`attendance_approve_attempt` once per row, generating a fresh `p_decision_id`
inside the loop. Three consequences follow, and all three are defects rather
than design:

- the loop is not atomic, so a failure part way through leaves some rows settled
  and some not, with no record that they were one act;
- the loop is not idempotent, because a retry mints new decision identities
  rather than replaying the same command;
- the reason, evidence and authority rules are evaluated once per row against a
  reading the client may have cached for up to 60 seconds.

`attendance_approve_attempt` and `attendance_deny_attempt` also omit
`public.app_device_ok()`, which every read policy on `attendance_attempts` and
`attendance_decisions` requires. A revoked counter tablet's session therefore
cannot read the attendance day but can settle rows on it through a hand-crafted
request.

The data model is already right for this. `attendance` holds one canonical row
per person and business date with a `state_version`; `attendance_attempts` holds
immutable claims; `attendance_decisions` holds immutable decisions behind a
trigger that refuses every update and delete. Nothing here needs a new table.

Two neighbouring changes landed while this one was being written and both bear
on it. `attendance-one-day-per-person` made the roll-call multi-outlet and keyed
the position cache per outlet. `a-biller-is-staff` made Biller a staff role,
required the view to list anybody carrying a recorded row whatever assignment
they hold, and confirmed such a waiting row can be approved from the view.

## Goals / Non-Goals

**Goals:**

- One database command that settles an explicit set of waiting rows atomically,
  idempotently, and with every rule evaluated server-side per row.
- One evaluation of the reason rule, shared by the batch path and the per-row
  buttons, so the rule cannot be enforced two ways.
- One fresh manager position per action, judged independently against each
  selected row's own outlet and business date.
- Selection that cannot become a rubber stamp: every person joins the set by a
  manual action of its own.
- A refusal that costs the manager their action, never their selection.

**Non-Goals:**

- No new multi-day surface. The command carries no date restriction so one can
  be built later without touching it, but this change builds none.
- No change to check-in, retry eligibility, lateness, corrections, manual entry,
  or one-day-per-person uniqueness.
- No mixed approve-and-deny command.
- No GPS accuracy threshold.
- No offline attendance. Attendance stays online-only and enters no outbox.

## Decisions

### D1 — One command, `attendance_decide_set`, replacing both per-row RPCs

A new `security definer` function takes the action, the explicit set, and the
shared evidence:

```
attendance_decide_set(
  p_command_id      uuid,
  p_action          text,        -- 'approve' | 'deny'
  p_items           jsonb,       -- [{ attendance_id, attempt_id, expected_version, decision_id }]
  p_reason          text,
  p_prevent_retry   boolean,     -- denial only
  p_manager_lat     double precision,
  p_manager_lng     double precision,
  p_manager_accuracy_m numeric
) returns setof public.attendance
```

`p_items` is `jsonb` rather than parallel arrays so an item cannot be silently
misaligned by a client that builds four arrays of different lengths.

**The per-row Approve and Deny buttons stay in the UI and call this same
function with a set of one.** They are the common case and must not cost three
taps. What they stop being is a second write path.

`attendance_approve_attempt` and `attendance_deny_attempt` are **dropped** in the
same migration. Alternative considered: keep them and add the device check.
Rejected because an unused write path with its own copy of the reason rule is
exactly the silent over-permission the roadmap's protocol for command changes
warns about, and because their only caller is the adapter this change rewrites.
`attendance_submit_attempt`, `attendance_correct` and `attendance_record_manual`
are untouched.

### D2 — Identity: one command id, one decision id per row, one fingerprint

- `p_command_id` identifies the action. A new `command_id uuid` column on
  `attendance_decisions` carries it, so history states that these rows were one
  act instead of leaving it to be inferred from adjacent timestamps.
- Each item carries its own `decision_id`, preserving one immutable decision per
  person exactly as today. The command id correlates; it never replaces them.
- The request fingerprint is computed over the **whole** payload: action, the
  items sorted by attendance id, reason, retry flag and the position reading.

Replay rule: if `command_id` already exists, the stored fingerprint and actor
must match, and the command returns the current rows for that set. A replay
carrying the same command id with a changed set, action, reason, retry choice or
reading is refused. This is the same shape the existing single-row commands use,
lifted from one decision to a set.

The column is added now because `attendance_decisions` is sealed by
`attendance_decision_guard()`; retrofitting it later means a second migration
against live rows. Rows written before this change stay null, since those
decisions were made one at a time and inventing a batch for them would be
fiction.

### D3 — Deterministic lock order and a bounded set

Selected rows are locked `for update` in `attendance.id` order, in one statement,
before any decision is appended. A batch and a concurrent single decision
therefore acquire rows in the same order and cannot deadlock each other.

At most **100** items are accepted. A day's roll-call is far smaller, so no real
selection meets it. It exists so a hand-crafted request cannot ask one
transaction to lock an unbounded set. A future surface that legitimately needs
more raises it deliberately rather than discovering there is no bound.

The whole set is validated before the first insert: authority, device, expected
attempt, expected version, and that the row is genuinely waiting. Any failure
raises, and the transaction takes nothing with it.

### D4 — One fresh reading, judged independently per row

This **reverses `attendance-one-day-per-person` design D6**, which forbade
reusing a position reading across outlets, and the reversal is deliberate.

D6 was protecting against staleness, not against arithmetic. Its concern was the
60-second reuse window: a reading taken inside Kalyani and reused four minutes
later at Kanchrapara vouches for a place the manager may have left. This change
takes **one reading in direct response to the action** and measures it against
each selected row's own outlet coordinates and radius. Measuring one instant
against two fixed points is not a claim to occupy both; it is the same
computation the database already performs for one row, performed for several.

D5 removes the window that made D6 necessary, so the reversal gives up nothing
D6 defended.

The database computes every distance itself from the submitted coordinates and
disregards any distance a client offers, exactly as today. Approvals partition
server-side: a row needs the shared reason unless the reading is inside that
row's outlet fence **and** the row's business date is still current at that
outlet. The client's partition preview is explanatory, never enforcement.

### D5 — Retire the 60-second position cache

`POSITION_CACHE_MS` in `outlet-attendance.tsx` exists only so that approving one
at a time does not mean one GPS read per person, which is the problem this
change solves properly. Removing it means every stored approval position is a
reading taken for that action, and leaves one freshness rule in the capability
instead of two. The per-outlet cache map and its scope-change reset go with it.

### D6 — Authority and device, resolved from the session

Authority is unchanged in substance and now uniform in application: Super Admin
anywhere, Franchise Admin only where they hold a live assignment at that row's
outlet, resolved from `auth.uid()` and never from the request. Every selected
row is validated even though the client lists only readable ones, so a
hand-crafted set naming another outlet's row is refused as a whole.

`public.app_device_ok()` is required, closing the gap the dropped functions
carried. It passes for every ordinary person session and fails only for a
revoked counter device, so no real flow changes.

### D7 — All or nothing, with the classification the client needs

A stale item, a changed version, a superseded attempt, a lost assignment, an
unauthorised outlet or a blank required reason refuses the entire command. No
partial settlement, no silent remainder.

The refusal names its class and **not** which rows moved. The client already
holds the day and re-reads it, then diffs its own selection: rows that changed
are dropped from the selection and named on screen; rows still waiting stay
selected so the manager re-acts in one tap. Alternative considered: have the
command return the offending rows. Rejected because it would have the database
describe rows the caller may not be entitled to read, which is a tenancy leak
dressed as an error message.

### D8 — Adapter shape

`attendance.approve(ids, ...)` keeps its array shape and stops lying: one RPC
call, identities generated once by the caller and reused on retry. `deny` grows
the same set shape. Both return the settled rows. The mock adapter implements
the same semantics, including refusal on stale state and idempotent replay, so
demo mode and tests exercise the real contract rather than a permissive
imitation.

### D9 — Selection is its own control, and confirmation is the last gate

The roll-call opens rows onto their detail, keeps waiting rows open on arrival,
treats openness as the reader's own state, and does not close a row when it
settles. Selection therefore lives on **its own control on the row**, never on
the row body: tapping the body still opens and closes, in selection mode and out
of it, so a manager can read somebody's evidence without disturbing the set they
have built.

Every person joins the set by one manual action of its own. There is no Select
all and no subset shortcut of any kind: not by outlet, not by lateness, not
select-the-rest, no range drag, no press-and-hold sweep. `Clear` is retained
because it only ever removes people from the action.

Confirmation names every selected person before anything is written, whenever
more than one person is being acted on, and is always the last step: where a
reason is required, the reason form comes first and the confirmation follows it.
A single-person action shows none, because its own row is the thing being looked
at.

Where a set spans dates, every summary names the date beside the person, and the
retry-prevention control names each row's own business date instead of saying
`today`.

## Risks / Trade-offs

- **Deadlock between a batch and a concurrent single decision** → D3's fixed
  `attendance.id` lock order, with a test that runs both concurrently.
- **All-or-nothing is noisy under contention**: two managers on one busy morning
  can refuse each other's batches → D7 preserves the selection, so the cost of a
  refusal is one tap, not ten. Tested with a retry landing mid-batch.
- **One imprecise GPS reading now carries several approvals.** Accuracy is
  recorded and displayed but gates nothing today, so a reading accurate to
  kilometres that lands inside a fence reads as on site. This change amplifies
  that from one approval to a set → accepted and recorded in
  `docs/LIMITATIONS.md`. A threshold would also change employee check-in and
  belongs in its own change.
- **Dropping two RPCs breaks existing database and REST tests** → they are
  rewritten in this change, and their coverage is preserved rather than deleted:
  every rule they proved is re-proved against the new command.
- **The reversal of D6 could be read later as a contradiction** → the delta
  retires D6's clause and its scenario explicitly, and states the freshness
  argument, so the capability carries one rule and its reason.
- **A set spanning outlets means a partition summary with several groups** →
  grouped by treatment with outlet names and counts, and the same shape for two
  outlets or five, so there is no special case to get wrong.
- **Emulated position is not a real GPS fix.** Playwright's emulation drives the
  same `navigator.geolocation` path the app uses in production and proves every
  rule that depends on where the manager is: the partition, the reason
  requirement, the stored evidence, one read per action and none for a denial.
  What it cannot reproduce is a real device's drift and accuracy behaviour, which
  gates nothing today by design → accepted, and it is the same basis on which the
  existing check-in and approval specs are already proved.
- **RLS is not the enforcement here.** The command is `security definer` and
  therefore bypasses the row policies by construction. Its own per-row authority
  and device checks are the boundary, and the isolation tests target the command
  directly with hand-crafted sets rather than relying on the read policies.

## Migration Plan

**Forward**, one migration, forward-only and additive except for the two dropped
functions:

1. `alter table public.attendance_decisions add column command_id uuid`, nullable,
   with an index on `(command_id)`. Existing rows stay null.
2. Create `attendance_decide_set`, with `revoke ... from public, anon` and
   `grant execute ... to authenticated`, matching the existing command grants.
3. `drop function public.attendance_approve_attempt(...)` and
   `public.attendance_deny_attempt(...)`.

**Rollback**: forward-only, so a defect is corrected by a further migration that
re-creates the dropped functions and the previous adapter path. Nothing in this
change rewrites history: every existing attempt, decision and canonical row is
untouched, and the new column is nullable, so a rollback loses only the ability
to state that a set was one act.

**Order of work**: every database rule is written as a failing test before the
migration that satisfies it, per the roadmap's protocol for command changes, and
each numbered section of `tasks.md` ends in something provable in one sitting.

## Open Questions

- None blocking. The ten decisions this change needed were settled with the
  owner before expansion: off-staff-list rows selectable, per-row buttons
  retained, `command_id` added now, 100-row bound, ordered locking, device check
  required, refusal preserves selection, no date restriction, accuracy left
  unchanged and recorded, selection cleared after a successful action.
- One item is a stated reading rather than an instruction: the confirmation is
  shown **before** the write in both the plain and the reason case. If it was
  meant as a receipt after the write, that is a UI-only correction and touches
  no command, policy or migration.
