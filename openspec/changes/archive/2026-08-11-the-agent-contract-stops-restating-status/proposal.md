# Proposal: The Agent Contract Stops Restating Status

> **Model**: Opus · **Kind**: documentation correction, not a roadmap change · **Gate**: **no sentence in `AGENTS.md` claims which surfaces are built, live or demo-gated**; the two places that did now point at the derived roadmap and the gate registry instead; the dangling cross-reference to a removed Limitations caveat is gone; and every durable rule the file carries survives untouched.

## Why

`AGENTS.md` is the one file every agent reads before touching this repo, and two
of its sentences are false.

**The counter tablet is described as "Not built".** It arrived with
`counter-devices-and-offline`, archived 2026-08-09. The same sentence points at
[Limitations](../../../docs/LIMITATIONS.md) for a caveat that a Biller signs in
with their own password until then, and that caveat no longer exists: #9
correctly removed it. So the claim is wrong and its evidence is a dangling
reference.

This cost real time on 2026-08-11. While diagnosing why registering a tablet
failed, "Not built" read as a plausible explanation for a feature that was in
fact fully built, fully tested, and simply never deployed. The wrong sentence
pointed at the wrong answer.

**The whole-repo status line is wrong in more places than that one.** It says
every surface except attendance is "built and demo-gated". The gate registry,
which is what actually decides, says otherwise: `admin-menu`, both manual-ledger
surfaces, expense categories, tablets, people and outlets are all `live`.

Neither sentence was wrong when written. Both describe a moving target from a
file that is meant to be durable, which is the actual defect: **a status claim
restated by hand goes stale on somebody else's change, silently, and nothing
checks it.** `ROADMAP.md` is derived from folder state and cannot go stale, and
the gate registry is the authority on demo versus live. The contract should send
readers to both rather than compete with them.

## What Changes

- The whole-repo status paragraph stops enumerating which surfaces are real. It
  keeps what is durable (the delivery model, and that the UI is walkable ahead
  of its backend) and points at `ROADMAP.md` and the gate registry for the rest.
- The counter tablet entry drops "Not built" and its dangling Limitations
  reference. The paragraph's rules, which are durable and still exactly right,
  are untouched.
- Both entries in the Authentication Model stop carrying a built/not-built
  annotation, since the same drift applies to each.

## Impact

- **Docs**: `AGENTS.md` only. `docs/LIMITATIONS.md` was checked and is already
  correct; it was updated properly by #9.
- **No spec delta.** Nothing here changes what the app must do. No requirement
  covers the wording of the agent contract, and none should.
- **No code, no migration, no policy, no test behaviour.**
- **No ROADMAP.md row, number or wave**: a documentation correction.
- Closes [`agent-contract-describes-built-features-as-unbuilt`](../../todos/agent-contract-describes-built-features-as-unbuilt.md),
  which is removed from the backlog with its index row.
