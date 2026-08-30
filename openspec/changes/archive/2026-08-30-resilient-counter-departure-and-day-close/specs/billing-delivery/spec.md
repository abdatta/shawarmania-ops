## MODIFIED Requirements

### Requirement: Unsent work survives session and application lifecycle

Unsent and needs-attention envelopes SHALL survive the shift ending, cutover,
browser restart and compatible application updates while the tablet remains set
up. The enrolled device SHALL continue delivery and non-identifying telemetry
without a live shift. Replaying an immutable old envelope SHALL NOT grant the
tablet authority to create new work.

#### Scenario: Remote leave with queued work

- **WHEN** an operator leaves from their phone while their tablet retains unsent commands
- **THEN** the tablet returns to shift request when it learns the end, keeps draining those exact commands in the background, and exposes no new-work control until another shift is approved

### Requirement: Finish Day explains readiness before acting

Every Finish Day attempt SHALL open one readiness sheet, attempt delivery, and
obtain authoritative server state before enabling completion. It SHALL name each
hard blocker and its resolution. Unsent/retrying work, needs-attention work, open
orders, or inability to obtain server authority SHALL block completion.

The five-minute tender-edit window SHALL be advisory. An otherwise ready tablet
MAY review recent payments, keep billing, or finish immediately. Finishing SHALL
end that edit opportunity and SHALL NOT bypass a hard blocker.

#### Scenario: Recent payment is the only concern

- **WHEN** the latest payment remains editable but delivery, attention, orders and server authority are clear
- **THEN** the sheet offers Review recent payments, Finish day now and Keep billing without a countdown blocker

#### Scenario: Local commands are unresolved

- **WHEN** automatic drain leaves pending, retrying or needs-attention commands
- **THEN** the sheet names their categories, explains reconnect or local resolution, and does not offer Finish day now

#### Scenario: Finish deliberately ends correction authority

- **WHEN** the operator chooses Finish day now
- **THEN** the server ends the shift as day finished, records the device confirmation, and refuses any correction created after that instant
