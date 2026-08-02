## Context

Attendance currently stores one mutable row per person and business date. Its check-in evidence and
approval are frozen, and an unapproved check-in is represented by status `absent` plus no approval.
That shape supports one claim followed by one approval, but it cannot distinguish waiting from a
manager-decided absence, retain several location attempts, reverse a decision without rewriting it,
or move a pending claim between assigned outlets without colliding with the global unique key.

The change crosses the database, RLS, typed adapter seam, demo fixtures, employee and manager
surfaces, attention badges, and historical migration. Location evidence is employee monitoring data;
every extra attempt must remain minimal, immutable, and visible only to an authorised reader. The
existing one-person-one-business-date outcome, explicit business date, Asia/Kolkata display,
assignment-derived authority, and no-background-location rules remain binding.

## Goals / Non-Goals

**Goals:**

- Let an authorised manager deny one pending attempt with a reason and an optional global retry
  block, then correct that decision later without erasing history.
- Let an employee replace weak evidence or recover from a permitted denial, including at another
  assigned outlet, without creating a second attendance outcome for the date.
- Preserve each attempt and decision as typed, append-only evidence while keeping ordinary manager
  UI to Approve/Deny and one compact correction entry point.
- Make every cross-outlet transition atomic and database-authorised, with RLS preserving the current
  no-leak boundary.
- Migrate all existing attendance shapes without changing what any historical day means.

**Non-Goals:**

- Staff scheduling, an expected-outlet roster, automatic approval, bulk decisions, check-out,
  payroll policy changes, background location, or a new retention policy.
- Letting an employee reopen an approved/manual/leave/half-day day.
- Deleting or editing historical attempts and decisions.
- Making attendance offline-capable; unlike counter billing, attendance remains an online personal
  account workflow.

## Decisions

### D1. Keep one canonical day and normalize attempts and decisions beneath it

`attendance` remains the canonical person × `business_date` outcome and keeps the existing global
unique constraint. New outlet-scoped `attendance_attempts` rows hold each captured arrival's outlet,
time, source, coordinates, accuracy, database-computed distance, stamped arrival deadline, and
supersession/settlement relationship. New outlet-scoped `attendance_decisions` rows hold each
approval, denial, or correction with the acting account and snapshotted name, database time, reason,
retry consequence, and manager position only when the action vouches for presence.

The canonical row points at the current pending attempt and the attempt supporting the current
outcome. Its existing `status` remains the payroll outcome; pending work is not smuggled into that
enum. An initial undecided attempt reads waiting. After a denial, `status = absent` remains true even
while a later attempt waits, so the UI may honestly show “Absent — new check-in awaiting manager
review” and the process count may overlap the absent tally.

Alternatives rejected:

- Rewriting the location columns on `attendance` loses disputed evidence and contradicts the frozen
  evidence rule.
- Adding `second_check_in_*` columns merely caps the next edge at two attempts and duplicates every
  constraint.
- One generic JSON event table weakens typed schema checks, RLS review, and generated fixture types.
- Treating waiting/denied as new attendance statuses mixes workflow with payroll outcomes and makes
  existing summaries ambiguous.

### D2. Put every state transition behind idempotent database commands

Authenticated clients lose direct insert/update authority for attendance state. Narrow
`security definer` functions with empty `search_path` implement check-in/retry, approve, deny,
correct outcome, and reopen retry. They re-derive the caller, live assignments, outlet activity,
business date, distance, manager authority, and reason rule from database facts. Client-generated
UUIDs make attempts and decisions idempotent.

Each command locks the canonical person-day row and accepts the expected current attempt/decision
version. A stale approval, denial, correction, or retry fails by name and the client reloads. A
cross-outlet retry supersedes the old pending attempt, changes the canonical current outlet, and
creates the new attempt in the same transaction, so two managers are never simultaneously asked to
settle one person-day.

Alternatives rejected:

- Coordinating direct browser writes cannot make a cross-outlet move atomic and is bypassable by a
  hand-crafted request.
- An Edge Function adds a privileged network hop but no authorisation benefit; Postgres already owns
  the transaction and assignment facts. No service-role key is introduced.
- Last-write-wins would silently erase a manager decision or employee attempt in a race.

### D3. Retry eligibility is small and global

An employee may retry only when:

1. the newest pending attempt is outside the fence or unverifiable; or
2. the latest denial left retry open.

A newest pending in-fence attempt closes employee retry until a manager decides it. Approval,
manual presence, leave, and half-day remain employee-locked. A denial form's single
`Prevent another check-in today` checkbox is always unchecked initially; checking it closes retry at
every outlet. If retry remains open, the employee may use any outlet where they hold a live staff
assignment. This one global permission handles bad GPS and wrong-outlet arrivals without a retry
scope selector.

The target outlet must be active and must still calculate the canonical row's explicit
`business_date` as its current business date. This resolves differing cutovers without deriving a
day from UTC or letting a retry leak into another date. The new attempt stamps the target outlet's
current deadline; lateness is judged from that attempt's real time. A denied outcome remains absent
until approval of a later attempt.

Alternatives rejected:

- Same-outlet/any-outlet retry modes add manager choices and still cannot know the scheduled outlet,
  because scheduling is not modelled.
- Automatically trusting an in-fence retry would bypass the invariant that only a manager makes a
  day present.
- Reusing the first attempt's time or deadline would let an early outside claim disguise a late
  arrival.

### D4. One conditional employee confirmation covers every material change

The phone reads position and resolves the candidate outlet before writing. If a retry would change
outlet, on-time/late classification, or inside/outside/unverifiable fence result, one confirmation
lists every before → after change and offers `Use new check-in` or `Keep existing check-in`. No dialog
appears when nothing material changes. Confirmation grants no authority: the command still checks
the expected version and all eligibility rules.

An approved outcome never offers re-check, so “approved present → unapproved” cannot be confirmed by
an employee.

### D5. Denial has two inputs and does not collect manager location

The waiting row keeps Approve and gains Deny. Deny opens one sheet containing:

- a required editable reason, prefilled as “Check-in was outside the outlet geofence” for a measured
  outside attempt or “Check-in location could not be verified” when evidence is unknown; and
- `Prevent another check-in today`, always unchecked by default.

Submitting appends a denial, marks the canonical outcome absent, clears that pending attempt, and
stores whether retry is blocked. Denial does not read manager position: refusing a presence claim
does not assert the manager was at the outlet. Prefill is convenience only; the database requires a
non-blank reason and trusts neither the text nor client-computed fence result.

### D6. Corrections append; they never remove an approval or denial

Settled rows show no permanent button row. One quiet `Correct attendance` entry point reveals only
actions relevant to the current state:

- mark absent or present;
- allow another check-in after it was blocked; or
- mark an incorrectly approved outlet absent and allow another check-in.

Every correction requires a reason. Presence corrections use the latest recorded employee attempt
and capture the manager's location under the existing approval rule; they never manufacture a newer
employee reading. Absence and retry-only corrections do not read manager location. Earlier approval,
denial, and correction rows remain immutable and visible in history.

### D7. RLS follows the outlet of each piece of evidence

Both new tables carry `outlet_id` and ship RLS in the same migration. A Franchise Admin reads
attempts and decisions only for outlets where they hold a live Franchise Admin assignment and may
act only on the current pending/canonical state at such an outlet. An Employee reads all attempts
and decisions for their own person-day across their assignments. A Super Admin reads and acts across
outlets. Other roles receive no new access.

After a Kalyani attempt is superseded by a Kanchrapara attempt, Kalyani's manager can read the former
as superseded but cannot see or act on the latter. Kanchrapara's manager sees the current request but
not Kalyani's coordinates, reason, time, or manager. The existing “working elsewhere” disclosure
remains the only cross-outlet fact available to a Franchise Admin outside their evidence scope.

