## MODIFIED Requirements

### Requirement: A trading day is one row per outlet, holding revenue by channel and the drawer

The ledger SHALL record at most one day row per outlet per business date,
enforced by a uniqueness constraint in the database. Each row SHALL hold, in
integer paise: revenue received as cash, as UPI, through Zomato and through
Swiggy; cash brought into the drawer; cash taken out of the drawer; opening
cash; and the drawer count at close. It SHALL also hold a reason for any
non-zero cash movement, an optional free-text note, and the Zomato and Swiggy
commission rates that applied to that day.

Where a channel is sourced by `aggregator-settlement-sync`, the row SHALL
additionally hold that channel's **gross**, **commission** and **net** as three
separate integer-paise values, a **settlement state** of provisional, settled or
disputed, the figure the owner had typed before the sync superseded it together
with the moment it did so, and, where settling changed the figures, the
provisional figures they replaced. The stored net SHALL be that channel's revenue for every
computation on this surface, and the stored commission rate SHALL NOT
participate in computing it. The retained typed figure SHALL participate in no
computation at all.

Money SHALL be integer paise throughout, and commission SHALL be an integer
basis-point value, so that no figure on this surface is ever a float. The
business date SHALL be an explicit `date` column and SHALL NOT be derived from
a timestamp when read.

A negative revenue figure SHALL be permitted, because a cash refund is recorded
by reducing that day's cash revenue. A negative opening cash, drawer count,
cash-in or cash-out figure SHALL be refused, as SHALL a future business date
and a commission rate outside nought to ten thousand basis points.

#### Scenario: A day is recorded for one outlet

- **WHEN** the owner records revenue across four channels, a drawer count and any cash movements for an outlet and business date
- **THEN** one day row is stored in integer paise against that explicit business date

#### Scenario: A second row for the same day is refused

- **WHEN** a second day row is submitted for an outlet and business date that already has one, including by a hand-crafted request
- **THEN** the database refuses it and the existing row is unchanged

#### Scenario: Both outlets keep separate days

- **WHEN** the same business date is recorded for both outlets
- **THEN** two independent rows exist and neither outlet's figures contribute to the other's day or month

#### Scenario: A cash movement states its reason

- **WHEN** cash in or cash out is non-zero
- **THEN** a reason is required and stored, and a blank or whitespace-only reason is refused by the database

#### Scenario: A refund reduces cash revenue

- **WHEN** cash is returned to a customer
- **THEN** it is recorded by lowering that day's cash revenue, and the negative figure is accepted

#### Scenario: An impossible figure is refused

- **WHEN** a negative drawer count, negative opening cash, negative cash movement, future business date or out-of-range commission rate is submitted by a hand-crafted request
- **THEN** the database refuses the write

#### Scenario: A synced channel carries its own three figures

- **WHEN** a day row's Zomato revenue is sourced by the sync
- **THEN** that row holds gross, commission and net as integer paise alongside a settlement state, and the day's Zomato revenue for every computation is the stored net

#### Scenario: A day the sync does not cover is unchanged in shape

- **WHEN** a day row carries an aggregator channel with no synced figures
- **THEN** that channel's revenue is the typed figure and its net is computed from the stored commission rate exactly as before

### Requirement: Commission and opening cash are snapshotted per day, so editing an old day never rewrites a later one

Each day row SHALL store its own Zomato commission rate, Swiggy commission rate
and opening cash as stored values rather than deriving them when read. When the
entry form opens for a new day, it SHALL offer as defaults the commission rates
from that outlet's most recent earlier day row and the counted cash from that
outlet's immediately preceding day row, and each default SHALL remain editable.

For a channel sourced by `aggregator-settlement-sync`, the stored commission is
a **measured amount rather than a rate**, read from the aggregator for that day.
No rate SHALL be offered, inherited or required for such a channel, and no
stored rate SHALL be used to compute its net. The measured commission is already
a per-day snapshot, so the protection this requirement exists to give is
unchanged.

Editing an existing day's commission rate, counted cash or any other figure
SHALL change only that day. It SHALL NOT alter any other day's stored opening
cash, commission rate, expected cash or difference. A synced figure arriving for
one business date SHALL likewise change only that date.

Where a day's stored opening cash disagrees with the immediately preceding day
row's counted cash, the surface SHALL show that disagreement as a read-only
signal beside the day. It SHALL NOT repair the figure, because a stored figure
the owner entered is evidence and a recomputed one is not.

