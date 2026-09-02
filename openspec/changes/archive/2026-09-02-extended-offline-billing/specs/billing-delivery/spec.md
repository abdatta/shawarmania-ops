## ADDED Requirements

### Requirement: Capture continues across a deliberate restart inside one shift

Within a shift already approved online and not yet expired, the delivery store
SHALL keep accepting commands after the application is closed, updated or
reloaded with no backend reachable, and SHALL retain them until a real response
returns. Continuous capture SHALL NOT depend on the tab or the application
staying open.

#### Scenario: The tablet is restarted twice during one outage

- **WHEN** the counter accepts work, is closed and reopened, accepts more, is reloaded again, and the backend is unreachable throughout
- **THEN** every envelope, its dependency edges and its local resolutions survive both restarts and drain in order when a response returns

#### Scenario: The outage lasts the rest of the shift

- **WHEN** the tablet resumes offline and accepts commands until its shift expires
- **THEN** all of them remain durable and dependency-ordered, and none is discarded by expiry

### Requirement: Delivery outcomes are unchanged by how long the work waited

A command captured after an offline cold start SHALL resolve through the same
outcomes as one captured during a transient drop: accepted, exact replay,
correctable refusal offering correction, or terminal refusal offering discard
alone, each retaining its refused trace and naming the order the operation
identified. Age SHALL NOT convert a refusal into a success or a success into a
retry.

#### Scenario: A long-delayed payment is refused as not open

- **WHEN** a payment captured hours earlier reaches a server whose order was cancelled by a manager in the meantime
- **THEN** it moves to needs attention as a terminal refusal naming that order, offers discard and not correction, and its descendants stop while unrelated chains keep draining
