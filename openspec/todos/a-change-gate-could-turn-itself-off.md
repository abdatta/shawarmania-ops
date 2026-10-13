# A change gate could turn itself off

**Trigger:** the first time the owner turns a change gate off because of what
tablet health showed.

## The expectation

When a newly released change starts hurting the counters — requests climbing
far past normal, requests failing, the slowest request taking seconds — the
change switches itself off before the counter freezes, and the owner hears that
it did and why.

## Why it waits

Off is always safe by construction, so a false alarm costs only the feature for
a while. But the thresholds would be guesses today: one trading outlet, no
control group, and no incident under change gates to tune against. A wrong
automatic turn in the middle of service is an incident of its own.

## The shape agreed

A rule per gate, active for the first hours after the gate is turned on: when
more than a stated share of tablets report failures, or requests above a stated
multiple of their own reading before the release, for more than a stated number
of minutes, the gate turns off through the same path the owner's switch uses,
recorded as an automatic turn with the reading that tripped it, and the owner is
told. Thresholds come from the readings of the first few real releases.
