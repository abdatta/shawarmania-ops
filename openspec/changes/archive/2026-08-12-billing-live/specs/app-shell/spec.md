## ADDED Requirements

### Requirement: Billing V1 gates expose only the appropriate live context

The gate registry SHALL expose live counter navigation only on a set-up tablet
holding a live shift. Personal Biller sessions SHALL retain their Employee and
staff navigation, and FA and SA personal sessions SHALL reach only their
authorised management surfaces.

#### Scenario: A Biller signs in on a personal phone
- **WHEN** a Biller authenticates outside tablet context
- **THEN** the shell presents their Employee and staff capabilities and not the live counter

#### Scenario: An eligible operator holds the shift on the tablet
- **WHEN** a Biller, that outlet's FA, or an SA holds an approved shift on the set-up tablet
- **THEN** the shell presents the billing-only counter context and preserves no personal-role pages in that tablet session
