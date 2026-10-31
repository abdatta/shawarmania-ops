# Delta: pwa-and-deployment

The build stamp names the probe, an earlier verified build can be republished in
minutes, and an unverified hotfix can publish in minutes with the owner's approval.
Staging exists, every push lands there first, and `main` moves only by an
owner-approved promotion of a commit staging verified. Design D9, D16, D17, D19,
D20. How a turned change gate is applied — through
the existing update path — is specified in `change-gates`.

## MODIFIED Requirements

### Requirement: The running build is identifiable in the UI

The UI SHALL display a build version identifier (short commit SHA and build time) so the running build of any device can be read off-screen. It SHALL be in the account menu, and at the foot of every screen without an account menu — the signed-out screens, the counter tablet, its setup and shift-start screens, and the kitchen tablet — and of the Change gates pages (owner, 2026-10-12). It SHALL read as it always has. It SHALL be a button, and a tap SHALL copy its line with the **build code** in place of the short SHA — the short SHA, a middle dot, then the codes of every declared gate the page loaded with on, in declaration order, joined by dashes, e.g. *Build c1f19c32·DT-KR · 13 Oct 2026, 03:15 am*, or the short SHA alone when none is on — and SHALL show and select that line instead, claiming no copy, where the clipboard is refused (owner, 2026-10-13).

#### Scenario: Version visible on device

- **WHEN** any user opens the app shell
- **THEN** the build identifier is visible without developer tools, at the foot of
  the screen or in its account menu

#### Scenario: Built outside a version-control checkout

- **WHEN** the app is built from a source copy with no commit history
- **THEN** the build identifier degrades to an explicit unknown marker rather than failing the build

#### Scenario: Tablets show their build

- **WHEN** a counter or kitchen tablet shows its board, its shift-start screen or
  its setup screen
- **THEN** the build identifier is at the foot of the screen, and on the counter it
  takes no height from the till

#### Scenario: A phone page with an account menu has no second stamp

- **WHEN** an everyday phone page with an account menu is open
- **THEN** no build identifier is drawn at its foot

#### Scenario: The build code names the gates a page runs

- **WHEN** a page loads with the gates coded *DT* and *KR* on, and its build
  identifier is tapped
- **THEN** the identifier itself reads *Build <sha> · <time>* as always, and the
  clipboard holds *Build <sha>·DT-KR · <time>*

#### Scenario: Nothing on, the build alone

- **WHEN** a page loads with no gate on, and its build identifier is tapped
- **THEN** the clipboard holds *Build <sha> · <time>*

## ADDED Requirements

### Requirement: A verified build can be republished without re-running the suite

A manually dispatched **Republish** workflow SHALL take one commit SHA, SHALL first
confirm through the GitHub API that a Deploy run for exactly that commit concluded
successfully, and SHALL stop with a sentence saying so if none did. It SHALL then
build that commit and publish it to Pages, sharing Deploy's publication
concurrency group. It SHALL NOT apply migrations or deploy Edge Functions, so the
forward schema stays, which the migration lint makes safe for an earlier bundle.
Apart from Republish and Hotfix, no workflow SHALL publish to production a commit the
verification suite has not passed — in Deploy's own run or in a Staging run for the
same commit — and the workflow written during the 12 October incident, which builds and
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

A manually dispatched **Hotfix** workflow SHALL take a commit SHA on `stage`, of
which `main` is an ancestor, and a reason, and SHALL list every commit it would
carry onto `main`. It SHALL run a short gate — lint, typecheck, unit tests and the production
build — and SHALL then apply forward migrations, deploy Edge Functions and publish,
in that order, exactly as Deploy orders them, and SHALL then fast-forward `main` to
the SHA. Every job that migrates, deploys or
publishes SHALL run in a GitHub environment whose required reviewer is the owner,
so that nothing reaches production until the owner approves that run. The browser
and database suites are what it skips; because the commit is on `main`, Deploy
SHALL still run the full suite on it.

