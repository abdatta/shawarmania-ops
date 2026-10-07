## ADDED Requirements

### Requirement: Content payloads carry how the order was served

An order or payment content payload SHALL transmit the order's type (dine-in,
takeaway or neither), its table number if any, and for every line whether it is
an item or packaging.

The boundary SHALL check these for shape: a known type or none, a table in range
and only with dine-in, at most one packaging line, and a packaging line carrying
no menu item, no category, and a discount of nothing or its whole total. It SHALL
check a new packaging line's price and name against the outlet's packaging charge
by the same rule, and with the same timing, as it checks a new menu line against
the menu.

The boundary SHALL NOT refuse a type or a table because the outlet does not
currently offer it.

#### Scenario: A setting changed while a tablet was offline

- **WHEN** a dine-in order captured offline arrives after the owner stopped offering dine-in
- **THEN** it is recorded as dine-in

#### Scenario: Two packaging lines

- **WHEN** a payload carries two packaging lines
- **THEN** the command is refused and nothing is written

## MODIFIED Requirements

### Requirement: The boundary accepts the payload shape a till already queued

The command boundary SHALL accept every payload shape a till may still hold: the
shape that preceded discounts, the shape that carries them, and the shape that
carries how the order was served. It SHALL treat the first as carrying no discount
records and no rounding, and the first two as carrying no type, no table and only
item lines.

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
