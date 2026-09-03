## ADDED Requirements

### Requirement: Content payloads carry their discounts and their rounding

An order or payment content payload SHALL transmit every discount that produced
its total: for each, the source, the basis, the value in that basis and the
resulting paise, and for a menu discount the line it reduced. It SHALL transmit
the bill's rounding explicitly.

The boundary SHALL validate that the transmitted parts reconcile to the
transmitted totals — that the lines sum to the subtotal, that the discounts sum to
the transmitted discount, that the discount does not exceed the subtotal, that the
total is a whole number of rupees and at least one rupee, and that
`total = subtotal − discount + tax + rounding`. A payload failing any of these
SHALL be refused as malformed, and no order or bill SHALL be written.

#### Scenario: The parts do not reconcile

- **WHEN** a payload transmits a discount total that its own discount records do
  not sum to
- **THEN** the command is refused and nothing is written

#### Scenario: The total is not a whole rupee

- **WHEN** a payload transmits a total carrying paise
- **THEN** the command is refused

#### Scenario: The total is below the floor

- **WHEN** a payload transmits a total below one rupee
- **THEN** the command is refused

### Requirement: The boundary accepts the payload shape a till already queued

The command boundary SHALL accept both the payload shape that preceded discounts
and the shape that carries them, and SHALL treat the earlier shape as carrying no
discount records and no rounding.

A command captured by a till before this capability existed SHALL therefore
settle, exactly once, whenever that till reconnects — including after the till has
updated itself in the meantime.

The canonical JSON and hash rules SHALL be proved against both shapes by
cross-runtime vectors, because the client and the database are two implementations
of one rule and only a shared vector holds them together.

#### Scenario: A till that has been offline since before the release

- **WHEN** a till holding work captured under the earlier payload shape reconnects
  after the release
- **THEN** each command settles exactly once, with no discount and no rounding, and
  none is refused as malformed or as an unsupported schema

#### Scenario: A replay across the change

- **WHEN** such a command is replayed after it has already been accepted
- **THEN** it returns its original result and writes nothing further
