## MODIFIED Requirements

### Requirement: A synced day states gross, commission and net as three stored figures

For every outlet, channel and business date the sync covers, the ledger SHALL store the aggregator's gross order value, the commission-and-fee reduction from that gross, and the net order payout, each as its own integer-paise value normalized from the aggregator rather than from a stored percentage.

For Swiggy, gross SHALL use the timestamped order-detail basis `Total Customer Paid - GST Collected`, which fixture reconciliation proves equals the payout-annexure `Net Bill Value (before taxes)` at paisa precision. It SHALL NOT use Total Customer Paid including GST, `customerPaidAmount` from `getOrderLevelPayoutsV2`, or the calendar-day Business Metrics Net Sales card as ledger gross. The net order payout SHALL use the order-level amount payable to the restaurant after order-level fees and taxes. The reduction SHALL be gross minus net, so net plus reduction equals gross even when a cancelled order has zero gross and a negative net payout.

An undated cycle-level ad investment, refund, recovery, outstanding amount or other adjustment SHALL NOT be forced into a daily reduction; it remains a cycle deduction used to reconcile the exact final payout. No percentage SHALL be stored or used to calculate a synced net. An effective rate MAY be presented from stored values for display only.

#### Scenario: A day arrives with all three figures

- **WHEN** the sync writes an outlet's Swiggy business date from order rows
- **THEN** gross, reduction and net order payout are stored as integer paise and net plus reduction equals gross

#### Scenario: GST-inclusive Total Customer Paid is not ledger gross

- **WHEN** a Swiggy order includes GST collected from the customer
- **THEN** ledger gross subtracts the order-detail `GST Collected` amount from `Total Customer Paid`, and does not include that GST merely because the customer paid it

#### Scenario: A cycle-only deduction remains cycle-only

- **WHEN** a final payout includes an ad or recovery with no supported service date
- **THEN** it participates in cycle reconciliation but is not allocated across daily gross, reduction or net

#### Scenario: The rate is a reading, not an input

- **WHEN** a synced day is read
- **THEN** any rate shown is computed from stored money and no configured percentage participates in net revenue

#### Scenario: A day recorded before the sync is untouched

- **WHEN** a business date carries only a migrated typed Swiggy value
- **THEN** its preserved historical money remains the ledger value until an authoritative source covers that date

### Requirement: An unpaid week reads as provisional and a paid week replaces it

Each synced day SHALL carry a settlement state. A day sourced from a live/open payout cycle SHALL be **provisional**, with the capture time and the portal time through which it was current. Swiggy's open-cycle Current Payout MAY be displayed as a provisional cycle estimate but SHALL NOT be presented as money finally payable.

An aggregator cycle becomes eligible to settle when the operator labels that cycle final and supplies the exact final payout and sufficient component evidence to reconcile it. Bank status such as Pending, On Hold or Paid SHALL be stored separately from settlement state; Swiggy's final Pending payout can therefore settle the accounting record before the bank transfer, while a merely open Current Payout cannot.

A settled figure SHALL supersede a provisional one for the same outlet, channel and business date without creating a second row. A settled day SHALL NOT return to provisional. If a later final source changes a settled value, the restatement SHALL retain the earlier settled and provisional values and mark the day revised.

The surface SHALL state provisional, settled, revised or disputed wherever the figure is read and SHALL separately state the payout's bank status when known.

#### Scenario: This week's revenue is marked provisional

- **WHEN** a twice-daily read captures today's open-cycle Swiggy figures
- **THEN** the day is provisional and shows the as-of time rather than implying the day or payout is complete

#### Scenario: A cancellation refund appears only on settlement

- **WHEN** a cycle contains a cancellation or preparation refund absent from the live provisional source but present in final order facts
- **THEN** final settlement includes it, retains the earlier values and marks the affected day revised when its figures change

#### Scenario: Final pending can settle before payment

- **WHEN** Swiggy labels a closed cycle FINAL with bank status Pending and the cycle reconciles
- **THEN** its days become settled, the cycle retains Pending as bank status, and the owner is not told that the transfer has arrived

#### Scenario: Current payout cannot masquerade as final

- **WHEN** Swiggy supplies a Current Payout for an open cycle
- **THEN** it remains provisional even if every displayed component currently adds to the estimate

#### Scenario: Settlement replaces the estimate in place

- **WHEN** a previously provisional cycle becomes final and reconciles
- **THEN** each covered day is rewritten from authoritative order/cycle facts, remains one row per outlet/channel/date and retains the prior provisional values

