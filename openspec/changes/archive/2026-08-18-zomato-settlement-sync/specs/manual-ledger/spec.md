## MODIFIED Requirements

### Requirement: A trading day is one row per outlet, holding revenue by channel and the drawer

The ledger SHALL record at most one day row per outlet per business date,
enforced by a uniqueness constraint in the database. Each row SHALL hold, in
integer paise: revenue received as cash, as UPI, through Zomato and through
Swiggy; cash brought into the drawer; cash taken out of the drawer; opening
cash; and the drawer count at close. It SHALL also hold a reason for any
non-zero cash movement, an optional free-text note, and the **commission charged
on each aggregator channel that day, as an integer-paise amount**.

Commission SHALL NOT be stored as a rate [owner, 2026-08-17]. The measured take
moves between roughly 24% and 35% day to day, and is the sum of a base service
fee, a per-kilometre fulfilment fee, a capping discount, a payment fee and tax on
all of it; on one sampled order the published 14% base fee produced an actual take
of 37.8%. A single stored percentage therefore expressed an estimate in the shape
of an exact figure. Typed days SHALL take the amount off the statement, as synced
days take it from the aggregator.

Each channel SHALL hold exactly one revenue figure and one commission figure,
whether they were typed or read. A channel's **net** SHALL be computed as revenue
less commission and SHALL NOT be stored, because a stored third figure can
disagree with the two it is derived from.

Where a channel is sourced by `aggregator-settlement-sync`, the row SHALL
additionally hold a **settlement state** of provisional, settled or disputed,
which is the only thing that says whether that channel's figures were typed or
read; the revenue and commission the owner had typed before the sync superseded
them, together with the moment it did so; and, where settling changed the
figures, the provisional figures they replaced. The retained typed figures SHALL
participate in no computation at all.

Money SHALL be integer paise throughout, so that no figure on this surface is
ever a float. The business date SHALL be an explicit `date` column and SHALL NOT
be derived from a timestamp when read.

A negative revenue figure SHALL be permitted, because a cash refund is recorded
by reducing that day's cash revenue. A negative opening cash, drawer count or
cash movement figure SHALL be refused, as SHALL a future business date, and a
commission outside the range bounded by nought and that channel's own revenue for
the day.

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

- **WHEN** a negative drawer count, negative opening cash, negative cash movement, future business date, or a commission larger than that channel's own revenue for the day, is submitted by a hand-crafted request
- **THEN** the database refuses the write

#### Scenario: A synced channel writes the same two figures a typed one does

- **WHEN** a day row's Zomato revenue is sourced by the sync
- **THEN** that row's Zomato revenue and commission hold the figures read from Zomato, its settlement state says they were read rather than typed, and the day's Zomato net is revenue less commission

#### Scenario: A day the sync does not cover is unchanged in shape

- **WHEN** a day row carries an aggregator channel with no synced figures
- **THEN** its settlement state is absent, that channel's revenue and commission are the typed figures, and its net is revenue less commission exactly as for a synced day

### Requirement: Commission and opening cash are snapshotted per day, so editing an old day never rewrites a later one

Each day row SHALL store its own commission per channel and its own opening cash
as stored values rather than deriving them when read.

When the entry form opens for a new day it SHALL offer the counted cash from that
outlet's immediately preceding day row as the opening cash, editable. It SHALL
NOT offer, inherit or default a commission figure for any channel [owner,
2026-08-17]: commission is an amount, so the previous day's is a function of the
previous day's revenue and would be wrong by construction while looking
deliberate. A blank field is the honest offer.

A commission SHALL be required for any channel whose revenue for that day is
non-zero, and SHALL default to nought for a channel that earned nothing, because
a channel with no orders was charged nothing and that is a fact rather than an
unanswered question.

Editing an existing day's commission, counted cash or any other figure SHALL
change only that day. It SHALL NOT alter any other day's stored opening cash,
commission, expected cash or difference. A synced figure arriving for one
business date SHALL likewise change only that date.

Where a day's stored opening cash disagrees with the immediately preceding day
row's counted cash, the surface SHALL show that disagreement as a read-only
signal beside the day. It SHALL NOT repair the figure, because a stored figure
the owner entered is evidence and a recomputed one is not.

