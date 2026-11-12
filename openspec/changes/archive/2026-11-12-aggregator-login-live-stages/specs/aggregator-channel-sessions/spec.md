# Delta: aggregator-channel-sessions

## MODIFIED Requirements

### Requirement: A one-time code prompt appears only when a code was requested

The mailbox that carries the owner's code SHALL be opened at the moment the
login flow actually requests a code — after the identifier is accepted and the
code screen renders — and never at dispatch time. **The check that the code
screen has rendered SHALL NOT be satisfiable by the identifier screen before
it.** A surface MAY follow the open request to show the code field, and SHALL
NOT show one while no open request exists. Requests opened for a code nobody
will send SHALL be swept on expiry exactly as today.

**Where a surface shows the sign-in's progress, the code field SHALL appear as
the content of the stage that waits for it**, and nowhere else. A code that is
awaited SHALL always be asked for there: where the request is open and not past
its expiry but no live stage is recorded, the progress SHALL stand at the stage
that waits for the code. A request past its expiry SHALL NOT be asked for.

#### Scenario: An alive-session reconnect never shows a code box

- **WHEN** a reconnect completes on a still-alive session
- **THEN** no auth request is opened and the owner sees no code field at any
  point

#### Scenario: The field appears with the code, not before it

- **WHEN** the login flow reaches the code screen and opens its request
- **THEN** the surface shows the code field from that moment, and typing the
  code within its life signs the runner in

#### Scenario: A failed Send opens no mailbox

- **WHEN** the identifier is submitted and the code screen never renders
- **THEN** no request is opened and no code field is shown

#### Scenario: An abandoned challenge closes itself

- **WHEN** a request is opened and its code expires unused
- **THEN** the request is swept closed so the channel is not deadlocked against
  future reconnects

## ADDED Requirements

### Requirement: A sign-in under way reports where it has got to

A full sign-in the owner started SHALL report its progress as a sequence of
named stages — starting, opening the partner portal, signing in, waiting for the
code, checking the code, bringing Hyperpure along (Zomato only), done — and the
surface SHALL show which stage the sign-in has reached and which are behind it,
with no second Reconnect on it.

**While a sign-in is under way its stages SHALL hold the channel's page**: they
sit over the page, and the page beneath them SHALL take no input until the
sign-in ends, while every other page of the app SHALL remain reachable. Whether
the page is held SHALL be derived from the recorded stage alone, so a reload,
another device or a return from another page finds it held at the same stage.
A sign-in the page watched to its end SHALL show every stage complete until the
owner dismisses it. A sign-in that went quiet or stopped SHALL NOT hold the
page.

Each stage SHALL reach the surface within seconds of being recorded, without the
owner reloading. Stages SHALL be named in the owner's words.

**The stage vocabulary SHALL be closed and validated where it is recorded.** A
stage outside it SHALL be refused rather than stored, and a stage reported when
no sign-in is under way SHALL be refused. A stage SHALL NOT carry free text.

**Nothing beyond the stage SHALL reach a client.** The code and any session
material SHALL remain unreadable to every client; the stage SHALL be read only
through the owner's existing health read, and no client grant on the
credential or mailbox tables SHALL be added to carry it.

**Stages the server can observe SHALL be recorded by the server**, so progress
does not depend on the running process reporting them.

**A sign-in that stops reporting SHALL stop claiming progress.** Each stage has
a ceiling longer than it legitimately takes; past it the surface SHALL say the
sign-in has gone quiet and offer to reconnect. A sign-in that stopped SHALL say
so and offer the same.

**A completed sign-in SHALL NOT be presented as signed out** while no read has
run since it completed.

#### Scenario: The owner watches a sign-in progress

- **WHEN** the owner taps Reconnect and the full-login path runs
- **THEN** the stage list holds the page, moving through the stages as the
  sign-in reaches them, each within seconds and with no reload

#### Scenario: The rest of the app stays reachable during a sign-in

- **WHEN** a sign-in is under way and the owner opens another page and comes
  back, or reloads
- **THEN** the other page works normally, and the channel's page is held again
  at the stage the sign-in has reached

#### Scenario: The code is asked for inside the account of the sign-in

- **WHEN** the sign-in reaches the stage that waits for a code
- **THEN** the code field and its countdown appear at that stage, and no
  separate code card is shown

#### Scenario: A refused code is shown, not hidden

- **WHEN** the platform refuses a code and offers another attempt
- **THEN** checking returns to waiting, and the surface says the code was not
  accepted

#### Scenario: A dead sign-in does not pretend to be alive

- **WHEN** a stage stands unchanged beyond its ceiling
- **THEN** the surface says the sign-in has gone quiet and offers Reconnect

#### Scenario: A stopped sign-in says so

- **WHEN** the sign-in fails, expires or runs out of attempts
- **THEN** the surface says it stopped and offers Reconnect

#### Scenario: A client cannot read the code through the stage

- **WHEN** any client reads a sign-in's progress
- **THEN** it receives the stage and its time and never the code or session
  material, and the credential and mailbox tables remain unreadable to it

#### Scenario: An unknown or out-of-turn stage is refused

- **WHEN** a running process reports a stage outside its vocabulary, or when no
  sign-in is under way
- **THEN** it is refused and not stored

#### Scenario: A finished sign-in is not shown as signed out

- **WHEN** a sign-in completes and no read has run since
- **THEN** the surface shows the channel signed back in, not the signed-out
  card

#### Scenario: A reconnect that needs no login shows no stages

- **WHEN** a reconnect completes on a still-alive session, or repairs Hyperpure
  without a sign-in
- **THEN** no stages are shown at any point
