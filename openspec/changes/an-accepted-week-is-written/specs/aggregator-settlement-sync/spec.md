## MODIFIED Requirements

### Requirement: A disputed week may be re-checked or accepted with its difference recorded, and by nothing that conceals it

A disputed week SHALL offer the owner re-checking it and accepting it, and SHALL NOT offer an action that stores figures without accounting for the difference that made it disputed.

**Re-checking** SHALL read the cycle from the aggregator again and reconcile it again. Where it now reconciles, the cycle SHALL be written and its days settled. Aggregator figures have been observed to change after a payout, so most disputes are expected to resolve this way.

**Accepting** SHALL write the aggregator's own per-order figures and SHALL record the remaining difference as its own record against the outlet and the cycle, attributed to no business date, readable as an unexplained settlement difference. The accepted difference SHALL be recorded with the account that accepted it and the moment they did. The acceptance SHALL be recorded against the week when the owner accepts it, and a read SHALL be started at once; that read and every later one SHALL honour it.

An acceptance SHALL hold only for the figures that were accepted. A later read that finds different figures for the week, or finds that it now reconciles, SHALL withdraw the acceptance and its recorded difference, and SHALL reconcile or dispute the week afresh.

Accepting SHALL NOT adjust any day's figures to close the gap, because a difference spread silently across days would leave every day slightly wrong and the discrepancy unfindable.

Only the owner SHALL be able to accept a week.

#### Scenario: Re-checking resolves the dispute

- **WHEN** the owner re-checks a disputed week and the aggregator's figures now reconcile
- **THEN** the cycle is written, its days read as settled, and no difference is recorded

#### Scenario: Accepting records the gap rather than hiding it

- **WHEN** the owner accepts a disputed week whose computed total is short of the stated payout
- **THEN** the aggregator's per-order figures are written, the remaining difference is stored against the outlet and cycle as an unexplained settlement difference with who accepted it and when, and no day's figures are adjusted

#### Scenario: Accepting takes effect on the read it starts

- **WHEN** the owner accepts a disputed Swiggy week computed at −₹173.16 against a stated payout of ₹0
- **THEN** the read started by the acceptance settles the week's days, records ₹173.16 as an unexplained settlement difference attributed to the owner, the run reads ok, and the week no longer counts as waiting for the owner

#### Scenario: Figures that move after acceptance

- **WHEN** a week was accepted and a later read finds a different computed total or stated payout for it
- **THEN** the acceptance and its recorded difference are withdrawn, and the week is reconciled or disputed afresh without the run being refused

#### Scenario: Someone other than the owner tries to accept

- **WHEN** a Franchise Admin, a Biller, an Employee, a deactivated owner or an anonymous caller requests an acceptance
- **THEN** the database refuses it and records nothing

#### Scenario: The gap cannot be silently absorbed

- **WHEN** a disputed week is presented to the owner
- **THEN** no offered action writes the cycle without either reconciling it or recording the difference

## ADDED Requirements

### Requirement: A week that ended before an outlet's sync began is not recorded against it

A read SHALL NOT record a week, its days, its deductions or its reconciliation against an outlet when the whole week ends before that outlet's sync for the channel began. A week that straddles the start SHALL be reconciled whole and SHALL write only its days from the start onward.

#### Scenario: A feed moved to a new outlet

- **WHEN** a channel's feed is moved to an outlet whose sync begins on 1 Oct and the next read covers weeks ending 27 Sep and 30 Sep
- **THEN** neither week is recorded against the new outlet, the outlet that traded them keeps its own records of them, and the run is not a failure

### Requirement: A sync request the system does not recognise is refused

A request to the sync that names an action the system does not offer SHALL be refused with a reason, and SHALL NOT be carried out as any other action.

#### Scenario: An unknown action

- **WHEN** a request asks the sync for an action other than a read or a reconnect
- **THEN** it is refused and no read is started
