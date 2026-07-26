# pwa-and-deployment — delta

## ADDED Requirements

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

#### Scenario: Automated offline smoke test

- **WHEN** the Playwright suite loads the built app, waits for service worker installation, sets the browser context offline, and reloads
- **THEN** the shell renders

### Requirement: Updates are checked on launch and applied on the next load

The service worker registration SHALL check for a new version on every launch and apply a found update so the next load runs the new build. An update SHALL never force a reload mid-use.

#### Scenario: A deployed update reaches a cached client

- **WHEN** a new build is deployed and a client that cached the old build launches, then loads again
- **THEN** the second load runs the new build

### Requirement: The running build is identifiable in the UI

The UI SHALL display a build version identifier (short commit SHA and build time) so the running build of any device can be read off-screen.

#### Scenario: Version visible on device

- **WHEN** any user opens the app shell
- **THEN** the build identifier is visible without developer tools

### Requirement: Push to main deploys

A push to the `main` branch SHALL produce a static production deployment of the app at a stable URL, with immutable hashed assets so a rollback is redeploying a previous build.

#### Scenario: Deployment on push

- **WHEN** a commit lands on `main`
- **THEN** the hosting platform builds and publishes it, and the stable URL serves the new build identifier

### Requirement: The app works under a deployment sub-path

The app SHALL function when served from a sub-path (a GitHub Pages project site at `/<repo>/`) as well as from a domain root, with the path supplied at build time by a single `BASE_PATH` variable. No asset URL, router path, service-worker scope, or manifest field SHALL assume the root.

#### Scenario: Assets resolve under the sub-path

- **WHEN** the app is built with a sub-path base and loaded from that sub-path
- **THEN** every script, stylesheet, font, icon, and manifest request succeeds, with no request returning 404

#### Scenario: Routing respects the base

- **WHEN** the app is served from a sub-path
- **THEN** the router treats the sub-path as its root, and in-app links resolve beneath it

#### Scenario: Moving to a domain root needs no code change

- **WHEN** the app is built with `BASE_PATH=/`
- **THEN** it functions correctly served from a domain root, with no source file edited

### Requirement: Deep links resolve on static hosting without rewrite rules

Because GitHub Pages cannot rewrite unmatched paths to the shell, the build SHALL emit a `404.html` copy of the app shell so a deep link boots the app and is routed client-side.

#### Scenario: A deep link is opened directly

- **WHEN** a URL that matches no static file is requested from the deployment
- **THEN** the app shell is served, and the app renders the route for that URL rather than a hosting error page

#### Scenario: The fallback matches the shell

- **WHEN** the production build completes
- **THEN** `404.html` is byte-identical to `index.html`, so both boot the same build
