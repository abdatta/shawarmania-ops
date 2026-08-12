# Proposal: counter-seen-and-practised

> **Model**: Opus · **Wave**: E · **Depends on**: #10 · **Gate**: **from their own phone, away from the outlet, the owner opens a counter's own screen and sees what the biller sees** — the same components the tablet renders, read-only, stated as of one reading; every action inert and every write refused by the database, proved by a hand-crafted request; a Franchise Admin reaches the same view for outlets they manage and no others; and the owner alone can take that reading into a **practice copy** that is editable, carries the outlet's real data under its own banner, is reachable by no public link, writes nothing anywhere, and dies with the tab.

**This is not a `*-live` change and not a demo change.** It makes an existing
screen readable from somewhere else, and adds a third mode beside real and demo.

## Why

Two complaints from the owner's Kalyani session on 12 Aug 2026, which turn out
to be one problem
([item 7](../../todos/2026-08-12-owner-feedback.md)):

- **The counter cannot be looked at.** #10 §8 made the Tablets card report the
  shift and its figures, which answers "how is it going". It does not answer
  "what does the biller actually see", which is the question asked when
  something looks wrong, when a new biller is being taught, or when the owner is
  simply not in the shop.
- **The demo counter and the real counter drifted apart.** The demo's billing
  shell was never given Finish day, because the demo shell and the tablet shell
  are two different compositions of the same columns. Nobody noticed until the
  owner compared them. Any *third* hand-built counter view would drift the same
  way, on the same schedule, for the same reason.

So the read-only view is not a new screen. It is the existing counter workspace
mounted somewhere else, which is the only version of this that stays true.

## Scope

### One workspace, three mountings

Separate the counter's **workspace** — the menu grid, the bill composer, the
open-orders rail, Bills this shift, the shift header — from the **machinery**
that owns it: the enrolled-device context, the durable outbox, the heartbeat,
the shift lifecycle, Hand over and Finish day. Today the two are one component
reachable only from an enrolled tablet.

After this change the same workspace is mounted three ways:

| Mounting | Data | Writes |
|---|---|---|
| The tablet | live, subscribed | yes, through the outbox |
| The viewer | live, read once | none — inert, and refused by the database |
| The practice copy | a snapshot, held in memory | into the copy only |

**A capability object decides which**, passed down rather than sniffed for. A
component that asks "am I in a viewer" somewhere in its body is the drift this
change exists to end.

### The viewer

- Reached from the Tablets card, by an SA at any outlet and by an FA at outlets
  they are assigned to.
- Shows the counter **as of one reading**, with the reading time stated. Opening
  it reads; re-reading is explicit. No subscription, no timer — same reasoning
  as #10 §8.3, and the same reasoning the badge convention already carries.
- **Read-only is a database fact, not a disabled button.** The viewer holds no
  shift and is not an enrolled device, so every counter command already refuses
  it. This change proves that with a hand-crafted request rather than relying on
  an inert control.
- Carries the customer names and phone numbers the bills carry. The owner and
  the FA already read both in billing history; this shows them nothing new about
  anybody. What it must not do is widen *who* reads them, which is why the FA's
  view is scoped by assignment and proved by a refused request.

### The practice copy

- **Super Admin only.** The owner's use for it is showing the product to another
  owner and testing changes against real shapes; an FA has no such use, and the
  narrower affordance is the one to ship. The Tablets card offers the viewer to
  both and this to the SA alone.
- Takes the reading the viewer already has, copies it into a sandbox, and makes
  everything editable — ring a bill, pay it, cancel an order, press Finish day.
  Nothing leaves the tab.
- **It carries the outlet's real data** (owner decision, 2026-08-12): real
  customers, real menu, real takings. A scrubbed copy would not be the thing the
  owner asked to look at, and it exposes nobody who was not already exposed to
  the person holding the session.
- **It is a third mode, not demo mode wearing a hat.** It reuses demo mode's
  sandbox machinery — mock adapters, no client, in-memory store — and replaces
  everything demo mode says about itself. Its banner names the outlet and the
  reading rather than claiming fabricated data; its reset re-reads rather than
  restoring fixtures; its exit returns to Tablets rather than to the app root.
- **It never becomes a link.** The snapshot is handed over in memory, at the
  moment the mode opens. No URL parameter, no `localStorage`, no
  `sessionStorage`, nothing on disk. A reload ends it. There is no route that
  reconstructs it, which is what keeps `/demo`'s public-link property from
  quietly becoming a way to read Kalyani's customers.

