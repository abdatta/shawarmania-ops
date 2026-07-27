# Self-Service Password Reset

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Auth

## Expectation

Someone who has forgotten their password recovers access themselves, without needing an admin to be reachable.

## Current behaviour

Resets are admin-initiated. An admin re-issues a one-time code, passes it to the user, and the user redeems it and sets a new password. That is the whole reset story. It works — but it requires an admin to be available at the moment somebody is locked out, which at a counter opening for the morning is exactly when they may not be.

## Why it is deferred

Acceptable at current headcount; annoying at fifty staff across ten franchises.

**The constraint has changed since this was first recorded.** It was originally blocked on needing an SMS or WhatsApp channel, which was true while sign-in was phone-based. Sign-in is email, so email-based reset needs no new channel and no delivery integration. This got substantially cheaper — the reason to wait is now demand, not infrastructure.

## What already exists for it

- **Email is the sign-in identifier for every role**, so a reset has somewhere to send to.
- **The one-time code and redemption flow already exists end to end**, including expiry, attempt limits, supersession of outstanding codes, and a uniform failure response that reveals nothing about which part was wrong. A self-service path re-uses that machinery and changes only who triggers the issue.
- The active-account check means a reset can never resurrect a deactivated account.

Distinct from the deferred **signed-in password change** (changing a password you still know), recorded separately by `auth-and-roles`.

## Open questions

- **Do field staff reliably have working email on their phones?** An email reset is only self-service if the inbox is actually reachable. For a Biller signing in on a shared counter tablet it may not be, in which case this solves the problem for admins and owners and not for the people most likely to be locked out.
- Does the Biller role get self-service at all? A shared counter login is a different thing from a personal account, and probably should not be self-resettable by whoever is standing at the tablet.
- Rate limiting and enumeration: the reset form must not reveal whether an address has an account, matching the uniform failure response sign-in already uses.
- Should a self-service reset notify the outlet's admin? A silent reset is a quiet way for an account takeover to go unnoticed.

## Trigger to promote

Enough staff across enough outlets that admin-initiated resets become a bottleneck — or, more concretely, the first time a shift starts late because nobody could reach an admin for a code.

**Dependencies when seeded**: `auth-and-roles` (#4).
