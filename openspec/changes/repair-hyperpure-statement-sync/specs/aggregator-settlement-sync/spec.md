## ADDED Requirements

### Requirement: Automated restaurant identity uses the stateful mapping contract

Every automated operator flow that needs a restaurant identity SHALL resolve it
through `outlet_channel_restaurants`. The mapping SHALL use `state` as its
activation field, with `enabled` and `dormant` as its permitted values; it SHALL
NOT expose or query an `enabled` boolean column.

Statement parsing, owner-triggered reads, and reader session probes SHALL use
only mappings whose `state` is `enabled`. A dormant mapping SHALL remain
readable for audit but SHALL NOT cause automated work to start or use its
external reference.

#### Scenario: An enabled mapping permits the matching automated flow

- **WHEN** a statement parser, owner-triggered reader, or channel probe resolves
  an outlet's restaurant identity and an enabled mapping exists
- **THEN** it uses that mapping's `external_ref` for the matching outlet and
  channel

#### Scenario: A dormant mapping cannot start automated work

- **WHEN** the only mapping for an outlet and channel is dormant
- **THEN** the automated flow does not dispatch, ingest, or probe using that
  mapping

#### Scenario: The mapping activation state is queried correctly

- **WHEN** an automated mapping query is compiled against the generated schema
- **THEN** it queries `state = 'enabled'` and a query for an `enabled` boolean
  column is rejected
