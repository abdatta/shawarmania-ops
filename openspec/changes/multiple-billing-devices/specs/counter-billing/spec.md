## ADDED Requirements

### Requirement: Shift summaries distinguish device and outlet scope
The counter's current-shift summary SHALL show commands and payments attributable to that device's current grant. Authorized FA/SA history MAY aggregate the outlet and SHALL identify the originating and payment devices where accountability requires it.

#### Scenario: Two counters operate one outlet
- **WHEN** each device has taken payments during its current grant
- **THEN** each counter sees its own shift totals while authorized outlet history reconciles both without double counting
