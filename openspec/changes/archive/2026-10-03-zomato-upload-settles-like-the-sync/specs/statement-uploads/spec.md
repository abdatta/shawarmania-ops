## ADDED Requirements

### Requirement: A Zomato payout workbook settles only a paid week, from its own facts

A Zomato payout workbook SHALL be accepted only when the workbook itself proves the
week paid: every order row settled with no unsettled amount, every order with a
non-zero payout naming a bank UTR, and every deduction-sheet line settled. The week
SHALL be the report period the workbook states, never one inferred from order
dates, and every order SHALL fall inside it. The workbook SHALL cover exactly one
restaurant, mapped to an outlet the uploader may write for.

An accepted workbook SHALL produce the same days as the sync for the same week:
same cycle identity, same per-day gross, commission and net. Its Hyperpure, ads,
TDS, other-deduction, adjustment and addition lines SHALL each be represented, and
the week SHALL be written only if Σ order-level payout less the workbook's
`Total Deductions` plus its `Total Additions` agrees within one rupee with what
the itemised lines reconcile to. The customer identifier column SHALL NOT be read.

A workbook for a week the ledger already holds reconciled SHALL change nothing and
SHALL say whether the file agrees with the held payout.

#### Scenario: An unpaid week is refused with its reason

- **WHEN** the owner uploads the workbook for a week Zomato shows as TO BE PAID
- **THEN** the upload is refused, the screen says how many orders are still
  pending settlement and to upload after the payout date, and nothing is written

#### Scenario: A paid week settles as the sync would

- **WHEN** the owner uploads the workbook for a paid week that no run has settled
- **THEN** the week settles under the same cycle the sync uses, each day carries
  gross, commission and net, and the Hyperpure bill it lists is reconciled
  without being booked a second time as an expense

#### Scenario: A workbook that does not add up is refused

- **WHEN** a workbook's itemised lines and its own totals differ by more than one
  rupee
- **THEN** the upload is refused naming both amounts and the difference, and no
  day is marked disputed

#### Scenario: A week already settled is left alone

- **WHEN** a paid week's workbook is uploaded after the sync has settled that week
- **THEN** nothing is written and the owner is told it is already settled and
  whether the file matches the payout held

#### Scenario: A restaurant nobody may write for is named

- **WHEN** a workbook's orders belong to a restaurant not mapped to an outlet the
  uploader may write for
- **THEN** the upload is refused naming that restaurant, instead of reporting
  success having written nothing

### Requirement: Every refused upload tells the uploader why

A refused upload of any statement kind SHALL show the uploader the refusal's own
reason. A generic failure message SHALL appear only when the service gave no
reason, and write-contract refusals SHALL carry their reason back rather than
reading as an internal failure.

#### Scenario: The reason reaches the screen

- **WHEN** an upload is refused for its content
- **THEN** the upload screen shows that reason, not "That upload did not go
  through"
