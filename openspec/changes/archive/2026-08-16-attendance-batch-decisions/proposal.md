# Proposal: Attendance Batch Decisions

> **Model**: Opus · **Wave**: D · **Depends on**: #26, #29 · **Gate**: an FA or SA
> adds each waiting employee to a set by one manual action of its own, with no
> Select all and no subset shortcut of any kind, then approves or denies the
> explicit set in one atomic command after confirming the named people; one fresh
> manager position is judged independently against every selected row's own
> outlet and date, a common reason is stored only on the approvals that require
> it, denial reads no manager position and applies one explicit retry choice to
> all selected employees, stale or unauthorised state changes none of them, every
> row retains its own immutable decision and outlet isolation, and the four-role
> demo walkthrough still walks.

## Why

Attendance approval is intentionally a human attestation, but the current UI
confuses deliberate judgment with repeated submission. A manager who has seen
ten employees arrive must press Approve ten times and, when away or settling a
closed day, repeat the same explanation ten times even after consciously
deciding whom to include.

The earlier `attendance-approved-on-site` decision rejected an **Approve all**
button because it would include unseen arrivals by default. That protection
remains. This change draws a narrower boundary: every employee starts
unselected, the manager adds each one by an action of its own, and only the
final location read, explanation, confirmation and database command are shared.

Production already shows the repetition at today's smaller scale. From 30 July
through 13 August 2026, aggregate-only reads found 60 attempts across 28
outlet-days, 24 of those days carrying at least two attempts. Forty-four of 49
approvals occurred on multi-approval days, and 43 occurred in rapid runs whose
median gap was four seconds. Eighteen of 20 multi-approval runs used one shared
reason value, covering 39 approvals. Each outlet currently has only three
attendance-capable people; the cost is visible before the proposed ten-person
morning exists. No names, reason text, coordinates or row-level production data
were read for this analysis.

**Half of this seam already exists, and the half that exists is wrong.**
`attendance.approve()` already takes an array of attendance ids, and the roll-call
already calls it with one. The Supabase adapter satisfies that array by looping
one `attendance_approve_attempt` RPC per row, minting a fresh decision UUID
inside the loop. So a multi-row approval today is neither atomic nor idempotent:
a network failure part way through leaves some rows approved, and retrying
generates new identities rather than replaying the same command. This change
completes that seam rather than opening a new one, and closing the loop is the
defect it fixes, not merely the tapping.

## What Changes

- Add an explicit selection mode to the attendance day roll-call. Only current
  waiting rows are selectable, and every row begins unselected.
- Let an authorised FA or SA choose **Approve** or **Deny** for the selected set.
- Show one confirmation naming every selected person before anything is written,
  whenever more than one person is being acted on.
- For approval, read the manager's position once in direct response to the batch
  action and evaluate that one contemporaneous reading independently against
  every selected row's own outlet position, radius and business-day clock.
- Partition selected approvals into those that can be recorded normally and
  those that require a reason. One editable reason covers the latter group and
  is stored only on those rows; normally approved rows retain a null reason.
- For denial, read no manager position. Require one editable reason and apply
  one retry-prevention choice, unchecked by default, to every selected employee.
- Commit all selected approvals or denials atomically, in one database command
  that validates the complete set before appending any decision.
- Preserve one append-only attendance decision per employee, and stamp every
  decision from one action with a shared batch identity.
- **Keep the existing per-row Approve and Deny buttons exactly as they are.**
  Most days one or two people are waiting, and selection mode must not turn a
  one-tap approval into three. Both paths run through the one new command, so
  the reason rule, the evidence rule and the authority rule have exactly one
  implementation.
- **Retire the 60-second position reuse window.** It exists only so that
  approving one at a time does not mean one GPS read per person, which is the
  problem this change solves properly. Removing it makes every stored approval
  position a fresh reading rather than one that may be up to a minute stale, and
  leaves one freshness rule in the spec instead of two.
- Refresh the roll-call and every attendance attention count once after success,
  clear the selection after any successful action, clear it when the business
  date or outlet scope changes, and never allow an approved, denied, retried or
  otherwise settled row to remain silently selected.

## User-visible decision model

### Selection remains the safeguard

Entering selection mode adds a selected/unselected choice to each waiting row.
**Every person joins the set by one manual action of its own.** A sticky action
bar states the exact count and offers `Approve`, `Deny` and `Clear`.

There is no shortcut that adds more than one person at a time. Specifically
there is no Select all, no select all at this outlet, no select everyone who is
late, no select everyone who is on time, no select the rest, no drag across a
range, and no press-and-hold sweep. Ten people means ten taps to select and one
tap to act. **The saving is in the acting, never in the selecting.**

