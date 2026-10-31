## MODIFIED Requirements

### Requirement: Tablets report their health without content

Every request the app
makes through its Supabase client SHALL be counted by resource — the table, RPC,
Edge Function or auth endpoint — with whether it failed (a network error, a
timeout, a 5xx, a 408 or a 429) and how long it took, over a sixty-second window.
Query strings, headers and bodies SHALL never be read for it. The counting SHALL
never fail a request.

The counter and the kitchen SHALL report, once a minute and once
immediately after boot, their build, the gates the page booted with on, and the
window's requests, failures and slowest duration, through `report_device_health`,
which SHALL take the device and outlet from the caller's own device session. A
failed report SHALL be ignored.

#### Scenario: A report carries no customer data

- **WHEN** the counter looks up a customer by phone number
- **THEN** the report names the resource it called and nothing of the number
