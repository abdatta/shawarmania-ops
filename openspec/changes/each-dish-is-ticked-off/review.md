# Demo review — 11 October 2026

Using change `each-dish-is-ticked-off`, schema `spec-driven`, on
`claude/counter-kitchen-workflow-8tmc58`. Phase 1 tasks 1.1–1.9 are complete:
**9/28 tasks complete**. Task 1.9 is approved by the owner on 11 October 2026. The
database, live adapter and generated schema are unchanged; design D10 reserves
merging for the live half after approval.

Open [Counter](https://bidding-eat-lanes-investigator.trycloudflare.com/shawarmania-ops/demo/biller)
and [Kitchen](https://bidding-eat-lanes-investigator.trycloudflare.com/shawarmania-ops/demo/kitchen)
in two tabs in the same browser profile. Choose Kitchen 1 or Kitchen 2 in the demo
control. Start again resets both tabs. This temporary preview serves fabricated
demo data.

## Counter and composer

The six initial orders include two takeaway orders, Table 6, Table 9 and two
legacy orders without service information. They cover noted food, partially
handed-over food, food split across two kitchens, paid food still cooking, and
fully prepared food awaiting payment. Different ages exercise the warning, danger
and forty-minute critical rings, including an 84-minute order.

Counter tickets pack into two independent columns. Dish rows keep separate
quantities, fixed 15px checkboxes, centered text, 6px gaps, and mouse hover shadows
with a hand cursor. The checkbox has left inset without reducing name or quantity
width. Ready has a persistent orange checkbox outline; one uniform light grows
from a circular dot to fill the checkbox, fades out, pauses, then restarts without
shrinking. All cues share a clock; reduced motion uses a steady cue. Ticked dishes
have orange text and a filled checkbox. The halo and steady-dot alternatives
remain in the demo selector.

The aggregate Prepared button is removed from demo cards. Table or Takeaway sits
beside Paid; cards without service use one wide Paid button. A compact age ring
replaces the customer shortcut. The gold badge sits above the start of the order
number without moving it. Table/Takeaway is centered beside Paid. Each kitchen
keeps its own stable slot: single tick when sent, orange double tick when
acknowledged, bell for Ready food, then empty after counter handover. The 18px
marks change independently when an order spans both kitchens. The timer's SVG
text is centered and always shows total minutes, including 72 or 84, with a
darker red from forty minutes. Customer details remain accessible through payment
and the order menu.

The composer uses **Order Label** as its placeholder, without a visible caption.
Quantity controls form one compact pill, followed by the amount and a rightmost
pencil for notes. Edit submission reads **Save** and stays on one line.

## Kitchen and handover

Kitchen Done reaches the counter immediately. Its separate receipt becomes gray
and collapses to its header. The timer becomes an expand arrow; clicking anywhere
on the receipt toggles expansion both ways. Checked and unchecked circles have
the same diameter as the timer. The green check remains available for Undo Done at
any time while the receipt is present. Kitchen cards omit the order label and
pack independently into as many columns as fit.

Done receipts remain until the counter ticks every captured dish. Partial
handover leaves the remaining food visible. Complete handover runs the soft
320ms exit in its original position, reserves a 180ms blank slot, then packs the
other cards. Unticking returns the gray Done receipt, including during an exit.
Later food forms a separate active ticket beside previous Done receipts.

Try marking #105 Done, expanding it, waiting longer than five seconds, and
undoing it. Then mark it Done again and tick its dish at the counter: only that
handover removes it. Untick the dish to bring its Done receipt back.

## Records layout

Expenses sit below the menu on the left. Bills sit below the two-column orders
rail on the right and match its width. Narrow screens retain these tracks and
scroll sideways; workspace and records scroll positions stay linked. Cash/UPI
remain inside Bills only; the final owner decision removes the trial header
total because the pill describes counter status. Search keeps
its full width. The records row fills a second usable viewport: scrolling all the
way down moves the counter off screen and leaves Bills and Expenses filling the
screen below the demo banner. Each long list scrolls within its own panel. Menu
layout containment and spacing that excludes closed dialogs prevent empty scroll
space below the records. Loading placeholders match the revised layouts.

## Verification

- Full unit suite: **2,455 tests in 196 files pass**.
- After the final header removal and cleanup, **63 affected adapter/status
  tests pass**, including the kitchen response omitting the label entirely.
- Full production browser suite: **342 tests pass** before the final header-total
  removal. **4 final workflow walks pass**, light/dark on tablet and desktop,
  including the status pill without a total and totals inside Bills.
- Lint, format check, TypeScript, Edge Function typecheck and production build pass.
- Contrast: **88 pairs pass in both themes**.
- Browser geometry and interaction checks cover 1080px and 880px counters,
  390px phones and a 1600px kitchen; they cover pulse timing, hover, compact
  composer controls, service cases, handover, late Undo, middle-card exit slots,
  responsive masonry, independent kitchen slots, fixed circle sizes, centered age
  text and the records viewport endpoint at 1080px, 880px and 390px widths.
- A regression test reproduces an Undo authored just before an incoming counter
  snapshot: it fails before the fix and passes after. Local kitchen actions are
  published before adopting that snapshot, so rapid handover/Undo still reaches
  the counter.
- A second regression reproduces a dish tick on an unsent demo order: it fails
  before the projection fix and passes after. The tick appears immediately and
  survives delivery with one order. The embedded Bills panel also retains its
  last-read timestamp on an offline cold reopen.
- The remote preview HTML and its current JavaScript asset return HTTP 200.

[Review captures](review/) include light/dark tablet and phone views, composers,
notes, Ready cues, Bills/Expenses, kitchen tickets, and collapsed/expanded Done
receipts. Compact [counter](review/counter-preview.png),
[kitchen](review/kitchen-preview.png) and [records](review/records-preview.png)
captures show the final layout.

The owner approved the demo and requested this commit, with remaining work in a
separate chat. See [handoff.md](handoff.md). Database/RLS, real authentication and
live/offline settlement checks were not run for this demo review; those remain part of the live phase. Demo
offline/reconnect and cold-reopen paths are covered by the counter browser suite.
This is the Phase 1 commit; no push or archive is requested.