#### Scenario: A new day inherits the previous day's close

- **WHEN** the owner opens the form for a business date following an existing day row at that outlet
- **THEN** opening cash is offered as that preceding row's counted cash and both commission rates are offered from the most recent earlier row, all editable

#### Scenario: The first tracked day is seeded by hand

- **WHEN** the owner records the first day row for an outlet, with no earlier row to inherit from
- **THEN** opening cash and both commission rates are required entries with no inherited default

#### Scenario: Correcting an old day leaves later days alone

- **WHEN** the owner edits the counted cash or commission rate on a day that has later day rows at the same outlet
- **THEN** only that day's stored figures, expected cash and difference change, and every later day's stored opening cash, commission rate, expected cash and difference are byte-for-byte unchanged

#### Scenario: A broken chain is visible

- **WHEN** a day's stored opening cash differs from the preceding day row's counted cash
- **THEN** the surface shows the disagreement beside that day and changes no stored figure

#### Scenario: A retrospective commission edit moves no cash figure

- **WHEN** the owner changes a past day's Zomato or Swiggy commission rate
- **THEN** that day's net aggregator revenue and the month's profit change, while its expected cash, counted cash and difference are unchanged

#### Scenario: No rate is asked for on a synced channel

- **WHEN** the owner opens the form for a business date whose Zomato figures are synced
- **THEN** no Zomato commission rate is offered, inherited or required, and the day's net is the stored measured net

#### Scenario: A settled figure moves only its own day

- **WHEN** a payout settles and the sync rewrites one business date's figures
- **THEN** only that date's stored figures and the month's totals change, and every other day's stored figures are byte-for-byte unchanged

### Requirement: The entry form groups each aggregator with its own rate and result, and its explanations are available rather than displayed

Each aggregator's stated revenue SHALL be presented together with the commission
rate stored against that day, as one group, and that group SHALL show what was
actually received, computed as the figures are typed through the same rounding
rule the month uses. Where no rate has been given, the group SHALL show that
there is nothing to compute rather than showing nil.

Where a channel is sourced by `aggregator-settlement-sync`, its group SHALL be
presented as a **reading rather than an entry**: gross, commission and net shown
as recorded, with no revenue field and no rate field inviting the same money to
be entered again, and with its settlement state named on screen. Where the
owner's earlier typed figure was superseded, that figure SHALL be shown beside
the synced one and marked as superseded, so the two are never mistaken for each
other. Where settling revised the day's figures, the group SHALL say so and
SHALL state what they were revised from. Where the day belongs to a disputed
week, the group SHALL say that the week has been paid but does not reconcile,
rather than presenting the figure as merely awaiting settlement.

The explanations of how the ledger treats a figure — a rate held per day, a
capital purchase recorded as cash out, a refund recorded as negative revenue,
a provisional figure that will be replaced when the week settles — SHALL be
reachable from the section they govern rather than displayed permanently beside
the fields. They SHALL be reachable by tap as well as by pointer, SHALL state
whether they are open, and SHALL be dismissable from the keyboard.

Every entry field's accessible name SHALL identify the figure unambiguously,
including which aggregator or which drawer movement it belongs to, whatever the
visible label is shortened to. No entry field's font size SHALL fall below the
threshold at which a mobile browser zooms the viewport on focus.

#### Scenario: An aggregator's result is visible while it is being entered

- **WHEN** a stated aggregator figure is typed and a rate is present for that day
- **THEN** the amount actually received is shown in that aggregator's group, matching what the month would compute for the same figures

#### Scenario: No rate means no figure

- **WHEN** a stated aggregator figure is typed on a day carrying no commission rate
- **THEN** the group shows that there is nothing to compute, and does not show nil as though it were a result

#### Scenario: An explanation is asked for

- **WHEN** the reader opens a section's explanation
- **THEN** it appears without displacing the fields, reports itself as open, and can be dismissed from the keyboard

#### Scenario: A shortened label still identifies its field

- **WHEN** two aggregator groups present fields with identical visible labels
- **THEN** each field's accessible name names its aggregator and its unit, so the groups are distinguishable without seeing them

#### Scenario: A synced group offers nothing to type

- **WHEN** the owner opens a day whose Zomato figures are synced
- **THEN** the Zomato group shows gross, commission, net and its settlement state as a reading, with no revenue field and no rate field

#### Scenario: A provisional figure says so

- **WHEN** a synced day belongs to a week that has not been paid
- **THEN** its group names the figure as provisional, and the explanation available from that section says it will be replaced when the week settles