Selection is manual all the way down:

- nothing is selected on entry;
- rows that are not waiting cannot be selected;
- no outlet chip, day count or backlog count doubles as a selection control;
- leaving the day, changing outlet scope, acting successfully, or cancelling
  clears it.

`Clear` is retained even though it deselects several people at once. It only
ever removes people from the action, so it cannot cause an approval nobody
looked at, and without it a mis-tapped selection has to be undone one at a time.

This is deliberately not bulk approval by query. The database receives an
explicit finite set the manager constructed person by person.

### Rows that are not on the outlet's staff list are selectable too

The roll-call shows waiting rows for people who are not on the outlet's current
staff list, because the list is built from live staff assignments while the rows
are permanent. It happens when an assignment ends after a check-in, and whenever
somebody carries a recorded row at an outlet they hold no staff assignment at.

`a-biller-is-staff` settled who is on that list and requires the view to list
anybody carrying a recorded row on the day whatever assignment they hold, so
that every count computed from rows can be settled. Its scenario states that
such a waiting row can be approved from the view.

Those rows count towards the waiting badge, so excluding them from selection
would leave work a manager could only clear one row at a time. They are
selectable on exactly the same terms as any other waiting row.

### Selecting a row and opening it are different acts

The roll-call now opens each row onto its detail, keeps waiting rows open when
the view opens, treats openness as the reader's own state, and does not close a
row when it settles. Selection mode must not fight that.

Selection is therefore its own control on the row rather than a meaning loaded
onto tapping the row body. Tapping the body opens and closes the row as it does
today, in selection mode and out of it, so a manager can still read the evidence
for somebody they are deciding about without losing or accidentally changing the
set they have built.

### One reading, judged independently for every selected row

A fresh reading is one truthful statement about where the manager was at the
moment they approved the selected set. It does not claim that they occupied
several outlets. The database computes that reading's distance to each selected
row's own outlet independently, just as it computes one row today.

| Reading and row state | Approval treatment |
|---|---|
| Inside every selected row's outlet fence and each outlet still reckons that row's date as current | All selected approvals are normal; no reason is asked for. |
| Inside Kalyani but outside Kanchrapara | Kalyani rows are normal; the sheet explains that only Kanchrapara rows require the common reason. |
| Inside Kanchrapara but outside Kalyani | The reverse partition applies. |
| Outside every selected outlet | One reason is required for every selected approval. |
| Position unavailable | One reason is required for every selected approval and every row records unknown manager position. |
| An outlet is unsurveyed | Rows for that outlet require the reason; no surface claims the manager was on site there. |
| A selected row's business day has closed at its outlet | That row requires the reason even from inside its fence; still-current rows follow their distance result. |
| Selected outlet geofences overlap and the reading is honestly inside more than one | Rows at every containing outlet are normal. |

The sheet groups by treatment and names outlets and counts, for example:

> **Approving 5 employees**
>
> Kalyani: 2 approved normally
>
> Kanchrapara: 3 require your reason
>
> Your reason will be recorded only against the 3 Kanchrapara approvals.

Three or more outlets use the same partition; there is no two-outlet special
case. If different remote outlets need different explanations, the manager
splits the selection into separate batches.

### One action may cover exactly what is on screen

The command imposes no single-business-date restriction. Every rule it enforces
is already per row: that row's own outlet, that outlet's own clock, that row's
own current attempt and state version. A set spanning two dates therefore
partitions on one more axis rather than needing new machinery, and the closed-day
reason rule keeps it honest without any date check of its own.

Today's roll-call shows one day, so today's selections span one day. Nothing in
this change encodes that. If a future surface shows a week, its rows are
selectable on the same terms, each still added by a manual action of its own.

Two consequences follow wherever a set can span dates:

- any summary listing selected people states the date beside the name, so one
  person appearing on two dates is legible rather than duplicated;
- the retry-prevention control does not say `today`. It names each selected
  row's own business date.

### Confirmation is the last gate before the write

Whenever more than one person is being acted on, one confirmation lists every
selected person, their outlet, their date where the set spans dates, and what is
about to happen to them. Nothing is written until it is confirmed.

It is always the final step. Where the rule asks for a reason, the reason form
comes first and the confirmation follows it, so the manager sees the names
after, and in light of, the explanation they just wrote. A single-person action
shows no confirmation, because its own row is already the thing being looked at.

### Denial stays a different attestation

Denial says that the selected attempts should not count; it does not vouch that
the manager stood anywhere. It therefore never reads or stores the manager's
position and does not use the approval partition above.

