## MODIFIED Requirements

### Requirement: An order carries a preparation state independent of payment

An order SHALL carry `prepared_at`, a nullable timestamp, and `prepared_source`,
which is `counter` or `day_change` and is null exactly when `prepared_at` is null.
Null SHALL mean still preparing. Payment and preparation SHALL be independent axes:
an order MAY be paid while still preparing, and MAY be prepared while unpaid. The
status enum SHALL continue to describe only the money lifecycle.

Marking prepared by the counter SHALL be a typed command attributed like every
other counter command, and SHALL record `prepared_source = counter`. Reprepare
SHALL be refused once the order is paid — a prepared and paid order is a bill, and
bills do not return to preparation. Marking prepared on a paid-but-unprepared order
SHALL succeed and complete that order's path to its bill.

No client role SHALL be able to set or clear `prepared_source` other than through
the counter's prepare, reprepare and payment-unwind commands.

#### Scenario: Order taken lands in preparing

- **WHEN** an operator saves a new order under a live shift
- **THEN** the order exists with null `prepared_at`, null `prepared_source` and status open

#### Scenario: Marked prepared

- **WHEN** the owning tablet marks an open order prepared with its command time
- **THEN** `prepared_at` holds that time, `prepared_source` is `counter`, and the order remains open and unpaid until payment

#### Scenario: Reprepare while unpaid

- **WHEN** the owning tablet reprepares a prepared order whose status is open
- **THEN** `prepared_at` and `prepared_source` return to null and the order remains fully editable

#### Scenario: Reprepare after payment

- **WHEN** any caller attempts to reprepare an order whose status is paid
- **THEN** the database refuses the command and no bill or order field changes

#### Scenario: Paid while still preparing

- **WHEN** an upfront payer's order is paid before being marked prepared
- **THEN** the order carries status paid with null `prepared_at`, and marking it prepared afterwards succeeds

#### Scenario: History paid before preparation existed

- **WHEN** an order was paid before the outlet recorded preparation at all
- **THEN** its stored payment moment stands as its preparation record — the row reads prepared at `paid_at` and appears among settled bills, never as pipeline work still owed

#### Scenario: A client writes the source by hand

- **WHEN** an authenticated person, a Franchise Admin or a counter tablet hand-crafts an update setting `prepared_source` on an order
- **THEN** the database refuses it and the order is unchanged

## ADDED Requirements

### Requirement: The day change finishes a paid order nobody marked prepared

A paid order is eventually served: the owner's rule is not that it has been served
when the day is closed, but that it has been by the time the shop has shut. The
outlet's business-day cutover is the first instant that is reliably true.

When the business day that an order's **payment** belongs to has ended — at
`payment_business_date + 1` at the outlet's cutover — an order whose status is
`paid` and whose `prepared_at` is null SHALL be marked prepared with `prepared_at`
equal to **that cutover instant** and `prepared_source = day_change`.

The recorded values SHALL depend only on stored facts, so that the same rows result
whenever the finishing runs after the cutover. An order whose status is `open` or
`cancelled` SHALL NOT be touched. No `billing_commands` receipt SHALL be written,
and no tablet's end-of-day confirmation SHALL be invalidated by it.

The function that performs it SHALL be executable by no client role.

#### Scenario: A forgotten tick at night

- **WHEN** an order is paid at 22:05 on business date D and nobody ticks Prepared
- **THEN** after the cutover ending D it reads prepared at that cutover with source `day_change`, and it is on no rail

#### Scenario: Paid after midnight, before the cutover

- **WHEN** an order is taken at 03:55 on business date D and paid at 04:05, falling on payment business date D+1
- **THEN** it is finished at the cutover ending D+1, never at the one ending D, and its `prepared_at` is never earlier than its payment

#### Scenario: Finishing runs late

- **WHEN** the finishing first runs three hours after the cutover
- **THEN** the order's `prepared_at` is the cutover instant, identical to a run on the minute

#### Scenario: An unpaid order crosses the cutover

- **WHEN** an open, unpaid order is still on the rail after the cutover
- **THEN** it is unchanged and remains on the rail

#### Scenario: A client calls the finishing directly

- **WHEN** an authenticated person, a Franchise Admin, a Super Admin or a counter tablet hand-crafts a call to the finishing function
- **THEN** the database refuses it

#### Scenario: Counting the day change's work

- **WHEN** an operator queries orders whose `prepared_source` is `day_change`, grouped by outlet and payment business date
- **THEN** each such order is counted exactly once, and no order a counter ticked is among them

### Requirement: A late counter tick supersedes the day change, and an unwind clears it

A Prepared command for an order whose `prepared_source` is `day_change` SHALL be
accepted. Where its command time is earlier than the recorded `prepared_at`, the
order SHALL take the command time and `prepared_source = counter`; otherwise the
command SHALL be accepted without changing the order. A Prepared command for a paid
order whose `prepared_source` is `counter` SHALL continue to be refused as not open.

A payment take-back accepted for an order whose `prepared_source` is `day_change`
SHALL return its `prepared_at` and `prepared_source` to null, because the stamp was
premised on the payment the take-back removes. A counter-sourced preparation SHALL
survive a take-back as it does today.

#### Scenario: A tick queued offline before the cutover

- **WHEN** a tablet ticks Prepared at 23:40 with no network and delivers the command after the day change has finished that order
- **THEN** the command is accepted, the order reads prepared at 23:40 with source `counter`, and the tablet holds no needs-attention item for it

#### Scenario: A take-back queued offline before the cutover

- **WHEN** a take-back created inside the edit window under the shift then live is delivered after the day change finished the order
- **THEN** the order returns to open with null `prepared_at` and null `prepared_source`

#### Scenario: A second tick on an order the counter already ticked

- **WHEN** a Prepared command arrives for a paid order whose `prepared_source` is `counter`
- **THEN** it is refused as not open and nothing changes
