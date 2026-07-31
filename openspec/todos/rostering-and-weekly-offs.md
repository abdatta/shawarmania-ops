# Rostering And Weekly Offs

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Attendance

## Expectation

The app knows which days a person is expected to work **and roughly when**, so a
day they were never expected does not read as an absence and an evening shift is
not late for a morning deadline.

## Current behaviour

Since `attendance-approved-on-site` (#26), a person holding a live assignment at
an outlet reads as **absent** on every surface once that outlet's arrival
deadline for a business day has passed with no attendance row recorded for them.
That reading is derived rather than written — no scheduled process manufactures
rows (design D6) — and it is bounded by the assignment window, so days before
somebody joined or after they left are not painted at all.

A genuine weekly off is exactly the shape of an absence and reads as one. The
counts on the person view include it, so somebody working six days a week shows
four or five absences a month that nobody did anything wrong to earn.

The answer today is for a manager to **mark the day as leave**: a stored row
always wins over the derived reading, so a leave day stays leave. That works, and
it costs somebody remembering, once a week, per person.

**The same gap makes lateness blunt.** An outlet carries one arrival deadline for
everybody, so a shop running a morning and an evening shift cannot describe both:
whichever starts later reads as late, or the deadline is set late enough for the
evening and stops measuring the morning. The local seed works around it by giving
Kanchrapara a 20:00 deadline so the split-shift person's evening arrival is not
labelled late — a workaround that is visible in the fixture comments precisely so
nobody mistakes it for a design.

## Why it is deferred

Because the honest fix is a roster and the cheap fix is a guess.

Assuming Sundays off, or six-day weeks, or a rest day per person, would be wrong
for some outlet within a month — and a wrong assumption baked into how absence is
counted is harder to remove than to add, because by then it will have been read
as a payroll input. The owner's rule as stated on 2026-07-31 is about arrival
time, not about which days are working days, and #26 deliberately implemented
only what was asked for.

The cost is also visible rather than silent: an absence on a day off is wrong on
screen, where somebody will notice and say so, rather than quietly wrong in a
figure nobody checks.

## What already exists for it

- **The derived reading in one place** — `readDay` in
  `src/features/attendance/attendance-record.ts`, which every surface asks. A
  roster would narrow that one function rather than being threaded through three
  screens.
- **The assignment window already bounds it**, which is the same shape a roster
  needs: an expected-days rule is a second filter beside the one that already
  keeps days before somebody was hired off the list.
- **`leave` as a status**, which is the manual answer and would stay the answer
  for a day off that was not on the roster either.
- **The per-outlet arrival deadline**, which established that "when a day works"
  is a configuration surface rather than a constant — and which a shift-aware rule
  would narrow in the same way, not replace.
- **The stamped `attendance.arrival_deadline`**, which means a shift-aware
  deadline could be introduced without relabelling a single day already recorded:
  each row already carries the rule that applied to it.

## Open questions

- **Whose roster?** A pattern per person (six days, Sunday off) is cheap and
  covers the common case. A published weekly schedule per outlet is what a
  growing business actually wants, and is a different feature with shifts,
  publication and change history in it. Conflating the two is how this becomes a
  project.
- Does a roster bound the **absent reading only**, or does it also become
  something staff can see and plan against? The second is more useful and much
  more visible, which makes it a product decision rather than a data one.
- What happens to a person who works an **unrostered day** — recorded as normal,
  or flagged? Attendance already records what happened rather than what was
  expected, and that should probably not change.
- **Does the deadline move with the shift, or stay with the outlet?** Per-shift is
  what makes lateness meaningful for an evening; per-outlet is what exists and is
  one field an owner can understand. A middle answer — a second deadline for a
  named second shift — is cheaper than a roster and is arguably where this should
  start.
- Interacts with payroll, which V1 deliberately does not have (2026-07-28). A
  roster is the input payroll would need; building it as though payroll were
  coming is how it acquires fields nobody uses.

## Trigger to promote

The first time somebody asks why the attendance figures show absences on days
off; the first month in which the manual leave-marking is skipped often enough
that the counts stop being trusted; or the first outlet that genuinely runs two
shifts and needs both measured. Whichever comes first.

**Dependencies when seeded**: none structural. `attendance-approved-on-site`
(#26) is the change that made this visible.