One non-blank reason applies to every selected denial. The existing retry lock
remains opt-in through one unchecked checkbox whose batch consequence is
unambiguous, naming both the count and the date it applies to. If employees need
different reasons or retry treatment, the manager splits the selection. When
selected attempts carry mixed evidence, the shared reason starts blank rather
than prefilling a sentence that would be false for part of the set; an existing
evidence-derived prefill may be reused only when it is true for every selected
attempt.

## Integrity, authority and failure contract

- The batch command derives the actor from the authenticated session. Request
  fields never confer SA or FA authority.
- An SA may decide selected rows across reachable outlets. An FA may do so only
  for outlets where they currently hold the required live assignment. The
  database validates every selected row even though the UI lists only readable
  ones.
- **The command requires the enrolled-device check that the read policies
  already require.** The existing single-row approve and deny commands omit it,
  so a revoked counter tablet's session cannot read the attendance day yet could
  approve through a hand-crafted request. The new command does not inherit that
  omission, and the retained per-row buttons gain the check by running through it.
- The command locks and validates the complete explicit set before appending any
  decision. It never implements one visible action as a client loop of
  independently committed per-row RPC calls.
- **Selected rows are locked in a deterministic order**, sorted by attendance id,
  so a batch and a concurrent single decision cannot deadlock each other.
- **At most 100 rows may be decided in one command.** A day's roll-call is far
  smaller, so no real selection meets it; it exists so a hand-crafted request
  cannot ask one transaction to lock an unbounded set. A future surface that
  legitimately needs more raises it deliberately.
- Every item carries the current attempt ID and expected state version. A retry,
  another manager's decision or an assignment change wins cleanly and makes the
  whole stale batch fail without a partial outcome.
- **A refusal preserves the manager's work.** The client refreshes, keeps every
  selection that is still valid, drops only the rows that moved, and names them,
  so the manager re-acts on the remainder in one tap rather than re-selecting
  from nothing.
- Exact command replay is idempotent. Reusing a command or decision UUID with a
  changed selected set, action, evidence, reason or retry policy is refused.
- **Every decision from one action carries a shared batch identity**, stored on
  the decision row, so history states that these people were settled by one
  action rather than leaving it to be inferred from adjacent timestamps. It
  correlates the decisions and never replaces their individual audit records.
  The column is added in this change's migration because `attendance_decisions`
  is append-only behind a guard trigger, which makes retrofitting it later a
  second migration against live rows.
- Approval stores the one captured coordinate/accuracy reading on each approval
  decision and computes each distance server-side against that decision's own
  outlet. The client never supplies a trusted distance or an on-site verdict.
- For a mixed approval, the database decides per row whether the common reason
  is required and records it only there. Client-side partitioning is explanatory,
  not enforcement.
- Success returns the complete settled set. Failure returns no settled rows and
  enough stable classification for the client to refresh rather than inviting a
  blind retry of stale state.
- Attendance remains online-only. No batch decision enters the billing outbox or
  claims success before the server transaction commits.
- No employee name, reason text, location, phone number or command payload is
  written to application logs or analytics.

## Requirements this change retires or rewrites

These are in force in `attendance-and-location` today and must be explicitly
rewritten by the delta, not left to contradict the new behaviour.

- **"An approval SHALL be given one day at a time. No surface SHALL offer an
  action that settles more than one waiting day at once"**, and the scenario
  *There is no way to approve a whole morning at once*. What survives is the
  intent, restated precisely: no control adds more than one person to a set.
  The one-day-at-a-time phrasing was a side effect of a single-day screen rather
  than an intended rule, and is not re-enacted at the database.
- **"A reading SHALL NOT be reused across rows belonging to different outlets"**,
  and the scenario *A reading is not reused across outlets*. **This is a
  deliberate reversal of `attendance-one-day-per-person` design D6, and the
  delta states why.** That rule bans reusing a reading up to 60 seconds old at a
  second outlet, which is stale evidence vouching for a place the manager may
  have left. This change measures **one fresh reading**, taken in direct response
  to the action, against several fixed points, which is arithmetic rather than a
  claim to be in two places. Retiring the 60-second window removes the staleness
  the old rule was protecting against, so the reversal costs nothing it defended.
- **"SHALL be able to deny that attempt one person at a time"** and the denial
  form rule that it *SHALL contain only the required reason and one checkbox*.
  The form gains the selected-set consequence and the confirmation that follows
  it; the prefill and non-blank rules are unchanged.
