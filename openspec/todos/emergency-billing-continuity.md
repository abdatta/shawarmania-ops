# Emergency Billing Continuity

**Type**: Feature · **Status**: Deferred by decision · **Area**: Billing

## Expectation

When the registered counter is unavailable, an authorized FA or SA can
deliberately open a temporary billing-only session on another device, with the
reason and every resulting transaction visibly attributed.

## Why it is deferred

The owner chose to ship the registered-device path and its audited recovery
first instead of putting personal-device emergency billing on the initial path.
`multiple-billing-devices` (#35) later provides independently revocable registered
spares and is expected to remove most ordinary hardware-failure cases without
creating a personal-device bypass.

## Constraints when promoted

- It is a separate outlet-bound billing grant, never the administrator's
  ordinary personal session wearing different UI.
- It is time-bounded, reasoned, attributed, and expires no later than cutover.
- It must not weaken registered-device RLS or become an unrecorded bypass.

## Trigger to promote

All registered devices for an outlet are unavailable, replacement enrolment and
the recovery runbook are insufficient, and the owner explicitly accepts the
additional personal-device authority surface.

**Dependencies when seeded**: `billing-live` (#10). Re-evaluate the need after
`multiple-billing-devices` (#35) before promoting it.

## Re-evaluated after #35, 2026-09-02

`multiple-billing-devices` landed, and it delivered what this note was waiting
on: an outlet may hold several independently removable registered tablets, each
with its own identity and shifts, and setting one up no longer costs anything but
a code. **Stays deferred, and the case for it is now weaker rather than
stronger.**

What changed in its favour: a spare tablet at the counter is now an ordinary
thing to own rather than a schema change to request. A failed till is answered by
the spare beside it, which is a registered device under ordinary RLS with
ordinary attribution, so the hardware-failure cases this note was mostly about no
longer need a personal-device path at all.

What changed against it: the same change fixed the setup failure that used to
make replacement expensive. A redemption whose sign-in never lands now costs a
code and not a counter, and an outlet can be issued several live codes at once,
so standing a replacement up during service is one code typed at the counter with
nothing to clear first. The remaining gap is an outlet with **no** working
hardware at all and no spare, which is a stock decision rather than a software
one.

The constraints above still hold if it is ever promoted, and the trigger is
unchanged. Nothing here needs revisiting until an outlet actually loses every
registered tablet it has.
