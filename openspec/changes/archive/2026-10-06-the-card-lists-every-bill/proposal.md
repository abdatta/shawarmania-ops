# Proposal: the-card-lists-every-bill

> **Model**: Opus · **Kind**: a small capability on a live surface, not a
> roadmap change (no row) · **Gate**: on the Customers card, *Last seen* and
> *First visit here* sit under the divider and above *Last 30 days*; **See
> bills** opens that customer's bills at the chosen outlet as Billing's own rows,
> newest first, in a bordered window that pages ten summaries at a time and
> never pushes the card past the viewport; nothing is read until it is pressed,
> and a bill's detail only when its row is opened; demo and live answer the same
> shape; CI green.

## Why

The owner reads a regular's card to decide what to do about them, and the card
says how often and how much but not *what* or *when, exactly*. The only way to
see a customer's bills today is to walk Billing day by day hoping to recognise a
number. The owner asked for the whole history on the card [owner, 2026-10-06],
in a scrolling window so a long history cannot make the card taller than the
phone, and for the two dates to lead the thirty-day figures rather than trail
them.

## What Changes

- The card's figures block reads *Last seen*, *First visit here*, then *Last 30
  days* with visits and *Spent* — same divider, same values, new order.
- Under it, a **See bills** control. Pressed, it opens a fixed-height,
  independently scrolling list of this customer's bills at this outlet, newest
  first, ten at a time as the window nears its end.
- **Each bill is Billing's own row and detail** [owner, 2026-10-06]: the
  summary row is extracted from Billing into `manager-bill-row.tsx` and shared,
  and a tap opens `ManagerBillDetail` beneath it, actions included.
- The card becomes a column capped at the viewport less a margin; the bill
  window is the part that yields. The card widens to 28rem, and the bill
  detail's two columns follow its container rather than the viewport.
- The control is a divider labelled **See bills** / **Hide bills** with a
  chevron, and the bills sit in their own bordered, scrolling container
  [owner, 2026-10-06].
- **Low egress** [owner, 2026-10-06]: nothing is read until *See bills*; then
  ten row summaries (`BillingBillSummary`) per page, the next ten only as the
  window nears its end; a bill's detail is read with `getBill` the first time
  its row is opened, and kept.
- `BillingAdapter.listCustomerBills(outletId, customerId, offset)`: live, one
  narrow `bills` read (summary columns and the biller's name, ranged, one row
  past the page) plus the page's corrected tenders and till labels by id; in the demo,
  the store's bills plus the customer's older visits as bills (numbered below
  the store's sequence, which now starts at `DEMO_BILL_NUMBER_BASE + 1`).

## Why no migration and no new policy

The owner and a manager of an outlet already read every bill there under
`bills_select`. A customer's bills at an outlet are a filter on exactly those
rows: nothing a reader could not already see in Billing, and no new authority.

## Non-goals

- No spend, points or bill count on the Customers lists. Spend on a list stays
  refused (a list ranked by money is a league table); see the reply on this
  change for what the other figures would cost.
- No bills from other outlets: the card is one outlet's, like every figure on it.
