# Aggregator Settlement Sync

## Purpose

Defines how channel-scoped restaurant mappings, timestamped daily figures,
portal-declared payout cycles and official statement evidence become authoritative
ledger records. It preserves truthful provisional, settled, revised and disputed
states; makes browser-free daily reads safe to retry; and never invents a zero,
misattributes an order across an outlet cutover, or hides a payout discrepancy.
## Requirements
### Requirement: Automated restaurant identity uses the stateful mapping contract

Every automated operator flow that needs a restaurant identity SHALL resolve it
through `outlet_channel_restaurants`. The mapping SHALL use `state` as its
activation field, with `enabled` and `dormant` as its permitted values; it SHALL
NOT expose or query an `enabled` boolean column.

Statement parsing, owner-triggered reads, and reader session probes SHALL use
only mappings whose `state` is `enabled`. A dormant mapping SHALL remain
readable for audit but SHALL NOT cause automated work to start or use its
external reference.

#### Scenario: An enabled mapping permits the matching automated flow

- **WHEN** a statement parser, owner-triggered reader, or channel probe resolves
  an outlet's restaurant identity and an enabled mapping exists
- **THEN** it uses that mapping's `external_ref` for the matching outlet and
  channel

#### Scenario: A dormant mapping cannot start automated work

- **WHEN** the only mapping for an outlet and channel is dormant
- **THEN** the automated flow does not dispatch, ingest, or probe using that
  mapping

#### Scenario: The mapping activation state is queried correctly

- **WHEN** an automated mapping query is compiled against the generated schema
- **THEN** it queries `state = 'enabled'` and a query for an `enabled` boolean
  column is rejected

### Requirement: A synced day states gross, commission and net as three stored figures

For every outlet, channel and business date the sync covers, the ledger SHALL
store the aggregator's gross order value, the commission-and-fee reduction from
that gross, and the net order payout, each as its own integer-paise value
normalized from the aggregator rather than from a stored percentage.

For Swiggy, gross SHALL use the timestamped order-detail basis `Total Customer
Paid - GST Collected`, which fixture reconciliation proves equals the
payout-annexure `Net Bill Value (before taxes)` at paisa precision. It SHALL
NOT use Total Customer Paid including GST, `customerPaidAmount` from
`getOrderLevelPayoutsV2`, or the calendar-day Business Metrics Net Sales card as
ledger gross. The net order payout SHALL use the order-level amount payable to
the restaurant after order-level fees and taxes. The reduction SHALL be gross
minus net, so net plus reduction equals gross even when a cancelled order has
zero gross and a negative net payout.

An undated cycle-level ad investment, refund, recovery, outstanding amount or
other adjustment SHALL NOT be forced into a daily reduction; it remains a cycle
deduction used to reconcile the exact final payout. No percentage SHALL be
stored or used to calculate a synced net. An effective rate MAY be presented
from stored values for display only.

#### Scenario: A day arrives with all three figures

- **WHEN** the sync writes an outlet's Swiggy business date from order rows
- **THEN** gross, reduction and net order payout are stored as integer paise,
  and net plus reduction equals gross

#### Scenario: GST-inclusive Total Customer Paid is not ledger gross

- **WHEN** a Swiggy order includes GST collected from the customer
- **THEN** ledger gross subtracts the order-detail `GST Collected` amount from
  `Total Customer Paid`, and does not include that GST merely because the
  customer paid it

#### Scenario: A cycle-only deduction remains cycle-only

- **WHEN** a final payout includes an ad or recovery with no supported service
  date
- **THEN** it participates in cycle reconciliation but is not allocated across
  daily gross, reduction or net

#### Scenario: The rate is a reading, not an input

- **WHEN** a synced day is read
- **THEN** any rate shown is computed from stored money and no configured
  percentage participates in net revenue

#### Scenario: A day recorded before the sync is untouched

- **WHEN** a business date carries only a migrated typed Swiggy value
- **THEN** its preserved historical money remains the ledger value until an
  authoritative source covers that date

### Requirement: An order belongs to the trading day its placement time falls in

Each order SHALL be attributed to the business date produced by applying the outlet's own `business_day_cutover` to the order's **placement timestamp**, through the same rule the rest of the application uses.

The aggregator dates orders by calendar midnight and the outlets cut over at 04:00, so an order placed at 00:30 belongs to the previous trading day. The aggregator's own date field SHALL NOT be used as the business date. Where the settlement record carries a date but no time, the placement timestamp SHALL be obtained from the aggregator's order record and joined on the order identifier.

An order whose placement timestamp cannot be established SHALL NOT be attributed to a guessed day; it SHALL be held unattributed and reported.

#### Scenario: A late-night order stays on the trading day it was cooked

- **WHEN** an order is placed at 00:30, after an outlet whose cutover is 04:00 has begun a new calendar day
- **THEN** it is attributed to the previous business date, matching the date the counter's own takings for that shift carry

#### Scenario: An order at the cutover opens the new day

