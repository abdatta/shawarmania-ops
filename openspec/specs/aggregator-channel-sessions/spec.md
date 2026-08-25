## Purpose

Defines how each aggregator channel's stored session is proven, repaired and
kept out of every log: a reconnect probes before it dispatches, takes the
cheapest rung that repairs the real state, opens the one-time-code mailbox only
when the portal itself asks for a code, and confines browser automation to the
manual login path. Swiggy owns an independent credential and repair path; its
scheduled readers remain browser-free.

## Requirements

### Requirement: Reconnect is a repair ladder, not a login redo

A reconnect SHALL decide what to repair before dispatching anything, by probing
each channel's stored session with one real authenticated call rather than by
trusting stored expiry claims. It SHALL then take the cheapest rung that
repairs the actual state:

- Zomato alive and Hyperpure lapsed or absent → a capture-only run mints the
  Hyperpure session from the stored Zomato session, and no code request is
  opened.
- Both alive → the surface reports the owner is still signed in and nothing is
  dispatched.
- Zomato itself lapsed → the full sign-in runs, opening the mailbox only when
  the login flow reaches a code screen.

A reconnect SHALL NOT perform a full sign-in when a cheaper rung repairs the
state, and SHALL NOT open a code request for a rung that cannot reach one.

#### Scenario: A cold Hyperpure under a warm Zomato heals without a code

- **WHEN** the owner reconnects while the stored Zomato session answers an
  authenticated probe and no Hyperpure session exists
- **THEN** a capture-only run mints and stores a Hyperpure session, no auth
  request row is created, and no code prompt appears

#### Scenario: A reconnect on fully healthy sessions does nothing

- **WHEN** the owner reconnects and both probes answer alive
- **THEN** the surface reports they are still signed in, nothing is dispatched,
  and no runner starts

#### Scenario: A dead parent is the only rung that asks for a code

- **WHEN** the Zomato probe answers lapsed
- **THEN** the full login runs, and the code prompt appears only once the login
  flow has actually requested a code

#### Scenario: The probe is real, not a timestamp

- **WHEN** a channel's stored token carries no readable expiry claim
- **THEN** aliveness is still decided by an authenticated call against the live
  API, never by the absence or age of a stored date

### Requirement: One Zomato sign-in captures Hyperpure in the same pass

Because Hyperpure rides the Zomato partner login (one reconnect fixes both
channels), a successful full sign-in SHALL attempt to capture the Hyperpure
session in the same browser pass by driving the partner portal's outlet-picker
handoff, and SHALL store it beside the Zomato session. The capture SHALL be
best-effort relative to the login: a failure to capture SHALL NOT fail or undo
a Zomato sign-in that succeeded, and the outcome of each channel SHALL be
reported separately so a half-success can be named.

#### Scenario: The picker hop lands the token

- **WHEN** a signed-in browser context navigates to the partner portal's
  Hyperpure outlet picker, selects the configured outlet, and confirms
- **THEN** the Hyperpure `token` cookie lands in that context and its session
  is stored without any second sign-in

#### Scenario: A bare visit is known not to work

- **WHEN** a signed-in context navigates directly to hyperpure.com without the
  portal hop
- **THEN** no Hyperpure token lands, and this route is not used as the capture
  path

#### Scenario: A failed capture never undoes a good login

- **WHEN** the Zomato sign-in succeeds but the capture cannot land a token
- **THEN** the Zomato session remains stored and usable, and the outcome
  records that Hyperpure specifically did not follow

### Requirement: A one-time code prompt appears only when a code was requested

The mailbox that carries the owner's code SHALL be opened at the moment the
login flow actually requests a code — after the identifier is accepted and the
code screen renders — and never at dispatch time. A surface MAY follow the
open request to show the code card, and SHALL NOT show one while no open
request exists. Requests opened for a code nobody will send SHALL be swept on
expiry exactly as today.

#### Scenario: An alive-session reconnect never shows a code box

- **WHEN** a reconnect completes on a still-alive session
- **THEN** no auth request is opened and the owner sees no code card at any
  point

#### Scenario: The card appears with the code, not before it

- **WHEN** the login flow reaches the code screen and opens its request
- **THEN** the surface shows the code card from that moment, and typing the
  code within its life signs the runner in

#### Scenario: An abandoned challenge closes itself

- **WHEN** a request is opened and its code expires unused
- **THEN** the request is swept closed so the channel is not deadlocked
  against future reconnects

### Requirement: Session material never reaches logs or artifacts

Capture and login runs SHALL NOT write session tokens, cookie values or codes
into logs, workflow summaries, or committed files. Failure traces used to
diagnose a run SHALL carry page structure only, SHALL be uploaded on failure
only, and SHALL be short-lived. A captured session SHALL be written first to
the ops credential store, and any local file a verification run produces SHALL
live outside version control and be removed after use.

#### Scenario: A failed capture uploads structure, not secrets

