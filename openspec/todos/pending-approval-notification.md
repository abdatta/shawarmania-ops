# Pending Approval Notification

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Attendance

## Expectation

A manager learns that days are waiting for their approval without having to open
the attendance screen to find out.

## Current behaviour

Since `attendance-approved-on-site` (#26), every arrival counts as nothing until a
manager approves it. That makes a forgotten approval a real cost to somebody's
record, and the only thing that surfaces it today is a **count on a screen**:

- The manager's attendance day states how many arrivals are waiting and offers
  **Approve all**.
- The owner's attendance surface states the count per outlet and the oldest
  waiting business date, so a stranded day at a shop nobody opened is visible
  without opening it.
- The owner's console lists waiting arrivals as an attention item beside open
  alerts and low stock.

Nothing pushes. A manager who does not open the screen does not find out, and the
person whose day it is finds out when they query their pay.

## Why it is deferred

Because delivery is its own change, not a line in this one. #26 was explicit
about it as a non-goal: there is no notification, push, or alert channel in the
app for anything yet, and inventing one for attendance would either be a
throwaway or would quietly become the general mechanism without anybody having
designed it.

The counts also change the shape of the problem enough to be worth watching
first. A manager who settles the morning in one tap while standing at the counter
never accumulates a backlog, and the honest path was deliberately made the
cheapest one for exactly that reason. It is genuinely unknown whether forgetting
turns out to be common.

## What already exists for it

- **The waiting count per outlet**, with its oldest date, already computed by the
  adapter (`countWaitingByOutlet`) and scoped by RLS rather than by a filter
  anybody wrote. Whatever delivers a notification would ask the same question.
- **`alerts`**, which is the nearest existing thing to a channel: a manager raises
  one and the owner works it through. It is manager-to-owner and pull-based, so it
  is not the mechanism, but it is the precedent for what an in-app notice looks
  like here.
- **The derived reading in one place**, so "what counts as waiting" cannot drift
  between the screen and whatever sends the notice.

## Open questions

- **Push, or in-app?** A PWA push notification needs a service-worker
  subscription, a server to hold it and a key pair to sign with — none of which
  exists. An in-app badge on the shell's navigation is nearly free and is
  probably most of the value.
- **What is the trigger?** "Anything waiting" fires every morning and becomes
  noise a manager learns to dismiss. "Waiting since yesterday" fires only when
  something has actually gone wrong, which is the notice worth reading.
- **Who else?** The owner arguably wants to know that a manager has not settled a
  day; the employee arguably wants to know their own day is still unsettled. Both
  are defensible and neither is obviously wanted, and a monitoring feature that
  starts messaging staff about their own records deserves a deliberate decision
  rather than a default.
- Quiet hours already exist as a concept for alerts (`QUIET_HOURS_FROM` /
  `QUIET_HOURS_UNTIL`) and would apply here.

## Trigger to promote

The first time a manager forgets — specifically, the first waiting day that
survives its own business date and is noticed by somebody other than the manager.
The owner's per-outlet count is what will surface it.

**Dependencies when seeded**: none structural. Any general notification mechanism
should probably be designed once, for alerts and this together, rather than twice.
