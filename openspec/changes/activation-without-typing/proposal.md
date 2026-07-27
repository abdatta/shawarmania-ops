# Proposal: activation-without-typing

> **Model**: Opus · **Wave**: B · **Depends on**: #4, #15 · **Gate**: **a new employee sets their password by opening one link and typing one thing — a password — and every way of getting it wrong says which thing was wrong.**

## Why

Activation currently asks somebody, on a phone, on their first day, to type an
email address **and** a ten-character code, and then tells them nothing useful
when either is wrong.

`redeem_account_invite` looks the user up by address before it ever looks at
the code, and returns the same `invalid` for a wrong address, a wrong code, an
expired code, a spent code, a deactivated account and an exhausted attempt
count. That uniformity is deliberate — it is what stops the endpoint being an
address oracle — but it means the two most common mistakes are indistinguishable
from each other and from a genuine refusal.

`outlet-and-staff-setup` (#15) fixed the half of this that an admin causes: the
address is now visible on People and Access and correctable when it is wrong.
This change fixes the half the person activating causes, by removing the field
they can get wrong.

**The email is redundant.** `account_invites.code_hash` is a plain SHA-256 of
the normalised code, so the code alone is an indexed lookup. The address is
being used as a lookup key for a row that the code already identifies.

## Scope

**Redeem by code alone.** One input, plus the new password. The address is
derived from the invite, so there is nothing left to mistype and no ambiguity
about which field was wrong.

**A link that carries the code.** `…/activate?code=XXXXX-XXXXX`, sent over
WhatsApp exactly as the code is sent today. Tap, choose a password, done —
nothing typed at all. Needs no domain, no mail provider, no DNS.

**A QR beside the code** on the issuing admin's screen, for handing over in
person without reading characters aloud.

**The address is shown for confirmation, not retyped.** The link opens on the
address the account will sign in with and asks the person to confirm it is
theirs — an explicit *"Yes, that's me"* beside an equally prominent *"That's not
my email"*, never a passive Continue, because a passive one gets clicked
unread.

This is safe only because of the change above, and the reasoning is worth
keeping: the address cannot be revealed today because redemption would become
an oracle for "does this address have an account?". Once the **code** is the
lookup key, anyone who can ask has already proven possession of a valid,
unexpired, single-use code *for that specific account* — so the only address
they can learn is the one on the account they already hold. The objection
disappears precisely when the email stops being the key.

*Rejected: asking them to retype it as a check.* It catches the admin's typo,
which is the point — but it introduces its own. Somebody on their first day
types their address correctly, fat-fingers one character, and is told it does
not match: a false alarm on the one screen that must never produce them. And it
is more typing at the moment this change exists to remove typing. Reading an
address and recognising it is wrong is the whole job; making them produce it
from memory adds a failure mode without adding a check.

**"That's not my email" must lead somewhere.** It tells them to ask their
manager, who can now fix it — `outlet-and-staff-setup` (#15) made the address
visible and correctable on People and Access. Before that this branch had
nowhere to go, which is why the two changes are sequenced this way.

The **sign-in** screen still needs the address typed, and its copy should say
where to get it: *the email you gave your manager*.

**A rate limit that replaces what the attempt counter was doing.** This is the
part that makes it a change of its own rather than a tweak — see below.

## The security trade this exists to decide

Today `attempts` bounds guessing **per invite**: five wrong tries against *one*
account and that code is dead. Redemption by code alone means a blind guesser
is no longer aiming at a particular account — every live invite is a target at
once, and no individual row's counter ever advances enough to stop them.

The arithmetic still says hopeless: 50 bits against a handful of outstanding
invites. But the property protecting it changes from a designed, visible,
per-row limit to "the search space is big", and that is a different kind of
argument. So this change owes:

- a coarse limit on the redemption endpoint (per IP, and globally), and
- a decision on whether an exhausted global limit is visible to an admin, since
  a burst of failed redemptions is the only signal a targeted attempt gives.

Keeping the per-invite counter as well costs nothing and should stay.

## Non-goals

- **No email delivery.** Sending invites by mail needs a verified sending
  domain, which the business does not own yet. Once this change lands, an
  emailed link carries no capability a WhatsApp link does not — which is the
  point: this deliberately removes email from the critical path rather than
  waiting on it.
- No self-service password reset — still [`todos/self-service-password-reset.md`](../../todos/self-service-password-reset.md).
- No change to sign-in, which legitimately needs the address.

## Watch out for

**The uniform failure response must survive.** It is what stops redemption
confirming whether an address has an account. Removing the address field makes
this easier, not harder — but a well-meaning "that code has expired" message
would undo it.

**A link is a bearer credential.** Same as the code it replaces, with the same
seven-day life and single use, so the posture does not change — but it will sit
in a WhatsApp thread, and the expiry is what bounds that.

**Do not put the address in the URL.** It would solve nothing the code does not
already solve, and would put personal data into browser history, link previews
and any proxy in between.

## User-only gate steps

- 🧍 Send yourself the link from a real phone and activate from a WhatsApp tap.

## Docs to update before archiving

`docs/SCREENS.md` (*Set your password* becomes one field), `docs/OPERATIONS.md`
(the handover step, and the "a one-time code will not work" runbook),
`docs/SECURITY_AND_PRIVACY.md` (the guessing bound is now an endpoint limit,
not only a per-row counter).
