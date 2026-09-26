## MODIFIED Requirements

### Requirement: Demo fixtures include the unconfigured states, not only the finished one

Demo fixtures SHALL include the people states an admin actually has to
recognise and repair: at least one account with a migration placeholder address
(cannot be invited until it is corrected), at least one with an invite
outstanding (activated by nobody yet), at least one person holding no live
assignment (formerly "departed" — off every staff list, history intact), at
least one whose assignment at one outlet has ended while another continues, and
at least one deactivated person who still holds a live assignment.

#### Scenario: The Team surface demonstrates every unfinished state

- **WHEN** a demonstrator opens the Team surface in demo mode
- **THEN** the placeholder-address, invite-outstanding, no-assignment,
  one-assignment-ended and deactivated states are all present and each states
  what is wrong and what to do next