#### Scenario: A revised figure says what it was

- **WHEN** the owner opens a day whose figures changed when its week settled
- **THEN** the group states that the figures were revised and what they were revised from

#### Scenario: A disputed week is not read as pending

- **WHEN** the owner opens a day belonging to a week that was paid but did not reconcile
- **THEN** the group says the week does not reconcile, rather than describing the figure as one that will be replaced when the week settles

#### Scenario: A superseded guess stays visible

- **WHEN** the owner opens a day whose typed Zomato figure the sync replaced
- **THEN** both figures are shown, the retained one marked as superseded, and only the synced one is used in the day's and the month's totals

### Requirement: A live outlet's cash and UPI revenue comes from bills, while its aggregator revenue is sourced or typed per channel

Each outlet SHALL carry an explicit **billing go-live date**, null until that
outlet is promoted and set by a Super Admin. It SHALL NOT be derived from billing
data: shadow smoke-test bills are rung before any customer money, so a derived
boundary would move itself onto a day whose revenue was already typed by hand.
Setting it to a business date that has already started SHALL be refused, because a
day that begins hand-typed and ends sourced from bills is counted twice.

From that date, the manual ledger SHALL source that outlet's **cash and UPI**
revenue from paid bills rather than from a typed figure, SHALL state on screen
that each figure came from the counter, and SHALL NOT offer a second field
inviting the same money to be entered again. Where a paid bill has one or more
append-only tender corrections, the ledger SHALL use its latest accepted effective
Cash/UPI allocation and SHALL NOT count the original allocation as additional
revenue.

**An aggregator channel's revenue SHALL be sourced where `aggregator-settlement-sync`
covers it, and SHALL remain typed everywhere else**, independently of the billing
go-live date and independently of the other aggregator. V1 billing accepts Cash and
UPI only, so an aggregator order is never rung at the counter and no bill can ever
be its source; sourcing therefore comes from the settlement record and from nowhere
else. A channel with no sourced figure for a business date SHALL keep its stated
revenue field, its per-day commission rate and its computed net exactly as the
capability already defines them. A day MAY therefore read as two figures from the
counter, one from settlement and one entered by hand, each labelled for what it is.

Every other part of the ledger SHALL keep working by hand until #12 and #13
retire it: Swiggy commission, cash in and out, expenses the sync does not source,
and the counted drawer. A business date before that outlet went live SHALL keep
its typed figure exactly as recorded, and a business date before the sync covered
a channel SHALL keep that channel's typed figure and stored rate exactly as
recorded.

Sourcing an aggregator channel SHALL NOT leave a day computing a net from a rate
and no stated revenue: where a channel is sourced, its stored rate SHALL be
disregarded in favour of the measured commission, and where it is not, the rate
SHALL continue to govern.

#### Scenario: Go-live is set mid-trade
- **WHEN** a Super Admin tries to set an outlet's go-live date to a business date that outlet is already trading
- **THEN** it is refused, naming the next date that has not started, so no day is ever part typed and part billed

#### Scenario: Shadow tests before go-live
- **WHEN** test bills are rung at an outlet before its go-live date is set
- **THEN** the ledger keeps reading that outlet's typed cash and UPI revenue for those dates, because the boundary is the recorded date and not the presence of bills

#### Scenario: The night an outlet goes live
- **WHEN** the owner opens the ledger for a live outlet's business date
- **THEN** cash and UPI revenue are shown as coming from the counter and are not editable there, while any unsourced aggregator revenue, its commission rate, the cash movements, the expenses and the drawer count are entered as before

#### Scenario: Aggregator revenue survives the handover
- **WHEN** the owner records a live outlet's day on which no aggregator channel is sourced
- **THEN** the Zomato and Swiggy groups are present with their stated revenue fields, their per-day rates and their computed net, and the day is storable with aggregator revenue and no typed cash or UPI figure

#### Scenario: One aggregator is sourced and the other is not
- **WHEN** the owner opens a day whose Zomato figures are synced and whose Swiggy figures are not
- **THEN** the Zomato group reads as a sourced figure with its settlement state, the Swiggy group offers its revenue field and rate as before, and the day's total is the sum of both

#### Scenario: An earlier month is reopened
- **WHEN** the owner opens a business date from before that outlet went live, or from before the sync covered a channel
- **THEN** every figure reads exactly as it was recorded, computed by the rule that applied on that date