- **WHEN** a capture run fails and uploads its trace
- **THEN** the artifact contains screenshots and field listings, and no cookie
  value or token body

#### Scenario: A captured session has one home

- **WHEN** a capture succeeds
- **THEN** the session is stored in the ops database, and no copy is committed
  to either repository

### Requirement: Swiggy owns an independent session and repair path

Swiggy SHALL have its own configured identifier, credential-health record,
encrypted session material, auth-request mailbox and reconnect action. Its
health, expiry and failure SHALL NOT be inferred from, combined with or allowed
to change Zomato or Hyperpure health.

Reconnect SHALL first make a cheap authenticated Swiggy API probe. A healthy
probe SHALL report that the owner is still signed in and stop. A missing or
lapsed session SHALL dispatch the Swiggy login workflow, and no other
aggregator login or capture SHALL run.

An unavailable or unmeasured token expiry SHALL be represented as unknown and
resolved by the authenticated probe; the system SHALL NOT invent a future expiry
to present the session as healthy.

#### Scenario: A healthy Swiggy session needs no login

- **WHEN** the owner reconnects Swiggy and its authenticated probe succeeds
- **THEN** the surface reports that Swiggy is still signed in, no workflow or
  auth request is created, and Zomato and Hyperpure are untouched

#### Scenario: A lapsed Swiggy session repairs only Swiggy

- **WHEN** the owner reconnects Swiggy and its authenticated probe reports the
  session lapsed
- **THEN** only the Swiggy login workflow is dispatched and the other channel
  credentials remain byte-for-byte unchanged

#### Scenario: Unknown expiry is not guessed

- **WHEN** stored Swiggy material has no independently verified expiry
- **THEN** credential health states that expiry is unknown and aliveness is
  decided by a real authenticated probe

### Requirement: A Swiggy code is requested just in time and belongs only to Swiggy

The headed Swiggy login SHALL submit the configured identifier at most once per
attempt and SHALL open a Swiggy auth request only after the portal displays a
genuine OTP challenge. The owner surface SHALL show a code field only while
that channel has an open request.

Submitting a code SHALL atomically claim the matching open Swiggy request,
SHALL NOT satisfy or close a Zomato request, and SHALL never return or log the
code after delivery. The request lifetime SHALL come from a portal-declared or
live-measured lifetime; until that evidence exists the configured conservative
bound SHALL be explicit and verified by the live login gate.

The workflow SHALL NOT resend a code automatically. A failed or expired
challenge SHALL close without blocking a later reconnect.

#### Scenario: The code field follows the portal challenge

- **WHEN** the login reaches Swiggy's OTP screen and opens its auth request
- **THEN** the Swiggy tab begins showing the code field, and it was absent
  before that moment

#### Scenario: A Swiggy code cannot answer Zomato

- **WHEN** both channels have independent auth history and a code is submitted
  for Swiggy
- **THEN** only the open Swiggy request can claim it and no Zomato request or
  credential changes

#### Scenario: An expired attempt leaves no deadlock

- **WHEN** no code is supplied before the Swiggy request expires
- **THEN** it closes, no session is stored, and a later reconnect can open a
  fresh request

### Requirement: Only login uses a browser

Swiggy's scheduled daily and payout reads, authenticated probe, pagination and
retry paths SHALL use the captured API session through plain HTTP requests.
They SHALL NOT install, launch or depend on Playwright, a browser, a display
server or interactive input.

Only the manually dispatched login workflow MAY use headed Playwright. A
successful login SHALL store the minimum replayable Swiggy session in the
encrypted credential store, and a browser-free reader SHALL prove that stored
session before the login is accepted as complete.

#### Scenario: A schedule runs without browser machinery

- **WHEN** either twice-daily Swiggy schedule runs with a live stored session
- **THEN** it completes its API reads without launching a browser or requesting
  an OTP

#### Scenario: Login proves replay outside the browser

- **WHEN** a headed login captures and stores a Swiggy session
- **THEN** a fresh plain-HTTP client loads it from the credential store and
  completes an authenticated probe before the workflow reports success

### Requirement: Swiggy secrets have one encrypted home

Swiggy access tokens, cookies and OTP values SHALL NOT reach application
clients, database-readable metadata, logs, workflow summaries, fixtures or
uploaded failure artifacts. Stored session material SHALL be encrypted in the
server-side credential store and readable only by the aggregator reader
boundary.

Failure evidence MAY contain page structure needed to diagnose a selector or
portal-shape change, but SHALL be short-lived and SHALL contain no input values,
headers, cookie values, storage values, token bodies, OTPs, restaurant financial
data or customer data.

#### Scenario: Client health contains no secret

- **WHEN** the owner tab reads Swiggy credential health and open-request state
- **THEN** it receives status and timing metadata only, with no session or code
  material

#### Scenario: A failed login artifact is safe

- **WHEN** a headed Swiggy login fails and uploads diagnostic evidence
- **THEN** the artifact contains no token, cookie, storage value, OTP,
  restaurant figure or customer detail
