## ADDED Requirements

### Requirement: The drawer is a continuous balance observed at instants

An outlet's cash drawer SHALL be modelled as a continuous balance rather than as
a per-business-date record. A **drawer observation** SHALL record that a named
account saw a stated amount in one outlet's drawer at a stated instant, and
SHALL carry the instant it was counted, the instant it was recorded, the opening
it started from, the counted total, the expected total, and the difference.

There SHALL be no limit of one observation per business date, and no requirement
that an observation fall at or near a business day cutover. An observation whose
interval spans several business dates SHALL be recorded by the same path as one
spanning a single evening.

#### Scenario: A count taken mid-shift

- **WHEN** an admin records a count at 22:00 while the counter is still trading
- **THEN** the observation is accepted and cash rung after 22:00 does not contribute to it

#### Scenario: Two counts on one business date

- **WHEN** a second observation is recorded at the same outlet later the same evening
- **THEN** it is accepted and its interval begins at the first observation's counted instant

#### Scenario: A count after two skipped days

- **WHEN** the previous observation at that outlet was three days earlier
- **THEN** the observation is accepted by the ordinary path and its interval spans those three days

### Requirement: Interval figures are computed by the database and enforced as constraints

The expected total SHALL be computed inside the transaction that writes the
observation, from:

```
expected = opening
         + cash receipts whose payment instant falls in (previous counted_at, this counted_at]
         - cash expenses whose occurrence instant falls in that interval
         - cash out in that interval not belonging to this observation
```

Cash receipts SHALL be the latest accepted effective Cash allocations of settled
bills. A superseded original allocation and an earlier correction revision SHALL
NOT also contribute. UPI, Swiggy and Zomato SHALL move no drawer figure.

The database SHALL enforce `difference = counted_total − expected`, in integer
paise, with a shortfall producing a negative difference. Clients MUST NOT supply
the opening, the expected total or the difference, and MUST NOT write the
observation table directly.

#### Scenario: A client supplies derived figures

- **WHEN** any session attempts a direct insert or update of a drawer observation
- **THEN** the database rejects the write

#### Scenario: A bill corrected from Cash to UPI inside its edit window

- **WHEN** the interval's receipts are computed after the accepted correction
- **THEN** that bill contributes no cash receipt and its superseded Cash allocation is not counted

#### Scenario: An inconsistent difference

- **WHEN** a write attempts to store a difference that is not the counted total less the expected total
- **THEN** the database rejects it with a constraint violation

#### Scenario: A payment exactly at the previous count's instant

- **WHEN** a cash allocation's payment instant equals the previous observation's counted instant
- **THEN** it belongs to that earlier observation and not to this one

### Requirement: The carry-forward anchors to the counted amount, never the expected one

The opening of the next observation SHALL be the counted total of the previous
one less that observation's own cash out. A difference SHALL be recorded as a
variance on the observation that found it and SHALL NOT be carried into any
later interval.

#### Scenario: A shortfall does not propagate

- **WHEN** an observation records a counted total ₹500 below its expected total
- **THEN** the next observation's opening reflects the counted total, and the next difference is unaffected by that ₹500

### Requirement: The opening is stored per observation, and a break is reported rather than repaired

Each observation SHALL store its opening rather than deriving it from earlier
rows at read time. Where a stored opening disagrees with the previous
observation's carry-forward, the surface SHALL report the discrepancy and SHALL
NOT silently replace either figure.

#### Scenario: An adjusted earlier count leaves later openings alone

- **WHEN** an adjustment changes an earlier observation's counted total
- **THEN** no later observation's stored opening changes, and the surface reports the break

### Requirement: Every count time is approximate, and its bounds are enforced

Every observation SHALL be treated as approximate within a stated tolerance
window, whichever time the recorder chose and including a count recorded as
taken now. Counting a drawer takes time, the counter keeps trading while it
happens, and no instant a person supplies is the edge of that act.

The surface SHALL NOT offer any control asserting that a counted instant is
exact, and SHALL NOT mark individual observations as approximate in a way that
distinguishes them from others, because all of them are.

The tolerance window SHALL be the same for every time option. A window that
narrowed because the recorder pressed a different button would make two counts
of the same drawer incomparable for a reason that has nothing to do with the
drawer.

The surface SHALL offer, alongside its relative time options, a control for
stating an explicit date and time, so a count recalled days later can be placed
where it happened.

Both instants SHALL be stored and both SHALL be shown, with the lag between them
legible. The recorded instant SHALL be the server's clock.

