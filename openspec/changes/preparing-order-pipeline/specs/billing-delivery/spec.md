## ADDED Requirements

### Requirement: Unwinds chain behind the payment they reverse and project locally before delivery

`void_order_payment` and `cancel_paid_order` envelopes SHALL join the same
per-order dependency chain as the payment they reverse, so an unwind can never
deliver ahead of its payment whatever the connectivity. Before delivery, the
tablet's local reads SHALL project an accepted unwind: a voided-and-reopened
order reappears as open with its prior preparation state, a cancelled order
leaves the actionable pipeline, and neither presents the unwound bill as
settled in shift totals.

#### Scenario: Offline unpay replays after its payment

- **WHEN** an operator takes a payment back offline and both commands deliver after reconnecting
- **THEN** the pay lands first, the unwind second, the bill ends void with kind `counter_unpay`, and no duplicate bill exists

#### Scenario: The pipeline reads the unwind immediately

- **WHEN** `void_order_payment` is durably accepted locally while offline
- **THEN** the order card returns to its prior section at once and shift totals stop counting that bill, without waiting for delivery

## MODIFIED Requirements

### Requirement: Finishing the day requires a resolved online queue

Finishing a business day SHALL require every counter command of the day —
including preparation commands and payment unwinds — to be delivered or
resolved, and SHALL refuse while any remains unsent or needs attention. A
payment taken back within its window removes the bill from the day's settled
figures; the refusal messages SHALL treat such an unwound bill exactly as any
other resolved history.

#### Scenario: An undelivered unwind holds sign-off

- **WHEN** end-of-day readiness is evaluated while a payment unwind is still queued
- **THEN** the day refuses to finish until it resolves like any other pending command

#### Scenario: A day whose payment was taken back finishes normally

- **WHEN** a bill was voided by `counter_unpay` earlier in the window and nothing else is pending
- **THEN** the day finishes without naming the unwound bill
