## ADDED Requirements

### Requirement: A channel's health line says whether its reads are working

A channel's health line SHALL answer whether that channel's reads are working.
A run that read the portal with its session and wrote its weeks SHALL count as
working even when a week it read would not reconcile, because that week asks the
owner on its own row in *what needs them*; the line SHALL then read as it would
after any working run, quiet or overdue. A run whose session was refused, or
whose response could not be understood, SHALL keep the line's fault word.

#### Scenario: A read that found a week to check is still a working read

- **WHEN** a channel's latest run read its weeks and one of them did not
  reconcile against the stated payout
- **THEN** the health line reads as quiet, the week is listed under what needs
  the owner, and the line does not say the channel is stuck

#### Scenario: Reads that stopped are still overdue

- **WHEN** a channel's latest run found a week to check and no read has happened
  since for longer than its cadence allows
- **THEN** the health line reads as overdue
