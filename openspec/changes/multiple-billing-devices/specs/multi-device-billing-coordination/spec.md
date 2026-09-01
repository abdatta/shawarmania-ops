## ADDED Requirements

### Requirement: One outlet may hold several tablets, each removable alone

An outlet SHALL be able to hold more than one active counter tablet. Each SHALL
have its own machine identity, remain bound to exactly one outlet for its whole
life, and be removable without changing any other tablet, any live shift on
another tablet, or any human assignment.

#### Scenario: A second tablet is set up

- **WHEN** an authorised admin generates a setup code for an outlet that already has an active tablet, and it is redeemed on a second one
- **THEN** both tablets exist with distinct identities and each may hold its own shift at that outlet

#### Scenario: One tablet is removed

- **WHEN** an admin removes one of two tablets
- **THEN** that tablet is refused by the database at its next request, and the other keeps trading with its shift, its queue and its open orders untouched

#### Scenario: A tablet still reaches exactly one outlet

- **WHEN** either tablet hand-crafts a request for data at the other outlet
- **THEN** the database refuses it, unchanged by there being several tablets

### Requirement: Only the server coordinates tablets

Tablets SHALL NOT read, write or depend on one another's local state. Concurrent
submission SHALL be made safe by command UUID and canonical-hash idempotency,
row locks, outlet row-level security and transactional per-outlet bill numbering,
and by nothing on the client.

#### Scenario: Two tablets pay at the same moment

- **WHEN** both submit distinct valid payments concurrently and one response is lost and retried
- **THEN** two bills exist, the retry returns the original result and creates no third bill, and the two bills carry distinct sequential per-outlet numbers

#### Scenario: One tablet is offline while the other trades

- **WHEN** one tablet loses connectivity and the other stays online
- **THEN** each continues from its own store, and the online tablet neither drains nor can read the offline tablet's commands

### Requirement: Ownership survives having a neighbour

Ordinary revise, pay, cancel and preparation SHALL continue to require the
order's owning tablet even when several tablets share the outlet. Another tablet
MAY see the order on the outlet pipeline with its creator named and SHALL be
refused if it acts. Clearing an order stranded on an unusable tablet SHALL remain
a reasoned cancellation by that outlet's manager, and no transfer or recovery
path SHALL be introduced.

#### Scenario: The neighbouring tablet attempts payment

- **WHEN** an eligible operator on the other tablet submits payment for an order it does not own
- **THEN** the database refuses it, the order does not change, and no bill number is consumed

#### Scenario: A tablet becomes unusable mid-service

- **WHEN** one tablet is destroyed or removed with an open order on it
- **THEN** the outlet's manager cancels that order with a reason from their own device and the counter re-rings it, and nothing is transferred

### Requirement: Bill numbers follow acceptance, never chronology

Official bill numbers SHALL be allocated in successful server-acceptance order,
and SHALL remain unique, sequential per outlet and never reused. Ordered time,
payment time and their explicit business dates SHALL be retained and displayed
independently, and no surface SHALL use a bill number as a substitute for
accounting order.

#### Scenario: An offline tablet syncs after an online one

- **WHEN** an earlier payment captured offline reaches the server after a later payment made online
- **THEN** each keeps its own ordered and payment facts and business dates, while the numbers follow acceptance with no collision, no gap and no reuse

### Requirement: Every tablet that worked the date must confirm its own end of day

A business date SHALL NOT be ready while any tablet that held a shift or
submitted a command for it lacks a current end-of-day confirmation, holds a live
shift, or leaves an order open. One tablet's confirmation SHALL NOT satisfy
another's, and a later accepted command from a tablet SHALL invalidate that
tablet's confirmation.

#### Scenario: The second tablet has not reconnected

- **WHEN** one tablet has drained and confirmed while another participating tablet is still offline
- **THEN** the date remains not ready and names the outstanding tablet, without exposing its payloads or any customer fact

#### Scenario: A late command reopens the question

- **WHEN** a tablet confirms and a valid delayed command from it is accepted afterwards
- **THEN** its confirmation is invalidated and that tablet must confirm again before the date is ready
