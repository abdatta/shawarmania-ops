# Proposal: attendance-approved-on-site

> **Model**: Opus · **Wave**: D · **Depends on**: #5, #21, #22 · **Gate**: **real staff check in on their own phones in production and the day counts only once a manager approves it**; an in-fence approval taken on the row's own business day is one tap with no reason, and an off-site or later one is refused without a reason, proved by a hand-crafted request; a check-in past the outlet's arrival deadline records its real time and evidence and reads late; a person with no check-in reads absent once that deadline passes; **no check-out exists anywhere in schema, adapter, UI or spec**; a manager opens one person's month and its figures reconcile exactly with the same days read by day; a Franchise Admin's person view returns no rows worked at the other outlet, proved by a hand-crafted request; and the four-role demo walkthrough still walks.

## Why

Attendance went live on 2026-07-27 and the business has now used it. Three
things it decided are wrong, and one thing it never had.

**A geofence is not a witness.** Today a phone inside the radius records a day
as present with no human involved, so the record attests to where a phone was,
not to whether anybody worked. The owner's rule is that a manager confirms
each arrival, which also confirms the manager themselves turned up: the
approval is the second signal that makes the first one worth keeping.

**Check-out was never used.** It doubles the schema, doubles the location
capture, doubles the evidence rendering, and carries its own never-refuse rule
across four requirements. Nobody looks at it. Monitoring data nobody uses is
the kind this repo's privacy rules say not to keep.

**Nothing enforced arriving on time**, which is the single fact the owner
actually wants attendance for. And **nothing answered "how has this person
been this month"**, because the manager's view is a day at a time: a pattern
is what tells a manager something, and reading it one day at a time is not
reading it at all.

Now, because every further wave adds people and outlets to this system, and a
rule about arrival is cheapest to install while two outlets and a handful of
accounts are all that exist.

## What Changes

**A check-in is a claim until a manager approves it.** Every self check-in is
recorded pending, in-fence or not, and counts as nothing until an approval
lands. The fence stops being the authority and becomes evidence: it still
decides what the person is shown before they write, and its verdict still
sits on the row.

**An approval records where the approver was.** The approving device's
position is captured and the database computes its distance from the outlet,
exactly as it does for a check-in. One rule then governs every approver,
Franchise Admin and Super Admin alike: **inside the fence on the row's own
business day is one tap with no reason; anything else requires a reason** that
cannot be blank. Off-site, no position at all, and settling a day that has
already closed are the same case and cost the same sentence. Nothing is
refused on fence grounds, so the guarantee is that the record shows whether
the manager was there, not that they must have been. A manager who approves
from home every morning shows up as a column of reasons, which is oversight a
refusal would not have produced.

**A batch approval settles everyone pending in one action**, on one position
reading, carrying one reason where a reason is required.

**BREAKING: check-out is removed.** Every check-out column is dropped, along
with its evidence rendering, its manual-entry half, its far-from-outlet flag,
and the requirement that a check-out is never refused. A day becomes one
arrival event. **This destroys the check-out times and locations already
recorded in production**, which the owner decided on 2026-07-31 with that cost
stated; a full production dump is the first task of the change and lives
outside the repo.

**An outlet gains an arrival deadline**, a per-outlet time defaulting to
13:00, set by the owner beside the business-day cutover. The deadline that
applied is stamped onto each row by the database at check-in, so a later edit
to the outlet's rule never retroactively relabels a day that was recorded
under the old one.

**Late is a tag, never a status.** A check-in after the deadline still
records, with its real time and its real evidence, and reads late everywhere.
Approved, it is present and late. No status changes and no separate late
path exists: a late arrival is approved by the same one rule as any other.

**No check-in by the deadline reads absent.** Derived, never written: no
scheduled job manufactures rows, and a stored status always wins, so a day
marked leave stays leave. Before the deadline a person with no row reads as
not yet arrived; after it, and on every past day, absent.

