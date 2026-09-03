# Proposal: The Demo's Connectivity Is A Control In The Banner

> **Model**: Claude Opus 5 · **Wave**: none · **Depends on**: #34, #50 · **Gate**: the yellow demo indicator stays **one row** on a 375px phone and on a tablet, and carries the demo's connectivity as a single control — Online, Offline (network dropped), Offline (closed and reopened) — with no second strip anywhere in the demo and the tablet sitting directly beneath the indicator again; choosing **network dropped** leaves the counter taking money while bills stack in the queue and the sync indicator escalates, and returning to Online drains them exactly once; choosing **closed and reopened** reaches the same resumed-counter state the retired button reached, from a resume record byte-identical to the one a real outage builds; the control is absent on all three phone roles and on the Biller's own not-found route, because offline is the tablet's capability and no phone shell has one; the indicator is still undismissable after every control in it is pressed; and the four-role demo walkthrough still walks

## Why

The demo grew a second bar. Beneath the yellow indicator, on the Biller
walkthrough only, sits a dark strip reading **Extended-outage walkthrough** with
a button and a sentence of explanation. It arrived with #34, which needed a way
to reach the resumed-counter state, and a strip was the quickest place to put
one.

It is the right capability in the wrong place, and it is wrong in three ways.

**It is demo scaffolding outside the demo's container.** The yellow indicator is
the one piece of chrome that says *everything below this line is the product*.
A second strip below it and above the till erases that line: a viewer reading
top to bottom cannot tell where the demonstration harness ends and the counter
begins. The demo has had exactly one rule about its own chrome since
`demo-mode-and-app-shell` — it is a single, undismissable strip — and this broke
it without saying so.

**It pushes the product down a row.** The indicator's own contract says a warning
that reflows the page beneath it reads as part of that page. The strip does
precisely that to the counter, on the one surface where vertical space is
already tight enough that #50 had to give the shift column its own scroll.

**It offers one scene when the app has two.** The strip's button produces the
*extended outage*: the tablet closed and reopened with no backend, resuming from
the stored record. That is the harder scene and the one a browser cannot fake.
But the ordinary scene — the network dropping while the app stays open, bills
stacking in the queue, the sync indicator escalating, everything draining on
reconnect — is the one that actually sells this product, and today it is
reachable only by someone who knows to open devtools and toggle Offline. The
mock has listened for the browser's own `online`/`offline` events since
`ui-billing-counter`; nothing surfaces them. **The single most convincing thing
this app does is invisible in its own demonstration.**

**What this is not.** No production behaviour changes and none diverges. The
resume record the control builds stays byte-identical to the one
`use-real-session` builds when a genuine outage throws; the connectivity
override is read by the mock adapter only, and the real tree has no path to it.
The divergence being repaired is one of *chrome*, not of behaviour — the demo
was showing a real capability from a fake-looking place.

## What Changes

- **The strip is deleted.** The tablet returns to sitting directly beneath the
  yellow indicator, as every other demo surface does.
- **The indicator carries the demo's connectivity**, as one control in the
  right-hand cluster beside Start again and Exit demo, where the demo's other
  settings already live. Three states:
  - **Online** — the default every walkthrough starts and resets to.
  - **Offline — network dropped**: the app stays open and the backend stops
    answering. New. This is the scene that was only reachable through devtools.
  - **Offline — closed and reopened**: the extended outage, resuming from the
    stored record. What today's button does.
- **It is shaped like the role switcher, in reverse.** The role switcher is tabs
  on desktop that collapse to a native picker on a phone; connectivity is a
  labelled picker on desktop that collapses to an **icon-only** picker on a
  phone, the icon naming the current state. Same native `<select>` over a drawn
  pill, at the 16px that stops iOS zooming the viewport. The strip stays one
  row at 375px, which is the constraint that decided the shape.
- **It is the Biller's alone**, and absent rather than disabled elsewhere. Not
  by asking what role is being viewed, but by reading a context the demo's
  counter host provides — the same mechanism, and the same `{control && …}`
  shape, that the reset control has used since it was added.
- **A reset returns the demo to Online**, like every other piece of walkthrough
  state.

## Capabilities

### Modified Capabilities

- `demo-mode`: the indicator's requirement gains the connectivity control and
  the one-row constraint that governs it; a new requirement states that the
  demo can reach both offline scenes from that control, that they are the
  tablet's alone, and that reset restores Online.

## Impact

`src/demo/demo-banner.tsx` grows the control. A new
`src/demo/demo-connectivity.ts` holds the context, mirroring `demo-reset.ts`
including its "null outside the tree is the honest answer" contract.
`src/demo/demo-counter.tsx` loses the strip and provides the context instead.
`DemoStore` grows a connectivity slice — on the store rather than the host so it
survives a role switch and is rebuilt by reset, like every other piece of demo
state — and the mock billing adapter's `isOnline()` reads it alongside
`navigator.onLine`, so a genuine devtools toggle keeps working exactly as it
does today.

`e2e/counter.spec.ts` moves from clicking two buttons to driving one select, and
gains the network-dropped scene. `src/demo/demo-safety.test.tsx` adds the new
control to the sweep that presses everything in the strip and proves the strip
survives.

**Nothing in the real tree is touched.** No adapter, no session, no counter
component, no migration, no policy.

## Non-goals

- **A connectivity control for the three phone roles.** There is nothing behind
  it: `real-root.tsx` builds their adapters with no counter session, so they get
  no resume coordinator and no local queue, and `expenses.createExpense` cannot
  enqueue without a shift. A control that did nothing on three of four roles
  would teach that the owner's console keeps working offline. It does not.
- **Demonstrating what the phone roles do offline** — which is fail. Worth
  showing one day, honestly, as its own change; it needs offline states designed
  for surfaces that have none.
- **Changing any production offline behaviour**, or any real adapter, session or
  counter component.
- **A third scene between the two** — a slow or flapping link. The queue's
  age-based escalation is already visible in the network-dropped scene.
- **Making the control dismissable, hideable, or absent from any route the
  Biller walkthrough can reach.** It is chrome, under the indicator's rules.

## Docs to update before archive

`docs/DEMO_MODE.md` — the walkthrough's Biller section: where connectivity now
lives, and both offline scenes as steps a demonstrator can follow.
`docs/SCREENS.md` — the demo indicator's contents.