- **WHEN** an order is placed at exactly the outlet's cutover time
- **THEN** it is attributed to the new business date, consistent with the cutover being an inclusive start

#### Scenario: A timestamp cannot be found

- **WHEN** a settlement row has no matching order record from which to read a placement time
- **THEN** the order is not written against any business date, and the sync reports it as unattributed rather than falling back to the aggregator's own date

### Requirement: An unpaid week reads as provisional and a paid week replaces it

Each synced day SHALL carry a settlement state. A day sourced from a live/open
payout cycle SHALL be **provisional**, with the capture time and the portal time
through which it was current. Swiggy's open-cycle Current Payout MAY be
displayed as a provisional cycle estimate but SHALL NOT be presented as money
finally payable.

An aggregator cycle becomes eligible to settle when the operator labels that
cycle final and supplies the exact final payout and sufficient component evidence
to reconcile it. Bank status such as Pending, On Hold or Paid SHALL be stored
separately from settlement state; Swiggy's final Pending payout can therefore
settle the accounting record before the bank transfer, while a merely open
Current Payout cannot.

A settled figure SHALL supersede a provisional one for the same outlet, channel
and business date without creating a second row. A settled day SHALL NOT return
to provisional. If a later final source changes a settled value, the restatement
SHALL retain the earlier settled and provisional values and mark the day revised.

The `legacy_typed` provenance is not an operator settlement. A timestamped
portal daily read MAY replace a `legacy_typed` day with a provisional sourced
value, retaining the typed gross/reduction and supersession time. This narrowly
scoped transition SHALL NOT permit a provisional read to replace a genuine
settlement or an operator-supplied statement.

The surface SHALL state provisional, settled, revised or disputed wherever the
figure is read and SHALL separately state the payout's bank status when known.

#### Scenario: This week's revenue is marked provisional

- **WHEN** a twice-daily read captures today's open-cycle Swiggy figures
- **THEN** the day is provisional and shows the as-of time rather than implying
  the day or payout is complete

#### Scenario: A live day replaces a typed placeholder

- **WHEN** timestamped Swiggy order detail covers a business date carrying
  `legacy_typed` history
- **THEN** the sourced provisional gross replaces the typed value, retains the
  typed value as superseded history, and does not permit the same transition
  over a genuine settled or supplied statement day

#### Scenario: Settlement replaces the estimate in place

- **WHEN** a previously provisional cycle becomes final and reconciles
- **THEN** each covered day is rewritten from authoritative order/cycle facts,
  remains one row per outlet/channel/date and retains the prior provisional
  values

#### Scenario: A cancellation refund appears only on settlement

- **WHEN** a cycle contains a cancellation or preparation refund absent from the
  live provisional source but present in final order facts
- **THEN** final settlement includes it, retains the earlier values and marks
  the affected day revised when its figures change

#### Scenario: Final pending can settle before payment

- **WHEN** Swiggy labels a closed cycle FINAL with bank status Pending and the
  cycle reconciles
- **THEN** its days become settled, the cycle retains Pending as bank status,
  and the owner is not told that the transfer has arrived

#### Scenario: Current payout cannot masquerade as final

- **WHEN** Swiggy supplies a Current Payout for an open cycle
- **THEN** it remains provisional even if every displayed component currently
  adds to the estimate

#### Scenario: A revised day says what it was

- **WHEN** final or later-restated figures differ from earlier figures
- **THEN** the earlier values and source are shown beside the current ones and
  the day reads revised

#### Scenario: An unchanged day is not marked revised

- **WHEN** a cycle settles and a day's figures are identical to the provisional ones already stored
- **THEN** the day reads as settled and is not marked revised

#### Scenario: A settled day is not downgraded

- **WHEN** a later run reads live dashboard data for an already settled date
- **THEN** the settled values and state remain unchanged

### Requirement: A settled week is written only if it reconciles against the payout actually made

Before writing a settled cycle, the sync SHALL verify that the sum of its
order-level restaurant payouts, plus or minus its separately represented dated
and cycle-level deductions, taxes, ads, complaints, cancellations, refunds and
adjustments, equals the exact final payout stated by the aggregator.

The cycle identity and start/end dates SHALL come from the portal. The system
SHALL NOT infer a Monday-to-Sunday, Sunday-to-Saturday, seven-day or
calendar-month cadence; shortened month-boundary cycles are valid.

Where computed and stated payout agree within one rupee, the cycle SHALL be
written atomically. Where they differ by more than one rupee, no day, deduction
or reconciliation record from that candidate SHALL be written or altered, the
prior values SHALL remain, and the cycle SHALL read disputed with outlet,
channel, portal cycle, both totals and the difference.

A disputed final cycle SHALL remain disputed until a later source reconciles it
or the Super Admin uses the existing recheck/accept-difference controls. Payment
status changes alone SHALL NOT conceal or resolve a discrepancy.

#### Scenario: A reconciling cycle is written

- **WHEN** order payouts and represented adjustments equal Swiggy's final net
  payout within one rupee