The database SHALL refuse an observation whose counted instant is later than its
recorded instant, or is not later than the previous observation's counted instant
at that outlet, or precedes that outlet's earliest drawer activity.

#### Scenario: A count taken now is still approximate

- **WHEN** an observation is recorded with the time option meaning now
- **THEN** it is stored approximate with the same tolerance window as a recalled time, and no control offers to assert it exact

#### Scenario: A count placed at an explicit past instant

- **WHEN** a recorder states a date and time two days earlier for a count they are entering now
- **THEN** that instant is what the count is measured against, and it is stored approximate

#### Scenario: A count claimed in the future

- **WHEN** a counted instant later than the server's clock is submitted
- **THEN** the database rejects it

#### Scenario: A count slotted before a settled interval

- **WHEN** a counted instant not later than the previous observation's counted instant is submitted
- **THEN** the database rejects it and names the previous observation

#### Scenario: A count entered after the cutover for the evening before

- **WHEN** a count taken at 22:00 is recorded at 04:30 the next morning
- **THEN** it is accepted, files under the business date of its counted instant, and shows both instants

### Requirement: The surface states what the timing could account for, and reports only an exact coincidence

The surface SHALL state, in rupees, how much cash moved within the counted
instant's tolerance window, so a difference can be read against what the timing
alone could explain. Every counted instant carries such a window, so this
statement is available on every count rather than only on a recalled one.

Where a difference exactly equals the sum of a contiguous run of cash bills
adjacent to the stated instant, the surface SHALL report that coincidence as a
fact, naming the bills and their instants.

The surface SHALL NOT propose an alternative counted instant, SHALL NOT rank
candidate boundaries by how small a difference they produce, and SHALL NOT
disclose which instant would make the observation balance. It SHALL instead
present the nearby cash bills with a movable boundary, so the recorder may
correct the instant from evidence.

#### Scenario: A difference that exactly matches a run of bills

- **WHEN** the difference equals the sum of the three cash bills between the stated instant and the true one
- **THEN** the surface states that coincidence and names those bills

#### Scenario: A difference that matches nothing

- **WHEN** no contiguous run of nearby cash bills sums to the difference
- **THEN** the surface offers no alternative instant and no candidate boundary

#### Scenario: A genuine shortfall is not explained away

- **WHEN** a ₹500 shortfall sits between two reachable boundary values
- **THEN** the surface reports ₹500 short and does not present the nearer boundary that would reduce it

### Requirement: The app never changes a person's observation on its own

No stored counted amount, counted instant or difference SHALL be altered by the
system in response to work arriving later, to a settlement restating a figure,
or to any recomputation. Every change to an observation SHALL be the act of an
identified account.

#### Scenario: Cash syncs after the interval was observed

- **WHEN** a cash allocation whose payment instant falls inside an observed interval arrives afterwards
- **THEN** the observation's stored figures are unchanged

### Requirement: An observation is editable until the next one anchors on it

An observation SHALL be fully editable, without a reason and without a recorded
trail on the row, by any account permitted to record one at that outlet, until a
later observation at that outlet is recorded. From that point the observation
SHALL be immutable, and a correction SHALL be an append-only adjustment carrying
a required reason, an instant and an attributed account, with both the original
and the corrected figure readable.

Attribution SHALL name both the account that recorded an observation and the
account that last corrected it, where these differ.

#### Scenario: A typo fixed before the next count

- **WHEN** the recorder reopens the most recent observation at that outlet and changes the counted total
- **THEN** the change is accepted, no reason is required, and the figure is replaced

#### Scenario: A correction after a later count exists

- **WHEN** a correction is attempted on an observation that a later one has anchored on
- **THEN** the edit is refused and an adjustment carrying a reason is the only path

#### Scenario: An adjustment keeps both figures

- **WHEN** an adjustment is posted
- **THEN** the original counted total, the corrected figure, the reason and both accounts remain readable

### Requirement: Late-arriving work raises an exception beside the observation

Cash whose payment or occurrence instant falls inside an already-observed
interval SHALL raise a reconciliation exception against that observation, naming
what arrived, its amount, when it occurred, when it landed, and what the
difference would have been. An exception SHALL be resolvable by an attributed
acknowledgement with a note, or by recording a fresh observation.

Where the late arrival accounts for a recorded variance, the recorded figure
SHALL remain and the explanation SHALL be recorded beside it with its instant.

#### Scenario: An offline tablet syncs cash after a count

- **WHEN** cash bills rung before an observation arrive after it was recorded
- **THEN** the observation is unchanged and an exception names those bills and the difference they would have produced

