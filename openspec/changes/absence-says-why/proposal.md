# Proposal: An Absence Says Why

> **Model**: Opus 5 · **Kind**: production bug fix, not a roadmap change · **Gate**: **every absent day on the manager's roll-call, the person view and the employee's own history opens onto one sentence saying why it is absent** — a manager's decision named with their words where they gave any, and a deadline-derived absence named as the deadline it was — with the two other derived readings still carrying no chevron.

## Why

An absent day says "Absent" and nothing else. The employee reading their own
month cannot tell whether they forgot to check in, whether a manager did not
accept the check-in they made, or why — and the manager reading the same day is
no better off, because the denial reason exists only as one line inside a
history timeline they have to open and scan.

That is the wrong silence for the one verdict somebody is most likely to
dispute. Attendance is what pay is worked out from by hand, and an absence a
person cannot account for is an argument at the counter rather than a record.

## What Changes

- An absent day carries one plain sentence saying why, revealed when the card
  is expanded and hidden until then, so the roll-call stays scannable.
- A day made absent by a manager names them, says what they did — did not
  accept the check-in, or marked the day absent — and quotes their reason where
  the record holds one.
- A day absent because nobody checked in says that, and says the outlet's
  deadline for arriving has passed.
- Because a deadline-derived absence now has one thing beneath it, it gains the
  chevron it deliberately did not have. `Not yet arrived` and
  `Working at another outlet` still have nothing beneath them and still carry
  none.
- Derived once, in the module that already knows what a stored row means, and
  rendered by the same component on all three surfaces — so an employee reads
  exactly what their manager reads, which is the standing rule for this
  feature.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: absence becomes a verdict that states its own
  cause on every surface, rather than a bare status the reader has to
  reconstruct from a timeline.

## Impact

One derivation in `src/features/attendance/attendance-record.ts`, one shared
component in `evidence.tsx`, and the two card renderers that already share
both. No schema, no policy, no adapter, no new read: every fact the sentence
states is already loaded and already visible to both readers.

## Non-goals

- Any new stored column, decision kind or reason field. Nothing is written.
- Wording that differs between the manager's view and the employee's own. One
  implementation is what keeps the two honest.
- Explaining the other derived readings. Nothing is wrong on a day nobody has
  arrived for yet, and `Working at another outlet` is one bit wide on purpose.
- Removing the denial reason from the history timeline. History is the audit
  trail; this is the headline.

## Docs to update before archive

`docs/SCREENS.md`, where the attendance surfaces are described.
