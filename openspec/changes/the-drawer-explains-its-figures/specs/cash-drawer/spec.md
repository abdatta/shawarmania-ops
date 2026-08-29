# Delta: cash-drawer

## MODIFIED Requirements

### Requirement: Cash leaving the drawer is one record carrying its kind

Every movement of cash into or out of the drawer that is not a sale or an expense
SHALL be recorded as a single kind of record carrying a **signed non-zero
amount**, an occurrence instant, an attributed account and a kind of either
**collection** or **spend**.

A positive amount SHALL mean cash leaving the drawer and a negative amount SHALL
mean cash added to it. There SHALL be no separate record, table, kind or surface
for cash added. The interval arithmetic SHALL subtract this term whatever its
sign, so that a negative increases the expected total and increases the following
opening without a separate branch.

A `spend` SHALL carry a positive amount only, and SHALL require a reason. A
collection SHALL require neither a reason nor a separate actor: the account
recording it is the account collecting, and that holds for a negative collection
too. Neither SHALL be recorded as an expense.

**The application SHALL offer a movement only as part of recording a count, and
SHALL offer it only as a collection.** It SHALL NOT offer a movement recorded on
its own, and SHALL NOT offer a spend. Consequently every movement the application
creates belongs to an observation, is excluded from that observation's counted
and expected totals, and reduces the following opening — so the opening, the
interval's cash receipts and its cash expenses together account for the expected
balance completely, with no term the surface leaves unexplained.

The record SHALL retain both kinds, their constraints and their grants, so that a
movement reaching the table by any other path is still bound by them and a
historical spend remains readable. Re-offering a spend SHALL be a matter of
adding a control, not of altering the record.

A collection recorded as part of an observation SHALL be written in the same
transaction, SHALL NOT be included in that observation's counted total, and
SHALL NOT be subtracted from that observation's expected total.

#### Scenario: A collection is taken with the count

- **WHEN** a count is recorded together with an amount collected
- **THEN** it is accepted with no reason and no actor supplied, attributed to the recording account, excluded from that count's counted and expected totals, and subtracted from the following opening

#### Scenario: Cash added at the count

- **WHEN** a drawer counted at ₹450 is topped up by ₹1,000 recorded as an amount of −1,000
- **THEN** the record is accepted, the amount left is ₹1,450, and the next observation's opening is ₹1,450

#### Scenario: The surface offers no movement of its own

- **WHEN** the drawer surface is read
- **THEN** it offers no control that records a collection or a spend on its own, and none that records a spend at all

#### Scenario: The three figures account for the balance

- **WHEN** the balance card is read at any moment between two counts
- **THEN** the opening, the interval's cash receipts and its cash expenses together equal the expected balance, because no movement exists outside a count

#### Scenario: The record still binds what reaches it

- **WHEN** a spend reaches the record by any path
- **THEN** a negative amount is refused, a missing reason is refused, and it does not count toward the month's operating expenses

### Requirement: An observation is editable until the next one anchors on it

An observation SHALL be **fully editable** — its counted total, its note **and
its counted instant** — without a reason and without a recorded trail on the row,
by any account permitted to record one at that outlet, until a later observation
at that outlet is recorded. From that point the observation SHALL be immutable,
and a correction SHALL be an append-only adjustment carrying a required reason, an
instant and an attributed account, with both the original and the corrected
figure readable.

Where the counted instant is moved, the observation's **expected total SHALL be
recomputed** from that instant, by the same database readers that computed it
when it was recorded, and its difference SHALL be recomputed against the new
expected total. An expected total that survived a moved instant unchanged would
measure the count against bills that were not in the drawer.

A moved instant SHALL be bounded exactly as a recorded one is: refused when it is
in the future, when it is not later than the preceding observation, and when it
precedes the outlet's earliest drawer activity, each refusal naming what it
collided with.

Editing SHALL NOT clear a field the caller did not supply a new value for. In
particular an edit that changes only the counted total SHALL leave the note and
the expected total as they were.

Attribution SHALL name both the account that recorded an observation and the
account that last corrected it, where these differ.

#### Scenario: A typo fixed before the next count