#### Scenario: A late arrival explains an over

- **WHEN** the arriving cash equals a recorded excess
- **THEN** the recorded excess stays on the observation and is marked explained, with the date it was explained

#### Scenario: A backdated cash expense crosses an observed interval

- **WHEN** a cash expense is recorded with an occurrence instant inside an already-observed interval
- **THEN** the same exception path is used

### Requirement: Unsynced devices advise and never block a count

Devices holding undelivered work at the moment of counting SHALL be reported on
the count surface, naming how many and since when, and the expected figure SHALL
be marked as possibly understated. A count SHALL NOT be refused because a device
has unsynced work, because the person counting is holding the cash.

#### Scenario: A count is taken while a tablet is behind

- **WHEN** a device has undelivered commands at the counted instant
- **THEN** the surface says so, marks the expected figure provisional, and the count is still accepted

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

A `spend` SHALL carry a positive amount only.

A collection SHALL require neither a reason nor a separate actor: the account
recording it is the account collecting, and that holds for a negative collection
too. A spend SHALL require a reason, and SHALL NOT be recorded as an expense, so
that drawer cash spent on capital leaves the day reconciling while the month's
operating figure stays clean.

A collection recorded as part of an observation SHALL be written in the same
transaction, SHALL NOT be included in that observation's counted total, and
SHALL NOT be subtracted from that observation's expected total.

#### Scenario: A routine collection

- **WHEN** a collection is recorded with an amount and an instant
- **THEN** it is accepted with no reason and no actor supplied, attributed to the recording account

#### Scenario: Cash added at the count

- **WHEN** a drawer counted at ₹450 is topped up by ₹1,000 recorded as an amount of −1,000
- **THEN** the record is accepted, the amount left is ₹1,450, and the next observation's opening is ₹1,450

#### Scenario: A negative is refused for a spend

- **WHEN** a spend is submitted with a negative amount
- **THEN** it is refused

#### Scenario: Zero is not a movement

- **WHEN** an amount of zero is submitted
- **THEN** it is refused

#### Scenario: A spend requires its reason

- **WHEN** a spend is submitted without a reason
- **THEN** it is refused

#### Scenario: An observation's own collection is not double counted

- **WHEN** an observation is saved together with a collection
- **THEN** the expected total excludes that collection and the next observation's opening is the counted total less it

#### Scenario: Capital spending leaves the month clean

- **WHEN** drawer cash buys equipment and is recorded as a spend
- **THEN** the drawer reconciles and the month's operating expenses are unchanged

### Requirement: A negative amount announces that it means money added, as it is typed

Wherever a cash movement amount is entered, the surface SHALL state that a
negative means money added to the drawer rather than taken out, **from the
keystroke that makes it negative and before anything is submitted**. The stated
action, the resulting balance and the confirming control SHALL all agree with the
sign.

This warning SHALL NOT be deferred to submission or to a confirmation step,
because its purpose is to catch a minus nobody meant to type.

#### Scenario: A minus is typed

- **WHEN** an amount becomes negative in the entry field
- **THEN** the surface says a negative means money added rather than taken out, without waiting for submission

#### Scenario: The surface agrees with the sign

- **WHEN** the amount is negative
- **THEN** the stated action reads as adding, the balance preview rises, and the confirming control names adding rather than collecting

#### Scenario: A positive is unremarkable

- **WHEN** the amount is positive
- **THEN** no warning is shown and the surface reads as collecting

### Requirement: The difference appears the moment the counted amount is entered

The count surface SHALL show the difference from the expected total immediately
on entry of the counted amount, before anything is submitted, stating its
direction in words as well as by sign, with a shortfall negative.

#### Scenario: A drawer that is short

- **WHEN** a counted amount below the expected total is entered
- **THEN** the difference is shown immediately, is negative, and is described as a shortfall

#### Scenario: A drawer that balances

- **WHEN** a counted amount equal to the expected total is entered
- **THEN** the difference is shown as zero and described as balancing

### Requirement: The drawer arithmetic is a shared pure function in integer paise

The expected total, the difference and the carry-forward SHALL be computed by
pure domain functions over integer paise, mirroring the constraints the database
enforces. A non-integer input SHALL be rejected rather than rounded.

#### Scenario: A float reaches the drawer arithmetic

- **WHEN** a non-integer paise value is passed to the drawer arithmetic
- **THEN** it throws rather than rounding

### Requirement: A Super Admin reaches every drawer, and where they stood is recorded

