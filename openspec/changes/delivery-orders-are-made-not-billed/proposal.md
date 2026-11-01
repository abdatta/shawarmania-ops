# Proposal: Delivery Orders Are Made, Not Billed

> **Model**: Opus · **Wave**: F · **Roadmap**: #83 (owner request, 2026-11-01) ·
> **Depends on**: #60 `each-outlet-chooses-how-it-serves` (the service choices
> this joins), #70 `the-kitchen-sees-its-orders`, #74 `each-dish-is-ticked-off`
> (the label, the ticks, the kitchen tickets), #71 `sales-and-menu-analytics`,
> #78 `billing-day-at-a-glance` (Stats and Billing History), #75
> `a-release-can-be-switched-off` · **Gate**: `delivery-orders` (*DO*), off

## Why

Kalyani Cafe has started taking Zomato orders (owner, relaying the co-owner,
2026-11-01). Zomato and Swiggy orders are **not rung at the counter**: their
money reaches the app from the platforms themselves, through the aggregator
sync, so a counter bill for one would count it twice — in Sales, the Ledger,
profit and the drawer. That is why Swiggy and Zomato are refused as counter
tenders.

But the kitchen learns what to cook only from orders saved at the counter. A
Zomato order never appears on the kitchen tablet. The kitchen works from a
second, informal channel, and the two get confused.

The owner wants the counter to tell the kitchen about an order it only has to
**make**: one that goes through the kitchen exactly like any other, and never
counts in the day's billing.

## What changes

### A Delivery order

Each outlet may offer **Delivery** beside Dine-in and Takeaway, on its own page
under **Orders**. It is off for every outlet until a manager or the owner turns
it on, as the other service choices are. Kalyani Cafe is the first to use it.

Delivery means **any delivery platform**: Zomato, Swiggy or one added later.
The counter does not ask which. The biller types the platform's order ID, or
anything else that helps, into the order's **label**, as the counter already
allows (owner, 2026-11-01).

On the counter, with Delivery offered:

- The composer's service row shows a **Delivery** chip beside Dine-in and
  Takeaway, or alone if the outlet offers neither. Choosing it clears any
  table and packaging. It can be changed while the order is open, like the
  service.
- A delivery order is saved with **Order** and takes the day's next order
  number, like any other. **It shows no money.** There is no total, no Mark
  Paid, no discount, no customer, no points or gold, no receipt. Zomato's
  prices are not the counter's — platforms charge a premium to cover their
  commission — so a counter total beside a delivery order would mean nothing
  (owner, 2026-11-01).
- On the rail its card reads **Delivery** where a service would sit, with its
  label, dishes and age, and **Hand over** where Mark Paid would be.

### The kitchen makes it like any other order

A delivery order rings, is acknowledged, is marked Ready and is ticked exactly
as any order. Its card says **Delivery** where it would say *Takeaway*. The
kitchen still knows it by its order number, never its label.

### Hand over, and taking it back

**Hand over** ticks whatever dishes are still owed and closes the order:
it leaves the rail and is recorded as **handed over**, with who and when. No
bill is made and no money moves.

A mistaken tap can be undone. **Take back**, on the order in My
shift, puts it back on the rail as it was before the tap, with a reason, until
**five minutes** after the handover — the same window as taking back a
payment, on the same tablet only.

### Where a handed-over order is seen

- **My shift**, beside the shift's paid bills: each handed-over delivery order
  marked **Delivery**, with its label, dishes and time, and no amount. The
  shift's Cash and UPI totals are unchanged.
- **Billing History**, for managers and the owner, the same, with who rang it
  and who handed it over.

### Labels are kept

Today an order's label is thrown away the moment the order leaves the rail. The
owner questioned that (2026-11-01): a customer gives their name, or a platform
gives its order ID, for that order, and keeping it beside that order serves
the same purpose. Nobody will mistake it for customer data — the customer is
known by their phone, and the label is whatever the biller typed.

So **every order's label is kept** after it is paid, cancelled or handed over,
and shown in My shift and Billing History. It is still **never** written on a
bill, a receipt, an SMS or an export, and never used as a customer's name.
Labels already thrown away are gone; history starts the day the gate turns on.

### Counter or Delivery, never both

Every page that counts orders or dishes keeps reading exactly as today, and
gains a **Counter · Delivery** switch, Counter by default and remembered per
page. There is no combined view (owner, 2026-11-01). A delivery order carries
no money, so the Delivery view shows counts, dishes and kitchen times, never
revenue or average bill.

