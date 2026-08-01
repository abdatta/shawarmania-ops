## Context

Change #28 (`multi-outlet-people`) made attendance one row per person **per
outlet** per business day (its D4), on the assumption that a split day across two
outlets was a real thing to record. The owner has since stated it is not: a person
staffed at two outlets works at one of them on any given day, and the month is a
mix of days at each.

Three of #28's decisions are revisited here. That is the intended use of a spec:
the model was built on an assumption, the assumption turned out to be wrong, and
the correction is recorded rather than patched around.

Production state, read 2026-08-01 before designing:

```
attendance ................ 7 rows, 5 people, 2026-07-29 to 2026-07-31
split days (person+date at 2 outlets) ...... 0
people with live staff assignments at 2 outlets ...... 1
outlets ... Kanchrapara and Kalyani, both cutover 04:00, deadline 13:00,
            radius 150 m, both surveyed, both active
```

So the wrong model is live but has produced no wrong row. No backfill, and no
defensive dedupe of historical data, is needed.

The constraint that shapes most of this design is Row-Level Security. Attendance
reads are already scoped by policy to the outlets the reader may see, and
`countWaitingByOutlet` relies on exactly that. A Franchise Admin at one outlet
**cannot see rows written at another outlet at all**. That single fact decides
how the collapse rule can be computed and is the subject of D3.

## Goals / Non-Goals

**Goals:**

- A person has one attendance day, and it counts once, whatever outlet it was
  worked at.
- Nobody is ever shown as absent on a day they worked.
- The owner can read one person's month across every outlet, to count days for
  pay by hand.
- A Franchise Admin's reach does not widen. What they may read is still decided
  in the database from their live assignments.
- Restoring split shifts later is cheap and the path is written down.

**Non-Goals:**

- Payroll amounts, rates, or payslips. Counting days is the whole of it.
- Supporting split shifts now.
- Offering an outlet picker when a position reading exists.
- Changing who may approve, when a reason is required, or what an approval
  records.

## Decisions

### D1 — One row per person per business date, enforced in the database

`attendance_one_per_person_outlet_day unique (person_id, outlet_id, business_date)`
returns to `attendance_one_per_person_day unique (person_id, business_date)`,
which is what it was before #28.

The owner initially preferred enforcing this outside the database to avoid a
migration. That option does not exist here: there is no server-side application
layer. `checkIn` is a direct `insert` from the browser client
(`src/data-access/supabase-adapters/attendance.ts`), so "adapter" and "UI" are
both client code and neither is an enforcement boundary. Postgres is the only
place a rule can actually hold.

**Rejected: a partial unique index instead of a constraint.** Same migration
cost, weaker error semantics, no benefit.

**Rejected: UI-only enforcement.** A hand-crafted request creates a second
waiting row at another outlet, which a manager there could then approve. Small,
but it is a wrong day in a pay count, which is the exact failure this change
exists to remove.

### D2 — The collapse rule lives in one module, for reversibility

The owner accepted the migration on the condition that restoring split shifts
later is not complex. The schema is not where that cost lives: #28 performed this
exact swap in the other direction in two statements, and reversing it is the same
two. The cost lives in read-side logic, so the design bounds it deliberately.

Every surface asks one module (`attendance-record.ts`) how a person's day reads.
No view derives absence, collapses rows, or reasons about outlets on its own.
Restoring split shifts is then: reverse the constraint, change that module, and
re-render. Not a hunt across five screens.

### D3 — A manager learns that somebody is accounted for elsewhere, and nothing more

This is the security-relevant decision in this change.

The collapse rule says a person with a row anywhere is not absent anywhere. A
Franchise Admin at Kalyani cannot see rows written at Kanchrapara, so **their
client cannot compute that rule**. Left alone, they would keep deriving absent
for a person who was at work, which is the bug this change exists to fix and is a
false statement about somebody's pay.

