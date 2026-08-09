# A tablet setup that fails at the last step takes the outlet's slot with it

**Type**: Verification gap · **Status**: Deferred by decision · **Area**: Counter

## What happens

Setting a tablet up is two acts that cannot share one transaction: a machine
identity is created in the auth system, then the one-time setup code is redeemed
in the database, and only then does the tablet sign in and keep the session.

The first boundary is handled. If redemption is refused for any reason, the
identity is deleted again, the code is not consumed, and the same code still
works — a failed attempt leaves nothing that can authenticate.

**The second boundary is not.** Once redemption succeeds the code is spent and
the tablet exists, holding that outlet's one active slot. If the response is
lost, or the sign-in that follows fails, the tablet has no session and nothing on
the device to retry with. The screen says so plainly rather than blaming the
code, and the only way forward is an admin removing that tablet and generating
another code.

Found by an adversarial review on 2026-08-09, before the change was archived, and
accepted deliberately rather than missed.

## Why it matters

It is a small failure with a bad audience. The window needs a network
interruption of a few hundred milliseconds, so it will be rare — but the person
who meets it is somebody setting up production hardware for the first time,
standing at a counter, following instructions, watching a screen say the tablet
was set up and cannot sign in. They will hit it exactly once and have no context
for it, and "remove the tablet you just created, then start again" is a strange
sentence to read on your first day with the system.

The consequence is bounded and worth stating plainly, because it is smaller than
it sounds: nothing is lost, no money is at risk, and no account is compromised —
a tablet holds no password. What is spent is a code, a slot, and somebody's
confidence.

## Why it was not fixed with the change

The fix is a pending state: a tablet row that does not count against the
one-active-tablet-per-outlet invariant until the browser proves it established a
session, plus an expiry that clears rows nobody ever claimed.

That invariant is a partial unique index, and it is what every other guarantee
about tablets rests on — one counter, one tablet, replacement by removal first.
Making it conditional on a second column, for a failure with a two-tap manual
recovery, was judged the wrong trade at the end of a change that had already
touched the surrounding policies five times.

## Constraints on any fix

- **The slot is the thing being protected**, not the row. Whatever shape it
  takes, two people setting up two tablets at one outlet at the same moment must
  still end with exactly one active tablet.
- **A pending row must expire on its own.** An admin should never have to clean
  one up, or the fix has moved the manual step rather than removed it.
- **A pending row is not a tablet.** It must not appear on the Tablets surface as
  hardware standing at a counter, and it must reach nothing.
- The existing behaviour is the fallback and must keep working: if the proof
  never arrives, an admin removing the tablet and issuing a fresh code has to
  remain a valid path.
- Whatever is built needs the failure genuinely injected — a redemption that
  commits followed by a sign-in that does not — rather than asserted from the
  code path that handles it.

## Trigger

`multiple-billing-devices` (#35) is the natural home: it removes the one-active-
tablet-per-outlet constraint, which is the same index this fix has to reshape,
so doing both at once costs one migration instead of two on the same invariant.

Sooner if a setup ever actually fails this way, or if tablets start being set up
often enough that a rare failure becomes a likely one — a second outlet opening,
or hardware being replaced on any regular basis.