Publication SHALL never overlap: Deploy, Republish and Hotfix SHALL share one
concurrency group on their publishing jobs, and the group SHALL NOT span Deploy's
verification, so a hotfix does not wait behind a running suite.

#### Scenario: A hotfix waits for the owner

- **WHEN** an agent dispatches Hotfix for a commit
- **THEN** the short gate runs, and nothing is migrated, deployed, published or
  pushed to `main` until the owner approves the run in GitHub

#### Scenario: A hotfix does not queue behind Deploy

- **WHEN** Hotfix is dispatched while Deploy is running its verification suite
- **THEN** the hotfix publishes as soon as its own gate passes and the owner
  approves, without waiting for that suite

#### Scenario: The full suite still judges a hotfix

- **WHEN** a hotfix commit has been published
- **THEN** Deploy, finding no successful Staging run for that commit, runs the full
  suite on it, and a red result is visible on that commit

### Requirement: Staging is a separate copy of the system that only the owner can enter

A staging environment SHALL exist as a Supabase project separate from production's,
in a Supabase account that holds no production project, on the same plan and
compute size as production, with its own frontend address. It SHALL hold synthetic
data only, generated at production's row counts; no production row SHALL be copied
into it except a trading outlet's menu, which is public, and nothing about a person
ever. It SHALL hold no third-party secret — no aggregator credential, no SMS key,
no receipt Worker URL or secret — and every Edge Function and scheduled job that
reaches outside the project SHALL do nothing or fail closed there. Only the owner
SHALL create staging accounts. A staging build SHALL show a ribbon reading
**Staging** across the top-left corner of every surface and in every role, named
*Staging · not a real outlet* to assistive technology and letting every tap through,
and a production build SHALL not.

#### Scenario: A bill on staging texts nobody

- **WHEN** a bill with a phone number is paid on staging
- **THEN** no SMS is sent and no receipt request leaves the project

#### Scenario: Staging cannot be mistaken for the counter

- **WHEN** any role opens any surface of a staging build
- **THEN** the staging ribbon is visible, and a production build of the same commit
  shows none

#### Scenario: Staging tooling refuses production

- **WHEN** the staging seed or reset is pointed at a URL whose project reference is
  production's
- **THEN** it stops before connecting, saying so

### Requirement: Every push reaches staging first, and production only by promotion

A push to `stage` SHALL run the verification suite and, when it passes, migrate
staging, deploy Edge Functions to staging, publish the staging build and run the
staging smoke suite. `main` SHALL refuse direct pushes, force pushes and deletion
from every actor except one deploy key, which only the Promote and Hotfix workflows
hold, in environments whose required reviewer is the owner. A manually dispatched
**Promote** workflow SHALL take a SHA, or given none SHALL take the newest commit on
`stage` above `main` with a successful Staging run, SHALL stop with one sentence unless a Staging
run for exactly that SHA succeeded and `main` is its ancestor, SHALL list every
commit and change folder it would carry, and after the owner approves SHALL
fast-forward `main` to that SHA without creating a commit. Deploy SHALL skip the
verification suite for a SHA whose Staging run succeeded and run it for any other.

#### Scenario: Production runs the commit staging ran

- **WHEN** the owner approves a Promote of a SHA staging verified
- **THEN** `main` points at that SHA, Deploy publishes it without re-running the
  suite, and the build stamp on production equals the one on staging

#### Scenario: A docs-only tip waits for the next promotion

- **WHEN** `stage`'s newest commit changes only documentation, so no Staging run
  verified it, and the owner runs Promote without a SHA
- **THEN** Promote takes the newest commit beneath it that Staging verified, and its
  summary lists the docs-only commit as left on `stage`

#### Scenario: An untried commit cannot be promoted

- **WHEN** Promote is given a SHA with no successful Staging run, or one `main` is
  not an ancestor of
- **THEN** it stops before asking for approval, saying which check failed

#### Scenario: A direct push to main is refused

- **WHEN** anybody pushes to `main` directly
- **THEN** GitHub refuses the push, and production does not change
