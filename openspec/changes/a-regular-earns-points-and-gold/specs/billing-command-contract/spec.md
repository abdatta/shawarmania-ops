## ADDED Requirements

### Requirement: A bill-level discount in a payload names its source

The order and payment content payloads SHALL carry, on each bill-level discount,
its source: the biller or points. A payload that names none SHALL be read as the
biller's.

#### Scenario: A points discount is sent
- **WHEN** a till sends an order carrying 20 points
- **THEN** the order and the bill it becomes record a points discount of ₹20

## MODIFIED Requirements

### Requirement: The boundary accepts the payload shape a till already queued

The command boundary SHALL accept every payload shape a till may still hold: the
shape that preceded discounts, the shape that carries them, the shape that carries
how the order was served, and the shape that names each bill discount's source.
It SHALL treat the first as carrying no discount records and no rounding, the
first two as carrying no type, no table and only item lines, and the first three
as carrying only the biller's bill discounts.

A command captured by a till before any of these capabilities existed SHALL
therefore settle, exactly once, whenever that till reconnects, including after
the till has updated itself in the meantime.

The canonical JSON and hash rules SHALL be proved against every accepted shape by
cross-runtime vectors, because the client and the database are two
implementations of one rule and only a shared vector holds them together.

#### Scenario: A till that has been offline since before the release

- **WHEN** a till holding work captured under an earlier payload shape reconnects
  after the release
- **THEN** each command settles exactly once, as that shape is read, and none is
  refused as malformed or as an unsupported schema

#### Scenario: A replay across the change

- **WHEN** such a command is replayed after it has already been accepted
- **THEN** it returns its original result and writes nothing further
