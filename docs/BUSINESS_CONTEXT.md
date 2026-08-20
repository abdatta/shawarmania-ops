# Business Context

Facts about Shawarmania that the software has to fit. Sourced from the public site (<https://shawarmania.in/>) as of 2026-07-25. Treat this page as the record of what the business *is*; when reality and this page disagree, update this page in the same change that acts on the difference.

## The business

**Shawarmania** — "Kalyani's Premium Shawarma". Positioning line: *Eat Healthy, Stay Happy*. Quick-service shawarma counters with a small footprint and fast service, grown from one grill in Kalyani to two outlets in under a year, now actively selling franchises across West Bengal.

Quality is part of the brand promise: the menu is lab-tested (NABL/ISO 17025 accredited report), which is marketed prominently. That matters operationally — consistency across franchise outlets is a selling point, so per-outlet menu and inventory discipline is a business requirement, not just bookkeeping.

## Outlets

Both are live counters. These are the seed records for the system.

| | Kalyani | Kanchrapara |
|---|---|---|
| **Label** | Kalyani — Central Park | Kanchrapara |
| **Address** | Ward 10, B-9 Diagonal Road, Near Central Park Ground | 281, K G Path (N), Near Joramandir Bus Stand |
| **District** | Nadia | North 24 Parganas |
| **PIN** | 741235 | 743145 |
| **Phone** | +91 89815 24778 | +91 89815 24778 |
| **Business-day cutover** | 04:00 | 04:00 |
| **Geofence radius** | 150 m | 150 m |
| **Coordinates** | *not yet captured* | *not yet captured* |

Home delivery line (shared): **033 2582 3100**. FSSAI licences: `22825123001193`, `12826013000341`.

**Cutover and radius are owner-confirmed** (2026-07-26), matching the defaults in [Data Model](DATA_MODEL.md). The cutover only has to sit later than the latest close and earlier than the earliest open, so 04:00 has room on both sides; it is what puts a bill rung at 00:20 on the previous day's takings. The 150 m radius is deliberately forgiving — GPS drifts 20–100 m indoors, and a tight fence would block real staff standing at the counter more often than it would stop anyone gaming it. Nothing is blocked on distance in any case: the fence is evidence a manager reads, and the manager's approval is what counts a day.

**Staff are expected by 13:00**, per outlet and set by the owner beside the cutover (owner decision, 2026-07-31). Arriving on time is the single fact the business wanted attendance for, and until #26 nothing measured it. An arrival after the deadline is recorded with its real time and reads as **late** everywhere; somebody with no arrival at all reads as **absent** once it passes. Neither is a deduction — what a late day is worth stays a manager's call, recorded in the day's status. The deadline is stamped onto each row when the arrival lands, so moving it next month never relabels a day already recorded.

**A check-in is a claim; a manager's approval is what makes it a worked day** (owner decision, 2026-07-31). A geofence attests to where a phone was, and the business wanted the manager's own presence confirmed at the same time — so the approval is the second signal that makes the first one worth keeping, and the record shows whether the manager was standing at the outlet when they gave it.

**Coordinates are outstanding and cannot be looked up.** They must be taken standing at each counter, not from a map search — a map pin can be tens of metres out, which against a 150 m fence is most of the margin. Attendance (#5) is where they become load-bearing; until then the schema seeds approximate values. See the 🧍 item in that change's proposal.

Note that both outlets currently publish the same contact number. The data model still stores contact per outlet — franchise outlets will have their own, and the owner needs to reach a specific outlet.

## Menu

The live menu as of this writing. Seven items, all built around chicken shawarma plus one burger. Prices appear to be **tax-inclusive** with no GST breakup shown to customers, which is why v1 stores bills with `pricing_mode = 'no_tax'`.

| Item | Price | Note |
|---|---|---|
| Classic Chicken Shawarma | ₹139 | Bestseller |
| Mayonnaise Chicken Shawarma | ₹159 | Top rated |
| Double Chicken Shawarma | ₹179 | |
| Mozzarella Cheese Chicken Shawarma | ₹199 | |
| Healthy Chicken Shawarma Salad | ₹219 | Viral; 25.8g protein per 100g |
| Stuffed Lebanese Chicken Shawarma | ₹238 | Saaj/pita style |
| Fully Loaded Smashed Burger | ₹250 | New |

Implications for the software:

- **A small menu means the billing screen should show everything at once.** No search-first interaction, no deep category drilling — a grid of large tappable tiles is faster than any list. Design for ~10–20 items visible, not 200.
- **Prices are round rupees.** Still stored as integer paise, because the moment a discount or a future tax split appears, sub-rupee amounts arrive.
- **Items are veg/non-veg meaningful.** The brand's own CSS already carries `--color-veg` and `--color-nonveg` tokens; the menu carries the distinction. Model it.

## How money arrives

Payment methods the system must record, taken from how the business actually sells:

| Method | Notes |
|---|---|
| **Cash** | The only method that affects the cash drawer, and therefore the only one in daily cash reconciliation |
| **UPI** | Expected to be the dominant digital method |
| **Swiggy** | Aggregator order, entered manually at the counter |
| **Zomato** | Aggregator order, entered manually at the counter |

**Only `cash` flows into the daily cash record.** This is the single most important rule connecting billing to reconciliation — a UPI sale increases revenue but not the drawer.

Swiggy and Zomato revenue arrives later via aggregator settlement, net of commission. **Zomato is now read and reconciled** against the payout automatically (#42, #43) — the daily order history and the weekly settlement workbook — with Hyperpure supply costs read the same way; Swiggy is still typed. Item-level aggregator sales are not captured; see [Limitations](LIMITATIONS.md).

## How a counter shift actually runs

This is the workflow the billing screen must not fight:

1. A customer orders at the counter, usually 1–3 items. The counter records an
   editable order and calls its small daily order number while the kitchen cooks.
2. When food is handed over, the whole order is paid and becomes one immutable
   bill. Pay-now creates the same bill shape when order and payment happen
   together, without allocating an order number. **Speed here is the product.**
3. Customer name and phone are captured when convenient — for a walk-in queue at peak, often not at all. Both must be optional, and neither should ever block settling a bill.
4. Aggregator orders follow the same order → prepare → full-payment path, with
   the rider collecting, or use pay-now when appropriate.
5. At close, the manager counts the drawer and reconciles against what the app expected.

V1 has no discount, deposit or partially paid order. A fully paid bill may use exact mixed tender—for example ₹100 Cash and ₹39 UPI on ₹139—and only its Cash allocation reaches drawer reconciliation. Every order and bill carries `discount_paise = 0`; exposing a dormant discount field would make a pricing and authority decision the business has not made.

Two consequences worth stating plainly:

- **Optional fields must be genuinely optional.** A required customer name would get filled with "a" a hundred times a day and destroy the customer data it was meant to create.
- **Shifts can cross midnight.** A quick-service food counter serving evening trade may ring a bill at 00:20. That bill belongs to the previous day's takings, and the drawer is counted once. This is why every record carries an explicit `business_date` with a per-outlet cutover, rather than deriving a day from a timestamp. See [Glossary](GLOSSARY.md#business-date).

## Devices in the field

- **One tablet per outlet, at the counter.** Shared across billers and shifts, stays in the shop, always the same physical device. This is what the billing role is anchored to: the tablet is set up to one outlet, and a person opens a shift on it from their own phone.
- **Personal smartphones for everyone else.** Owner, franchise admins, and employees use their own phones. Android-dominant, mixed and sometimes old hardware, on mobile data.

Mobile data in small-town West Bengal is generally fine and occasionally not. The counter cannot care. See [Offline And Sync](OFFLINE_AND_SYNC.md).

## Growth assumption

The franchise pitch is live and explicitly targeting expansion across West Bengal. Design every outlet-scoped feature so that **adding outlet number seven is a data operation, not a code change** — no hardcoded outlet lists, no per-outlet branches, no assumption that the count is two.