**Attendance reads by person as well as by day.** The manager's surface gains
a second axis: pick a person, pick a range defaulting to this month, and see
every day in it with a summary of present, late, absent and pending. The
person's own history gains the same range control, because the spec already
requires that an employee sees exactly what their manager sees about their
days. A Franchise Admin's person view returns only the days worked at their
own outlet; somebody who works at both has days at each, and the other
outlet's days are the other outlet's data.

**Stranded days are visible to the owner across outlets.** A pending day that
nobody settles is invisible until somebody queries their pay, so the owner
sees a pending count per outlet on the live attendance surface, not in the
demo-gated console.

## Non-goals

- **No rostering, and therefore no concept of a day off.** A day with no
  record and no leave marker reads absent, including a genuine weekly off.
  The manager marking leave is what distinguishes them. If that becomes noise
  in real use it is a rostering change, and it is not this one.
- **No payroll consequence for lateness.** Whether a late day is worth half a
  day stays a manager's call through the existing `half_day` status.
- No notification, push or alert telling a manager that approvals are
  waiting. The counts are on the surfaces; delivery is its own change.
- No change to how an outlet's position is captured, or to the radius.
- No background location of any kind, for anybody, including approvers. A
  position is read in direct response to a check-in, an approval, or an
  outlet capture, and at no other moment.
- No counter-tablet check-in. It stays hidden until #9 enrolls devices.

## Capabilities

### New Capabilities

None. This restates behaviour that `attendance-and-location` already owns.

### Modified Capabilities

- `attendance-and-location`: check-in becomes a claim that a recorded human
  approval settles; the approval carries its own location evidence and the
  one-rule reason requirement; check-out is removed entirely, taking three
  requirements with it; an outlet arrival deadline is stamped per row and
  produces the late tag and the derived absent; attendance is readable by
  person over a range as well as by day; pending days are visible to the
  owner across outlets.
- `outlet-tenancy`: the outlet the owner creates and edits gains an arrival
  deadline alongside its business-day cutover, writable by the Super Admin
  alone like every other outlet configuration field.
- `demo-mode`: the Employee's demo day is an arrival awaiting approval and
  then approved, not a check-in and a check-out; the manual-entry
  demonstration loses its check-out half; the dataset gains a late arrival, a
  pending day, and an absent day so the month view demonstrates a pattern
  rather than a single row.

## Impact

**Schema and policy** (a migration, against live production data):

- Drop ten check-out columns from `attendance`, plus the constraints and
  guard branches that reference them.
- Add the approver's evidence columns beside the existing approval columns,
  and the stamped arrival deadline.
- Add the arrival deadline to `outlets`, defaulting to 13:00.
- Rewrite `attendance_guard()` and `attendance_evaluate_geofence()`: no
  check-out leg, no auto-present on a bare check-in, the approval rule
  enforced in the database rather than by the shape of a policy branch, and
  the deadline stamped at write time.
- **Existing rows keep their status untouched**, with empty approval evidence,
  read as recorded before approval was required. Retro-fitting an approver
  onto historic days would fabricate the exact human decision this change
  exists to record.
- Isolation cases for every new read, including the per-person range.

**Client**: `AttendanceAdapter` loses `checkOut` and gains a person-range
read and a batch approval; both the mock and Supabase adapters follow. The
check-in card loses its check-out phase; the outlet day view gains the
person axis, the approval flow with its position read, and the reason rule;
the employee's own history gains the range control. The derived absent and
late rules live beside `isAwaitingOverride` in one shared module, so every
surface agrees by construction.

**Docs to update before this can archive**: `docs/DATA_MODEL.md`,
`docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md`,
`docs/SECURITY_AND_PRIVACY.md` (an approver's location is now monitoring
data about a manager), `docs/BUSINESS_CONTEXT.md` (the arrival rule),
`docs/DEMO_MODE.md`, `docs/GLOSSARY.md`, and `docs/LIMITATIONS.md` (a day
off reads absent; recorded check-out history is gone).
