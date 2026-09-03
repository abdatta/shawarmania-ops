# Design: The Demo's Connectivity Is A Control In The Banner

## The offline semantics, stated first

This change touches the demo's rendition of offline billing, so the semantics
are named explicitly before anything else, as the change rules require.

**Nothing about production's offline behaviour changes.** Not the outbox, not
the resume record, not the drain, not idempotency, not the counter's refusal to
block on the network. No file under `src/outbox/`, `src/auth/`,
`src/features/counter/` or `src/data-access/supabase-adapters/` is edited by
this change.

**Two distinct scenes exist, and they are not variations of one another.**

| | Network dropped | Closed and reopened |
|---|---|---|
| App process | stays open | restarted |
| Session state | intact in memory | rebuilt from IndexedDB |
| Production trigger | `navigator.onLine` goes false; requests fail | session read throws, `readCounterResume` returns a record |
| Production code path | adapters queue; `CounterResumeCoordinator` keeps recording | `use-real-session.ts:105-129` returns `indeterminate` with `resume` |
| Visible difference | live data, queue grows, sync pill escalates | every read labelled *as of* its last successful read |

The second is strictly harder and cannot be produced by a browser toggle,
because it is a **startup** read. That is why #34 needed a control at all. The
first needs no control in production — the browser produces it — but needs one
in the demo, because a demonstrator holding a tablet in front of a prospect is
not going to open devtools.

**The resume record stays byte-identical.** `demo-counter.tsx` builds a
`CounterResumeRecord` at `COUNTER_RESUME_SCHEMA_VERSION` with the same fields
`readCounterResume` returns. This change moves *where the build is triggered
from* and touches neither the shape nor the schema version. If the record ever
drifts from production's, the demo is lying about the harder scene — so the
record's construction stays in the demo counter host, next to the session it
belongs to, rather than following the control into the banner.

**Exactly-once survives.** Returning to Online calls the mock's existing
`onOnline`, which is the same handler the browser's `online` event calls today:
`drain()` then `emit()`. No new settlement path is introduced, so the
exactly-once guarantee is the one the mock already has and the e2e suite already
proves.

## Where the state lives, and why it is not where you would first put it

The control is rendered by `DemoBanner`. The extended-outage state is consumed
by `DemoCounter`. `DemoBanner` is *constructed* in `DemoRoot` and passed down as
an opaque `banner` slot.

That last fact looks like it blocks the whole change, and does not. React
context resolves by **tree position, not construction position**, and
`{banner}` is rendered at `demo-counter.tsx:51`, inside the tree `DemoCounter`
returns. A provider wrapped around it therefore reaches the banner.

This is not a trick discovered for this change. It is exactly how the reset
control already works, and `demo-reset.ts` says why in its own words: *"A
context rather than a prop threaded through two shells: the control lives in the
demo banner, which the shells receive as an opaque slot and must not learn
anything about."* The connectivity control gets `demo-connectivity.ts` in the
same shape, with the same null-outside-the-tree contract.

**The Biller-only rule then costs nothing.** The banner renders
`{connectivity && <control/>}` and never asks what role is being viewed. On the
three phone shells, and on `/demo/biller/anything-else` where `DemoRoot` renders
`<DemoBanner/>` beside `<NotFound/>` rather than inside `DemoCounter`, the
context is null and the control is simply not there. Role-dependence falls out
of tree position, which means it cannot drift out of sync with the role router.

## Two pieces of state, one control

The control presents one three-way choice, but two different things sit behind
it, and conflating them would be a bug:

- **`store.connectivity`** — whether the mock backend answers. Owned by the
  `DemoStore`, because it must survive a role switch (the adapters are rebuilt
  per role; the data is not) and must be rebuilt by reset (the store is
  reconstructed, so this is free). Read by the mock billing adapter's
  `isOnline()`.
- **`offlineResume`** — the resumed-counter session. Owned by `DemoCounter`,
  where it already lives, because it is a property of the counter session rather
  than of the data.

The control's `onChange` is the only place that knows both. `closed-and-reopened`
implies the network is also down, so it sets both; `network-dropped` sets
connectivity alone; `online` clears both.

**`isOnline()` reads the override *and* `navigator.onLine`:**

```ts
return storeIsOnline() && (typeof navigator === 'undefined' || navigator.onLine !== false)
```

Offline either way. A genuine devtools toggle keeps behaving exactly as it does
today — this change adds a way to reach the state, it does not take one away —
and a demonstrator whose venue wifi actually dies sees the honest thing rather
than a control claiming Online over a dead link.

## Rejected alternatives

**Leave the strip where it is, just restyle it.** Rejected. The problem is not
that the strip is ugly; it is that demo scaffolding is rendering outside the one
container that marks scaffolding as scaffolding, and pushing the product down a
row while it does. Restyling would make a rule-breaking strip look deliberate.

**A toggle whose label flips**, rather than a picker. Rejected once the third
state arrived: three states are not a toggle. Also, a control whose *label* is
its state reads as a button that performs an action — which is exactly the
misreading the current strip invites, where "Close and resume offline" looks
like something you do rather than a state you are in.

**A role-independent Online/Offline switch, present on all four roles.** The
owner asked for this directly, and it was rejected on evidence. `real-root.tsx`
builds the phone roles' adapters as `createSupabaseAdapters()` with no counter
session, so `resumeCoordinator` is undefined, no `offlineResume` branch is
reachable, and `expenses.createExpense` cannot enqueue — it requires
`counterSession?.shift`. The billing factory states the split outright: tablet
sessions get "the durable local-first settlement path; personal sessions receive
the same authorised manager reads and writes **without opening a local queue**."
A switch on the owner's phone would either do nothing or imply the console keeps
working offline. Offline is the tablet's capability; a control that appears only
on the tablet says so.

**Put the connectivity flag on the demo counter host instead of the store.**
Rejected: it would reset on a role switch, so stepping to a phone to approve a
shift request and stepping back would silently reconnect the counter mid-scene.

**Fake `navigator.onLine`.** Rejected. It cannot be assigned, so it would mean a
global shim in the demo tree that the real tree could in principle also observe
— a demo seam leaking toward production, which is the class of problem this
change exists to close.

**A fourth state for a slow or flapping link.** Rejected as unnecessary: the
mock's `syncTicker` already escalates the sync indicator on queue *age*, so the
network-dropped scene shows the stuck-command case after a couple of minutes
without a state of its own.

## Layout: why one row survives

Desktop has room; the question was 375px, where the strip already runs
`DEMO — FABRICATED DATA` · role picker · Start again · Exit demo with the label
truncating as the designated casualty.

The two existing controls already solved this: below `sm` they keep their icons
and move their words to `aria-label`. Connectivity does the same — an icon-only
native picker, the icon naming the state — so the phone strip gains one
icon-width, which the truncating label absorbs. Nothing new is hidden by a
breakpoint; one more thing is spelled shorter, which is the rule the strip has
followed since it was written.

The `<select>`-over-a-drawn-pill construction is copied from the role switcher,
including the two things that construction exists for: the real control stays
16px so iOS does not zoom the viewport when the picker opens, and it is
*colourless* rather than `opacity-0`, so it stays in the accessibility tree.
