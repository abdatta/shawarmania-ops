# Proposal: Attendance Batch Decisions

> **Model**: Opus · **Wave**: D · **Depends on**: #26, #29 · **Gate**: an FA or SA deliberately selects each waiting employee, with no Select all, then approves or denies the selected set in one atomic command; one fresh manager position is judged independently against every selected outlet, a common reason is stored only on approvals that require it, denial reads no manager position and applies one explicit retry choice to all selected employees, stale or unauthorised state changes none of them, and every row retains its own immutable decision and outlet isolation.

## Why

Attendance approval is intentionally a human attestation, but the current UI
confuses deliberate judgment with repeated submission. A manager who has seen
ten employees arrive must press Approve ten times and, when away or settling a
closed day, repeat the same explanation ten times even after consciously
deciding whom to include.

The earlier `attendance-approved-on-site` decision rejected an **Approve all**
button because it would include unseen arrivals by default. That protection
remains. This change draws a narrower boundary: every employee starts
unselected, the manager must select each one deliberately, and only the final
location read, explanation and database command are shared.

Production already shows the repetition at today's smaller scale. From 30 July
through 13 August 2026, aggregate-only reads found 60 attempts across 28
outlet-days, 24 of those days carrying at least two attempts. Forty-four of 49
approvals occurred on multi-approval days, and 43 occurred in rapid runs whose
median gap was four seconds. Eighteen of 20 multi-approval runs used one shared
reason value, covering 39 approvals. Each outlet currently has only three
attendance-capable people; the cost is visible before the proposed ten-person
morning exists. No names, reason text, coordinates or row-level production data
were read for this analysis.

## What Changes

- Add an explicit selection mode to the attendance day roll-call. Only current
  waiting rows are selectable; every row begins unselected, and there is no
  Select all, implicit selection, range selection or remembered selection.
- Let an authorised FA or SA choose **Approve** or **Deny** for the selected set.
  The selected employees and their outlets remain visible in the final sheet so
  the manager can verify exactly whose attendance the action will change.
- Keep the existing one-business-date boundary naturally imposed by the day
  view, while allowing the selected rows to span every outlet currently in
  scope and reachable by the manager.
- For approval, read the manager's position once in direct response to the batch
  action and evaluate that one contemporaneous reading independently against
  every selected outlet's position, radius and business-day clock.
- Partition selected approvals into those that can be recorded normally and
  those that require a reason. One editable reason covers the latter group and
  is stored only on those rows; normally approved rows retain a null reason.
- For denial, read no manager position. Require one editable reason and apply
  one `Prevent another check-in today` choice, unchecked by default, to every
  selected employee. The sheet states that shared consequence explicitly.
- Commit all selected approvals or denials atomically. A stale attempt, changed
  version, lost assignment, unauthorised outlet, malformed row or rule failure
  rejects the whole batch; the client refreshes and identifies which visible
  selections changed rather than silently settling the remainder.
- Preserve one append-only attendance decision per employee, each with its own
  client UUID, attempt link, actor snapshot, database time, previous/new outcome,
  reason where applicable, retry policy and approval evidence. A shared command
  identity may correlate the decisions but never replaces their individual
  audit records.
- Refresh the roll-call and every attendance attention count once after success,
  clear selection when the business date or outlet scope changes, and never
  allow an approved, denied, retried or otherwise settled row to remain silently
  selected.

## User-visible decision model

### Selection remains the safeguard

Entering selection mode changes each waiting row from a pair of immediate
actions into an explicit selected/unselected choice. A sticky action bar states
the exact count and offers `Approve`, `Deny` and `Clear`. Selection is manual all
the way down:

- nothing is selected on entry;
- a manager taps every employee they intend to decide;
- rows that are not waiting cannot be selected;
- no outlet chip, day count or backlog count doubles as a selection control;
- leaving the day, changing outlet scope or cancelling the action clears it.

This is deliberately not bulk approval by query. The database receives an
explicit finite set the manager constructed person by person.

### One position, independently judged for every outlet

A fresh reading is one truthful statement about where the manager was at the
moment they approved the selected set. It does not claim that they occupied
several outlets. The database computes that reading's distance to each selected
row's own outlet independently, just as it computes one row today.

| Reading and outlet state | Approval treatment |
|---|---|
| Inside every selected outlet's fence and each outlet still reckons the displayed date as current | All selected approvals are normal; no reason sheet opens. |
| Inside Kalyani but outside Kanchrapara | Kalyani rows are normal; the sheet explains that only Kanchrapara rows require the common reason. |
| Inside Kanchrapara but outside Kalyani | The reverse partition applies. |
| Outside every selected outlet | One reason is required for every selected approval. |
| Position unavailable | One reason is required for every selected approval and every row records unknown manager position. |
| An outlet is unsurveyed | Rows for that outlet require the reason; no surface claims the manager was on site there. |
| The displayed date has closed at one outlet but not another because cutovers differ | Closed-day rows require the reason even if the manager is inside their fence; still-current rows follow their distance result. |
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