| Page | Counter (today, unchanged) | Delivery |
|---|---|---|
| **Billing → Stats** | today's figures, delivery orders left out | placed, updated, cancelled, handed over, seen and Ready by the kitchen, and the two average times |
| **Billing History** | bills, as today | handed-over and cancelled delivery orders |
| **Analytics → Items** | as today | **Items sold** per dish and category from handed-over delivery orders; Dish revenue is unavailable |
| **Analytics → Sales** | as today | the **Orders** measure only, by hour, day or week; Revenue and AOV are unavailable |

Overview and the shift's Cash and UPI totals have no switch: they are about
money, and delivery orders add none. Sales **Revenue** keeps adding counter
sales and delivery money from the sync, as #76 decided; the switch does not
touch it.

## Change gate

- **`delivery-orders`** (*DO*)
  - **On:** An outlet may offer Delivery, whose orders the kitchen makes and the
    counter hands to a rider without a bill, labels are kept after an order
    leaves the rail, and Stats, Billing History, Items and Sales can show
    delivery orders alone.
  - **Off:** Every order is billed or cancelled, labels go when an order leaves
    the rail, and no page shows delivery orders.

**Off is today, with one thing the old path must live with.** Delivery orders
saved while the gate was on stay in the database:

- **An open delivery order** reads on today's counter as an ordinary open order
  with no service and its counter-price total, which the biller can cancel —
  or pay, which would bill it. The kitchen keeps cooking it, with no
  *Delivery* on the card. The owner should turn the gate off with no delivery
  order on the rail, which the gate's page states.
- **A handed-over delivery order** is invisible to every surface of the off
  path, which reads only open, paid and cancelled orders. It is never a bill,
  so no money figure changes.
- **Kept labels** stay stored and unread.

Queued work is never stranded: a delivery order, handover or take-back queued
while on drains with the gate off, because the server accepts it whatever the
gate says (round trip `tested`, design D9).

## Non-goals

- **Which platform.** No Zomato/Swiggy picker; the label carries it. It can be
  added later without undoing anything.
- **Matching delivery orders against the platforms' own order counts.** Useful
  for catching food that left without being paid for, but it needs per-order
  counts the sync does not store. A follow-up, not this change.
- **Pulling orders from Zomato or Swiggy automatically.** The sync reads twice a
  day through a sign-in; there is no live feed to build on.
- **Any money on a delivery order**, or any change to how delivery revenue and
  commission reach Sales, the Ledger, Overview or profit.
- **A combined counter-and-delivery view** of any figure.
- **Showing the label to the kitchen.** It goes by the order number.
- **Recovering labels** thrown away before the gate turns on.
- **A delivery order that is paid at the counter.** A rider who pays is a
  takeaway order.

## Capabilities

### Modified

- `order-lifecycle` — the delivery order, its handover and take-back; the
  label's lifetime.
- `counter-billing` — the composer's Delivery chip, the rail card, My shift,
  Billing History and Stats.
- `kitchen-display` — a delivery card reads *Delivery*.
- `service-and-packaging` — Delivery offered as a service choice.
- `sales-analytics` — the Counter · Delivery switch on Items and Sales.

## Impact

- **Database (additive):** an `order_status` value `handed_over`; an outlet
  column `delivery_offered`; tables `delivery_orders` and `kept_order_labels`,
  each with RLS and an isolation test; new commands for creating, revising,
  handing over and taking back a delivery order; `_v2`/`_v3` reads for the
  kitchen board, the rail, Overview's open total, Stats, Billing History and
  Analytics; a gated trigger that keeps labels; and **one replaced function,
  `billing_order_guard`**, which needs the owner's agreement (design D3).
- **Counter and kitchen:** the composer, rail card, My shift, the kitchen card.
- **Owner and manager:** the outlet's Orders section, Billing History, Stats,
  Analytics → Items and Sales.
- **Demo:** delivery orders in the demo fixtures, at the demo outlet that offers
  Delivery.

## Durable documentation

Before archive: `docs/BUSINESS_CONTEXT.md` (the counter workflow's aggregator
step, which still says aggregator orders are paid at the counter, and the
label), `docs/SCREENS.md` (counter, kitchen, Billing, Analytics, the outlet's
Orders), `docs/DATA_MODEL.md` (`orders.status`, `delivery_orders`,
`kept_order_labels`, `outlets.delivery_offered`, the label), `docs/GLOSSARY.md`
(*Delivery order*, *Handed over*), `docs/LIMITATIONS.md` (bills are not
complete revenue; delivery orders carry no money), `docs/DEMO_MODE.md` and
`docs/TESTING.md`.
