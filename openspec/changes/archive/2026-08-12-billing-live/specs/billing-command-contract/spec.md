## ADDED Requirements

### Requirement: Tender correction is an atomic append-only billing command

The system SHALL expose a versioned, idempotent payment-correction command that
accepts a bill identity, the effective revision being replaced and one exact
Cash/UPI replacement allocation set. The command SHALL lock the bill and SHALL
atomically validate authority, outlet and originating-tablet scope, settled state,
unchanged total, allocation arithmetic, current revision and the five-minute
deadline before appending the correction header, its allocations and its compact
command receipt, or SHALL append none of them.

The bill and its original payment rows SHALL remain immutable. Every correction
SHALL receive a new client UUID and a sequential revision for that bill, and SHALL
retain command, tablet, shift, operator and immutable creation-time attribution.
An exact replay SHALL return the same accepted revision. A stale expected revision,
an ineligible tablet, an expired creation time or invalid arithmetic SHALL be a
classified permanent refusal rather than an update or a retryable success.

Eligibility SHALL be decided by the database from the original stored `paid_at`
and the correction envelope's immutable client creation time. The creation time
SHALL be on or after `paid_at`, before `paid_at + 5 minutes`, and historically
valid for the referenced tablet shift. Arrival after the deadline SHALL NOT by
itself invalidate a correction that was durably created inside the window.

#### Scenario: A valid correction is accepted
- **WHEN** the originating tablet submits an exact changed allocation against the current revision inside the five-minute window
- **THEN** one new attributed revision and its allocations are appended, the same bill remains settled, and the original rows are unchanged

#### Scenario: The same correction response is lost
- **WHEN** an accepted correction is replayed with the same UUID, version and canonical payload hash
- **THEN** the original correction revision is returned and no second revision or allocation row is created

#### Scenario: Two edits start from the same revision
- **WHEN** one correction advances the bill and another command still names the superseded effective revision
- **THEN** the second command is refused as stale and does not overwrite or append after the newer choice

#### Scenario: Correction time is outside the bill window
- **WHEN** a correction creation time is before the bill's `paid_at`, at or after `paid_at + 5 minutes`, or outside its referenced shift
- **THEN** the database refuses it permanently regardless of what countdown the client displayed

#### Scenario: Another outlet or tablet attempts correction
- **WHEN** an authenticated device hand-crafts a correction for a bill it did not originate
- **THEN** the database refuses it and exposes no allocation or audit row across the outlet boundary

#### Scenario: Replacement allocations do not match the bill
- **WHEN** the replacement is empty, duplicated by method, non-positive, unsupported or does not sum exactly to the immutable bill total
- **THEN** the transaction appends no correction, allocation or accepted command effect