#### Scenario: A revised day says what it was

- **WHEN** final or later-restated figures differ from earlier figures
- **THEN** the earlier values and source are shown beside the current ones and the day reads revised

#### Scenario: An unchanged day is not marked revised

- **WHEN** a cycle settles and a day's figures equal the provisional values already stored
- **THEN** the day reads settled and is not marked revised

#### Scenario: A settled day is not downgraded

- **WHEN** a later run reads live dashboard data for an already settled date
- **THEN** the settled values and state remain unchanged

### Requirement: A settled week is written only if it reconciles against the payout actually made

Before writing a settled cycle, the sync SHALL verify that the sum of its order-level restaurant payouts, plus or minus its separately represented dated and cycle-level deductions, taxes, ads, complaints, cancellations, refunds and adjustments, equals the exact final payout stated by the aggregator.

The cycle identity and start/end dates SHALL come from the portal. The system SHALL NOT infer a Monday-to-Sunday, Sunday-to-Saturday, seven-day or calendar-month cadence; shortened month-boundary cycles are valid.

Where computed and stated payout agree within one rupee, the cycle SHALL be written atomically. Where they differ by more than one rupee, no day, deduction or reconciliation record from that candidate SHALL be written or altered, the prior values SHALL remain, and the cycle SHALL read disputed with outlet, channel, portal cycle, both totals and the difference.

A disputed final cycle SHALL remain disputed until a later source reconciles it or the Super Admin uses the existing recheck/accept-difference controls. Payment status changes alone SHALL NOT conceal or resolve a discrepancy.

#### Scenario: A reconciling cycle is written

- **WHEN** order payouts and represented adjustments equal Swiggy's final net payout within one rupee
- **THEN** all daily, deduction and reconciliation changes commit together as settled

#### Scenario: Portal dates define a shortened cycle

- **WHEN** Swiggy declares a final cycle covering a month-boundary range shorter than seven days
- **THEN** reconciliation uses those exact dates and does not expand or merge the range

#### Scenario: A discrepancy stops the write

- **WHEN** a final cycle differs from the computed payout by more than one rupee
- **THEN** no candidate day, deduction or cycle value is committed, prior records remain unchanged and the named cycle becomes disputed

#### Scenario: A disputed week is not mistaken for the current week

- **WHEN** a FINAL cycle has been refused for failing to reconcile
- **THEN** its candidate dates read disputed rather than provisional, distinguishable from an open cycle still awaiting finality

#### Scenario: A later run resolves a dispute

- **WHEN** a previously disputed cycle reconciles from a later authoritative read or confirmed upload
- **THEN** its candidate facts commit atomically and the cycle becomes settled or revised as appropriate

#### Scenario: Rounding noise does not raise an alarm

- **WHEN** computed payout differs from the exact stated payout only within the one-rupee tolerance
- **THEN** the cycle is treated as reconciled and no discrepancy is reported

### Requirement: A synced figure supersedes a typed one while preserving what was typed

Where an authoritative sync or upload covers an outlet, channel and business date that already has a typed legacy figure, the sourced figure SHALL become the ledger value and the entered values SHALL be retained with legacy-typed provenance and the moment they were superseded.

Before the writable Swiggy fields are removed, migration SHALL prove that every non-null typed revenue, rate and commission fact has been carried and that day/month totals remain identical. A partial carry SHALL fail atomically. After removal, a date awaiting authoritative coverage SHALL read its carried legacy values as read-only history; failure of a later read SHALL not delete them, replace them with zero or reopen typing.

The retained figure SHALL NOT participate in revenue or profit computation once superseded. It exists so the owner can compare prior estimates with measured truth.

#### Scenario: Typed Swiggy is carried before fields are removed

- **WHEN** the handover migration runs
- **THEN** every existing typed Swiggy value is retained with legacy provenance, totals are unchanged and the migration refuses a partial carry

#### Scenario: A typed day is taken over

- **WHEN** an authoritative Swiggy source covers a business date carrying a legacy value
- **THEN** the sourced figure becomes the day's value, the legacy figure is marked superseded and totals include only the sourced figure

#### Scenario: The owner can see what they had guessed

- **WHEN** the owner reads a date whose typed Swiggy figure was superseded
- **THEN** the legacy and authoritative figures remain distinguishable, with the legacy value excluded from totals

#### Scenario: A failed reader preserves legacy history

- **WHEN** the reader fails before authoritative Swiggy data covers a legacy date
- **THEN** the legacy value remains readable and unchanged, no zero is written and no manual money field returns