- **THEN** all daily, deduction and reconciliation changes commit together as
  settled

#### Scenario: Portal dates define a shortened cycle

- **WHEN** Swiggy declares a final cycle covering a month-boundary range shorter
  than seven days
- **THEN** reconciliation uses those exact dates and does not expand or merge
  the range

#### Scenario: A discrepancy stops the write

- **WHEN** a final cycle differs from the computed payout by more than one rupee
- **THEN** no candidate day, deduction or cycle value is committed, prior
  records remain unchanged and the named cycle becomes disputed

#### Scenario: A disputed week is not mistaken for the current week

- **WHEN** a FINAL cycle has been refused for failing to reconcile
- **THEN** its candidate dates read disputed rather than provisional,
  distinguishable from an open cycle still awaiting finality

#### Scenario: A later run resolves a dispute

- **WHEN** a previously disputed cycle reconciles from a later authoritative read
  or confirmed upload
- **THEN** its candidate facts commit atomically and the cycle becomes settled
  or revised as appropriate

#### Scenario: Rounding noise does not raise an alarm

- **WHEN** computed payout differs from the exact stated payout only within the
  one-rupee tolerance
- **THEN** the cycle is treated as reconciled and no discrepancy is reported

### Requirement: Aggregator deductions are recorded as expenses dated to when the spend happened

Deductions the aggregator takes from a payout, such as supply purchases and advertising, SHALL be recorded as expense rows dated to the business date of the **spend itself**, not to the date of the payout that collected it. A deduction has been observed settling four to eleven days after the purchase, sometimes in a later cycle than the one containing its date.

Each such expense SHALL carry the identity of the record it came from, so that repeated runs update the same row rather than creating another, and so that a hand-entered row for the same purchase is recognisable as a duplicate rather than silently doubling the month's costs.

A hand-entered row and a sourced row for the same purchase SHALL be recognised as a possible duplicate **without requiring their amounts or dates to be equal**, because a typed figure is rounded and typed dates record when a bill was noticed rather than when it was paid. The surface SHALL present both rows with their own amount, date and note, and SHALL offer settling the flag without changing either row, since the same purchase genuinely occurring twice in a day is ordinary.

An expense sourced this way SHALL be marked non-cash, because it never passed through the drawer.

#### Scenario: A supply bill lands on its purchase date

- **WHEN** a supply deduction dated the 1st is collected by a payout on the 12th
- **THEN** the expense is recorded against the 1st, and the month containing the 1st carries the cost

#### Scenario: Re-running does not duplicate a deduction

- **WHEN** the sync runs again over a window that already produced a deduction expense
- **THEN** the existing row is updated in place and no second row is created for the same source record

#### Scenario: A rounded figure on a nearby day is still a possible duplicate

- **WHEN** a supply deduction of ₹3,747.77 dated the 16th arrives at an outlet where the owner has already entered ₹3,750 on the 15th
- **THEN** the two are presented together as a possible duplicate, each showing its own amount, date and note, and neither is altered

#### Scenario: Both are real

- **WHEN** the owner settles a possible duplicate by saying both purchases happened
- **THEN** the flag stops asking, both expenses continue to count, and neither row is changed

#### Scenario: A deduction never touches the drawer

- **WHEN** a deduction expense is written
- **THEN** it is marked non-cash, and the day's expected cash and difference are unchanged

### Requirement: A deduction belonging to no trading day is never attributed to one

A cycle-level deduction SHALL be recognised as such and stored as its own deduction record against the outlet and the period it names. It SHALL NOT be attributed to a business date, SHALL NOT contribute to any day's revenue, and SHALL NOT be recorded as an expense category.

The aggregator emits these, such as tax deducted at source, through the same channel as orders: carrying an identifier that names a deduction kind, an outlet and a period rather than an order, a null date that renders as an epoch date, a rejected status and a negative amount. Such a record refers to a period that is not the cycle it is paid in, so attributing it to the cycle that carries it would misdate it as well as misplace it.

#### Scenario: A tax deduction is recognised, not booked as a day

- **WHEN** the settlement record contains a row whose identifier marks it as a cycle-level deduction with a null date
- **THEN** it is stored against the outlet and the period it names, and no business date's revenue changes

#### Scenario: An epoch date never reaches the ledger

- **WHEN** a record carries a null date rendering as 1 January 1970
- **THEN** no ledger row is created for that date

### Requirement: A synced figure supersedes a typed one while preserving what was typed

Where an authoritative sync or upload covers an outlet, channel and business date
that already has a typed legacy figure, the sourced figure SHALL become the
ledger value and the entered values SHALL be retained with legacy-typed
provenance and the moment they were superseded.

Before the writable Swiggy fields are removed, migration SHALL prove that every
non-null typed revenue, rate and commission fact has been carried and that
day/month totals remain identical. A partial carry SHALL fail atomically. After
removal, a date awaiting authoritative coverage SHALL read its carried legacy
values as read-only history; failure of a later read SHALL not delete them,
replace them with zero or reopen typing.

