## REMOVED Requirements

### Requirement: An alert carries a category, a priority, a subject and a message

**Reason**: The whole capability is withdrawn (owner decision, 2026-08-31). It
was built as demonstration in #7 and never promoted; no change was ever
scheduled to give it live data, and the owner reviewed the app against the
business as it actually runs and concluded the alert thread is not something
Shawarmania is going to operate. What an outlet is raising is read on that
outlet's card instead, derived from rows that already exist.

The thinking is preserved as a todo rather than discarded, and
`outlet_alerts` / `alert_responses` keep their policies and their isolation
coverage — the surfaces go, the tables do not.

### Requirement: An alert moves through a defined sequence of statuses

**Reason**: Withdrawn with the capability above.

### Requirement: Alerts carry a thread of responses

**Reason**: Withdrawn with the capability above.

### Requirement: The owner reads alerts across outlets; a manager reads only their own

**Reason**: Withdrawn with the capability above. The isolation property it
described is not lost: it lives in `outlet-tenancy`, which still enumerates
`outlet_alerts` in its coverage.

### Requirement: Priority is conveyed by more than colour

**Reason**: Withdrawn with the capability above. The design-system rule it was an
instance of — colour is never the only signal — is stated in `design-system` and
is unaffected.