### Requirement: Synced records are readable only by those who may already read the outlet

Every outlet-scoped table this capability uses SHALL carry Row-Level Security. A Super Admin SHALL read daily figures and settlement internals across outlets. A Franchise Admin SHALL read daily aggregate channel figures only for outlets named by a live assignment, matching the full ledger already granted there, but SHALL read no cycle reconciliation, deduction, run, credential or auth-request record. A Biller and Employee SHALL read none of these financial rows.

No application client role SHALL insert, update or delete sourced figures, cycle records, deductions, sync runs, mappings, credentials or auth requests through direct table access. Privileged commands SHALL re-derive authority from the caller token or authenticate the reader boundary itself; they SHALL NOT trust an outlet, role or channel claim supplied by a client.

#### Scenario: A manager reads assigned daily aggregates only

- **WHEN** a Franchise Admin requests channel-day rows for an assigned outlet
- **THEN** those daily aggregate rows are readable but settlement cycles, deductions, sync internals and credentials are not

#### Scenario: A manager cannot cross outlets

- **WHEN** a Franchise Admin hand-crafts a daily-figure or settlement request for another outlet
- **THEN** the database returns no rows and accepts no write

#### Scenario: A Franchise Admin cannot reach settlement records

- **WHEN** a Franchise Admin hand-crafts a request for any outlet's cycle reconciliation, deduction, run, credential or auth-request record
- **THEN** the database returns no row, including at an outlet assigned to that manager

#### Scenario: A Biller and an Employee are refused outright

- **WHEN** a Biller or Employee requests any sourced daily, settlement, deduction, sync or credential record
- **THEN** the database returns no rows and accepts no write

## ADDED Requirements

### Requirement: Swiggy daily sales respect evidence time and the outlet cutover

A Swiggy daily write SHALL use order placement timestamps converted through the outlet's business-day cutover whenever it asserts an authoritative business date. For every non-annexure order it SHALL obtain the detail `payoutSummary`, require exactly one parseable `Total Customer Paid` header and exactly one parseable `GST Collected` sub-header, and use their difference as gross. The sole exception is an order detail whose own status explicitly says cancelled and omits GST Collected: it SHALL record zero gross because the final annexure's Net Bill Value is zero for that state, even if the detail carries customer-payment components. A non-cancelled omission SHALL fail as a source-shape change. Portal dashboard/report dates are Asia/Kolkata calendar days and SHALL NOT silently become business dates for an outlet whose cutover is not midnight.

The live Net Sales metric MAY be stored as provisional only for a range that is proved to correspond exactly to one business-date window. If the API cannot provide order timestamps or a cutover-aligned range, the metric SHALL remain health/cross-check telemetry rather than an authoritative ledger write. A multi-date aggregate SHALL never be assigned to its last date.

Each provisional row SHALL retain its capture/as-of time. A later same-day read MAY replace it idempotently; a failed or partial read SHALL preserve the last successful row.

#### Scenario: A post-midnight order stays with the trading shift

- **WHEN** a Swiggy order is placed at 00:30 at an outlet whose cutover is 04:00
- **THEN** it contributes to the previous business date even if the portal dashboard labels it with the new calendar date

#### Scenario: A daily order reproduces the settlement gross

- **WHEN** a live Swiggy order detail shows `Total Customer Paid` and `GST Collected`
- **THEN** its provisional gross is their integer-paise difference and matches that order's later payout-annexure Net Bill Value when the cycle settles

#### Scenario: Missing detail cannot become GST-inclusive gross

- **WHEN** the order-detail response omits, duplicates or cannot parse either required money label
- **THEN** the candidate fails as a source-shape change, no daily amount is written, and the reader does not fall back to `customerPaidAmount` or a calendar aggregate

#### Scenario: A calendar aggregate cannot prove a business date

- **WHEN** the API returns only midnight-to-midnight Net Sales and cannot provide cutover-aligned data or order timestamps
- **THEN** it does not overwrite the authoritative ledger day and the run reports the limited source shape

#### Scenario: Same-day data advances without becoming final

- **WHEN** the second daily run sees more valid orders for today's open cycle
- **THEN** it replaces the provisional row with a later as-of value and retains provisional state

#### Scenario: A multi-date total is not placed on one date

- **WHEN** a Swiggy response aggregates several portal dates into one total
- **THEN** no business date receives that total unless source rows can be separated and attributed by the cutover contract

### Requirement: Swiggy reads run twice daily without login side effects

