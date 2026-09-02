# Proposal: Multiple Billing Devices

> **Model**: Opus · **Wave**: D · **Depends on**: #34 · **Gate**: **Billing V2.2:** two tablets at one outlet bill at the same time — each opening its own shift, each owning its own orders, each draining its own queue — and neither can act on the other's order, proved by a hand-crafted request; bill numbers remain unique and sequential in server acceptance order across both, including when one tablet was offline and syncs late; removing one tablet stops it at the database immediately and leaves the other trading, with every human assignment untouched; the business date is not ready until **both** tablets have confirmed their own end of day, and one tablet's confirmation never covers the other; a setup that fails after its code is redeemed no longer costs the outlet a counter; every tablet still reaches exactly one outlet, proved by a hand-crafted request; and the four-role demo walkthrough still walks.

## Why

The database enforces one active tablet per outlet, and that single partial
unique index is the only reason a busy outlet cannot open a second till. It was
the right launch constraint and it is now the ceiling: a queue at the counter has
one answer, and a tablet that dies mid-service has none.

**Most of what this change was originally going to build already exists.** The
command layer was written for concurrency from the start; the preparation
pipeline has been outlet-wide since #45 and already names another operator as the
creator; `order-lifecycle` already binds ordinary actions to the owning tablet and
already carries a scenario about a second tablet at the outlet being refused; and
`billing_day_readiness` already iterates every tablet that held a shift for the
date rather than assuming one. So this change is mostly a constraint removal, a
management surface that stops assuming a singleton, and the concurrency evidence
that has to exist before either is safe.

## What Changes

- **Remove the one-active-tablet-per-outlet index**, and reshape it in the same
  migration as the pending-setup fix it collides with (below), so one invariant
  is rewritten once rather than twice.
- **Fix the slot a failed setup takes with it.** Redemption succeeding and the
  browser establishing its session are two acts that cannot share a transaction;
  today a lost response between them spends the outlet's only counter and needs an
  admin to remove it. A tablet SHALL not count as a counter until it has proven a
  session, and an unproven row SHALL expire on its own. Taking
  [`openspec/todos/tablet-setup-consumes-its-slot-before-it-is-proven.md`](../../todos/tablet-setup-consumes-its-slot-before-it-is-proven.md),
  which names this change as its home for exactly this reason.
- **Make an active tablet's label unique within its outlet**, so a manager
  removing one counter, and an operator reading a creator's name on a pipeline
  card, are never guessing which.
- **Turn the Tablets surface from a card into a collection**: several tablets per
  outlet, each with its own setup state, last seen time, last reported unsent
  count, live shift and the person holding it, and its own removal. Its existing
  rules are unchanged — one stated read with no subscription, the reader's own
  outlets only, the database refusing anything else, and no bill, order, total or
  customer fact anywhere on it.
- **Let each tablet run its own shift.** One person may hold a shift on each of
  two tablets, and each command is attributed to the tablet and shift that
  actually produced it.
- **Prove the concurrency rather than assume it**: simultaneous payments, a lost
  response replayed against a live competitor, unique sequential per-outlet bill
  numbers in acceptance order, isolated queues, per-tablet removal, and outlet
  isolation still refusing a hand-crafted cross-outlet request.
- **Require both tablets to confirm their own end of day** before the date is
  ready, which `billing_day_readiness` already computes and nothing has yet
  exercised with two.

## Capabilities

### New Capabilities

- `multi-device-billing-coordination`: several tablets at one outlet, what
  coordinates them (the server, and only the server), how bill numbers order
  themselves, and what readiness now requires.

### Modified Capabilities

- `counter-device-sessions`: an outlet may hold several tablets, each
  independently removable, each with its own shifts; setup no longer refuses a
  second tablet and no longer spends a counter on a failure; labels are unique
  among active tablets; and management reads a collection.
- `billing-delivery`: one tablet's queue, recovery and refusals never reach
  another's.
- `counter-billing`: the shift summary is this tablet's, outlet history
  reconciles both without double counting, and accounting order is never read off
  a bill number.
  While editing this capability, carry the correction described in
  [`openspec/todos/pipeline-rename-left-two-sentences-behind.md`](../../todos/pipeline-rename-left-two-sentences-behind.md):
  the composer requirement still ends a scenario with the order appearing in
  **Open orders**, while its sibling two screens away says **Preparing**. One
  capability, two names for one rail. The standalone page and the manager's
  history tab keep the plain Open orders heading by the owner's call, so only the
  counter rail's name is at issue.
- `offline-billing-resumption`: a resume record is one tablet's, and the outlet
  pipeline it remembers holds the neighbour's orders, so ownership is refused
  locally with no server reachable and a remembered pipeline reads as the past
  read it is. The capability arrived with #34 after this proposal was first
  written and is already per-tablet everywhere else, so this is its one delta.
- `app-shell`: management navigation lists tablets and requires an explicit one
  for every action. Its existing requirements are untouched; this is one added
  requirement rather than a rewrite of any of them.

## Impact

One migration reshapes the active-tablet invariant and adds the unproven-setup
state and the active-label uniqueness. Setup, removal and management adapters and
surfaces stop assuming one row. Generated types, demo fixtures and the RLS,
concurrency and browser suites gain a second tablet. **No command RPC, ownership
rule, numbering allocator or readiness query changes** — the point of the
evidence is that they already hold. Existing tablet rows, credentials, pending
local work and historical attribution migrate in place, untouched.

## Non-goals

- **Order transfer between tablets, and any privileged upload or recovery path
  from an unusable one.** Both were cut on 2026-08-09 when the owner described the
  actual workflow: an order is a short-lived record so the kitchen knows what to
  cook, not a tab. A stranded order is cancelled by that outlet's manager with a
  reason and re-rung, `counter-billing` states that no transfer path exists, and
  this change does not reopen it.
- An optimistic-version conflict contract, cut in the same decision. An order
  that is no longer open refuses every further command, which is the whole
  contract.
- Ordinary cross-tablet editing of open orders. Two tablets accepting changes to
  one order is how money merges silently.
- Shared local storage or peer-to-peer sync between tablets. The server is the
  only coordinator, and adding a second one adds a second thing that can be wrong.
- A fixed tablet quota, or setup without an admin's one-time code.
- **Telling an admin sooner that a person is not eligible to bill.**
  [`openspec/todos/code-request-before-eligibility-check.md`](../../todos/code-request-before-eligibility-check.md)
  is the most tempting neighbour this change has: it lives in the same migration
  and the same shift-request screen, and this change is already opening both. It
  is left alone deliberately, because it argues for a **more** revealing refusal
  while this change's whole setup story depends on keeping refusals
  indistinguishable, and deciding how much a refusal may disclose is a policy
  question that deserves its own change rather than a paragraph inside a
  concurrency one. Two edits to one screen is cheap; two opposing rules about
  what a refusal may say is not.
- Emergency billing on an unregistered personal device. Registered spares are
  expected to remove most of its cases; re-evaluate
  [`openspec/todos/emergency-billing-continuity.md`](../../todos/emergency-billing-continuity.md)
  after this change rather than during it.
- Split tender beyond what exists, partial payment, refunds, printing or GST.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`,
`docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/SECURITY_AND_PRIVACY.md`, and
`docs/LIMITATIONS.md` — which loses **One active tablet per outlet at launch**
and **A tablet setup that fails at the last step needs an admin, not a retry**.
