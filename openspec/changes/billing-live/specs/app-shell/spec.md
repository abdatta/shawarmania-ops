## ADDED Requirements

### Requirement: Billing V1 gates expose only the appropriate live context
The gate registry SHALL expose live counter navigation only in an enrolled billing-device context with a valid daily operator grant. Personal Biller sessions SHALL retain Employee/staff navigation, and FA/SA personal sessions SHALL reach only their authorized management and recovery surfaces.

#### Scenario: Biller signs in on a personal phone
- **WHEN** a Biller authenticates outside an enrolled billing-device context
- **THEN** the shell presents their Employee/staff capabilities and does not present the live counter

#### Scenario: Eligible operator signs in on the enrolled device
- **WHEN** a Biller, that outlet's FA, or an SA authenticates on the registered billing device
- **THEN** the shell presents the billing-only counter context and does not preserve personal-role pages in that device session