The retained figure SHALL NOT participate in revenue or profit computation once
superseded. It exists so the owner can compare prior estimates with measured
truth.

#### Scenario: Typed Swiggy is carried before fields are removed

- **WHEN** the handover migration runs
- **THEN** every existing typed Swiggy value is retained with legacy provenance,
  totals are unchanged and the migration refuses a partial carry

#### Scenario: A typed day is taken over

- **WHEN** an authoritative Swiggy source covers a business date carrying a
  legacy value
- **THEN** the sourced figure becomes the day's value, the legacy figure is
  marked superseded and totals include only the sourced figure

#### Scenario: The owner can see what they had guessed

- **WHEN** the owner reads a date whose typed Swiggy figure was superseded
- **THEN** the legacy and authoritative figures remain distinguishable, with the
  legacy value excluded from totals

#### Scenario: A failed reader preserves legacy history

- **WHEN** the reader fails before authoritative Swiggy data covers a legacy
  date
- **THEN** the legacy value remains readable and unchanged, no zero is written
  and no manual money field returns

### Requirement: The owner has one surface listing what the sync changed, in which a row is a run

The owner SHALL have a single surface reporting the sync's activity, in two
sections: what needs them, and what has happened. **That surface SHALL serve
every restaurant channel through one navigation entry**, with the channel chosen
on the surface itself; the sections, the vocabulary and the history below are the
same questions asked of each channel's own reader.

**What needs them** SHALL list only unresolved matters — a lapsed session, a
disputed week, a possible duplicate expense — and SHALL be presented expanded
with the actions available on each. A matter resolved by a later run SHALL leave
this section. The surface SHALL state when the sync last ran and whether it
succeeded.

**A channel that has stopped running SHALL read as stopped, and SHALL NOT read as
its last success.** Where the time since a channel's last run exceeds its own
reported cadence by a stated margin, the surface SHALL present that channel as at
fault, name that a read was due and did not happen, and offer the read it is
already able to offer. The margin SHALL be derived from the cadence the runner
reports rather than from a constant in this repository, so that it moves when the
schedule moves.

This SHALL be evaluated at read time. A channel that has stopped running cannot
record that it has, because the process that would record it is the process that
is missing; nothing SHALL be relied upon to write that fact.

A channel that has never run, one not switched on for the outlet, one with a run
under way, and one whose last run recorded a failure SHALL each keep the more
specific statement, because each names its state more precisely than being
overdue does.

**What has happened SHALL be a history of runs, newest first, and it SHALL list
every run.** A row SHALL be a run: one the owner asked for and one that ran to
schedule, one that succeeded and one that failed, one that moved figures and one
that moved nothing, one that has finished and one still under way. A rehearsal
SHALL NOT appear, because it writes nothing and therefore reports nothing about
the figures.

**A failure SHALL remain readable after it is healed.** A later successful run
SHALL end a matter in *what needs them* and SHALL NOT remove, hide or amend any
run already recorded, so that an outage repaired at noon is still legible from
its first failure onward.

A run that moved figures SHALL state what moved in rupees, naming the business
day, the week or the supply orders affected, and where it replaced a figure SHALL
state what that figure changed from as well as what it changed to. A run that
moved nothing SHALL say so in one line. A failed run SHALL say why, in the same
vocabulary offered to the owner as an action. A run under way SHALL read as under
way.

**What a run changed SHALL be determined by the write itself** — inside the
transaction that performs the writes, while both the stored figure and the
incoming one are still known — and SHALL be carried onto the run's record. It
SHALL NOT be derived from stored figures after that transaction has committed.
Once a write commits, a figure restated identically is indistinguishable from a
figure touched, so a summary derived later cannot tell movement from repetition.
Money in that record SHALL be integer paise. Determining the summary SHALL NOT
alter any figure the run writes.

**A run SHALL record how it began** — to schedule, or because the owner asked —
reported by the process that ran it, and SHALL NOT be inferred from a run's
timing or from which control was on screen.

**Consecutive runs telling an identical story SHALL collapse into one line**
carrying how many runs it stands for and the span they cover, and that line SHALL
expand to the runs within it. Collapsing SHALL stop at a change of outcome, at a
run that moved a figure, at a run the owner asked for, at a change of channel, at
a day boundary, and at a run still under way. Two runs SHALL NOT collapse
together across a run of any other kind, so a collapsed line never claims a
continuity that did not happen.

The history SHALL load a page at a time as the reader scrolls and SHALL NOT
require counting the whole history to render its first screen. Collapsing SHALL
be applied to the runs accumulated so far rather than within a page, so that a
group spanning a page boundary reads as one group.

The sync SHALL distinguish its failure states, because they need different
people: a lapsed aggregator session, which the owner resolves; an aggregator
response whose shape is no longer understood, which a maintainer resolves; and a
reconciliation discrepancy, which is a question about money. A lapsed session
SHALL be surfaced to the owner as an action they can take.

