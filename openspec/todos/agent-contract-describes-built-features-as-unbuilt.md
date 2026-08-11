# The agent contract still describes built features as unbuilt

**Type**: Documentation gap · **Status**: Open · **Area**: Process

## What happens

`AGENTS.md` is the single contract every agent reads before touching this repo,
and its status prose has fallen behind the changes it describes. The clearest
case is the counter tablet, which the Authentication Model section still calls
**"Not built — arrives with `counter-devices-and-offline`"**. That change was
archived on 2026-08-09. The tablet is built, and its setup and shift handshake
have their own capability spec.

The whole-repo status line above it has the same shape of problem: it describes
billing, menu, inventory, expenses, daily cash and the owner's console as
uniformly "built and demo-gated", which was true when it was written and is
being made false one `*-live` change at a time.

## Why it matters

The contract is the one file loaded before anything else, and it is trusted
precisely because it is meant to be the durable statement rather than a
changelog. An agent reading "not built" about a built feature will propose
building it, or will treat a bug in it as a design question about something
that does not exist yet.

It also cost real confusion on 2026-08-11. While diagnosing why registering a
tablet failed, "Not built" read as a plausible explanation for a feature that
was in fact fully built, fully tested, and simply never deployed. The wrong
sentence pointed at the wrong answer.

## Why it was not fixed in passing

Found while `edge-functions-ship-with-the-release` was in flight, which touched
the same file's verification list. Correcting one stale clause would have left
the rest, and deciding which of these sentences are stale means auditing the
archive against every status claim in the file: that is a pass over `AGENTS.md`
in its own right, not a line edit inside an unrelated change.

## Constraints on any fix

- **Status claims that go stale on every change do not belong in a durable
  contract.** The roadmap is derived from folder state and is never stale;
  wherever `AGENTS.md` states what is built, it should point at that rather
  than restate it.
- The Authentication Model's *rules* are durable and must survive: the two
  device contexts, no password on a tablet, admin-provisioned accounts. Only
  the built/not-built annotations are the problem.
- `docs/LIMITATIONS.md` carries the "until then a Biller signs in with their own
  username and password" caveat, which is the same claim and needs checking in
  the same pass.

## Trigger

The next change that touches `AGENTS.md` for any reason, or the next time an
agent acts on a stale status claim. Sooner if a `*-live` change lands, since
each one makes the whole-repo status line less true.
