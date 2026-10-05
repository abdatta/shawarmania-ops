# Proposal: the-card-leads-with-its-number

> **Model**: Opus · **Kind**: production correction, not a roadmap change ·
> **Gate**: a dine-in card with a table reads `#106 · Table 8`; no pipeline card
> prints the customer's name or the order's age; the card's customer control
> opens the order's customer, or the edit with the customer dialog when there is
> none; the pinning tests fail on the tree before the change.

## Why

At the counter a table replaced the order number on the pipeline card
(owner, 2026-09-26). The number is still what the bill, the kitchen and a
manager share, and the biller lost it on exactly the orders where a second
reference matters most. The card's header was also crowded: the customer's name
and the order's age took a whole line the kitchen does not read, and the list is
already newest first (owner, 2026-10-05).

## What Changes

- The card reads `#106` then a place tag, `TABLE 8` or `TAKEAWAY`, in one style
  for both (icon in primary, small muted capitals), since they answer the same
  question. The docked card under edit reads `#106 · Table 8`.
- The customer line and the age are gone from the pipeline card. The gold star
  badges the customer control, since it describes the customer.
- One customer control sits right of the total. With a customer it opens the
  order's own snapshot (name, phone, membership) and offers *Change customer*;
  without one it starts the ordinary edit with the customer dialog already
  open. Choosing in that dialog saves it at once — Use attaches the customer,
  Skip removes one — and closing it abandons the edit [owner, 2026-10-05]. The
  save is the ordinary revision, so this adds no new write path.

## Non-goals

- No change to how orders, numbers or customers are stored or written.
- The docked card under edit keeps its age and customer: it is the order being
  worked on, and the requirement keeps the original time visible there.
- Bills, history and manager surfaces are unchanged.
