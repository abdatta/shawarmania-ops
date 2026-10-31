# PWA And Deployment

## Purpose

Guarantees that the app reaches a device and keeps working there. It is installable to a home screen, its shell opens with no network, a new build reaches a device that has cached an old one without interrupting whoever is mid-shift, and the build a device is running can be identified without touching it. It also holds the constraints of static hosting with no rewrite rules, which the app must absorb rather than assume away.
## Requirements
### Requirement: The app is installable as a PWA

The app SHALL ship a web app manifest with icons and metadata such that it can be installed to the home screen of an Android device and launches standalone.

#### Scenario: Install on Android

- **WHEN** the deployed app is opened in Chrome on an Android phone and installed
- **THEN** it launches from the home screen standalone, without browser chrome

### Requirement: The app exposes installation only when it is actionable

The app SHALL expose an app-owned installation action in public and real
application chrome when the current browser can complete either a native PWA
installation or the documented iOS Safari manual path. The action SHALL be
absent when the app is installed, the browser is unsupported or ineligible,
or the user is in demo mode.

#### Scenario: Native installation is offered

- **WHEN** an uninstalled browser reports native PWA installation capability
  on a public page or in a real role shell
- **THEN** the header shows an action named “Install Shawarmania Ops as an app”
- **AND** activating it opens the browser's native installation prompt at most
  once
- **AND** the action is removed after the browser records the user's choice

#### Scenario: Native capability survives sign-in navigation

- **WHEN** the browser reports native installation capability on a public page
  and the user then signs in and reaches a real role shell
- **THEN** the shell still shows the install action
- **AND** activating it opens the originally captured native prompt

#### Scenario: Installation elsewhere removes the action

- **WHEN** the browser reports that the PWA was installed through any
  installation surface
- **THEN** the app-owned install action is removed immediately

#### Scenario: An installed app offers no installation action

- **WHEN** the app is running in standalone or fullscreen display mode, or
  iOS reports that it is running standalone
- **THEN** no app-owned install action is rendered

#### Scenario: iOS Safari explains its manual path

- **WHEN** an uninstalled iPhone or iPad opens the app in Safari browser mode
- **THEN** the header shows the install action
- **AND** activating it explains Share, Add to Home Screen, Open as Web App and
  Add in that order
- **AND** it does not claim to have opened a native prompt

#### Scenario: Unsupported or ineligible browser offers no dead action

- **WHEN** the app is not installed but the browser supplies neither native
  installation capability nor the supported iOS Safari manual path
- **THEN** no app-owned install action is rendered

#### Scenario: Demo mode does not promote installation

- **WHEN** native or iOS installation capability exists while a demo shell is
  visible
- **THEN** the demo shell renders no app-owned install action

### Requirement: The install action fits persistent operational chrome

The install action SHALL use the app's semantic control tokens, SHALL remain a
44 px header control at rest, SHALL teach its visible “Install” label once per
tab, and SHALL remain understandable without motion. It SHALL appear before
theme and account actions on public and real phone chrome, and after sync
status but before theme and account actions on real counter chrome.

#### Scenario: The label teaches itself once

- **WHEN** installation first becomes actionable in a tab without reduced
  motion
- **THEN** the icon-sized action expands after three seconds to show “Install”
- **AND** it collapses again after five seconds
- **AND** navigating or reloading within that tab does not replay the timed
  reveal

#### Scenario: Hover and focus reveal the label

- **WHEN** the collapsed action receives pointer hover or keyboard focus
- **THEN** its visible “Install” label is revealed without changing its
  accessible name

#### Scenario: Reduced motion keeps a stable label

- **WHEN** installation is actionable and the user prefers reduced motion
- **THEN** the full “Install” label is visible without a width animation
- **AND** it remains stable until the action is used or ceases to be available

#### Scenario: The action remains usable in every supported shell layout

- **WHEN** the public header, a real phone shell and a real counter shell are
  rendered at their supported phone and landscape-tablet widths in either
  theme
- **THEN** the install action uses semantic primary styling
- **AND** it does not obscure, truncate or displace the shell's navigation,
  sync, theme or account controls

### Requirement: Icons are derived from a single committed master

Every icon the app serves SHALL be generated from one committed brand master by a repeatable script, so that changing the app's icon is replacing that master and re-running the script. The set SHALL include a maskable variant whose artwork survives being cropped to an arbitrary platform shape.

