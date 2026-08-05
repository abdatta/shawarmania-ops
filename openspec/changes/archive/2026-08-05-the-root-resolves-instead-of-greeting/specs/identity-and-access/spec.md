## ADDED Requirements

### Requirement: The application root resolves the session rather than greeting the visitor

The application root SHALL be a resolver, not a destination. It SHALL present no
description of the product and offer no navigation of its own, because the
operations origin serves only people who are trying to get into the app and the
product is described on its own separately hosted site.

The root SHALL act on the session state it has, and SHALL distinguish a session
that is absent from one that is merely not yet known:

- While the session is still being resolved, the root SHALL show the same
  loading placeholder the role shells show, and SHALL send nobody anywhere.
- Once resolved, the root SHALL take the session to the home of the highest role
  it holds.
- Once the absence of a session is **confirmed**, the root SHALL send the visitor
  to sign-in.
- When a session probably exists but could not be confirmed, the root SHALL say
  so and offer a retry, and SHALL NOT send anyone to sign-in.

A session whose state is unknown or unconfirmed SHALL NOT be treated as signed
out. Asking somebody to authenticate again for a session they already hold is a
refusal the app SHALL never make on the strength of an unanswered request.

The unauthenticated entry screen SHALL be the sign-in screen, and SHALL be
composed as a standalone screen rather than as content within a longer page.

#### Scenario: A signed-in visit to the root goes to the app

- **WHEN** a signed-in session opens the application root
- **THEN** it is taken to the home of the highest role it holds, without any
  intermediate screen describing the product

#### Scenario: A confirmed signed-out visit reaches sign-in

- **WHEN** a visitor whose absence of a session has been confirmed opens the
  application root
- **THEN** they arrive at sign-in without an intervening screen to pass through

#### Scenario: An unresolved session waits rather than being sent anywhere

- **WHEN** the application root is opened and the session has not yet resolved
- **THEN** the loading placeholder is shown, and no navigation to sign-in or to
  a role shell has happened

#### Scenario: An unconfirmed session is not sent to sign-in

- **WHEN** the application root is opened, a stored session exists, and the
  request that would confirm it receives no response
- **THEN** the root states that the session could not be confirmed and offers a
  retry, and sign-in is not reached

#### Scenario: The root describes nothing

- **WHEN** the application root is opened with no session
- **THEN** no product description, marketing copy, or route other than the way
  in has been presented

### Requirement: The session is resolved once per visit, not once per screen

The real session SHALL be resolved by one holder shared across the screens that
need it, so that one visit asks who the person is once. Handing off from the
root to a role shell SHALL NOT re-resolve the session from nothing, and signing
in SHALL NOT require the destination to resolve it again.

That holder SHALL supply session state without deciding what is rendered: each
screen SHALL decide for itself what an unresolved session means for it, so that
screens which do not need a session, such as sign-in and activation, render
immediately rather than behind a placeholder.

The holder SHALL NOT be mounted above demo mode. Demo mode SHALL remain outside
its scope so that no real-session read occurs while fabricated data is on
screen.

#### Scenario: Opening the root resolves the session once

- **WHEN** a signed-in person opens the application root and is taken to their
  shell
- **THEN** the profile and assignments behind that session were read once for
  the visit, not once for the root and again for the shell

#### Scenario: Signing in does not re-resolve from nothing

- **WHEN** a person completes sign-in
- **THEN** the shell they arrive at already has the resolved session, without
  starting from an unresolved state

#### Scenario: The screens that need no session are not delayed by one

- **WHEN** sign-in or activation is opened while a session is still resolving
- **THEN** the form is rendered immediately rather than behind a loading
  placeholder

#### Scenario: Demo mode is outside the session holder

- **WHEN** any demo-mode path is rendered
- **THEN** no real session is resolved for it, and the demo-scope guard is not
  triggered

## MODIFIED Requirements

