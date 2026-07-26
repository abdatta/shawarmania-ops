# PWA And Deployment

## Purpose

Guarantees that the app reaches a device and keeps working there. It is installable to a home screen, its shell opens with no network, a new build reaches a device that has cached an old one without interrupting whoever is mid-shift, and the build a device is running can be identified without touching it. It also holds the constraints of static hosting with no rewrite rules, which the app must absorb rather than assume away.

## Requirements

### Requirement: The app is installable as a PWA

The app SHALL ship a web app manifest with icons and metadata such that it can be installed to the home screen of an Android device and launches standalone.

#### Scenario: Install on Android

- **WHEN** the deployed app is opened in Chrome on an Android phone and installed
- **THEN** it launches from the home screen standalone, without browser chrome

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

### Requirement: Push to main deploys

A push to the `main` branch SHALL produce a static production deployment of the app at a stable URL, with immutable hashed assets so a rollback is redeploying a previous build.

#### Scenario: Deployment on push

- **WHEN** a commit lands on `main`
- **THEN** the hosting platform builds and publishes it, and the stable URL serves the new build identifier

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

Where the hosting platform cannot rewrite unmatched paths to the shell, the build SHALL emit a copy of the app shell that the platform serves for unmatched paths, so a deep link boots the app and is routed client-side.

#### Scenario: A deep link is opened directly

- **WHEN** a URL that matches no static file is requested from the deployment
- **THEN** the app shell is served, and the app renders the route for that URL rather than a hosting error page

#### Scenario: The fallback matches the shell

- **WHEN** the production build completes
- **THEN** the fallback document is byte-identical to the entry document, so both boot the same build
