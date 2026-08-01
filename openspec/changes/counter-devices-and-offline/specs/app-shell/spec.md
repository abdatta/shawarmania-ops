## ADDED Requirements

### Requirement: Registered-device context overrides personal-role navigation

The application SHALL, when a browser holds a valid counter-device machine session,
render the Counter shell and only device, billing, shift, history, sync,
and recovery surfaces permitted there. It SHALL NOT render personal Employee,
FA, or SA navigation based on the person who opened the billing grant.

#### Scenario: Super Admin opens a grant on the tablet
- **WHEN** an SA authenticates as the operator of a registered device
- **THEN** Counter shell remains mounted and no owner or manager route becomes reachable

#### Scenario: Personal device has a Biller account
- **WHEN** the same Biller signs in on an unregistered personal browser
- **THEN** their Employee-capable personal shell renders instead of Counter shell