Where the sync cannot obtain data for a date, it SHALL write nothing for that
date and report the failure. It SHALL NOT write a zero, and SHALL NOT overwrite
an existing figure with an empty one. **Reporting a failure for one date SHALL
NOT discard what the same run obtained for another.**

#### Scenario: A channel that stopped reads as stopped

- **WHEN** a channel scheduled four times a day last ran successfully nine hours
  ago and has recorded nothing since
- **THEN** the surface presents that channel as at fault, says a read was due, and
  offers Read now

#### Scenario: A stuck channel is not merely overdue

- **WHEN** a channel is both past due and its last run recorded a changed portal
  shape
- **THEN** the surface says the shape changed rather than that a read was due

#### Scenario: A quiet week is one line, not six

- **WHEN** six scheduled reads in a row complete having moved nothing
- **THEN** the history shows one line stating that six scheduled reads moved
  nothing and the span they cover, and that line expands to the six runs

#### Scenario: A healed outage is still legible

- **WHEN** a session lapses at 4:10 am, nine scheduled reads fail, and a
  reconnect at noon succeeds
- **THEN** what needs them no longer asks for a reconnect, and the history still
  shows all nine failed reads and the successful run after them

#### Scenario: A run refused over money is a run, not only a week

- **WHEN** a run refuses to write because the computed total disagrees with the
  stated payout
- **THEN** the history shows that run, says the amount it was off by, and the
  disputed week appears in what needs them

#### Scenario: A run waiting for a code is visible while it waits

- **WHEN** a run is holding for a one-time code
- **THEN** the history shows that run as under way rather than omitting it

#### Scenario: An overwrite says what it was

- **WHEN** the history lists a run in which a stored figure was replaced
- **THEN** the line states the figure it changed from and the figure it changed
  to, without the reader needing to expand it

#### Scenario: Runs the owner asked for stand alone

- **WHEN** the owner taps Read now four times and each read moves nothing
- **THEN** the history shows four separate lines, not one collapsed line

#### Scenario: A quiet run either side of a failure does not merge

- **WHEN** a quiet scheduled run is followed by a failed run and then another
  quiet scheduled run
- **THEN** the history shows three lines and collapses none of them together

#### Scenario: A group spanning a page boundary reads as one group

- **WHEN** seven consecutive quiet runs straddle the boundary between the first
  and second loaded page
- **THEN** after the second page loads the history shows one line standing for
  seven runs, not one for three and another for four

#### Scenario: Recording a summary does not change a figure

- **WHEN** a cycle is ingested by the function that records run summaries
- **THEN** every day figure, expense and reconciliation row written is identical
  to what the same cycle produced before summaries were recorded

#### Scenario: A restated figure that did not move is not reported as movement

- **WHEN** a run re-reads a fortnight-old week whose figures still match what is
  stored
- **THEN** that week contributes nothing to the run's summary and the run reads
  as having moved nothing

#### Scenario: How a run began is reported, not guessed

- **WHEN** a scheduled run and a run the owner asked for start within the same
  minute
- **THEN** each is labelled from what the running process reported, and the two
  are not distinguished by their timing

#### Scenario: A rehearsal is not a run in the history

- **WHEN** a rehearsal completes
- **THEN** it appears nowhere in the history

#### Scenario: A failed fetch writes nothing

- **WHEN** the sync cannot retrieve a date's data
- **THEN** no row is written or modified for that date, any previously stored
  figure is unchanged, and the failure is reported

#### Scenario: Failure states are told apart

- **WHEN** the sync fails
- **THEN** the report names which of the three states occurred, and a lapsed
  session is not reported as a shape change or a discrepancy

### Requirement: A run that wrote part of what it read is recorded once, as both

A run that obtained some of the data it went for and not the rest SHALL be
recorded as **one run** carrying both facts: the figures it moved, and the reason
it fell short. It SHALL NOT be recorded as a success, and its writes SHALL NOT be
discarded because it fell short.

The reason SHALL be named with the same vocabulary a wholly failed run uses,
because a partial failure needs the same person a total one does. **Completeness
SHALL be read from what the run recorded as moved** — a degraded run that moved
nothing and one that moved six weeks are distinguished by that record, not by a
separate word. Money in that record SHALL be integer paise.

Where a run both falls short of its read and fails on its writes, the recorded
reason SHALL be the one naming the more specific fault, and the other SHALL NOT
be silently dropped from what the run says about itself.

A caller declaring success alongside figures SHALL be treated as a caller
declaring nothing: a run SHALL NOT be able to assert that it succeeded.

#### Scenario: A settled week survives an unreadable open week

- **WHEN** a run reads six settled weeks, cannot read the open one, and posts both
  the six weeks and the reason the seventh failed
- **THEN** the six weeks are written, and the history shows one run stating what
  those weeks moved and why the open week is missing

#### Scenario: A partial run is not a success

- **WHEN** the owner looks at a channel whose last run wrote figures and fell
  short
- **THEN** the surface does not report that channel as healthy

#### Scenario: Money that does not add up outranks a short read

