## ADDED Requirements

### Requirement: A counter that has just confirmed itself online retries its waiting work at once

When a counter page starts delivery after resolving its tablet and shift against
the server, it SHALL make every retrying command for that tablet eligible
immediately, rather than waiting out a retry delay recorded by an earlier page.
This SHALL NOT be treated as evidence that the backend is reachable; reachability
SHALL still change only on the outcome of a real request. A counter opened
without a server-confirmed session SHALL NOT shorten any retry delay.

#### Scenario: The counter is reloaded right after the network returns

- **WHEN** a counter holding commands that backed off while offline is reloaded once the server is reachable again
- **THEN** it resolves the tablet and shift first and then sends those commands at once, in dependency order, each resolving exactly once

#### Scenario: The counter is reopened while the server is still unreachable

- **WHEN** a counter holding backed-off commands is reopened from its resume record with no backend reachable
- **THEN** it sends nothing and leaves every recorded retry delay unchanged

#### Scenario: The first send after the wake gets no answer

- **WHEN** the immediate retry after a confirmed session receives no HTTP response
- **THEN** the command backs off again from its existing attempt count and the counter shows that it stopped sending
