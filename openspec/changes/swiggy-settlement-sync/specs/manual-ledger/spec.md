## MODIFIED Requirements

### Requirement: The day record is reachable by owners, and by managers at the outlets they are assigned to

The manual ledger's day record, its sourced daily aggregator figures and its full surface SHALL be available to an account holding a live Super Admin assignment at any outlet, and to an account holding a live Franchise Admin assignment **at the outlets that assignment names**. A Franchise Admin SHALL be refused every select, insert, update and delete on `manual_ledger_days` and every select of a sourced channel day at every outlet where they do not hold a live assignment, by Row-Level Security rather than by the interface.

A Franchise Admin's daily-figure grant SHALL NOT extend to aggregator settlement cycles, deductions, sync runs, credentials, auth requests or owner sync controls. A Biller or an Employee SHALL be refused every select, insert, update and delete on `manual_ledger_days` and every sourced channel-day select at every outlet, including outlets where they hold a live assignment. The refusal SHALL be the absence of a policy branch, not a hidden screen.

That refusal protects two distinct things and the difference SHALL be stated rather than left implied.

On the **write** side it protects the drawer. No outlet staff account SHALL be able to set a day's counted cash, opening cash or cash removed, because a staff account that could set any of them could make any drawer reconcile, and the nightly count is the only control the business has over cash.

On the **read** side it protects history and aggregates: any past business date, any month's total, any other outlet, and every figure net of commission. None of these is observable from behind a counter, and a running total across weeks is not the same information as one evening's cash.

The system SHALL NOT claim that the takings of a shift a staff member worked, at the outlet they worked it in, are confidential. That person stands where the sales happen and could tally them. No requirement, test or later feature SHALL rest on the premise that such a figure is secret. The policy nevertheless refuses every day row without checking who was rostered, because the concession is a limit on what the system may claim and not an instruction to open a hole.

The expense record SHALL be reachable by outlet staff under the separate requirement below, which is a narrower grant against a different table.

Deactivating an account, or ending the assignment that granted its reach, SHALL end that access on the account's next request rather than at token expiry.

#### Scenario: An owner opens the ledger

- **WHEN** an account with a live Super Admin assignment signs in
- **THEN** the manual ledger appears in their navigation and opens with sourced aggregator figures for every outlet

#### Scenario: A manager opens the ledger at an outlet they are assigned to

- **WHEN** an account with a live Franchise Admin assignment signs in
- **THEN** the manual ledger appears for each assigned outlet and shows the day and month in full, including sourced Zomato and Swiggy daily figures

#### Scenario: A manager is refused another outlet's ledger by the database

- **WHEN** a Franchise Admin issues a hand-crafted request for a day row or sourced channel day at an outlet where they hold no live assignment
- **THEN** the database refuses it and returns no rows, with no reliance on the interface having hidden anything

#### Scenario: A manager cannot inspect owner settlement internals

- **WHEN** a Franchise Admin requests a cycle reconciliation, deduction, sync run, credential or auth request at an assigned outlet
- **THEN** the database returns no row

#### Scenario: Outlet staff are refused the day record at their own outlet

- **WHEN** a Biller or Employee issues a hand-crafted read or write against a day record or sourced channel day at any outlet
- **THEN** the database refuses it and returns no rows

#### Scenario: Staff cannot move the drawer figures

- **WHEN** a Biller or an Employee issues a hand-crafted update setting a day's counted cash, opening cash or cash removed at their own outlet
- **THEN** the database refuses each of them and every figure on that day is unchanged

#### Scenario: A past day and a month total stay out of reach

- **WHEN** a Biller or Employee issues a hand-crafted select for a past business date or month range at their outlet
- **THEN** the database returns no day or sourced channel rows

#### Scenario: The day surface is absent rather than forbidden

- **WHEN** a Biller or an Employee navigates directly to the manual-ledger path
- **THEN** no manual-ledger surface renders and no manual-ledger request is issued

#### Scenario: Losing an assignment ends access

- **WHEN** an account's assignment is ended or the account is deactivated
- **THEN** its next manual-ledger and sourced-figure request is refused without waiting for token expiry

### Requirement: A live outlet's cash and UPI revenue comes from bills, while its aggregator revenue stays typed