- **WHEN** a run posts a declared shortfall and one of its cycles also fails to
  reconcile against the stated payout
- **THEN** the run is recorded as a reconciliation failure and the shortfall is
  still readable in what the run says about itself

### Requirement: A disputed week may be re-checked or accepted with its difference recorded, and by nothing that conceals it

A disputed week SHALL offer the owner re-checking it and accepting it, and SHALL NOT offer an action that stores figures without accounting for the difference that made it disputed.

**Re-checking** SHALL read the cycle from the aggregator again and reconcile it again. Where it now reconciles, the cycle SHALL be written and its days settled. Aggregator figures have been observed to change after a payout, so most disputes are expected to resolve this way.

**Accepting** SHALL write the aggregator's own per-order figures and SHALL record the remaining difference as its own record against the outlet and the cycle, attributed to no business date, readable as an unexplained settlement difference. The accepted difference SHALL be recorded with the account that accepted it and the moment they did.

Accepting SHALL NOT adjust any day's figures to close the gap, because a difference spread silently across days would leave every day slightly wrong and the discrepancy unfindable.

#### Scenario: Re-checking resolves the dispute

- **WHEN** the owner re-checks a disputed week and the aggregator's figures now reconcile
- **THEN** the cycle is written, its days read as settled, and no difference is recorded

#### Scenario: Accepting records the gap rather than hiding it

- **WHEN** the owner accepts a disputed week whose computed total is short of the stated payout
- **THEN** the aggregator's per-order figures are written, the remaining difference is stored against the outlet and cycle as an unexplained settlement difference with who accepted it and when, and no day's figures are adjusted

#### Scenario: The gap cannot be silently absorbed

- **WHEN** a disputed week is presented to the owner
- **THEN** no offered action writes the cycle without either reconciling it or recording the difference

### Requirement: Running the sync twice produces the same ledger as running it once

Every write the sync makes SHALL be keyed on the aggregator's own identity for that record, so that re-running over an overlapping window updates rows rather than adding them.

The sync SHALL re-read recent history on every run rather than only the newest day, because both revenue figures and deductions arrive late. It SHALL cover at least the two most recent payout cycles for orders and the four most recent for deductions.

#### Scenario: An overlapping run changes nothing

- **WHEN** the sync runs twice over the same window with no change at the aggregator
- **THEN** the second run leaves every ledger row byte-for-byte unchanged and creates none

#### Scenario: A late arrival is picked up

- **WHEN** an order or deduction appears at the aggregator for a date already synced
- **THEN** a subsequent run within the re-read window incorporates it into that date's stored figures

### Requirement: Synced records are readable only by those who may already read the outlet

Every outlet-scoped table this capability uses SHALL carry Row-Level Security. A
Super Admin SHALL read daily figures and settlement internals across outlets. A
Franchise Admin SHALL read daily aggregate channel figures only for outlets
named by a live assignment, matching the full ledger already granted there, but
SHALL read no cycle reconciliation, deduction, run, credential or auth-request
record. A Biller and Employee SHALL read none of these financial rows.

No application client role SHALL insert, update or delete sourced figures, cycle
records, deductions, sync runs, mappings, credentials or auth requests through
direct table access. Privileged commands SHALL re-derive authority from the
caller token or authenticate the reader boundary itself; they SHALL NOT trust an
outlet, role or channel claim supplied by a client.

#### Scenario: A manager reads assigned daily aggregates only

- **WHEN** a Franchise Admin requests channel-day rows for an assigned outlet
- **THEN** those daily aggregate rows are readable but settlement cycles,
  deductions, sync internals and credentials are not

#### Scenario: A manager cannot cross outlets

- **WHEN** a Franchise Admin hand-crafts a daily-figure or settlement request
  for another outlet
- **THEN** the database returns no rows and accepts no write

#### Scenario: A Franchise Admin cannot reach settlement records

- **WHEN** a Franchise Admin hand-crafts a request for any outlet's cycle
  reconciliation, deduction, run, credential or auth-request record
- **THEN** the database returns no row, including at an outlet assigned to that
  manager

#### Scenario: A Biller and an Employee are refused outright

- **WHEN** a Biller or Employee requests any sourced daily, settlement,
  deduction, sync or credential record
- **THEN** the database returns no rows and accepts no write



### Requirement: The Hyperpure health line carries the same repair as Zomato's