### Denial stays a different attestation

Denial says that the selected attempts should not count; it does not vouch that
the manager stood anywhere. It therefore never reads or stores the manager's
position and does not use the approval partition above.

One non-blank reason applies to every selected denial. The existing retry lock
remains opt-in through one unchecked checkbox whose batch consequence is
unambiguous: `Prevent another check-in today for all 4 selected employees.` If
employees need different reasons or retry treatment, the manager must split the
selection. When selected attempts carry mixed evidence, the shared reason starts
blank rather than prefilling a sentence that would be false for part of the set;
an existing evidence-derived prefill may be reused only when it is true for
every selected attempt.

## Integrity, authority and failure contract

- The batch command derives the actor from the authenticated session. Request
  fields never confer SA or FA authority.
- An SA may decide selected rows across reachable outlets. An FA may do so only
  for outlets where they currently hold the required live assignment. The
  database validates every selected row even though the UI lists only readable
  ones.
- The command locks and validates the complete explicit set before appending any
  decision. It never implements one visible action as a client loop of
  independently committed per-row RPC calls.
- Every item carries the current attempt ID and expected state version. A retry,
  another manager's decision or an assignment change wins cleanly and makes the
  whole stale batch fail without a partial outcome.
- Exact command replay is idempotent. Reusing a command or decision UUID with a
  changed selected set, action, evidence, reason or retry policy is refused.
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

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: Replace the one-decision-at-a-time surface rule
  with explicit person-by-person selection followed by one atomic approval or
  denial; define multi-outlet evaluation of one fresh manager reading, selective
  approval reasons, shared batch-denial reason/retry behavior, immutable
  per-person audit records, idempotency, stale-state rejection and the continued
  prohibition on Select all.

## Non-goals

- No Approve all, Deny all, Select all, default selection, selection from a
  backlog count, or action over rows that are not visibly and individually
  selected.
- No automatic approval from employee geofence evidence. A check-in remains a
  claim until a manager acts.
- No mixed approve-and-deny command. One action applies to the complete selected
  set; different outcomes require separate selections.
- No per-employee reason editor inside one batch. Split the batch when reasons
  differ.
- No multi-day selection, approval from the by-staff month view, or action over
  an unseen historical range.
- No batching of manual entry or settled-day corrections. Their entered times,
  actions and reasons remain person-specific.
- No background location, continuous monitoring or position read before the
  manager presses Approve.
- No change to attendance outcomes, lateness rules, retry eligibility, one-day-
  per-person uniqueness, assignment authority or employee-visible evidence.
- No offline attendance decisions.

## Impact

- **Database command boundary:** a transactional, idempotent selected-set
  approval/denial command; deterministic locking; per-row authority, state,
  outlet-clock and reason validation; append-only decisions; and complete-set
  return/refusal behavior. Existing direct client loops cannot back the feature.
- **Tenancy:** RLS and command tests for a multi-outlet SA, a multi-outlet FA,
  mixed authorised/unauthorised selections, hand-crafted other-outlet IDs,
  assignment loss during review and an owner with no outlet assignment.
- **Adapter seam:** selected-set command types in the shared attendance adapter,
  matching Supabase and mock semantics, stable idempotency identities, typed
  stale/conflict errors and one post-success attention invalidation.
- **UI:** roll-call selection mode, row selection state, sticky batch action bar,
  multi-outlet approval partition summary, shared reason sheet, batch denial
  retry wording, stale-selection refresh and a reshaped attendance shimmer if
  selection changes the reserved row/action geometry.
- **Location and privacy:** one fresh approval reading fanned out as evidence to
  the explicit selected decisions, no location on denial, no background read and
  no additional categories of monitoring data.
- **Demo:** coherent multi-outlet fixtures demonstrating inside-one/away-one,
  unavailable position, shared denial, stale batch refusal and the absence of
  any Select all path without writing real data.
- **Verification:** database transaction/race/idempotency tests, RLS isolation,
  real-transport adapter coverage, component and accessibility tests, the four-
  role demo walkthrough, real auth role landings, phone/tablet viewports, light
  and dark themes, contrast, and the complete CI suite because this changes a
  live attendance command and role-index surface.

## Docs to update before archive

`docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`,
`docs/SECURITY_AND_PRIVACY.md`, `docs/DEMO_MODE.md`, `docs/TESTING.md`, and
`docs/LIMITATIONS.md`.