### What holds while all this is true

Every safety rule `docs/DEMO_MODE.md` records survives, because none of them is
weakened by a copy that cannot write back:

- the sandbox route tree still constructs only mock adapters;
- lint still forbids sandbox and mock modules from importing the client or the
  real adapters — **the snapshot is built on the real side and handed in**, so
  the one new seam is a plain typed value crossing a boundary, not an import
  crossing it;
- the runtime tripwire still makes the client throw while a sandbox is mounted;
- the escaping-request tests still fail on any request leaving the origin;
- `/demo` is untouched: still fabricated, still public, still resettable to the
  same walkthrough.

## Non-goals

- **No writing back.** Nothing done in a practice copy can be promoted, saved or
  replayed against the outlet. The moment that exists, this is a remote counter
  and needs #35's whole multi-device contract.
- **No live mirroring.** Not a screen share and not a subscription. It is a
  reading, restated when asked for.
- **No practice copy for a Franchise Admin**, until somebody asks.
- **No snapshot of anything but one outlet's current counter.** Not a whole
  business, not a past day.
- **No new billing capability.** If the workspace needs a new adapter read to be
  mountable read-only, the mock was the wrong shape; fix the shape.

## Design questions to settle during `/opsx:propose`

- **Where the workspace/machinery seam falls.** The composer holds draft state,
  the rail holds edit state, and the shift header holds Hand over and Finish day.
  Which of those is workspace and which is machinery decides how much of the
  tablet's most valuable screen is refactored under a live counter — and #10 is
  taking real money by then, so the answer has to be provable by the existing
  billing tests passing unchanged, not by inspection.
- **What the viewer does with a counter mid-edit.** The biller has an order open
  and a draft in the composer. Those are local to the tablet and unreadable.
  Showing an empty composer implies nothing is being typed. Saying so plainly is
  probably right, but it is a sentence somebody has to write.
- **What the practice copy's banner says**, in the same breath as what it must
  never be mistaken for. "Demo — fabricated data" is exactly wrong here, and a
  screenshot of a practice copy showing real revenue is a different risk from a
  screenshot of the demo showing invented revenue: it is real, and it is out.
- **Whether the practice copy is reachable from the viewer or from the Tablets
  card**, and whether entering it re-reads first. A practice copy of a reading
  from twenty minutes ago is a fair thing to want and a confusing thing to be
  given by accident.
- **What happens to an outlet with no tablet, or a tablet with no shift.** There
  is still a menu and still a day. A viewer that refuses to open at all is
  probably wrong; a viewer that opens on an empty counter needs to say why it is
  empty.
- **Whether the demo's own counter is re-pointed at the shared workspace in this
  change or the next.** Doing it here is what actually fixes the drift the owner
  found; deferring it leaves the demo shell a fourth composition and the
  Finish day gap unclosed. The argument for deferring is that it touches the
  walkthrough, which every change since #8 has had to keep walking.

## Where the seam is today

Carried over from the owner-feedback note this change absorbed, so the first
session does not rediscover it:

- The tablet's shell, and the **Finish day** control the demo shell never had:
  `src/features/counter/counter-shell.tsx`. It reaches its device through
  `useCounterDevice()`, which is why nothing but an enrolled tablet can mount it.
- The workspace itself: `src/features/billing/billing-counter.tsx` and the
  columns beside it under `src/features/billing/`.
- The sandbox always builds fabricated data, with no path to any other source:
  `createDemoData()` in `src/data-access/mock/index.ts`.
- The lint rule that keeps sandbox and mock modules from importing the client or
  the real adapters is recorded in `docs/DEMO_MODE.md` under the adapter seam.
  **It is not weakened here**: the snapshot is built on the real side and handed
  in as a plain typed value.
- The Tablets surface this is reached from:
  `src/features/counter/devices-surface.tsx`, as #10 §8 leaves it.

## Docs to update before archiving

`docs/DEMO_MODE.md` (the third mode, and why its rules are unweakened),
`docs/SCREENS.md`, `docs/ARCHITECTURE.md` (the workspace/machinery seam),
`docs/ROLES_AND_PERMISSIONS.md` (who reaches the viewer, who reaches practice),
`docs/LIMITATIONS.md` (a reading is not a mirror; a practice copy is not a
counter).
