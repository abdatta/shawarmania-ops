## ADDED Requirements

### Requirement: A set-up tablet opens only its own page, whatever the address

While a browser holds a set-up tablet's session, the application SHALL show it
only pages within that tablet's own branch: the counter and the pages beneath it
for a counter tablet, the kitchen and the pages beneath it for a kitchen tablet.
Tablet setup is not part of the counter's branch. Every other address SHALL take
the tablet to its home. That includes sign-in, activation, tablet setup, any
role address, an address no route matches, and any page added outside the
tablet's branch after this requirement.

The rule SHALL be **deny by default**. The addresses a tablet may open SHALL be
declared once, as its own branch. A new page beneath a tablet's home SHALL be
open to that tablet, and a new page anywhere else SHALL be closed to it, with no
declaration of its own either way.

While the session is still resolving and the browser's stored session is
already a tablet's, the application SHALL show a loading or retry state, not
the page asked for, so no password field appears even briefly.

A person or a signed-out visitor SHALL NOT reach a tablet's home. A counter
tablet SHALL NOT reach the kitchen's home, and a kitchen tablet SHALL NOT reach
the counter's.

#### Scenario: A counter tablet opens sign-in
- **WHEN** a set-up counter tablet opens `/sign-in`
- **THEN** it lands on the counter, no password field is ever drawn, and its
  session is unchanged

#### Scenario: A kitchen tablet opens activation
- **WHEN** a set-up kitchen tablet opens an activation link
- **THEN** it lands on the kitchen, and no password field is ever drawn

#### Scenario: A page added later, outside the tablet's branch
- **WHEN** a new page is added outside the counter and kitchen branches and a
  set-up tablet opens its address
- **THEN** the tablet lands on its own home, with no change made to the new page
  for that purpose

#### Scenario: A page added later, beneath the counter
- **WHEN** a new page is added beneath the counter's home, such as a counter
  Expenses page, and a counter tablet opens it
- **THEN** the page opens, with no change made to the boundary for that purpose,
  and a kitchen tablet or a person opening the same address does not see it

#### Scenario: A tablet opens an address that does not exist
- **WHEN** a set-up tablet opens an address no route matches
- **THEN** it lands on its own home rather than on a not-found page

#### Scenario: A tablet opens the other kind's page
- **WHEN** a counter tablet opens `/kitchen`, or a kitchen tablet opens `/counter`
- **THEN** each lands on its own home

#### Scenario: A person opens a tablet's page
- **WHEN** a signed-in person opens `/counter` or `/kitchen`
- **THEN** they land on their own shell, and no tablet screen is drawn

#### Scenario: A tablet cold-starts on the sign-in address
- **WHEN** a tablet's browser restarts on `/sign-in` and its session has not yet
  resolved
- **THEN** a loading state is shown until it resolves, and then the tablet's
  home, with no password field drawn at any point

### Requirement: A person's session never replaces a tablet's

While a browser holds a tablet's session, no person's sign-in or activation SHALL
be sent from it. The refusal SHALL be made before any request leaves the browser.
The tablet's session SHALL remain, and the refusal SHALL tell the person to sign
in on their own phone.

Every client path that establishes a person's session SHALL pass through the one
place that makes this refusal, so a session-writing path added later cannot
bypass it.

#### Scenario: A sign-in reached on a tablet by any route
- **WHEN** the person sign-in is invoked on a browser holding a counter tablet's
  session
- **THEN** no request is sent, the tablet's session is unchanged, and the
  message says this is a counter tablet and to sign in on their own phone

#### Scenario: An activation reached on a tablet
- **WHEN** an activation is submitted on a browser holding a tablet's session
- **THEN** no code is redeemed, no password is set, and the tablet's session is
  unchanged

#### Scenario: A new session-writing path is added outside the one place
- **WHEN** code outside the account module calls an Auth method that establishes
  a session
- **THEN** the project's lint fails

### Requirement: A setup that succeeded is not ended by the check that runs before its proof

When the signed-in identity is a tablet's and its device row is not yet readable,
the session check SHALL attempt the tablet's session proof and read the row again
before concluding anything. A proof that succeeds SHALL leave the browser a
tablet. A proof refused because the tablet was removed or its window has passed
SHALL end the session exactly as removal does. A proof that cannot be sent SHALL
change nothing.

The same rule SHALL rescue a tablet whose proof response was lost, at its next
start, without a new code.

#### Scenario: The session check races the proof
- **WHEN** a setup code is redeemed, the tablet signs in, and the session check
  runs before the proof has landed
- **THEN** the tablet ends on the counter with its session held, and is not
  signed out

#### Scenario: The proof response was lost
- **WHEN** a tablet signed in at setup, its proof request was lost, and the app
  starts again inside the code's window
- **THEN** the tablet proves itself and opens the counter with no new code and
  no admin action

#### Scenario: A removed tablet starts
- **WHEN** a tablet an admin removed makes its next session check
- **THEN** the proof is refused and the session ends, as it does today

#### Scenario: The proof cannot be sent
- **WHEN** a tablet's row is unreadable and the network is down
- **THEN** nothing about the session changes, and nobody is signed out