- **WHEN** the recorder reopens the most recent observation at that outlet and changes the counted total
- **THEN** the change is accepted, no reason is required, the figure is replaced, and the note and expected total are unchanged

#### Scenario: A wrong time fixed before the next count

- **WHEN** the recorder moves the most recent observation's counted instant earlier, to the moment they actually counted
- **THEN** the expected total is recomputed from that instant, the difference is recomputed against it, and the surface states how much cash the move put outside the count

#### Scenario: A moved instant is bounded

- **WHEN** an edit moves the counted instant into the future, or to at or before the preceding observation's instant
- **THEN** it is refused, naming what it collided with

#### Scenario: A correction after a later count exists

- **WHEN** a correction is attempted on an observation that a later one has anchored on
- **THEN** the edit is refused and an adjustment carrying a reason is the only path

#### Scenario: An adjustment keeps both figures

- **WHEN** an adjustment is posted
- **THEN** the original counted total, the corrected figure, the reason and both accounts remain readable

## ADDED Requirements

### Requirement: Every figure in the balance is readable day by day, and reconciles to the figure it explains

Each interval figure stated on the balance — the cash received since the last
count, and the cash spent from the drawer since it — SHALL be reachable from the
figure itself, and SHALL open a reading of that interval **partitioned by
business date**, most recent first, resolved through the outlet's own business-day
cutover rather than through any constant held by the application.

The partition SHALL be of the interval and never of the calendar day. A group
whose business date is only partly inside the interval SHALL say so and SHALL name
the count that bounds it. A group wholly inside the interval SHALL carry no such
qualifier.

The groups SHALL sum exactly to the figure they were opened from, and SHALL be
computed by the database from the same relation, predicate and interval
convention as that figure, so that the two cannot disagree.

Any count of contributing rows stated beside an interval figure SHALL be the true
count over that interval, and SHALL NOT be derived from a bounded or capped
sample gathered for another purpose.

#### Scenario: Cash received, read day by day

- **WHEN** the cash received since the last count is opened
- **THEN** each business date in the interval is listed with its cash total and its number of bills, most recent first

#### Scenario: The partial day names its boundary

- **WHEN** the interval begins partway through a business date
- **THEN** that date's group states that it covers only the part since that count, and names the count's time

#### Scenario: The breakdown reconciles

- **WHEN** the groups of either breakdown are totalled
- **THEN** the total equals the interval figure the breakdown was opened from

#### Scenario: The row count is not sampled

- **WHEN** more cash bills fall in the interval than any window the surface gathers for the movable boundary
- **THEN** the count stated beside the figure is the true number of contributing bills

#### Scenario: The cutover is the outlet's own

- **WHEN** the breakdown is read at an outlet whose business-day cutover is not the one another outlet uses
- **THEN** movements in the small hours are grouped into the business date that outlet's cutover puts them in

### Requirement: The expenses behind the drawer figure are correctable and extendable where they are read

The reading of cash spent since the last count SHALL present each business date's
expenses as the same list and entry form every other expenses surface renders,
and SHALL offer, **for each business date**, the recording of a further expense
against that date.

An expense recorded from that reading SHALL be dated to the business date of the
group it was recorded in, and SHALL take effect on the expected balance as soon
as it is saved, because it occurred inside the interval the balance covers.

The listed expenses SHALL be those falling inside the interval, by the same
instant the drawer arithmetic uses. Where a business date holds expenses that
fall before the interval, the group SHALL state how many it is not listing and
that they were settled by the earlier count, so that an expense already recorded
is not recorded twice.

An expense that did not come from the drawer SHALL be listed and marked as such,
and SHALL NOT count toward the group's total or the figure the reading explains.

#### Scenario: A missed expense is added while counting

- **WHEN** an expense is recorded from a past business date's group in the reading
- **THEN** it is stored against that business date, and the expected balance moves by that amount

#### Scenario: A partial day says what it is not showing

- **WHEN** a business date holds cash expenses both before and after the count that bounds the interval
- **THEN** only those after it are listed, and the group states how many earlier ones were settled by that count

#### Scenario: A non-cash expense is visible but not counted

- **WHEN** a business date in the interval holds an expense not paid from the drawer
- **THEN** it is listed and marked, and neither the group's total nor the drawer figure includes it
