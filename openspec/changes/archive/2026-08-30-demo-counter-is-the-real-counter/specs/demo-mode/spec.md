## ADDED Requirements

### Requirement: The demo Biller walkthrough is the enrolled tablet's own shell

The demo Biller surface SHALL be the same counter shell component the enrolled
tablet branch renders, provided with a synthetic counter-device session by a
demo-owned host. The demo SHALL NOT maintain a second implementation of the
counter, and the demo host SHALL NOT import the database client or any real
adapter.

#### Scenario: The demo counter is the production counter

- **WHEN** the Biller walkthrough is opened
- **THEN** it renders the enrolled tablet's own shell — device label, sync
  indicator, Hand over and Finish day above the till with expenses beneath it —
  with no navigation, no account menu and no sign-out

#### Scenario: The demo cannot reach the backend to do it

- **WHEN** the demo host provides the counter session and adapters
- **THEN** every adapter in that tree is a mock, and no import path from the demo
  tree reaches the database client or a real adapter

#### Scenario: The whole counter lifecycle is walkable

- **WHEN** a walkthrough hands over, leaves the counter from a phone, or finishes
  the day
- **THEN** the shift-request screen, its four readable digits, its wait, its
  timeout, its destruction after three wrong codes, and the no-shift resting
  state are all reachable without leaving demo mode

#### Scenario: The counter between shifts

- **WHEN** the demo shift is ended or the day is finished during a walkthrough
- **THEN** the counter shows the shift-request screen a real tablet shows
  overnight, and demo reset restores the open shift the walkthrough starts from

### Requirement: The demo models the live shift table, not the retired one

The demo SHALL hold a counter shift in exactly one representation, and that
representation SHALL be the one the live counter uses. Demo bills, orders and
billing commands SHALL carry the same shift reference production writes, and
SHALL NOT place an identifier from the retired pre-tablet shift model into a
column that references the live one. Confirming a shift request SHALL open a
shift that billing attributes bills to; ending a shift from a phone and
finishing the day SHALL close that same shift with distinguishable reasons; and
the counter, the Tablets surface, every phone's live-shift card and the billing
figures SHALL agree about who holds the counter and since when. A demo shift's
business date and expiry SHALL be resolved through its outlet's own cutover.

#### Scenario: A demo shift reference could exist in production

- **WHEN** the demo creates a bill, an order or a billing command under a shift
- **THEN** the shift reference it stores is the one the live schema declares for
  that column, and no value is written that production's foreign keys would
  reject

#### Scenario: A shift ends for a stated reason

- **WHEN** a shift ends because its operator left, because the day was finished,
  or because it reached the outlet's cutover
- **THEN** the demo records which of those happened, rather than recording only
  that the shift is no longer open

#### Scenario: Tablets and the phone agree about the counter

- **WHEN** a shift is open at the demo outlet
- **THEN** the Tablets surface names its holder and opening time, and that same
  person sees the live-shift card offering **Leave counter** on their own phone

#### Scenario: A confirmed handshake opens a shift that takes money

- **WHEN** a request is approved from a phone and a bill is then rung at the
  counter
- **THEN** the bill is attributed to the person who approved it, and appears in
  their shift's totals and in every figure derived from them

#### Scenario: Leaving the counter closes the shift the counter is showing

- **WHEN** the shift holder chooses Leave counter on their phone
- **THEN** the same shift closes everywhere, and the counter stops offering new
  work rather than continuing against a shift only it can still see

#### Scenario: A demo shift opened after midnight belongs to the trading day

- **WHEN** a shift is opened during a walkthrough held after the outlet's cutover
- **THEN** its business date is the one that outlet's cutover resolves, and every
  surface dating that shift's work agrees with it

## MODIFIED Requirements

### Requirement: Live billing promotion preserves the isolated demo composition

Promoting billing capabilities to `live` SHALL connect real tablet sessions to
live adapters while `/demo` continues to use the complete synthetic billing
lifecycle with no authentication, no IndexedDB delivery and no Supabase writes.
The synthetic lifecycle SHALL include the counter's own day-close and departure
behaviour: a Finish Day readiness sheet that drains before deciding and names
each blocker, an advisory rather than blocking recent-payment window, and an
after-departure attribution exception a manager can review.

#### Scenario: Demo is opened after live promotion

- **WHEN** a visitor enters the billing walkthrough through `/demo`
- **THEN** direct and on-handover payment, five-minute tender editing with the same relative countdown, cancelled, unsent, originating-tablet needs-attention, read-only manager-diagnostic and customer-reuse scenarios remain walkable with no discount control, and no live queue or backend mutation is created

#### Scenario: Finish Day explains itself in demo

- **WHEN** Finish day is chosen at the demo counter
- **THEN** the readiness sheet drains, names every hard blocker with its
  resolution, treats a still-editable recent payment as advice rather than a
  refusal, and finishes the day when nothing genuine is blocking

#### Scenario: A manager reviews an after-departure attribution in demo

- **WHEN** a manager opens the flagged bill in billing history
- **THEN** the bill is labelled as recorded after its operator left remotely,
  remains inside the day's takings and every figure derived from them, and offers
  confirming the original operator, naming another, or recording that the
  operator cannot be established — appending the outcome without rewriting the
  original attribution
