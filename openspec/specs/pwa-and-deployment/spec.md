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

### Requirement: Updates are checked on launch and applied on the next load

The service worker registration SHALL check for a new version on every launch and apply a found update so the next load runs the new build. An update SHALL never force a reload mid-use, and a newly activated worker SHALL NOT take control of an already-open page.

#### Scenario: A deployed update reaches a cached client

- **WHEN** a new build is deployed and a client that cached the old build launches, then loads again
- **THEN** the second load runs the new build

#### Scenario: An update never disturbs an open session

- **WHEN** a new build is published while the app is open and in use
- **THEN** the running page is neither reloaded nor served assets from the new build

### Requirement: The running build is identifiable in the UI

The UI SHALL display a build version identifier (short commit SHA and build time) so the running build of any device can be read off-screen.

#### Scenario: Version visible on device

- **WHEN** any user opens the app shell
- **THEN** the build identifier is visible without developer tools

#### Scenario: Built outside a version-control checkout

- **WHEN** the app is built from a source copy with no commit history
- **THEN** the build identifier degrades to an explicit unknown marker rather than failing the build

### Requirement: Push to main migrates then deploys, and only after verification passes

A push to the `main` branch SHALL produce a static production deployment of the
app at a stable URL, with immutable hashed assets so a rollback is redeploying a
previous build. That deployment SHALL be gated on the whole verification suite
continuous integration runs — including its database and authenticated
end-to-end jobs — which SHALL complete successfully before anything is
published. A failure anywhere in that suite SHALL stop the deployment with the
previously published deployment still live. Producing a build artifact SHALL
NOT be treated as permission to publish it: an artifact built for a commit that
fails verification SHALL never reach the stable URL.

After verification succeeds on a push, continuous integration SHALL apply every
pending forward migration to the production database before publishing the
static bundle. Publication SHALL depend on that migration job: a missing
credential, rejected migration, failed backfill assertion or connection failure
SHALL leave the previously published frontend live. The migration job SHALL use
a production-database environment secret and SHALL run migration push only; it
SHALL NOT reset the hosted database, apply seed data, push local configuration
or expose a service-role key.

The migration SHALL run before the new frontend, so every migration committed
with application code SHALL remain compatible with the previously published
frontend for that short ordering window. It SHALL also be possible to trigger
the same gated deployment manually for a chosen earlier commit. That manual
frontend rollback SHALL NOT reverse or reapply production migration history,
because released migrations are forward-only.

#### Scenario: Deployment on push

- **WHEN** a commit lands on `main` and the whole verification suite passes for
  it
- **THEN** the hosting platform builds and publishes it, and the stable URL
  serves the new build identifier
- **AND** every migration in that commit is recorded in production before the
  new build is published

#### Scenario: A commit that compiles but fails verification does not reach users

- **WHEN** a commit lands on `main` whose bundle compiles but which fails any
  job of the verification suite
- **THEN** no deployment is produced, even though the bundle built successfully
- **AND** the stable URL continues to serve the previously published build
  identifier

#### Scenario: A production migration fails

- **WHEN** verification passes but a pending production migration cannot be
  applied completely
- **THEN** the static artifact is not published
- **AND** the previous frontend remains live against the unchanged or
  transactionally rolled-back production schema

#### Scenario: A commit has no pending migration

- **WHEN** verification passes and production already contains every migration
  in the commit
- **THEN** the migration job succeeds without changing data and publication
  continues

#### Scenario: Rollback redeploys an earlier commit

- **WHEN** a deployment is triggered manually for an earlier commit
- **THEN** that commit is verified again and redeployed
- **AND** the stable URL serves that earlier build identifier
- **AND** the current forward production migration history is left untouched

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
