# Signed-In Password Change

**Type**: Feature · **Status**: Deferred by decision · **Area**: Auth

## Expectation

Someone who is signed in and knows their current password can change it, from inside the app, without involving an admin.

## Current behaviour

There is no way to. `auth-and-roles` shipped sign-in, first-run activation, and admin-issued one-time codes; the account menu in every shell shows name, role and outlet, and offers sign out. Changing a password you still know is not offered anywhere.

The only route today is to ask an admin to issue a fresh one-time code and redeem it on the activation screen — which works, but routes a private, low-stakes act through another person.

## Why it is deferred

Not blocked, just out of scope. `auth-and-roles` deliberately shipped the paths that had to exist for the roadmap gate — four roles signing in, provisioning end to end, deactivation biting immediately — and drew the line there. This was recorded as a decision rather than left as an omission, so nobody later has to guess whether it was forgotten.

It is genuinely small: the auth service already exposes a password update for the signed-in user, so no new server surface, no new table, and no new privileged function is involved.

## What already exists for it

- **Email is the identifier for every role**, and every account is a real auth user with a password they set themselves.
- **The password rule exists in one place** (a ten-character minimum) and is enforced server-side on redemption, so a change screen has a rule to reuse rather than invent.
- **The account menu is in every shell's chrome**, so there is an obvious place to put it.
- `docs/SCREENS.md` already describes a shared **Profile** screen — own name, phone, role, assigned outlet, change password, sign out — which is where this belongs when that screen is built.

## Distinct from self-service reset

[Self-Service Password Reset](./self-service-password-reset.md) is for someone **locked out**: they cannot sign in, so the flow has to prove identity without a session and is an enumeration risk. This one is for someone **already signed in**, where the current password is the proof and there is nothing to enumerate. They share a rule and nothing else; building this does not deliver that.

## Open questions

- Does changing a password end the person's other sessions? Ending them is the safer default and is the point of changing a password after a suspected leak — but on this app it would sign a Biller out of a counter tablet mid-shift, which is exactly the "the counter never blocks" hazard.
- Does a Biller get it at all, once the shared tablet is enrolled as a device (`counter-devices-and-offline`)? By then the tablet's credential is the device, not a person, and a per-person password change may no longer mean anything there.

## Trigger to promote

The **Profile** screen being built for any other reason — this is a field on it, not a feature of its own. Or the first time someone asks, which is likely to be whoever first types their password on a screen a colleague was looking at.

**Dependencies when seeded**: `auth-and-roles` (#4).