So one bit crosses the outlet boundary. A `security definer` function answers,
for a given outlet and business date, which people **on that outlet's own staff
list** hold an attendance row somewhere else that day. It returns person ids and
nothing else:

```
elsewhere(outlet, date) -> person_id[]

  discloses:      "this person is accounted for somewhere today"
  never discloses: which outlet, what time, the distance, the accuracy,
                   the status, the approver, or whether it was approved
```

The disclosure is bounded twice: to people the caller already manages, and to a
single boolean per person per day. The surface renders it as "Working at another
outlet today" with no outlet named.

**Rejected: showing nothing at all.** The owner's first instinct, and it reads
worse in practice: the roll-call silently shrinks and the manager cannot tell a
missing person from an absent one.

**Rejected: naming the outlet.** More useful to the manager, and a real widening
of what a Franchise Admin may learn about another outlet's operations. Not worth
one line of convenience.

**Rejected: deriving it from assignments alone** ("this person is also staffed
elsewhere"). That is true every day, including days they genuinely did not turn
up, so it would suppress real absences.

### D4 — By Staff takes its scope from RLS; By Outlet takes a set and RLS intersects

The two reads are scoped differently, on purpose.

**By Staff** drops the outlet filter entirely and lets policy define the answer.
"Every outlet this reader may see" is then a consequence of who they are rather
than of what they asked for, and it is automatically correct for all three
readers: one outlet for a single-outlet Franchise Admin, their own for a
multi-outlet one, all of them for the owner. No branching, nothing client-supplied.

This revisits #28's D7, which pinned an explicit `outletId` on the person-range
read so that "a query should mean one thing rather than quietly widening to
whatever RLS happens to allow". That reasoning held when the intended meaning was
one outlet. The intended meaning is now exactly the set RLS already computes, so
naming a set client-side would either duplicate the policy or contradict it.

**By Outlet** does take a client-named set, because the multi-select is a filter
within what the reader may already see. RLS intersects it. This is the existing
rule that the selector confers no authority, unchanged.

### D5 — The picker appears only when there is no reading at all

#28's D5 made the fence the sole chooser and rejected any outlet picker,
including when the fence is ambiguous. That rejection is kept for every case where
a position exists: inside one fence, inside several, or outside all of them, the
fence still decides and the person is never asked.

The one case it changes is no position at all with more than one assignment,
which #28 handled by refusing the check-in outright. The rejection reasoning does
not reach this case: there is no ambiguity to resolve, there is no data, and a
picker is the only honest input left.

The safety cost is nil. A row recorded this way carries no coordinates, so it is
already unverifiable and already requires a reasoned approval. The choice decides
only whose approval queue it lands in, and a manager who did not see that person
simply does not approve it.

**Rejected: keeping the refusal and directing to manual entry.** It is a dead end
for the one person in production who is staffed at two outlets, on the day their
GPS fails, and it hands work to an admin for no gain in truthfulness.

### D6 — The approval fence is judged per row, not per view

Today `decideApproval` evaluates the manager's single position reading against
the view's single outlet. With several outlets on screen, one reading can be
inside Kalyani's fence and outside Kanchrapara's at the same time.

Each row is therefore judged against **its own outlet's** position and radius.
Approving a Kalyani row from inside Kalyani stays one tap; approving a
Kanchrapara row from the same spot asks for a reason. That is not a new rule, it
is the existing rule applied correctly once the view stops being single-outlet.
The 60-second position reuse window is unchanged and is now keyed per outlet,
since a reading reused across outlets would vouch for standing in two places.

### D7 — Each row carries its own outlet's clock; nothing global is assumed

Both production outlets share a 04:00 cutover and a 13:00 deadline, so combining
them is currently trivial. The code must not encode that.

`business_date` is a stored column, so filtering a combined day is a plain
`outlet_id in (...) and business_date = X` and needs no shared clock at all. Only
two things need one: which date "today" is, and whether the next-day control is
disabled. Both are taken from the selected outlets, and where their cutovers
disagree the view shows the day as each outlet reckons it rather than inventing a
blended one. Radius, arrival deadline and lateness are already per row and stay
that way.

### D8 — Stale scope is cleared before it can be rendered

The reported "brief flash of old info" is a state bug, not only a missing
spinner. `OutletAttendance` holds `outlet` and `people` in state and refetches on
outlet change, so the previous outlet's roll-call renders under the new outlet's
name until the fetch lands.

The fix follows the pattern already correct in the By Person axis: key the loaded
data by the scope that produced it and treat a mismatch as loading, rather than
clearing state inside an effect. A shared loading placeholder that reserves the
layout of what is loading replaces the bare "Loading…" text, which also removes
the layout jump. It goes in the design system because no such component exists
anywhere in the repo today.

### D9 — The card compresses presentation, never the facts

The spec requires distance, accuracy, source, whether the approver was on site,
and any reason to be shown wherever attendance is read, and requires the
employee's own view to show exactly what their manager sees. `evidence.tsx` is
shared by all three surfaces for that reason, so this redesign changes the
employee's screen too. That is correct and intended.

"Less text" therefore means chips and icons in place of sentences, tighter
spacing, and an outlet chip when more than one outlet is in scope. Every fact
stays on the card, and every icon-only fact keeps an accessible name, so nothing
is lost to a screen reader or to somebody disputing a day. Colour is never the
only signal, per the design system.

### D10 — A manual entry names its outlet when the scope holds several

`recordManualEntry` writes to one outlet. With several selected and a person
staffed at more than one of them, the target is ambiguous, so the entry sheet
asks. With one outlet in scope, or a person staffed at only one of the selected
outlets, it is resolved and nothing is asked.

## Risks / Trade-offs

- **A genuine split day becomes unrecordable, including by an admin** → Accepted
  by the owner. Reversal is two migration statements plus one module (D2), and
  `docs/LIMITATIONS.md` records it so it is not rediscovered as a bug.
- **One bit crosses the outlet boundary (D3)** → Bounded to the caller's own
  staff, carries no outlet, time, status or evidence, and ships with an RLS
  isolation test asserting that the detail rows themselves are still refused.
- **The card redesign changes the employee's screen, not only the admin's** →
  Required by the spec that the two match. Covered by the existing e2e paths for
  all three surfaces rather than by the admin path alone.
- **Multi-select multiplies approval states** → D6 makes the judgement per row,
  which is the simpler rule as well as the correct one. Tested with a reading
  inside one outlet's fence and outside another's.
- **Mock adapters and demo mode drift from the new model** → Updated in this
  change. A demo that still shows the phantom absence would be showing the bug
  this change removes.
- **The collapse rule could be reimplemented ad hoc in a view later** → D2 gives
  it one home; the module is the only exporter of the day reading, and views take
  no outlet-aware branch of their own.

## Migration Plan

**Forward**

1. Verify production still holds zero rows violating `(person_id, business_date)`.
   It held zero on 2026-08-01. The constraint is added without a backfill.
2. One migration: swap the unique constraint, add the `elsewhere` security
   definer function (D3), and drop the single-outlet requirement from the
   person-range read path (D4).
3. Ship the collapse module and its tests before any surface consumes it.

**Rollback**

Reverse the constraint swap (two statements, the mirror of what #28 did) and
revert the collapse module. Rows written under the new rule remain valid under
the old one, since one row per person per day satisfies one row per person per
outlet per day. Rollback loses no data and needs no repair.

## Open Questions

None blocking.

Settled during exploration and recorded here so they are not reopened:

- Whether to defensively dedupe historical split-day rows. No, production has
  none.
- Whether "working at another outlet" should also appear on By Staff. No, By
  Staff is already combined across the reader's outlets, so there is no elsewhere
  to point at.
- Whether to split this into two changes. The owner asked for one, ordered so
  each layer is verifiable before the next depends on it.
