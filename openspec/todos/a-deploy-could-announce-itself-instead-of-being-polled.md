# A Deploy Could Announce Itself Instead Of Being Polled

**Type**: Feature · **Status**: Deferred by decision · **Area**: Deployment

## The expectation

When a new build is published, an open device learns about it immediately rather
than within a few minutes.

## The behaviour today

`updates-wait-for-a-safe-moment` has an open app look for a new build on launch,
on returning to the foreground, on regaining connectivity, and every five
minutes. A device that stays open and connected therefore learns about a
published build within five minutes at worst, and usually sooner.

The app already receives live database notifications elsewhere, so announcing a
deployed version the same way is feasible: publication records the version, and
every open device is told at once.

## Why it was deferred

Discovery is not the bottleneck. A build is applied only when the page is
unoccupied, so learning sooner changes nothing for a counter that is busy, and a
device that is idle already reloads promptly on its own.

Three costs sit against a benefit that mostly does not land:

- Every existing check still has to exist, because a live notification is
  unavailable in exactly the situation where the network is, which is the
  situation the counter is designed to survive.
- Publication completing is not the same as the new build being reachable from
  every edge. A device told too early looks, finds nothing, and concludes it is
  current, so the announcement needs its own retry story.
- It introduces a publicly readable record of the deployed version, its
  isolation policy, and a production write performed by the release pipeline.

## Trigger to promote

A published fix demonstrably needs to reach an idle device faster than the
current interval, or the release pipeline gains a reason to record versions
anyway.

## Constraint that makes it non-trivial

The announcement must not become the only path. Whatever is built has to sit
alongside the existing checks as one more caller, never as a replacement for
them.
