# Delta: aggregator-channel-sessions

## MODIFIED Requirements

### Requirement: A one-time code prompt appears only when a code was requested

The mailbox that carries the owner's code SHALL be opened at the moment the
login flow actually requests a code — after the identifier is accepted and the
code screen renders — and never at dispatch time. A surface MAY follow the open
request to show the code card, and SHALL NOT show one while no open request
exists. Requests opened for a code nobody will send SHALL be swept on expiry
exactly as today.

**Where a surface shows the sign-in's progress, the code field SHALL appear as
the content of the stage that waits for it**, rather than as a separate card
beside that progress, so the field is where the account of the sign-in says it
should be.

#### Scenario: An alive-session reconnect never shows a code box

- **WHEN** a reconnect completes on a still-alive session
- **THEN** no auth request is opened and the owner sees no code card at any
  point

#### Scenario: The card appears with the code, not before it

- **WHEN** the login flow reaches the code screen and opens its request
- **THEN** the surface shows the code field from that moment, and typing the
  code within its life signs the runner in

#### Scenario: An abandoned challenge closes itself

- **WHEN** a request is opened and its code expires unused
- **THEN** the request is swept closed so the channel is not deadlocked against
  future reconnects

## ADDED Requirements

### Requirement: A sign-in under way reports where it has got to

A login the owner started SHALL report its progress as a sequence of named
stages, and the surface SHALL show which stage the sign-in has reached, which
stages are behind it, and that it is still going.

Each stage SHALL arrive at the surface within seconds of the running process
reaching it, without the owner reloading or revisiting the page. Stages SHALL be
named in the owner's words and SHALL NOT use the vocabulary of the machinery
running them.

**The stage vocabulary SHALL be closed and validated where it is recorded.** A
process reporting a stage outside the vocabulary SHALL be refused rather than
stored, so that a stepper cannot silently stop advancing on an unrecognised
word.

**Nothing beyond the stage SHALL reach a client through this path.** The code
itself, and any session material, SHALL remain unreadable to every client, and
the transport carrying stages SHALL be one that enforces the row's existing
access policy rather than one that bypasses it.

**A sign-in that stops reporting SHALL stop claiming progress.** Where a stage
has stood unchanged beyond a bounded silence longer than any legitimate stage
takes, the surface SHALL say the sign-in has gone quiet and offer what the owner
can do, and SHALL NOT continue presenting the last stage as though it were still
happening.

Where stages cannot be followed live, the surface SHALL fall back to what it
reports today and SHALL NOT present a stage it cannot confirm.

#### Scenario: The owner watches a sign-in progress

- **WHEN** the owner taps Reconnect and the full-login path runs
- **THEN** the surface moves through the named stages as the sign-in reaches
  them, each within seconds and with no reload, ending at a finished state

#### Scenario: The code is asked for inside the account of the sign-in

- **WHEN** the sign-in reaches the stage that waits for a code
- **THEN** the code field and its countdown appear at that stage, and no
  separate code card is shown

#### Scenario: A dead sign-in does not pretend to be alive

- **WHEN** the process running a sign-in stops without finishing and its stage
  stands unchanged beyond the bounded silence
- **THEN** the surface says the sign-in has gone quiet and offers the owner an
  action, rather than continuing to show the last stage as in progress

#### Scenario: A client following stages cannot read the code

- **WHEN** a client subscribed to a sign-in's progress receives an update
- **THEN** it receives the stage and never the code or any session material

#### Scenario: An unknown stage is refused

- **WHEN** a running process reports a stage outside the vocabulary
- **THEN** it is refused and not stored

#### Scenario: Losing the live connection falls back rather than lying

- **WHEN** stages cannot be followed live during a sign-in
- **THEN** the surface reports what it reported before stages existed, and shows
  no stage it cannot confirm

#### Scenario: A reconnect that needs no login shows no stepper

- **WHEN** a reconnect completes on a still-alive session without a full login
- **THEN** no stages are shown at any point