### Requirement: Each role lands on a shell it holds an assignment for

After sign-in a session SHALL be routed to the shell of the highest role it
holds a live assignment for. A session SHALL be able to reach any role shell it
holds a live assignment for, and SHALL NOT be able to render one it cannot
reach — navigating there SHALL redirect it home.

A session holding the owner role SHALL additionally reach the outlet-level
manager shell, at every outlet, without holding an assignment at any of them.
Its authority there is the owner's own and is resolved by the database from the
owner role, so no assignment is written to grant it and none is required to use
it. What that authority stops short of does not change: the existing non-cash
boundary stands, so at an outlet they hold no assignment at the owner is offered
neither a day close nor a withdrawal, and the database refuses both.

Navigation SHALL be the union of the surfaces the session can reach, so that a
person who manages one outlet and works at another reaches both sets of surfaces
without switching anything.

#### Scenario: All four roles reach their own shell

- **WHEN** a Super Admin, a Franchise Admin, a Biller, and an Employee each
  sign in
- **THEN** each lands on their own role's home surface with that role's
  navigation

#### Scenario: A mixed-role person sees both sets of surfaces

- **WHEN** a person holding a Franchise Admin assignment at one outlet and an
  Employee assignment at another signs in
- **THEN** they land on the Franchise Admin shell and their navigation includes
  their own attendance alongside the manager surfaces, with no switcher

#### Scenario: The owner reaches the manager shell unassigned

- **WHEN** a Super Admin holding no outlet assignment navigates to the
  outlet-level manager shell
- **THEN** it renders, scoped to an outlet they may see, rather than redirecting
  them home

#### Scenario: The owner's unassigned reach still stops at the drawer

- **WHEN** a Super Admin holding no assignment at an outlet opens that outlet's
  cash surface
- **THEN** the day is shown, neither a day close nor a withdrawal is offered,
  and both are refused by the database if attempted by a hand-crafted request

#### Scenario: A path for an unreachable role redirects

- **WHEN** a signed-in session navigates to the path of a role it can neither
  hold nor reach
- **THEN** it is redirected to its own home rather than rendering that shell

### Requirement: An activation link carries the code and asks for username plus a new password

The issuing surface SHALL offer an origin-relative activation link containing
the code as the only handover: a scannable image, the link itself, and one copy
action. The raw code SHALL NOT be separately displayed, and the URL SHALL carry
no username, provider alias, account email, or other personal detail.

Opening a live link SHALL resolve and display the current username, then ask
the person to type that username, a new password, and the repeated new password.
The code itself SHALL NOT be typed, and activation SHALL therefore offer no
field, form, or route for entering one. A code is a thing links carry, not a
thing people transcribe.

Activation opened without a code SHALL say that the link is incomplete and
SHALL offer the way to sign in. It SHALL NOT invite the person to supply the
missing code, because the issuing surface never shows them one to supply.

#### Scenario: Issuing a code produces one link handover

- **WHEN** an admin provisions or reissues
- **THEN** the panel offers the QR image, link, and copy action without exposing
  a separate raw code

#### Scenario: The image can be enlarged

- **WHEN** an admin taps the scannable image
- **THEN** it enlarges for another phone camera and can be dismissed

#### Scenario: The link contains no identity data

- **WHEN** an activation link is generated
- **THEN** its URL carries the code and no username, alias, or account email

#### Scenario: Opening the link presents three credential fields

- **WHEN** a person opens a valid activation link
- **THEN** the current username is shown and the form contains username, new
  password, and repeated new password

#### Scenario: Activation offers no way to type a code

- **WHEN** activation is opened without a code
- **THEN** no code field is present, the screen says the link is incomplete, and
  the way to sign in is offered

#### Scenario: No screen routes to activation without a code

- **WHEN** the sign-in screen is inspected for its routes onward
- **THEN** it offers no link to activation, and tells anybody without a password
  to ask an authorized admin for a one-time link
