## ADDED Requirements

### Requirement: A phone-shell page is one centred column on a wide screen

Every page in the owner's, a manager's and a staff member's shell SHALL keep its
content within one centred column 672px wide (`max-w-2xl`) however wide the
window is. Analytics pages SHALL keep theirs within 1024px (`max-w-5xl`). Content
rendered above a page's own column SHALL keep to the same width. A table wider
than the column SHALL scroll sideways inside it rather than widen the page. The
counter and kitchen tablets are not phone-shell pages.

#### Scenario: Billing on a laptop

- **WHEN** the owner opens Billing in a 1600px-wide window
- **THEN** the bills, the search and the day's figures sit in the centred column, with margin on both sides

#### Scenario: Analytics on a laptop

- **WHEN** the owner opens Sales in a 1600px-wide window
- **THEN** the charts are wider than the standard column and no wider than 1024px

#### Scenario: A page added to the rail

- **WHEN** a new page is added to a role's rail without a width cap
- **THEN** `e2e/page-width.spec.ts` fails on it
