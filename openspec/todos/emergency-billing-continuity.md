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