Each outlet SHALL carry an explicit **billing go-live date**, null until that outlet is promoted and set by a Super Admin. It SHALL NOT be derived from billing data: shadow smoke-test bills are rung before any customer money, so a derived boundary would move itself onto a day whose revenue was already typed by hand. Setting it to a business date that has already started SHALL be refused, because a day that begins hand-typed and ends sourced from bills is counted twice.

From that date, the manual ledger SHALL source that outlet's **cash and UPI** revenue from paid bills rather than from a typed figure, SHALL state on screen that each figure came from the counter, and SHALL NOT offer a second field inviting the same money to be entered again. Where a paid bill has one or more append-only tender corrections, the ledger SHALL use its latest accepted effective Cash/UPI allocation and SHALL NOT count the original allocation as additional revenue.

An aggregator channel's revenue SHALL be sourced where `aggregator-settlement-sync` covers it, independently of billing go-live and independently of the other aggregator. V1 billing accepts Cash and UPI only, so aggregator orders are never rung at the counter. Once this change promotes Swiggy for an outlet, the ledger SHALL remove every writable Swiggy revenue, rate and commission field for all dates and SHALL refuse a stale day payload that still carries any of them rather than silently discarding it.

Before removing those fields, migration SHALL carry every existing typed Swiggy value into read-only legacy provenance with its original values and SHALL prove that historical day and month totals are unchanged. An authoritative daily reader or settlement for the same outlet and date SHALL supersede that legacy value without deleting it and SHALL be the only version included in totals. A date not yet covered by an authoritative source SHALL continue to read its carried legacy value, marked as such, but SHALL not become writable again.

A sourced channel with no successful figure for a date SHALL read as not yet measured, not as zero, and SHALL offer Read again or the statement fallback only to the Super Admin. Every other part of the ledger SHALL keep working by hand until #12 and #13 retire it: cash in and out, expenses the sync does not source and the counted drawer.

Sourcing an aggregator channel SHALL NOT leave a day computing a net from a rate and no stated revenue: a measured row uses its exact stored gross, commission-and-fee reduction and net; a carried legacy row uses its preserved historical values.

#### Scenario: Go-live is set mid-trade

- **WHEN** a Super Admin tries to set an outlet's go-live date to a business date that outlet is already trading
- **THEN** it is refused, naming the next date that has not started, so no day is ever part typed and part billed

#### Scenario: Shadow tests before go-live

- **WHEN** test bills are rung at an outlet before its go-live date is set
- **THEN** the ledger keeps reading that outlet's typed cash and UPI revenue for those dates, because the boundary is the recorded date and not the presence of bills

#### Scenario: The night an outlet goes live

- **WHEN** the owner opens the ledger for a live outlet's business date
- **THEN** cash and UPI revenue come from the counter, promoted aggregator channels come from their own records, and only the remaining cash movements, expenses and drawer count are entered by hand

#### Scenario: Aggregator revenue survives the handover

- **WHEN** the owner records a day after Swiggy typing is frozen but before a successful current Swiggy read exists
- **THEN** preserved legacy Swiggy values remain readable for historical dates, a new uncovered date states not yet measured, and neither case invents zero or reopens a money field

#### Scenario: One aggregator is sourced and the other is not

- **WHEN** a date has an authoritative Zomato figure and Swiggy has only legacy or not-yet-measured state
- **THEN** each channel displays its own source/state and the total includes only the authoritative or preserved value actually available for that channel

#### Scenario: Existing Swiggy typing survives the freeze

- **WHEN** the Swiggy handover migration completes
- **THEN** every historical Swiggy amount and total is unchanged, each value is retained with legacy-typed provenance, and no Swiggy revenue, rate or commission field remains writable

#### Scenario: Authoritative Swiggy replaces a legacy value

- **WHEN** a successful Swiggy read covers a date carrying a legacy typed value
- **THEN** the measured value alone enters totals and the legacy value remains visible as superseded history

#### Scenario: A failed read does not reopen typing

- **WHEN** no successful Swiggy value exists for a date after the handover
- **THEN** the ledger states not yet measured, writes no zero, and exposes no manual Swiggy money field

#### Scenario: A stale client is refused

- **WHEN** an old client saves a day payload containing removed Swiggy money or rate fields
- **THEN** the write fails clearly and no part of the day is changed

#### Scenario: An earlier month is reopened

- **WHEN** the owner or assigned Franchise Admin opens a date from before billing or aggregator automation went live
- **THEN** every available figure reads from its preserved historical source and computes by the rule recorded with that source
