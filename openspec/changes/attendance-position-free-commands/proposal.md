# Proposal: Position-Free Attendance Commands

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · **Gate**: **a person assigned to two outlets whose phone can supply no position picks an outlet and their check-in is recorded, waiting for that outlet's manager**, and a manager whose phone can supply no position settles a waiting day with a reason — both proved against a real Postgres over the same transport the phone uses; a command the backend cannot accept at all reads as a fault to report rather than a moment to try again; and the four-role demo walkthrough still walks.

## Why

Every attendance command that carries no position fails in production, and has
since the day the paths were built. A real employee assigned to both outlets
stood at a counter this morning, was asked which outlet he was at, chose one,
and was told *"That did not work. Try again in a moment."* Nothing was
recorded, and trying again could never have helped.

Two rules already in the spec are broken by it. An employee whose device cannot
supply a position is promised the record-it-anyway path "rather than failing
with a generic error", and an approval with no position is meant to be "treated
exactly as an off-site one". Both are unreachable today. The day this fix does
not land is a day somebody's attendance depends on their manager typing it in
for them.

## What Changes

- A check-in with no position is accepted: the row is recorded at the chosen
  outlet with unknown coordinates and waits for that outlet's manager. This is
  the which-outlet path for a person with several assignments, and the
  record-it-anyway path for a person with one.
- An approval given with no position is accepted, treated as off-site, and
  records that the approver's position is unknown.
- A command the backend cannot accept at all stops masquerading as a transient
  failure. The person is told the action cannot be sent and to report it, rather
  than being invited to retry something that will never succeed.
- The position-free path of both commands is covered against a real Postgres
  over the same transport the phone uses, because it is exactly the path the
  existing coverage never took.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: A position-free check-in and a position-free
  approval become stated, testable outcomes of the command transport rather
  than only of the screens above it; and an attendance command the backend
  cannot accept becomes a distinct user-visible fault, separate from a
  transient one.

## Impact

The Supabase attendance adapter's command payloads and its Postgres error
classification, one new action-error code and its copy, and the REST command
tests. No schema change, no migration, no policy change, no UI redesign: the
screens already model both paths correctly and it is what they send that is
wrong.

## Non-goals

- Widening or reinterpreting the geofence. An unlocated day still counts as
  nothing until a manager approves it with a reason.
- Recording a position the device did not give, or reusing an older reading to
  stand in for a missing one.
- Queueing a failed check-in for later delivery. Attendance is not the counter,
  and an offline attendance outbox is its own decision.
- Adding defaults to the attendance command functions in Postgres. The
  signatures are correct; the caller was dropping arguments.

## Docs to update before archive

`docs/ARCHITECTURE.md` (the adapter seam gains the rule that a command argument
is sent explicitly, never left undefined), `docs/TESTING.md` (the REST command
coverage now includes the position-free paths), and `docs/LIMITATIONS.md` (a
check-in that cannot be sent is reported, not queued).
