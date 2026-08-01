# Self-Service Account Settings

**Type**: Feature · **Status**: Deferred by decision · **Area**: Auth

## Expectation

A signed-in person has one Profile or Settings surface where they can request a
different username and change a password they still know without turning an
ordinary preference into a forgotten-password incident.

The username is still a business-wide account identifier chosen and supported
by management, so “request” need not mean an immediate unreviewed rename. The
future proposal must decide whether the person's request needs admin approval,
and it must keep the same uniqueness and authority boundary as an admin
correction.

## Baseline after #24

`username-sign-in-and-owner-recovery` (#24) makes username the everyday
credential for every human role:

- an authorized admin can correct another person's username from People;
- every role that forgets a password asks an authorized admin for a one-time
  link; one Super Admin can help another;
- a Super Admin can use their associated email as an alternate sign-in, while
  automated email recovery remains a separate deferred todo;
- nobody has an in-app self-service page for changing a username or a known
  password.

This todo starts from that contract. It does not require email for ordinary
staff, add `@username`, or create a second login per assignment. Any account
that has an associated email can already use it as an alternate sign-in.

## Why it is deferred

The admin correction/reset paths cover access emergencies. A convenience
surface is useful but does not need to delay the identity migration. Billing
planning has now settled the Biller boundary: a Biller remains a personal human
account with Employee/staff capabilities, while an enrolled tablet has a separate
machine context and verifies eligible operators with their normal credentials.
There is no counter PIN.

## What already exists for it

- One canonical, case-insensitive username namespace and one account per
  person.
- A privileged admin rename that preserves the account UUID, password,
  assignments, sessions, history, and outstanding invite.
- A single password rule and Supabase's signed-in password-update capability.
- An account menu in every role shell and a shared Profile surface already
  anticipated in `docs/SCREENS.md`.

## Open questions

- Does a username request require approval by the same admin who could correct
  it directly, or may any signed-in person claim an available username?
- If approval is required, where does the request appear and how is the person
  told that it was accepted or refused without adding a messaging system?
- Must a known-password change end other personal-phone sessions? If yes, how
  are already-issued daily billing grants treated without confusing them with
  the enrolled device's independent machine session?
- Should the screen permit a person to request a change to their associated
  email, and what recent-authentication proof and administrator approval are
  required before that high-value change?

## Trigger to promote

The shared Profile/Settings surface being built for any other reason, or the
first real request to change a username or known password.

**Dependencies when seeded**: `username-sign-in-and-owner-recovery` (#24) and
the settled account/device/grant boundary from `counter-devices-and-offline` (#9).