### D8. Waiting attention follows only the current pending attempt

A person-day contributes at most one waiting item. Its outlet is the active attempt's outlet. Retry
atomically removes it from the previous outlet's counts and adds it to the new one; approval or
denial removes it; a later permitted attempt adds it again. Denied-absent plus pending therefore
counts as absent in outcome summaries and as waiting in attention summaries.

The existing foreground/on-arrival refresh model remains. Successful commands invalidate the shared
attendance read so visible badges update immediately without polling.

### D9. Demo and live adapters share the command contract

The typed adapter exposes attempts, decisions, eligibility, and idempotent commands rather than
letting screens import Supabase. The mock enforces the same transition, reason, business-date,
assignment, retry, and stale-version rules in memory. Demo fixtures include an outside denial, a
permitted wrong-outlet retry, a blocked retry, a correction, and a material-change confirmation,
without any request leaving the app origin.

### D10. Migrate historical meaning, not merely columns

The migration creates a synthetic immutable attempt for each existing row with check-in evidence and
a decision for each recorded approval/manual settlement, preserving stored timestamps, names,
reasons, distances, deadlines, sources, and status. Pre-approval legacy rows that are already
`present` remain settled historical present rather than becoming weeks-old waiting work. Rows with
leave, half-day, or a manager-recorded status and no check-in retain that outcome without inventing
location. Current unapproved `absent` check-ins become initial pending attempts.

The canonical row and compatibility read are populated before direct mutation policies are removed,
so deployed readers do not observe a half-migrated shape.

## Risks / Trade-offs

- **[More GPS evidence is retained]** → Store only the evidence already captured per deliberate
  attempt, apply strict RLS, never read location in background, update the privacy docs, and leave
  retention duration to the existing retention-policy backlog.
- **[Outcome and waiting counts can overlap after denial]** → Label the employee state explicitly and
  test day/person summaries so “absent” and “awaiting review” are not presented as alternatives.
- **[Security-definer commands can widen authority if careless]** → Empty `search_path`, revoke public
  execution, grant only authenticated, derive identity/assignment server-side, constrain every
  transition, and prove cross-outlet refusals with hand-crafted SQL/REST tests.
- **[Cross-outlet cutovers disagree]** → Require the target outlet's current explicit business date
  to equal the canonical date; never infer the date from an attempt timestamp at read time.
- **[Backfill can relabel history]** → Assert counts and representative legacy/manual/leave/half-day
  shapes before and after reset; make the migration fail rather than guess an unrecognised shape.
- **[Rare recovery UI becomes clutter]** → Keep only Approve/Deny on waiting rows and hide corrections
  behind one state-sensitive entry point in expanded details.
- **[Concurrent managers or retrying employee race]** → Row lock plus expected version; one command
  wins, the other receives a named stale-state response and reloads.

## Migration Plan

1. Add append-only attempt/decision tables, canonical links/version fields, constraints, RLS, and
   guarded command functions without removing current reads.
2. Backfill attempts and decisions from every existing attendance shape and assert one canonical
   outcome per person/date with no new waiting item for settled legacy rows.
3. Regenerate database types; move adapters and fixtures to the new read/command contract.
4. Move employee, manager, history, tally, and attention UI to the new model.
5. Revoke legacy direct attendance mutation paths after all commands and tests are in place.
6. Update durable docs and run the full ordinary, database/RLS, auth E2E, demo, viewport, and theme
   verification set.

Rollback before application deployment drops the new objects and fields after verifying that no new
attempt or decision exists. After live use, rollback is forward-only: retain the append-only history
and deploy a compatibility reader, because collapsing several attempts or corrections back into one
row would discard evidence.

## Open Questions

None. Product behavior is settled; exact SQL object and TypeScript symbol names may be chosen during
implementation without changing the contract above.
