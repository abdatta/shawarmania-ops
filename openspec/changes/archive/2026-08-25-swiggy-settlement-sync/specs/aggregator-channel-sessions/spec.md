## Purpose

Defines Swiggy as an independently authenticated aggregator channel whose session is repaired only when needed and whose scheduled readers never require a browser or expose credential material.

## ADDED Requirements

### Requirement: Swiggy owns an independent session and repair path

Swiggy SHALL have its own configured identifier, credential-health record, encrypted session material, auth-request mailbox and reconnect action. Its health, expiry and failure SHALL NOT be inferred from, combined with or allowed to change Zomato or Hyperpure health.

Reconnect SHALL first make a cheap authenticated Swiggy API probe. A healthy probe SHALL report that the owner is still signed in and stop. A missing or lapsed session SHALL dispatch the Swiggy login workflow, and no other aggregator login or capture SHALL run.

An unavailable or unmeasured token expiry SHALL be represented as unknown and resolved by the authenticated probe; the system SHALL NOT invent a future expiry to present the session as healthy.

#### Scenario: A healthy Swiggy session needs no login

- **WHEN** the owner reconnects Swiggy and its authenticated probe succeeds
- **THEN** the surface reports that Swiggy is still signed in, no workflow or auth request is created, and Zomato and Hyperpure are untouched

#### Scenario: A lapsed Swiggy session repairs only Swiggy

- **WHEN** the owner reconnects Swiggy and its authenticated probe reports the session lapsed
- **THEN** only the Swiggy login workflow is dispatched and the other channel credentials remain byte-for-byte unchanged

#### Scenario: Unknown expiry is not guessed

- **WHEN** stored Swiggy material has no independently verified expiry
- **THEN** credential health states that expiry is unknown and aliveness is decided by a real authenticated probe

### Requirement: A Swiggy code is requested just in time and belongs only to Swiggy

The headed Swiggy login SHALL submit the configured identifier at most once per attempt and SHALL open a Swiggy auth request only after the portal displays a genuine OTP challenge. The owner surface SHALL show a code field only while that channel has an open request.

Submitting a code SHALL atomically claim the matching open Swiggy request, SHALL NOT satisfy or close a Zomato request, and SHALL never return or log the code after delivery. The request lifetime SHALL come from a portal-declared or live-measured lifetime; until that evidence exists the configured conservative bound SHALL be explicit and verified by the live login gate.

The workflow SHALL NOT resend a code automatically. A failed or expired challenge SHALL close without blocking a later reconnect.

#### Scenario: The code field follows the portal challenge

- **WHEN** the login reaches Swiggy's OTP screen and opens its auth request
- **THEN** the Swiggy tab begins showing the code field, and it was absent before that moment

#### Scenario: A Swiggy code cannot answer Zomato

- **WHEN** both channels have independent auth history and a code is submitted for Swiggy
- **THEN** only the open Swiggy request can claim it and no Zomato request or credential changes

#### Scenario: An expired attempt leaves no deadlock

- **WHEN** no code is supplied before the Swiggy request expires
- **THEN** it closes, no session is stored, and a later reconnect can open a fresh request

### Requirement: Only login uses a browser

Swiggy's scheduled daily and payout reads, authenticated probe, pagination and retry paths SHALL use the captured API session through plain HTTP requests. They SHALL NOT install, launch or depend on Playwright, a browser, a display server or interactive input.

Only the manually dispatched login workflow MAY use headed Playwright. A successful login SHALL store the minimum replayable Swiggy session in the encrypted credential store, and a browser-free reader SHALL prove that stored session before the login is accepted as complete.

#### Scenario: A schedule runs without browser machinery

- **WHEN** either twice-daily Swiggy schedule runs with a live stored session
- **THEN** it completes its API reads without launching a browser or requesting an OTP

#### Scenario: Login proves replay outside the browser

- **WHEN** a headed login captures and stores a Swiggy session
- **THEN** a fresh plain-HTTP client loads it from the credential store and completes an authenticated probe before the workflow reports success

### Requirement: Swiggy secrets have one encrypted home

Swiggy access tokens, cookies and OTP values SHALL NOT reach application clients, database-readable metadata, logs, workflow summaries, fixtures or uploaded failure artifacts. Stored session material SHALL be encrypted in the server-side credential store and readable only by the aggregator reader boundary.

Failure evidence MAY contain page structure needed to diagnose a selector or portal-shape change, but SHALL be short-lived and SHALL contain no input values, headers, cookie values, storage values, token bodies, OTPs, restaurant financial data or customer data.

#### Scenario: Client health contains no secret

- **WHEN** the owner tab reads Swiggy credential health and open-request state
- **THEN** it receives status and timing metadata only, with no session or code material

#### Scenario: A failed login artifact is safe

- **WHEN** a headed Swiggy login fails and uploads diagnostic evidence
- **THEN** the artifact contains no token, cookie, storage value, OTP, restaurant figure or customer detail
