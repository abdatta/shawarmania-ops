## REMOVED Requirements

Every requirement in this capability describes closing a business day: a single
record per outlet per business date, written once by an end-of-session act,
frozen thereafter. That act does not happen at these outlets and never did. The
capability is removed whole rather than amended, because a model built on a
boundary the business does not observe cannot be corrected by adjusting its
figures.

**Nothing is lost that is not carried forward.** The three requirements worth
keeping have successors in `cash-drawer`, named against each below, and the rule
underneath the freeze survives in the words that outlive the ritual it was
attached to: *the app never changes a person's observation on its own.*

The tables and functions these requirements describe are **not dropped by this
change**. `daily_cash_records` and `close_business_day()` are left in place,
unwritten and uncalled, and are removed by `retire-the-manual-ledger` (#12).
`daily_cash_records` has never held a production row.

### Requirement: Day close snapshots figures computed by the database

**Reason**: there is no day close. Superseded by *Interval figures are computed
by the database and enforced as constraints* in `cash-drawer`, which computes
the same figures over an interval bounded by observation instants rather than by
a business date.

### Requirement: A closed day is a snapshot and is never recomputed

**Reason**: there is no closed day. The rule it protected survives as *The app
never changes a person's observation on its own* in `cash-drawer`.

### Requirement: The reconciliation arithmetic is enforced as constraints

**Reason**: superseded by the constraint requirement in `cash-drawer`. The
arithmetic changes shape: opening comes from the previous observation's
carry-forward rather than being supplied, and the terms are bounded by instants.

### Requirement: One close per outlet per business day, by that outlet's Franchise Admin

**Reason**: both halves are wrong. There may be two observations in one day, one
spanning three days, or none. And the authority is settled differently in *A
Super Admin reaches every drawer, and where they stood is recorded*.

### Requirement: The daily cash surface shows every input to the expected closing figure

**Reason**: superseded by `ledger-statement`'s derived drawer section, which
shows the same inputs ordered by instant, and by the cash drawer surface, which
shows the running balance and what has moved since the last observation.

### Requirement: The difference appears the moment the counted amount is entered

**Reason**: carried forward verbatim in intent. The successor of the same name
is in `cash-drawer`.

### Requirement: The reconciliation arithmetic is a shared, pure function in integer paise

**Reason**: carried forward. The successor, *The drawer arithmetic is a shared
pure function in integer paise*, is in `cash-drawer` and covers the
carry-forward as well as the expected total and the difference.

### Requirement: Closing a day states what it does and then freezes the figures

**Reason**: there is no close and no freeze. An observation is editable until the
next one anchors on it, then correctable only by an attributed adjustment; see
*An observation is editable until the next one anchors on it*.

### Requirement: A bill arriving against a closed day raises a visible exception

**Reason**: superseded by *Late-arriving work raises an exception beside the
observation*, which reports against the observation whose interval contains the
payment instant rather than against a business date, and which additionally
handles a late arrival that explains a recorded variance.

### Requirement: A cash withdrawal is recorded against the day and reduces the expected closing

**Reason**: superseded by *Cash leaving the drawer is one record carrying its
kind*. A withdrawal is no longer a day-scoped figure; it carries an instant, it
is either a collection or a spend, and one recorded as part of an observation is
excluded from that observation's expected total rather than subtracted from it.
