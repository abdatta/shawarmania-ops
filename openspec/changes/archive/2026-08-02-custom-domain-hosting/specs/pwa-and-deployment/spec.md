## ADDED Requirements

### Requirement: Production uses the Shawarmania operations hostname

The canonical production origin SHALL be `https://ops.shawarmania.in/`.
Production SHALL be built with `/` as its base, and the DNS record, GitHub Pages
custom-domain setting, and deployed `CNAME` artifact SHALL name that same host.
The landing page at `shawarmania.in` SHALL remain independently hosted and
unchanged by the operations deployment.

#### Scenario: The production root serves the PWA

- **WHEN** a user opens `https://ops.shawarmania.in/`
- **THEN** GitHub Pages serves the root-base production build over HTTPS, with
  its scripts, styles, manifest, icons, and service worker on the same origin

#### Scenario: A production deep link boots the app

- **WHEN** a user directly opens a valid nested route at
  `https://ops.shawarmania.in/`
- **THEN** the Pages fallback boots the shell and the router interprets the path
  relative to `/`

#### Scenario: The landing page is not displaced

- **WHEN** the operations hostname is configured
- **THEN** the apex `shawarmania.in` and its `www` alias continue serving the
  separate landing-page deployment
