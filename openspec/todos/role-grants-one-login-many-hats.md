# Role Grants: One Login, Many Hats

**Type**: Feature · **Status**: Direction settled (owner, 2026-07-28), not scheduled · **Area**: Roles

## Expectation

One person has exactly one login, and that login can hold several capabilities
— Franchise Admin of one outlet, staff at another — with the session wearing
**one hat at a time**, switched deliberately. A part-timer doing shifts at two
outlets is one account. An owner stepping in as manager of one shop is one
account. Nobody ever has two logins, two passwords, or a split history.

## Current behaviour

An account is exactly one role at at most one outlet, enforced by the schema.
The real-life cases that strain this:

- a staff member who works shifts at two outlets (two accounts, two passwords,
  attendance history split in half, offboarding must remember both);
- the owner who day-runs one outlet and needs that outlet's operational writes
  (see `owner-break-glass-writes.md` — the two todos may be one feature);
- checking a flow works as another role (already served by demo mode's
  persona switcher — not a reason to build this).

## The settled direction (owner, 2026-07-28)

- **Grants, not hierarchy.** A person accumulates explicit (role, outlet)
  grants; a session activates exactly one, so every policy and isolation test
  keeps reasoning about a single-scoped session. A blanket hierarchy (senior
  role inherits junior powers everywhere) was considered and rejected —
  seniority widens what you see, never what you can attest to.
- **Account-per-outlet is rejected.** Never solve multi-outlet by minting a
  second login.
- Attribution never blurs: rows record *who*, enforced today; the hat worn
  changes what a session may do, not who it is.

## What has to be true first

- `staff-as-accounts` (#21) — grants attach to the merged person-record; this
  todo must not graduate before it.
- The People surface becomes grant management (add/remove hats) when this
  lands; the existing guardrails carry over — nobody manages their own
  account, and the last Super Admin cannot be removed.

## Open questions

- Does switching hats end or suspend anything in flight? (Billing sessions are
  rows, not session state, so they survive — settled in #9's design questions.
  Anything else?)
- Per-outlet disable: "this person no longer works at outlet B" is a grant
  ending, not an account dying — what does that do to their still-active grant
  at outlet A?
- Is the owner's "act as FA of outlet X" a grant like any other, or implicit
  in being Super Admin?

## Trigger to promote

The first real person who needs a second hat: a staffer actually splitting
shifts across outlets, or the owner sustainably managing one outlet
day-to-day.
