# Delta: pwa-and-deployment

The build stamp names the probe, an earlier verified build can be republished in
minutes, and an unverified hotfix can publish in minutes with the owner's approval.
Design D9, D16, D17. How a turned release switch is applied — through
the existing update path — is specified in `release-switches`.

## MODIFIED Requirements

### Requirement: The running build is identifiable in the UI

The UI SHALL display a build version identifier (short commit SHA and build time) so the running build of any device can be read off-screen. While the `release-probe` switch is on for the page, the identifier SHALL be followed by `· probe`.

#### Scenario: Version visible on device

- **WHEN** any user opens the app shell
- **THEN** the build identifier is visible without developer tools

#### Scenario: Built outside a version-control checkout

- **WHEN** the app is built from a source copy with no commit history
- **THEN** the build identifier degrades to an explicit unknown marker rather than failing the build

#### Scenario: The probe is visible

- **WHEN** a page loads with the `release-probe` switch on
- **THEN** its build identifier reads `· probe` after the SHA, and a page loaded
  with it off does not

## ADDED Requirements

### Requirement: A verified build can be republished without re-running the suite

A manually dispatched **Republish** workflow SHALL take one commit SHA, SHALL first
confirm through the GitHub API that a Deploy run for exactly that commit concluded
successfully, and SHALL stop with a sentence saying so if none did. It SHALL then
build that commit and publish it to Pages, sharing Deploy's publication
concurrency group. It SHALL NOT apply migrations or deploy Edge Functions, so the
forward schema stays, which the migration lint makes safe for an earlier bundle.
Apart from Republish and Hotfix, no workflow SHALL publish without the verification
suite, and the workflow written during the 12 October incident, which builds and
publishes any ref with no check, SHALL be removed.

#### Scenario: A verified build returns in minutes

- **WHEN** the owner republishes the previous build's SHA, whose Deploy run
  succeeded
- **THEN** that build is published without the verification suite running, and
  production's migrations and Edge Functions are untouched

#### Scenario: An unverified commit is refused

- **WHEN** a SHA is given whose Deploy run did not succeed, or that has none
- **THEN** the workflow stops before building, saying the commit was never verified

### Requirement: An unverified hotfix publishes only after the owner approves it

A manually dispatched **Hotfix** workflow SHALL take a commit SHA on `main` and a
reason. It SHALL run a short gate — lint, typecheck, unit tests and the production
build — and SHALL then apply forward migrations, deploy Edge Functions and publish,
in that order, exactly as Deploy orders them. Every job that migrates, deploys or
publishes SHALL run in a GitHub environment whose required reviewer is the owner,
so that nothing reaches production until the owner approves that run. The browser
and database suites are what it skips; because the commit is on `main`, Deploy
SHALL still run the full suite on it.

Publication SHALL never overlap: Deploy, Republish and Hotfix SHALL share one
concurrency group on their publishing jobs, and the group SHALL NOT span Deploy's
verification, so a hotfix does not wait behind a running suite.

#### Scenario: A hotfix waits for the owner

- **WHEN** an agent dispatches Hotfix for a commit
- **THEN** the short gate runs, and nothing is migrated, deployed or published until
  the owner approves the run in GitHub

#### Scenario: A hotfix does not queue behind Deploy

- **WHEN** Hotfix is dispatched while Deploy is running its verification suite
- **THEN** the hotfix publishes as soon as its own gate passes and the owner
  approves, without waiting for that suite

#### Scenario: The full suite still judges a hotfix

- **WHEN** a hotfix commit has been published
- **THEN** Deploy runs the full suite on the same commit, and a red result is
  visible on that commit