An account holding a live Super Admin assignment SHALL be able to record an
observation, a collection, a spend and an adjustment at **any** outlet, holding
no assignment at it. An account holding a live Franchise Admin assignment SHALL
be able to do the same at the outlets that assignment names, and nowhere else. A
Biller and an Employee SHALL be refused every drawer read and write at every
outlet, including outlets where they hold a live assignment, by the absence of a
policy branch rather than by a hidden screen.

Each record SHALL carry whether the account was inside that outlet's geofence at
the moment of recording, evaluated by the same distance rule attendance uses. A
record made outside the fence SHALL require a reason first, and that reason SHALL
be stored and shown on the record. No drawer action SHALL be refused for being
recorded away from the outlet.

**The position SHALL be read by the surface, not typed by the recorder.** Every
sheet that records a drawer action SHALL read one position when it opens,
through the single module permitted to touch the browser's geolocation, and
SHALL send it with the write so the database derives the distance and the
on-site verdict from coordinates rather than from a claim. The read SHALL NOT
block any field or the save control, and no drawer surface SHALL watch or sample
a position in the background.

The reason field SHALL be present exactly when the recorder was not shown to be
inside the fence — outside it, or with no position obtained at all — and SHALL be
required whenever it is present. It SHALL be absent when the position places the
recorder inside the fence. A surface SHALL NOT supply a reason on the recorder's
behalf, and SHALL NOT send a constant string in place of one.

Deactivating an account, or ending the assignment that granted its reach, SHALL
end that access on the account's next request.

#### Scenario: The owner counts at an outlet they do not manage

- **WHEN** a Super Admin holding no assignment at that outlet records an observation there
- **THEN** it is accepted and carries their account and their position

#### Scenario: A manager is refused another outlet's drawer

- **WHEN** a Franchise Admin issues a hand-crafted drawer write at an outlet where they hold no live assignment
- **THEN** the database refuses it

#### Scenario: Outlet staff are refused the drawer at their own outlet

- **WHEN** a Biller or Employee issues a hand-crafted drawer read or write at any outlet
- **THEN** the database refuses it and returns no rows

#### Scenario: A count recorded away from the outlet

- **WHEN** an account records an observation from outside the outlet's geofence
- **THEN** a reason is required before it is accepted, and the record shows that it was made away with that reason

#### Scenario: Being elsewhere is never a refusal

- **WHEN** an account outside the fence supplies a reason
- **THEN** the observation is accepted

#### Scenario: Inside the fence, nothing is asked

- **WHEN** a sheet opens and the position places the recorder inside the outlet's fence
- **THEN** the surface states that they are at the outlet and offers no reason field

#### Scenario: No position at all is treated as away

- **WHEN** no position can be obtained, for any reason, or the outlet has no captured position to measure against
- **THEN** the reason field is present and required, and the surface names why it could not tell

#### Scenario: The save is refused by the sheet, not by the database

- **WHEN** a drawer action is submitted from outside the fence with an empty reason
- **THEN** the surface refuses it and says what is missing, and no write is attempted

### Requirement: The count history is paged and each count is a disclosure

The surface SHALL present past counts newest first, one row each, showing closed
the instant the count was taken, the counted amount, its verdict — matched,
short with the amount, over with the amount, or first count — and any broken
opening. The verdict SHALL be shown when the count matched as well as when it
did not, so a clean count is distinguishable from a row that has not loaded.

Everything else a count carries — its collection, who recorded it, why they were
away, its adjustments, and the control to adjust it — SHALL be behind that row's
disclosure, and SHALL NOT be rendered while it is closed. The control to adjust a
count SHALL be a control that reads as one.

The history SHALL be paged rather than capped: the surface SHALL be able to reach
every count an outlet has ever recorded, in bounded reads, without loading them
all. Paging SHALL be cursored on the counted instant rather than an offset, so a
count recorded while somebody is reading cannot duplicate or skip a row. The
surface SHALL state when it has reached the oldest count, and SHALL offer a
control that loads the next page as well as loading it on scroll.

#### Scenario: A matched count reads as matched

- **WHEN** a count whose difference is zero is listed
- **THEN** its closed row says it matched

#### Scenario: The detail is not rendered until it is asked for

- **WHEN** a count row is closed
- **THEN** its recorder, reason, collection, adjustments and adjust control are absent from the rendered output

#### Scenario: Reaching past the first page

- **WHEN** an outlet holds more counts than one page
- **THEN** the next page loads on demand, continues from the oldest row already shown, and the surface says when there are no more
