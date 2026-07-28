## MODIFIED Requirements

### Requirement: Deep links resolve on static hosting without rewrite rules

Where the hosting platform cannot rewrite unmatched paths to the shell, the build SHALL emit a copy of the app shell that the platform serves for unmatched paths, so a deep link boots the app and is routed client-side. A deep link's query string SHALL survive that fallback, so a link that carries a parameter arrives with it intact.

#### Scenario: A deep link is opened directly

- **WHEN** a URL that matches no static file is requested from the deployment
- **THEN** the app shell is served, and the app renders the route for that URL rather than a hosting error page

#### Scenario: The fallback matches the shell

- **WHEN** the production build completes
- **THEN** the fallback document is byte-identical to the entry document, so both boot the same build

#### Scenario: A deep link carrying a query string keeps it

- **WHEN** a deep link with a query string is opened from the deployment and served through the fallback
- **THEN** the app reads that query string and acts on it
