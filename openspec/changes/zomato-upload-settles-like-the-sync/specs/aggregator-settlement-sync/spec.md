## ADDED Requirements

### Requirement: A Zomato week is final only once Zomato calls it PAID

For Zomato, the operator's label that makes a closed cycle final SHALL be the
payout status `PAID`. A closed cycle in any other status, including `TO BE PAID`
and any status the reader has not seen before, SHALL be written provisional with
its order-level figures and no stated payout, and SHALL NOT be reconciled. The
reader SHALL keep re-reading such a cycle until it settles, even if a later cycle
closes first.

#### Scenario: A closed but unpaid week does not raise a false dispute

- **WHEN** a Zomato week has closed, its stated payout already reflects a
  deduction, and its deduction list does not yet show that deduction
- **THEN** the week's days are provisional with their commission and net, no
  reconciliation runs, and the channel does not read as failing

#### Scenario: The week settles after payment

- **WHEN** Zomato marks that week PAID and its deductions are listed
- **THEN** the next run settles and reconciles it