#### Scenario: A new day inherits the previous day's close

- **WHEN** the owner opens the form for a business date following an existing day row at that outlet
- **THEN** opening cash is offered as that preceding row's counted cash, editable, and both commission fields are empty

#### Scenario: The first tracked day is seeded by hand

- **WHEN** the owner records the first day row for an outlet, with no earlier row to inherit from
- **THEN** opening cash is a required entry with no inherited default, as is the commission on any channel that earned something

#### Scenario: Correcting an old day leaves later days alone

- **WHEN** the owner edits the counted cash or commission on a day that has later day rows at the same outlet
- **THEN** only that day's stored figures, expected cash and difference change, and every later day's stored opening cash, commission, expected cash and difference are byte-for-byte unchanged

#### Scenario: A broken chain is visible

- **WHEN** a day's stored opening cash differs from the preceding day row's counted cash
- **THEN** the surface shows the disagreement beside that day and changes no stored figure

#### Scenario: A retrospective commission edit moves no cash figure

- **WHEN** the owner changes a past day's Zomato or Swiggy commission
- **THEN** that day's net aggregator revenue and the month's profit change, while its expected cash, counted cash and difference are unchanged

#### Scenario: Nothing is asked for on a synced channel

- **WHEN** the owner opens the form for a business date whose Zomato figures are synced
- **THEN** neither a Zomato revenue nor a Zomato commission field is offered, and the day's net is its read revenue less its read commission

#### Scenario: A settled figure moves only its own day

- **WHEN** a payout settles and the sync rewrites one business date's figures
- **THEN** only that date's stored figures and the month's totals change, and every other day's stored figures are byte-for-byte unchanged

### Requirement: The entry form groups each aggregator with its own rate and result, and its explanations are available rather than displayed

Each aggregator's stated revenue SHALL be presented together with the commission
rate stored against that day, as one group, and that group SHALL show what was
actually received, computed as the figures are typed through the same rounding
rule the month uses. Where no rate has been given, the group SHALL show that
there is nothing to compute rather than showing nil.

How a sourced channel's group is presented is **not settled by this change**. It
is specified by `freeze-aggregator-and-supply-entry`, which withdraws the entry
fields for every aggregator rather than only for a sourced one, and moves the
figures out of the day row. Stating the sourced-reading behaviour here would
describe a form that this change did not build and that the next change replaces.

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

#### Scenario: No commission means no net

- **WHEN** a stated aggregator figure is typed on a day whose commission for that channel is still blank
- **THEN** the group shows that there is nothing to compute, and does not show the stated figure as though all of it had arrived

#### Scenario: An explanation is asked for

- **WHEN** the reader opens a section's explanation
- **THEN** it appears without displacing the fields, reports itself as open, and can be dismissed from the keyboard

#### Scenario: A shortened label still identifies its field

- **WHEN** two aggregator groups present fields with identical visible labels
- **THEN** each field's accessible name names its aggregator and its unit, so the groups are distinguishable without seeing them

### Requirement: A live outlet's cash and UPI revenue comes from bills, while its aggregator revenue stays typed

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
revenue field, its per-day commission amount and its computed net exactly as the
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
- **THEN** cash and UPI revenue are shown as coming from the counter and are not editable there, while any unsourced aggregator revenue, its commission, the cash movements, the expenses and the drawer count are entered as before

#### Scenario: Aggregator revenue survives the handover
- **WHEN** the owner records a live outlet's day on which no aggregator channel is sourced
- **THEN** the Zomato and Swiggy groups are present with their stated revenue fields, their per-day rates and their computed net, and the day is storable with aggregator revenue and no typed cash or UPI figure

#### Scenario: One aggregator is sourced and the other is not
- **WHEN** the owner opens a day whose Zomato figures are synced and whose Swiggy figures are not
- **THEN** the Zomato group reads as a sourced figure with its settlement state, the Swiggy group offers its revenue field and rate as before, and the day's total is the sum of both

#### Scenario: An earlier month is reopened
- **WHEN** the owner opens a business date from before that outlet went live, or from before the sync covered a channel
- **THEN** every figure reads exactly as it was recorded, computed by the rule that applied on that date