The Hyperpure health line on the sync surface SHALL offer Reconnect once
capture is proven, wired to the same reconnect dispatch as Zomato's, and SHALL
state which of its states holds in the surface's existing vocabulary: alive,
reading, lapsed (with Reconnect offered), awaiting a code (the shared code
card), or shape-changed (a maintainer's). A session that has ended SHALL point
at repair rather than only at the manual upload; the manual upload SHALL remain
available regardless of state.

#### Scenario: A lapsed Hyperpure offers a working reconnect

- **WHEN** the Hyperpure session has ended and the Zomato parent is alive
- **THEN** the line reads "Session ended" with a Reconnect action, and acting
  on it completes without any code

#### Scenario: The line returns to quiet after a successful capture

- **WHEN** a capture-only run stores a working Hyperpure session and the next
  read succeeds
- **THEN** the line reads "All quiet" with its last-run time, and the manual
  upload remains present but unremarkable

#### Scenario: A shape change stays a maintainer's

- **WHEN** the Hyperpure reader cannot understand the aggregator's response
- **THEN** the line reads "Stuck" with the maintainer note, and offers no
  reconnect that could not help

### Requirement: A half-successful reconnect is named at the moment it happens

When a reconnect signs Zomato in but does not land a Hyperpure session â€” or
the reverse, should a Hyperpure-only path ever exist â€” the surface SHALL name
the channel that did not follow at that moment, on that channel's own health
line, rather than reporting an unqualified success or leaving the manual
upload as the only signal. Each channel's outcome SHALL be knowable
separately.

#### Scenario: Zomato signed in, Hyperpure did not follow

- **WHEN** a reconnect ends with the Zomato session stored and no Hyperpure
  token captured
- **THEN** the Zomato line reports success while the Hyperpure line says the
  handoff did not follow and offers trying again

#### Scenario: Success is per channel, not one word for both

- **WHEN** a reconnect completes with both channels stored
- **THEN** each line independently reports its own channel as signed in

### Requirement: Swiggy daily sales respect evidence time and the outlet cutover

A Swiggy daily write SHALL use order placement timestamps converted through the
outlet's business-day cutover whenever it asserts an authoritative business
date. For every non-annexure order it SHALL obtain the detail `payoutSummary`,
require exactly one parseable `Total Customer Paid` header and exactly one
parseable `GST Collected` sub-header, and use their difference as gross. The
sole exception is an order detail whose own status explicitly says cancelled and
omits GST Collected: it SHALL record zero gross because the final annexure's Net
Bill Value is zero for that state, even if the detail carries customer-payment
components. A non-cancelled omission SHALL fail as a source-shape change. Portal
dashboard/report dates are Asia/Kolkata calendar days and SHALL NOT silently
become business dates for an outlet whose cutover is not midnight.

The live Net Sales metric MAY be stored as provisional only for a range that is
proved to correspond exactly to one business-date window. If the API cannot
provide order timestamps or a cutover-aligned range, the metric SHALL remain
health/cross-check telemetry rather than an authoritative ledger write. A
multi-date aggregate SHALL never be assigned to its last date.

Each provisional row SHALL retain its capture/as-of time. A later same-day read
MAY replace it idempotently; a failed or partial read SHALL preserve the last
successful row.

#### Scenario: A post-midnight order stays with the trading shift

- **WHEN** a Swiggy order is placed at 00:30 at an outlet whose cutover is 04:00
- **THEN** it contributes to the previous business date even if the portal
  dashboard labels it with the new calendar date

#### Scenario: A daily order reproduces the settlement gross

- **WHEN** a live Swiggy order detail shows `Total Customer Paid` and `GST Collected`
- **THEN** its provisional gross is their integer-paise difference and matches
  that order's later payout-annexure Net Bill Value when the cycle settles

#### Scenario: Missing detail cannot become GST-inclusive gross

- **WHEN** the order-detail response omits, duplicates or cannot parse either
  required money label
- **THEN** the candidate fails as a source-shape change, no daily amount is
  written, and the reader does not fall back to `customerPaidAmount` or a
  calendar aggregate

#### Scenario: A calendar aggregate cannot prove a business date

- **WHEN** the API returns only midnight-to-midnight Net Sales and cannot
  provide cutover-aligned data or order timestamps
- **THEN** it does not overwrite the authoritative ledger day and the run
  reports the limited source shape

#### Scenario: Same-day data advances without becoming final

- **WHEN** the second daily run sees more valid orders for today's open cycle
- **THEN** it replaces the provisional row with a later as-of value and retains
  provisional state

#### Scenario: A multi-date total is not placed on one date

- **WHEN** a Swiggy response aggregates several portal dates into one total
- **THEN** no business date receives that total unless source rows can be
  separated and attributed by the cutover contract

### Requirement: Swiggy reads run twice daily without login side effects

One serialized Swiggy workflow SHALL be scheduled exactly twice per
Asia/Kolkata business day at documented UTC cron times. Each run SHALL attempt
the current/open cycle and a bounded lookback that includes at least yesterday
and the two most recent portal-declared closed cycles. This is one twice-daily
discovery cadence, not a separate assumed weekly cron.

The run SHALL use only the stored Swiggy API session. It SHALL paginate until
source exhaustion, retry bounded transient 408, 429 and 5xx failures, classify
authentication lapse separately from source-shape and transport failures, and
emit one event per meaningful outcome. It SHALL NOT launch a browser,
request/resend an OTP, or create an auth request.

A failed, partial, lapsed or shape-changed read SHALL write no synthetic zero
and SHALL not alter a prior successful figure. A session lapse SHALL update
health and direct the owner to reconnect.

#### Scenario: Both daily schedules inspect sales and payouts

- **WHEN** either scheduled Swiggy run starts
- **THEN** it refreshes eligible current data and checks at least the two most
  recent closed portal cycles for final or revised payout facts

#### Scenario: Pagination is complete before ingest

- **WHEN** a Swiggy order or payout response has another cursor
- **THEN** the run continues until exhaustion before claiming the candidate
  cycle is complete

#### Scenario: A session lapse does not log in

- **WHEN** a scheduled API call reports that the Swiggy session has lapsed
- **THEN** the run writes no financial value, marks health as needing reconnect
  and exits without browser or OTP activity

#### Scenario: A shape change cannot erase money

- **WHEN** a required Swiggy field or metric label is absent or incompatible
- **THEN** the run records a source-shape failure and leaves every prior
  financial row unchanged

### Requirement: Restaurant identities are explicit and channel-scoped

An operator restaurant reference SHALL map to exactly one Ops outlet within its
channel, while one outlet MAY have multiple references for the same channel with
independent enabled/dormant status. Automation and uploads SHALL use the same
mapping and SHALL reject an unmapped or ambiguously mapped reference before
writing money.

An outlet with no enabled Swiggy reference SHALL read **Not connected for this
outlet**. It SHALL have no Swiggy sync boundary, no read/reconnect action for a
fabricated identity, no run row caused by scheduling and no zero-valued channel
day. Mapping SHALL never be inferred from a fuzzy name or approximate ledger
total.

#### Scenario: Two Kalyani references remain explicit

- **WHEN** the Swiggy account exposes an active and dormant restaurant reference
  that both belong to Kalyani
- **THEN** both can map to Kalyani with explicit statuses and neither creates a
  duplicate outlet or ambiguous write

#### Scenario: Kanchrapara is unserved

- **WHEN** Kanchrapara has no verified enabled Swiggy reference
- **THEN** its Swiggy tab state says not connected and schedules write no run,
  figure or synthetic zero for it

#### Scenario: An unknown report row is refused

- **WHEN** automation or an uploaded report carries a restaurant reference
  absent from the mapping
- **THEN** the affected ingest is refused with that reference identified and no
  guessed outlet assignment

### Requirement: Swiggy is a channel of the Delivery surface, without Hyperpure

The Super Admin SHALL reach every restaurant channel through **one navigation
entry**, and SHALL choose between them on the surface itself. For each
configured outlet, each channel SHALL show credential and reader health, last
successful read and as-of time, Read again with duplicate suppression,
reconnect, a code field only during an open challenge for that channel,
provisional/final bank status, its run history, upload outcome, disputes,
recheck and accept-difference actions. Each channel SHALL identify the affected
outlet and period and SHALL use the same state language as the ledger.

**The channels SHALL remain independent in substance.** Each SHALL read through
its own adapter instance against its own session, so that one channel's waiting
work can be neither created nor cleared by the other, one channel's repair
signs no other channel in, and a failure in one alters no other's health,
history or counts. What they share is the container and nothing else: one
navigation entry, one route that carries which channel is being read, and one
badge.

**Selecting a channel SHALL be addressable.** The channel being read SHALL be
carried in the route, so that a badge, a link or a returning reader lands on the
channel the work is actually on rather than on a fixed default. Where exactly
one channel has work waiting, the surface SHALL open on that channel.

The Swiggy channel SHALL contain no Hyperpure health, capture, upload or
reconnect function. Unconfigured outlets SHALL show the not-connected state
defined by the mapping contract. The surface SHALL depend on the typed adapter
interface and SHALL have an internally consistent demo covering provisional,
settled, revised, disputed, lapsed-session, upload and unconfigured states.

#### Scenario: One entry serves both channels

- **WHEN** the Super Admin reads their navigation
- **THEN** one entry covering the restaurant channels is offered, and no
  separate per-channel entry appears beside it

#### Scenario: The owner sees the same recovery controls

- **WHEN** a configured outlet's Swiggy reader needs attention
- **THEN** the Swiggy channel names the health problem and offers the relevant
  Read again, reconnect, OTP, upload, recheck or accept action

#### Scenario: Swiggy has no Hyperpure child line

- **WHEN** the owner reads the Swiggy channel
- **THEN** no Hyperpure state or action is shown, and changing Swiggy health
  cannot alter the Zomato channel's Hyperpure line

#### Scenario: A repair on one channel leaves the other untouched

- **WHEN** a Swiggy reconnect succeeds while Zomato's session is lapsed
- **THEN** Zomato's health, its waiting work and its run history are unchanged,
  and Zomato is still reported as needing the owner

#### Scenario: A link opens on the channel it names

- **WHEN** the owner follows a link to the Swiggy channel of the surface
- **THEN** the surface opens reading Swiggy rather than a default channel

#### Scenario: Demo mode remains self-contained

- **WHEN** the surface is opened in demo mode
- **THEN** each channel's states and actions use typed mock data, issue no live
  request and preserve the non-dismissible demo boundary