- **The 60-second position reuse window** and its scenario *A run of approvals
  reads the position once*, replaced by one reading per action.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: Replace the one-decision-at-a-time surface rule
  with per-person manual selection followed by one atomic approval or denial;
  define one-reading evaluation against each selected row's own outlet and date,
  selective approval reasons, shared batch-denial reason and retry behavior, the
  confirmation before any multi-person write, immutable per-person audit records
  carrying a shared batch identity, deterministic locking, the selected-set
  bound, the enrolled-device requirement, idempotency, stale-state rejection and
  the continued prohibition on every multi-select shortcut.

## Non-goals

- No Approve all, Deny all, Select all, select-by-outlet, select-by-lateness,
  select-the-rest, range selection, press-and-hold sweep, default selection,
  selection from a backlog count, or action over rows that are not visibly and
  individually selected.
- No automatic approval from employee geofence evidence. A check-in remains a
  claim until a manager acts.
- No mixed approve-and-deny command. One action applies to the complete selected
  set; different outcomes require separate selections.
- No per-employee reason editor inside one batch. Split the batch when reasons
  differ.
- **No new multi-day surface.** The command carries no date restriction so a
  future week view needs no command change, but this change builds no such view,
  and no action reaches rows that are not on screen and individually selected.
- No approval from the by-staff month view.
- No batching of manual entry or settled-day corrections. Their entered times,
  actions and reasons remain person-specific.
- No background location, continuous monitoring or position read before the
  manager presses Approve.
- **No GPS accuracy threshold.** Accuracy is recorded and displayed today but
  gates nothing, so a very imprecise reading that lands inside a fence counts as
  on site. This change lets one such reading carry several approvals instead of
  one, which is a real amplification and is recorded in `docs/LIMITATIONS.md`.
  Setting a threshold would also change employee check-in and belongs in its own
  change rather than arriving here as a side effect.
- No change to attendance outcomes, lateness rules, retry eligibility, one-day-
  per-person uniqueness, assignment authority or employee-visible evidence.
- No offline attendance decisions.

## Impact

- **Database command boundary:** a transactional, idempotent selected-set
  approval/denial command; deterministic lock ordering and a bounded set;
  per-row authority, device, state, outlet-clock and reason validation;
  append-only decisions carrying a batch identity; and complete-set
  return/refusal behavior. The existing per-row RPCs stop being the write path.
- **Migration:** one forward migration adding the batch identity column to
  `attendance_decisions` and the new command, leaving every existing row and
  guard trigger intact.
- **Tenancy:** RLS and command tests for a multi-outlet SA, a multi-outlet FA,
  mixed authorised/unauthorised selections, hand-crafted other-outlet IDs,
  assignment loss during review, a revoked counter device and an owner with no
  outlet assignment.
- **Adapter seam:** selected-set command types in the shared attendance adapter,
  replacing today's per-row loop; matching Supabase and mock semantics; stable
  client-generated identities that survive a retry; typed stale/conflict errors;
  and one post-success attention invalidation.
- **UI:** roll-call selection mode carried on its own row control rather than on
  the row body, so opening a row and selecting it stay separate acts; row
  selection state, sticky batch action bar, retained per-row actions, multi-outlet
  approval partition summary, shared reason sheet, the confirmation naming
  selected people, batch denial retry wording that names the date,
  selection-preserving refusal handling, and a reshaped attendance shimmer if
  selection changes the reserved row geometry.
- **Location and privacy:** one fresh approval reading fanned out as evidence to
  the explicit selected decisions, no location on denial, no background read, no
  cached reading, and no additional categories of monitoring data.
- **Demo:** coherent multi-outlet fixtures demonstrating inside-one/away-one,
  unavailable position, shared denial, stale batch refusal with preserved
  selection, an off-staff-list waiting row, and the absence of any multi-select
  shortcut, without writing real data.
- **Verification:** database transaction/race/idempotency/deadlock tests, RLS
  isolation, real-transport adapter coverage, component and accessibility tests,
  the four-role demo walkthrough, real auth role landings, phone/tablet
  viewports, light and dark themes, contrast, and the complete CI suite because
  this changes a live attendance command and role-index surface.
- **Every position-dependent rule is proved by emulated position, not by hand.**
  On site, away from every outlet, inside one fence and outside another, and no
  position at all are all driven through Playwright's own geolocation emulation,
  which exercises the same `navigator.geolocation` path a phone takes. One
  reading per action, and none at all for a denial, are proved by counting reads
  at the single module that touches that API. This change leaves no checkpoint
  that can only be closed on real hardware.

## Docs to update before archive

`docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`,
`docs/SECURITY_AND_PRIVACY.md`, `docs/DEMO_MODE.md`, `docs/TESTING.md`, and
`docs/LIMITATIONS.md`.