#### Scenario: Regenerating is deterministic

- **WHEN** the icon generation script is run twice without changing the master
- **THEN** the generated files are byte-identical

#### Scenario: The maskable icon survives cropping

- **WHEN** the maskable icon is cropped to a circle inscribed in its bounds
- **THEN** no part of the mark is cut off, and no transparent corner is exposed

#### Scenario: Replacing the mark replaces every size

- **WHEN** the master is replaced and the script is re-run
- **THEN** every derived size reflects the new artwork, including its background field

### Requirement: The app shell loads offline

A service worker SHALL precache the app shell so that, once installed, the app opens and renders its shell with no network connection.

#### Scenario: Offline launch

- **WHEN** the app has been loaded once and is then opened with the network off
- **THEN** the shell renders

#### Scenario: Automated offline coverage

- **WHEN** the end-to-end suite loads a production build, waits for the service worker to activate, disables the network, and reloads
- **THEN** the shell renders, and its self-hosted fonts render from cache rather than falling back to a system face

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

### Requirement: Push to main migrates then deploys, and only after verification passes

A push to `main` SHALL run the shared verification suite, apply pending forward
production migrations, deploy every Edge Function in the repository, and publish
the static frontend only after all three succeed. The production migration job
SHALL use an environment-scoped, project-specific database credential and SHALL
run migration push only. It SHALL NOT reset or seed production, push local
configuration, expose a service-role key, or reverse migration history during a
manual frontend rollback.

Edge Function deployment SHALL run after the migration and before publication,
so that the schema a function calls exists before the function does, and the
function a bundle calls exists before that bundle is served. It SHALL use a
credential scoped to its own environment and distinct from the database
credential. It SHALL NOT delete functions absent from the repository, and SHALL
NOT run during a manual frontend rollback.

Failure of either the migration or the function deployment SHALL leave the
previously published frontend live.

#### Scenario: Migration precedes publication

- **WHEN** a verified commit on `main` contains a pending migration
- **THEN** continuous integration applies it before Pages publishes that commit

#### Scenario: Functions precede publication and follow the migration

- **WHEN** a verified commit on `main` is published
- **THEN** every Edge Function in the repository is deployed after the migration
  completes and before Pages publishes that commit

#### Scenario: Migration failure blocks publication

- **WHEN** production migration cannot complete
- **THEN** the prior frontend remains published and a transactional migration
  leaves production unchanged

#### Scenario: Function deployment failure blocks publication

- **WHEN** an Edge Function cannot be deployed
- **THEN** the prior frontend remains published, rather than a bundle being
  served that calls a function production does not have

#### Scenario: Manual rollback preserves forward schema

- **WHEN** an earlier frontend commit is republished manually
- **THEN** production migration history remains at its current forward version,
  and no Edge Function is redeployed from the earlier commit

### Requirement: Every Edge Function deploys without being named

The release SHALL deploy every Edge Function present in the repository, derived
from the repository itself rather than from a list maintained by hand in a
workflow, a script or a document. Adding a function SHALL require no edit to any
enumeration for that function to reach production.

The project a function is deployed to SHALL be derived from the same
configuration the published bundle is built against, so that functions cannot be
deployed to a project other than the one the published application calls. The
deployment SHALL fail rather than proceed when that configuration is absent or
malformed.

#### Scenario: A newly added function reaches production

- **WHEN** a change adds an Edge Function directory and names it nowhere else
- **THEN** the next release deploys it, and the bundle that calls it is
  published only after it exists

#### Scenario: A function is never deployed to another project

- **WHEN** the configuration naming the project is absent or does not carry a
  resolvable project reference
- **THEN** the release fails without deploying any function, rather than
  deploying to a default project

#### Scenario: A function absent from the repository is left alone

- **WHEN** a function exists in the project and not in the repository
- **THEN** the release leaves it in place rather than deleting it

### Requirement: An Edge Function declares its gateway authentication

Every Edge Function in the repository SHALL carry an explicit gateway
authentication declaration in the committed Supabase configuration. Verification
SHALL fail when a function has none, because an undeclared function silently
receives the authenticating default, and a function written to serve a caller
who holds no token would then be refused at the gateway before it runs, while
appearing healthy.

