# Design: tablets-one-outlet-at-a-time

## The whole mechanism is one option

`useOutletScope` already builds both modes of the same control
(`src/features/outlet-scope.tsx`). A surface asks for `multiple: true` and gets
chips that toggle; it asks for nothing and gets chips that replace. The chip, the
selected treatment, and the rule that the current choice cannot be cleared are
identical either way — which is the point of the control, so that it does not
change shape as an owner walks between surfaces.

So Tablets stops passing `multiple: true`. There is no new control, no new state,
and nothing to remove from the hook.

## What that does to the rest of the surface

The surface already renders `outletIds.map(...)`, a section per outlet in scope.
With one outlet in scope that loop runs once, so the structure survives
unchanged: every tablet at that outlet, an `EmptyState` naming the outlet when it
has none, and **Set up another tablet at <outlet>** beneath. The loop stays a
loop rather than being flattened to a single outlet, because `outletIds` is the
hook's answer and the surface should keep reading it rather than asserting its
length.

Two things do change.

**The `<h2>` outlet name goes.** It exists so that two shops' tills do not run
together when stacked. With one outlet it sits directly under the chosen chip
saying the same word. The empty state keeps its outlet name — *"No tablet is set
up at Shawarmania Kalyani yet"* — because a sentence about an absence should say
which shop is missing one even when the chip is a glance away; that is the
sentence somebody acts on.

**A moved tablet leaves the list.** Nothing is written to make it leave; it
leaves because it is no longer at the outlet being read. This is the behaviour
the owner chose on 2026-09-20 over the alternative below.

## The comment that carried the old decision

`devices-surface.tsx` records the 2026-08-09 decision in prose, with the owner
attributed. It is replaced by the reasoning for the reversal, attributed and
dated the same way, rather than deleted — a decision that was argued should be
readable as having been re-argued, not as never having been made. The same holds
for the spec, where the reversal is written as a requirement rather than as the
absence of one.

## What is deliberately left alone

**The multi-select mode.** Attendance still uses it, the `app-shell` requirement
still describes it, and it is a contract about a shared control rather than about
this surface. Nothing generalises from this change to that one.

**The remembered selection.** A single-outlet surface's pick *reorders* the
remembered selection when the outlet is already in it and *replaces* it when it
is not — deliberately, so that opening Tablets does not silently narrow
Attendance to one outlet. That rule is in `app-shell` and was written for exactly
this situation. Tablets moving from the multi to the single side of it is the
rule working, not a case it fails to cover, and nothing about it needs to change.

**`devices/:outletId`.** The address still sets the opening outlet through
`openOn`, and it is more clearly right in single-select mode than it was in
multi: a link addressed to one outlet now opens on that outlet and nothing else.

**Every read, write and policy.** `readDeviceOperations` takes a list and is
handed a list of one. No adapter, function or policy is touched, and the
selection confers nothing either way.

## Alternatives rejected

**Keep multi-select and flatten to one list, each row naming its outlet** — what
the `app-shell` clause literally asks for. Rejected: with several tills per
outlet, a flat list is the two-level problem without the grouping that made it
survivable, and it destroys the one thing the multi view was for, which is
noticing an outlet that has *no* tablet at all. An absent outlet cannot be a row
in a list of tills.

**Follow the tablet to its new outlet after a move.** Rejected by the owner on
2026-09-20: the reader chose an outlet, and a move should not silently choose a
different one for them. The move confirmation already states the destination
before the move happens, so the tablet leaving the list is the stated thing
occurring.

**Leave the outlet heading in for the empty case only.** Rejected: the empty
state already names the outlet inside its own sentence, so the heading would be
the third place that word appears on one screen.

**Keep multi-select and add a collapse per outlet.** Rejected: it answers the
scrolling complaint and not the one the owner actually made, which is that the
question multi-select exists to answer is not being asked any more. A control
nobody needs does not get better by folding up.

**Take it through `/quickfix`.** Rejected: the fast lane is for restoring
behaviour an existing requirement already demands. This decides something new
about a shipped surface and reverses a recorded decision, so the reasoning needs
somewhere durable to live.

## RLS, money, offline

None. No migration, no policy, no paise, no outbox. The counter tablet's own code
paths are not on this surface at all — this is the administration screen read on a
manager's phone.