One serialized Swiggy workflow SHALL be scheduled exactly twice per Asia/Kolkata business day at documented UTC cron times. Each run SHALL attempt the current/open cycle and a bounded lookback that includes at least yesterday and the two most recent portal-declared closed cycles. This is one twice-daily discovery cadence, not a separate assumed weekly cron.

The run SHALL use only the stored Swiggy API session. It SHALL paginate until source exhaustion, retry bounded transient 408, 429 and 5xx failures, classify authentication lapse separately from source-shape and transport failures, and emit one event per meaningful outcome. It SHALL NOT launch a browser, request/resend an OTP, or create an auth request.

A failed, partial, lapsed or shape-changed read SHALL write no synthetic zero and SHALL not alter a prior successful figure. A session lapse SHALL update health and direct the owner to reconnect.

#### Scenario: Both daily schedules inspect sales and payouts

- **WHEN** either scheduled Swiggy run starts
- **THEN** it refreshes eligible current data and checks at least the two most recent closed portal cycles for final or revised payout facts

#### Scenario: Pagination is complete before ingest

- **WHEN** a Swiggy order or payout response has another cursor
- **THEN** the run continues until exhaustion before claiming the candidate cycle is complete

#### Scenario: A session lapse does not log in

- **WHEN** a scheduled API call reports that the Swiggy session has lapsed
- **THEN** the run writes no financial value, marks health as needing reconnect and exits without browser or OTP activity

#### Scenario: A shape change cannot erase money

- **WHEN** a required Swiggy field or metric label is absent or incompatible
- **THEN** the run records a source-shape failure and leaves every prior financial row unchanged

### Requirement: Restaurant identities are explicit and channel-scoped

An operator restaurant reference SHALL map to exactly one Ops outlet within its channel, while one outlet MAY have multiple references for the same channel with independent enabled/dormant status. Automation and uploads SHALL use the same mapping and SHALL reject an unmapped or ambiguously mapped reference before writing money.

An outlet with no enabled Swiggy reference SHALL read **Not connected for this outlet**. It SHALL have no Swiggy sync boundary, no read/reconnect action for a fabricated identity, no run row caused by scheduling and no zero-valued channel day. Mapping SHALL never be inferred from a fuzzy name or approximate ledger total.

#### Scenario: Two Kalyani references remain explicit

- **WHEN** the Swiggy account exposes an active and dormant restaurant reference that both belong to Kalyani
- **THEN** both can map to Kalyani with explicit statuses and neither creates a duplicate outlet or ambiguous write

#### Scenario: Kanchrapara is unserved

- **WHEN** Kanchrapara has no verified enabled Swiggy reference
- **THEN** its Swiggy tab state says not connected and schedules write no run, figure or synthetic zero for it

#### Scenario: An unknown report row is refused

- **WHEN** automation or an uploaded report carries a restaurant reference absent from the mapping
- **THEN** the affected ingest is refused with that reference identified and no guessed outlet assignment

### Requirement: Swiggy has a parity owner surface without Hyperpure

The Super Admin SHALL have a Swiggy tab parallel to Zomato. For each configured outlet it SHALL show credential and reader health, last successful read and as-of time, Read again with duplicate suppression, reconnect, a code field only during an open Swiggy challenge, provisional/final bank status, sync events, upload outcome, disputes, recheck and accept-difference actions.

The tab SHALL show events rather than raw workflow runs, SHALL identify the affected outlet and period, and SHALL use the same state language as the ledger. It SHALL contain no Hyperpure health, capture, upload or reconnect function. Unconfigured outlets SHALL show the not-connected state defined by the mapping contract.

The surface SHALL depend on the typed adapter interface and SHALL have an internally consistent demo covering provisional, settled, revised, disputed, lapsed-session, upload and unconfigured states. The owner-only gate, route and attention badge SHALL be independent from Zomato.

#### Scenario: The owner sees the same recovery controls

- **WHEN** a configured outlet's Swiggy reader needs attention
- **THEN** its Swiggy tab names the health problem and offers the relevant Read again, reconnect, OTP, upload, recheck or accept action

#### Scenario: Swiggy has no Hyperpure child line

- **WHEN** the owner opens the Swiggy tab
- **THEN** no Hyperpure state or action is shown and changing Swiggy health cannot alter the Zomato tab's Hyperpure line

#### Scenario: Demo mode remains self-contained

- **WHEN** the Swiggy surface is opened in demo mode
- **THEN** its states and actions use typed mock data, issue no live request and preserve the non-dismissible demo boundary