#### Scenario: A function added without a configuration block fails verification

- **WHEN** an Edge Function directory exists with no matching configuration
  block
- **THEN** verification fails and names the function, on both the pull-request
  and the deployment path

#### Scenario: A token-free function is proved open after deployment

- **WHEN** a function declared to require no token is deployed
- **THEN** an unauthenticated request carrying an invalid payload is answered by
  the function's own refusal rather than by the gateway's authentication refusal

### Requirement: One verification definition serves both the pull request and the deployment gate

The checks a pull request is judged on and the checks a deployment is gated on SHALL
come from one definition, so neither can be relaxed without relaxing the
other, and SHALL run once per commit rather than once per workflow that wants
the answer.

#### Scenario: A check added for pull requests also gates deployment

- **WHEN** a verification step is added to the shared definition
- **THEN** both the pull-request run and the deployment gate run it

#### Scenario: A push to main verifies once

- **WHEN** a commit lands on `main`
- **THEN** the verification suite runs once for that commit, as the deployment's
  own gate

### Requirement: Production uses the Shawarmania operations hostname

The canonical production origin SHALL be `https://ops.shawarmania.in/`.
Production SHALL be built with `/` as its base, and the DNS record, GitHub
Pages custom-domain setting, and deployed `CNAME` artifact SHALL name that same
host. The landing page at `shawarmania.in` SHALL remain independently hosted
and unchanged by the operations deployment.

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

### Requirement: The app works under a deployment sub-path

The app SHALL function when served from a sub-path (a project site at `/<repo>/`) as well as from a domain root, with the path supplied at build time by a single `BASE_PATH` variable. No asset URL, router path, service-worker scope, or manifest field SHALL assume the root.

#### Scenario: Assets resolve under the sub-path

- **WHEN** the app is built with a sub-path base and loaded from that sub-path
- **THEN** every script, stylesheet, font, icon, and manifest request succeeds, with no request returning 404

#### Scenario: Routing respects the base

- **WHEN** the app is served from a sub-path
- **THEN** the router treats the sub-path as its root, and in-app links resolve beneath it

#### Scenario: Moving to a domain root needs no code change

- **WHEN** the app is built with `BASE_PATH=/`
- **THEN** it functions correctly served from a domain root, with no source file edited

#### Scenario: A base-path mistake fails before release

- **WHEN** the end-to-end suite runs
- **THEN** it exercises the app under the deployment sub-path, so a root-absolute asset URL fails there rather than on a device

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

### Requirement: Updates are discovered continuously and applied only when a reload costs nothing

The service worker registration SHALL check for a new version on launch, on
every return to the foreground, on regaining network connectivity, and at least
every five minutes while the app remains open. No cooldown SHALL suppress a
check, so closing and reopening the app is always a reliable way to force one.

A found update SHALL be activated so that the next load runs the new build, and
SHALL NOT reload the running page. The app SHALL own the reload decision rather
than leaving it to the service-worker registration library.

A recorded update SHALL be applied to the running page only from a state in
which the app reports network connectivity, no surface declares unsaved work,
no meaningful typed work is present, and no write is in flight. The app SHALL
re-confirm that state after a settle delay before reloading, so a reload cannot
land in the gap between two pieces of work. A detected update SHALL cause at
most one reload.

#### Scenario: A deployed update reaches a cached client

- **WHEN** a new build is deployed and a client that cached the old build
  launches, then loads again
- **THEN** the second load runs the new build

#### Scenario: An update never reloads an occupied session

- **WHEN** a new build is published while the app is open and holding typed
  work, an undelivered composition, or a write in flight
- **THEN** the running page is not reloaded
- **AND** the header offers an update action instead

#### Scenario: An unoccupied session takes the update by itself

- **WHEN** a new build is published while the app is open, online, with nothing
  typed, nothing declared unsaved, and no write in flight
- **THEN** the page reloads onto the new build without being asked

#### Scenario: Work clearing releases a deferred update

- **WHEN** an update is deferred because the page was occupied, and every
  condition then clears
- **THEN** the page reloads onto the new build without a further action
- **AND** it does not reload if the page becomes occupied again during the
  settle delay

#### Scenario: Discovery does not require a relaunch

