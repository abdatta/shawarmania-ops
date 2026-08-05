## MODIFIED Requirements

### Requirement: Attendance is readable by person over a range, not only by day

Attendance SHALL be readable along two axes: **by day**, which is the roll-call
above for one business date across the outlets in scope, and **by staff**, which
is one person over **one calendar month**, defaulting to the current one, with a
summary of how many days were present, late, absent and waiting for approval.

**The outlet choice SHALL scope the surface rather than one axis.** It SHALL be
offered above the axis control, SHALL stay in the same place whichever axis is
read, and SHALL apply to both. This supersedes the earlier rule that the axis is
chosen before the outlet and that the outlet choice belongs to the by-outlet
axis alone.

**The period is a month and there SHALL be no second way to state it.** The
summary exists so somebody can work out pay by hand and pay is monthly; every
absence in the list is derived from the period's bounds, so an arbitrary span
would produce an arbitrary absence count indistinguishable from a meaningful
one. The control SHALL move a month at a time and SHALL NOT reach a month that
has not begun.

The by-staff read SHALL span every outlet the reader may see, and the set of
those outlets SHALL be resolved in the database from the reader's own live
assignments rather than from anything the request names. A Franchise Admin
holding one assignment therefore reads that outlet, a Franchise Admin holding
several reads exactly those, and a Super Admin reads all of them. A reader SHALL
NOT be able to obtain a person's days at an outlet they hold no live assignment
at, by the surface or by a hand-crafted request. **The outlet selection SHALL
NOT be named in that read**, so it can neither widen what comes back nor
contradict the policy that decides it.

**The outlet selection SHALL narrow who the by-staff axis offers**, to people
holding a staff assignment at a selected outlet, and SHALL NOT narrow anything
else about the axis. In particular a selected person's month SHALL continue to
be assembled against every outlet the reader may see, so a person who moved
between outlets inside the period reads as one continuous month rather than two
partial ones. Where the selection leaves nobody to offer, the axis SHALL say so
rather than present an empty control.

**A person the selection has narrowed away SHALL NOT remain the subject of the
read.** Where the person being read holds no staff assignment at any selected
outlet, the axis SHALL move to somebody it is offering, so the days on screen
always belong to a person the control names.

#### Scenario: The outlet selection narrows the person picker

- **WHEN** a reader who may see two outlets selects one of them and reads by
  staff
- **THEN** only people holding a staff assignment at the selected outlet are
  offered, and selecting the second outlet as well offers both outlets' people

#### Scenario: A narrowed month still spans the outlets the reader may see

- **WHEN** a reader selects one outlet and reads the month of a person who
  worked at two of the outlets that reader may see
- **THEN** every day of that month is listed once, including the days worked at
  the outlet that is not selected, and the read names no outlet

#### Scenario: The period cannot be stated as a loose range

- **WHEN** a reader inspects the period control on either range surface
- **THEN** it offers a month at a time and no way to enter arbitrary start and
  end dates

A person's days SHALL be counted once per business date in that summary, whatever
outlet each was worked at, because the summary exists to count days somebody
worked so their pay can be computed by hand.

A person who holds no staff assignment at any outlet the reader may see SHALL NOT
be offered here even if they carry recorded rows there. Such rows are read on the
business day they belong to, which is where anybody settling one needs them; a
range of days for somebody whose days are not tracked would be a pattern of
nothing.

A person reading their own attendance SHALL be offered the same month control,
and their own history SHALL continue to span every outlet they work or worked
at, each day naming its outlet. Each day SHALL open onto its detail on the same
terms as the roll-call's rows, since an employee sees exactly what their manager
sees.

#### Scenario: A manager reads one person's month

- **WHEN** a Franchise Admin selects a staff member and the current month
- **THEN** every business day in the range within that person's assignment is
  listed with its status, arrival time, late tag and approval, and the summary
  counts present, late, absent and waiting days

## ADDED Requirements

### Requirement: The late tag reads before the verdict it qualifies

Late SHALL remain a tag and never a status: an approved late day is present and
late, and whether that costs half a day stays a manager's decision recorded in
the status.

Where a day is both settled and late, the tag SHALL be rendered **before** the
status it qualifies, on every surface that shows one — the roll-call, the
person's month, and the employee's own history — so that a reader scanning a
column of days meets the qualifier and the verdict in the order they are read.

#### Scenario: A late present day reads as late first

- **WHEN** any surface renders a day that is present and late
- **THEN** the late tag appears before the word Present, and both are still
  present with the tag still named to a screen reader
