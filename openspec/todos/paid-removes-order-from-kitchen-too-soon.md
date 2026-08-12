# Marking a Bill "Paid" Removes It From the Kitchen List Too Soon

**Area:** Billing · **Reported:** 12 Aug 2026, Kalyani outlet

## What's wrong

A customer can pay at **any point**: when they order, while it's being made,
when it's handed over, or even after. But right now, the app treats
"an order is paid" and "an order is done" as the same thing. The moment
someone marks an order paid, it disappears from the kitchen's list of things
still being cooked — even if the food isn't ready yet.

This confuses the kitchen: they can't tell "still needs cooking" apart from
"already handed over."

## Why this happens

- Right now an order only has **one** status, and it can only be one of
  three things: `open`, `paid`, or `cancelled`. There's no separate "still
  cooking" vs "done cooking" status.
- The app was built assuming payment and handing over the food happen at the
  same moment. In real life at the counter, that's often not true.
- So the single act of "mark paid" both records the payment **and** takes the
  order off the kitchen's active list, in one step.

## What a fix could look like

- Add a real second status for cooking progress (like
  "Ordered → Preparing → Delivered"), separate from whether it's been paid.
- Let "Paid" and "Not Paid" be their own switch that can flip at any time,
  without affecting whether the kitchen still sees it as active.
- This is a bigger change — it touches money and the core order model, so it
  should go through a proper change proposal, not a quick fix.

## Code hint (for whoever builds this)

- The only status field today: `src/data-access/database.types.ts:3345`
  (`order_status: "open" | "paid" | "cancelled"`)
- Where paying and closing happen in one step: `src/data-access/mock/billing.ts:798-869`
- The spec that currently says paid orders leave the kitchen list on purpose: `openspec/specs/counter-billing/spec.md:531-533`
