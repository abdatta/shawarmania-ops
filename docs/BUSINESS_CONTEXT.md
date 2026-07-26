# Business Context

Facts about Shawarmania that the software has to fit. Sourced from the public site (<https://abdatta.github.io/shawarmania/>) as of 2026-07-25. Treat this page as the record of what the business *is*; when reality and this page disagree, update this page in the same change that acts on the difference.

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

**Cutover and radius are owner-confirmed** (2026-07-26), matching the defaults in [Data Model](DATA_MODEL.md). The cutover only has to sit later than the latest close and earlier than the earliest open, so 04:00 has room on both sides; it is what puts a bill rung at 00:20 on the previous day's takings. The 150 m radius is deliberately forgiving — GPS drifts 20–100 m indoors, and a tight fence would block real staff standing at the counter more often than it would stop anyone gaming it. The manager override exists for the remainder.

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
| **Card** | |
| **Swiggy** | Aggregator order, entered manually at the counter |
| **Zomato** | Aggregator order, entered manually at the counter |
| **Other** | Escape hatch; should be rare and is worth reviewing if it isn't |

**Only `cash` flows into the daily cash record.** This is the single most important rule connecting billing to reconciliation — a UPI sale increases revenue but not the drawer.

Swiggy and Zomato are recorded as bills so revenue and item-level sales stay complete, but the money arrives later via aggregator settlement, net of commission. The app does not reconcile aggregator payouts; see [Limitations](LIMITATIONS.md).

## How a counter shift actually runs

This is the workflow the billing screen must not fight:

1. A customer orders at the counter, usually 1–3 items, often while others queue behind.
2. The biller taps items, adjusts quantity, takes payment, and moves on. **Speed here is the product.**
3. Customer name and phone are captured when convenient — for a walk-in queue at peak, often not at all. Both must be optional, and neither should ever block settling a bill.
4. Aggregator orders arrive on a separate tablet or phone and get entered as bills when there's a gap.
5. At close, the manager counts the drawer and reconciles against what the app expected.

Two consequences worth stating plainly:

- **Optional fields must be genuinely optional.** A required customer name would get filled with "a" a hundred times a day and destroy the customer data it was meant to create.
- **Shifts can cross midnight.** A quick-service food counter serving evening trade may ring a bill at 00:20. That bill belongs to the previous day's takings, and the drawer is counted once. This is why every record carries an explicit `business_date` with a per-outlet cutover, rather than deriving a day from a timestamp. See [Glossary](GLOSSARY.md#business-date).

## Devices in the field

- **One tablet per outlet, at the counter.** Shared across billers and shifts, stays in the shop, always the same physical device. This is the enrolment anchor for the billing role.
- **Personal smartphones for everyone else.** Owner, franchise admins, and employees use their own phones. Android-dominant, mixed and sometimes old hardware, on mobile data.

Mobile data in small-town West Bengal is generally fine and occasionally not. The counter cannot care. See [Offline And Sync](OFFLINE_AND_SYNC.md).

## Growth assumption

The franchise pitch is live and explicitly targeting expansion across West Bengal. Design every outlet-scoped feature so that **adding outlet number seven is a data operation, not a code change** — no hardcoded outlet lists, no per-outlet branches, no assumption that the count is two.