- **WHEN** the app has been open for longer than the check interval, or returns
  to the foreground, or regains connectivity, and a new build was published in
  the meantime
- **THEN** the app discovers that build without being relaunched

#### Scenario: Reopening always checks

- **WHEN** the app is closed and opened again, however recently it last checked
- **THEN** it checks for a new build

#### Scenario: A disconnected device does not reload

- **WHEN** an update has been recorded and the app reports no network
  connectivity
- **THEN** the page is not reloaded, whatever else is true of it

#### Scenario: One update, one reload

- **WHEN** a single update has been detected and applied
- **THEN** the app reloads the page at most once for it

### Requirement: Work at risk from a reload is detected without per-surface registration

The app SHALL determine whether a reload would discard work by observing input
events at the document root, so that a surface added later is covered without
registering anything. Typed work SHALL count as meaningful when the person has
typed into three or more separate fields, or has entered a substantial amount of
text into any single field. A single short entry, such as a search term or a
filter, SHALL NOT defer an update.

Work that a reload would discard but that is not held in form controls SHALL be
declarable by the surface holding it. The bill composer SHALL declare it while
an order has lines, because an order is held in application state and renders no
form control that any generic measure could observe.

Writes in flight SHALL be counted once, at the adapter seam every write already
passes through, rather than per surface.

#### Scenario: A form written later is covered without being registered

- **WHEN** a surface containing form controls that was never made aware of
  update handling holds typing across several of its fields
- **THEN** an available update is deferred

#### Scenario: A single short entry does not defer an update

- **WHEN** the only typing on the page is one short entry, such as a search term
- **THEN** an available update is applied

#### Scenario: A long single entry defers an update

- **WHEN** one field holds a substantial amount of typed text, such as a written
  reason
- **THEN** an available update is deferred

#### Scenario: A composed order defers an update

- **WHEN** the bill composer holds an order with at least one line, and no form
  control on the page has been typed into
- **THEN** an available update is deferred

#### Scenario: A write in flight defers an update

- **WHEN** a write issued through the adapter seam has not yet settled
- **THEN** an available update is deferred

### Requirement: The header carries one app action, and installation outranks an update

The public header and the real phone and counter shells SHALL render at most one
app-owned action in their existing action slot. When installation is actionable
and an update is available at the same time, the header SHALL show the
installation action only. The update action SHALL appear when an update is
available and installation is not actionable, SHALL remain visible until that
update is applied rather than appearing and disappearing as the page changes,
and SHALL apply the update when activated. It SHALL use the same semantic
control styling, minimum touch target and accessible naming conventions as the
installation action.

Unlike the installation action, which teaches its label once per tab, the update
action SHALL keep reintroducing itself: its label SHALL expand and collapse on a
repeating cycle for as long as the update is unapplied, so that a device nobody
is watching still declares that it is holding a build back. Under reduced motion
the cycle SHALL NOT run and the label SHALL remain visible without animating.
The accessible name SHALL NOT change at any point in the cycle.

A demo shell SHALL render no app-owned action, and SHALL still take an available
update automatically when its page is unoccupied.

#### Scenario: Installation outranks an update

- **WHEN** the browser reports installation capability and an update is
  available at the same time
- **THEN** the header shows the installation action and no update action

#### Scenario: The update action appears when installation is not offered

- **WHEN** an update is available and installation is neither actionable nor
  applicable
- **THEN** the header shows an update action

#### Scenario: The update action does not flicker

- **WHEN** the update action is visible and the page's occupancy changes while
  the update is still unapplied
- **THEN** the action remains visible

#### Scenario: The update action keeps reintroducing itself

- **WHEN** the update action has been visible and unapplied for longer than one
  reveal cycle, without reduced motion
- **THEN** its label has expanded and collapsed more than once
- **AND** its accessible name has not changed

#### Scenario: Reduced motion states it without moving

- **WHEN** the update action is visible and the user prefers reduced motion
- **THEN** its label is visible and does not cycle

#### Scenario: Activating the action applies the update

- **WHEN** the update action is activated
- **THEN** the page reloads onto the new build

#### Scenario: Demo mode shows no action but still updates

- **WHEN** an update is available while a demo shell is visible
- **THEN** the demo shell renders no app-owned action
- **AND** the update is still applied automatically once the page is unoccupied

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
