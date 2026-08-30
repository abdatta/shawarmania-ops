## MODIFIED Requirements

### Requirement: A person can leave their counter from their own device

A person holding a live shift SHALL see it on their own phone and MAY choose
**Leave counter**. The confirmation SHALL distinguish this immediate remote stop
from ordinary Hand over at the tablet. Leaving takes effect at the database
immediately. The tablet stops exposing new work when it next learns the state,
while its device-level delivery continues.

#### Scenario: Ordinary handover

- **WHEN** one person is replacing another at the counter
- **THEN** the tablet recommends Hand over so the old shift stays live until the incoming person's approval opens the next shift atomically

#### Scenario: Offline tablet learns remote leave late

- **WHEN** the phone ends the shift while the tablet cannot receive the event
- **THEN** the phone says authority ended immediately, and later tablet commands are handled by the explicit after-departure contract rather than silently assigned to the next person

#### Scenario: Incoming operator signs in

- **WHEN** Priya opens a new shift after Rahul remotely left and Rahul's commands are still draining or flagged
- **THEN** Priya's new work belongs only to Priya, Rahul's records remain unchanged, and Priya receives no alert or acknowledgement task for Rahul's attribution exception
