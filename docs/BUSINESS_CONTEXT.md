# Business Context

Facts about Shawarmania that the software has to fit. Sourced from the public site (<https://shawarmania.in/>) as of 2026-07-25. Treat this page as the record of what the business *is*; when reality and this page disagree, update this page in the same change that acts on the difference.

## The business

**Shawarmania** — "Kalyani's Premium Shawarma". Positioning line: *Eat Healthy, Stay Happy*. Quick-service shawarma counters with a small footprint and fast service, grown from one grill in Kalyani to two outlets in under a year, now actively selling franchises across West Bengal.

Quality is part of the brand promise: the menu is lab-tested (NABL/ISO 17025 accredited report), which is marketed prominently. That matters operationally — consistency across franchise outlets is a selling point, so per-outlet menu and inventory discipline is a business requirement, not just bookkeeping.

## The legal entity, and where its papers are

Shawarmania is a brand; the business behind it is **De & Datta LLP**. Every registration below is in the LLP's name, which is why the receipt SMS signs off *Regards, De & Datta LLP* and every page on `shawarmania.in` says *Operated by De & Datta LLP*.

| What | Value | Source document |
|---|---|---|
| Legal name | DE & DATTA LLP (written *De & Datta LLP*) | Certificate of Incorporation |
| LLPIN (MCA) | `ADC-3200`, incorporated 17 Sep 2026 | Certificate of Incorporation |
| GSTIN | `19ABAFD3896L1ZV`, regular, from 25 Sep 2026 | GST Certificate (REG-06) |
| Udyam (MSME) | `UDYAM-WB-15-0142255`, micro, unit *Shawarmania* | Udyam Registration Certificate |
| Registered office | A-10/399, Kalyani, Nadia, West Bengal 741235 | Certificate of Incorporation, GST Certificate |
| DLT principal entity | Airtel, ID `1001829618159358766`, header `DEDTTL`, valid to 29 Sep 2027 | `SMS Docs/DLT certificate.pdf` |
| FSSAI | per outlet; see [Outlets](#outlets) | FSSAI licences |

Only identifiers that are public by law are written here, because this repository is public. The PAN, TAN, partners' details and contact numbers are in the documents and stay there.

**The documents live in the LLP's Google Drive, account `dedattallp@gmail.com`, in *My Drive*:** `Certificate of Incorporation.pdf`, `GST Certificate.pdf`, `Deed Agreement - De & Datta LLP.pdf`, `Print _ Udyam Registration Certificate.pdf`, `Letterhead De & Datta LLP.docx`, the food and drinks menus, and an `SMS Docs/` folder holding the DLT certificate and the authority letters filed for the SMS sender. **Never copy them into this repository.**

**Finding them on a machine.** On a PC running Google Drive for desktop, each signed-in account is mounted as its own drive letter, and the letter is not stable; find the volume labelled *`dedattallp@gmail.com - Google Drive`* (PowerShell: `Get-PSDrive -PSProvider FileSystem`), then open `My Drive`. Without the desktop client, the same folder is at <https://drive.google.com> signed in as that account. The PDFs carry a text layer, so their facts can be read without OCR.

## Outlets

Kalyani is the active counter. Kanchrapara operations are paused after trading
through 15 September 2026, but its historical records and outlet identity remain
intact. These are the seed records for the system.

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

Hyperpure deliveries followed the physical operation: Kanchrapara is the
delivery outlet for invoices through 15 September 2026, and Kalyani is the
delivery outlet from 16 September 2026. The provider app's displayed location
may lag this operational fact, so invoice-date routing in Ops is authoritative.

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

- **The billing screen is a grid of large tappable tiles, with a search over it.** The menu began at seven items and was designed to fit one screen; one outlet now sells sixty. Tiles stay the primary interaction and there is still no category drilling — the search narrows the grid in the browser and leaves the tapping as it was (`billing-menu-search`).
- **Prices are usually round rupees, and nothing requires them to be.** Money is integer paise throughout, and since discounts arrived a menu price may carry paise without anything downstream minding: a percentage of an odd subtotal already produces them, and the bill rounds **up** to a whole rupee on its own stated line rather than the prices being constrained to avoid it.
- **Items are veg/non-veg meaningful.** The brand's own CSS already carries `--color-veg` and `--color-nonveg` tokens; the menu carries the distinction. Model it.

## How money arrives

Payment methods the system must record, taken from how the business actually sells:

| Method | Notes |
|---|---|
| **Cash** | The only method that affects the cash drawer, and therefore the only one in daily cash reconciliation |
| **UPI** | Expected to be the dominant digital method |
| **Swiggy** | Aggregator order; never a counter tender, sourced from Swiggy Finance evidence |
| **Zomato** | Aggregator order; never a counter tender, sourced from Zomato evidence |

**Only `cash` flows into the daily cash record.** This is the single most important rule connecting billing to reconciliation — a UPI sale increases revenue but not the drawer.

Swiggy and Zomato revenue arrives later via aggregator settlement, net of commission. **Zomato is read and reconciled** against its payout from order history and the weekly settlement workbook (#42, #43); **Swiggy is read from its own Finance evidence**. A Swiggy provisional day uses each order's placement timestamp and `Total Customer Paid - GST Collected`, which equals the later annexure's pre-tax Net Bill Value. A detail explicitly marked cancelled and lacking GST has zero Net Bill Value even when it carries customer-payment components; its gross is therefore zero and its net payout may remain negative. The payout annexure supplies the final order/cycle settlement. Item-level aggregator analytics are not shown; see [Limitations](LIMITATIONS.md).

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

There is no deposit and no partially paid order. A fully paid bill may use exact mixed tender—for example ₹100 Cash and ₹39 UPI on ₹139—and only its Cash allocation reaches drawer reconciliation.

**Discounts are real.** A biller takes an amount or a percentage off the order in front of them, and the owner runs discounts across chosen menu categories from the Menu screen. Every discount is stored beside the price it reduces, carrying the basis that produced it, so a bill settled months ago still says what it gave away and why without the menu being consulted. A bill never falls below ₹1: a fully discounted order records the whole giveaway and the rounding line carries the total to the floor, which is why a free meal is visible in a day's takings as the odd rupee on the end.

**Where the food goes is each outlet's choice** (#60). An outlet may mark its
orders dine-in or takeaway, key a dine-in order to a table, and charge for
packaging on takeaway orders, per bag or flat per order, optionally free for
gold members. Every outlet starts with all of it off and bills exactly as the
counter always has; the owner, or the outlet's own manager, switches on what
the shop actually does. Where there is a choice the biller answers it in one tap
before the order is saved, because a kitchen that cannot tell a plate from a
parcel packs the wrong one. A dine-in order shows its table beside its number,
since the table is what the person carrying the tray needs and the number is
what the bill, the kitchen and a manager share.
Packaging is a line on the bill like any other, never removed or repriced at the
counter, so it reaches the day's takings without anybody remembering to add it.

**A regular earns points, and may be made gold** (#62). Where an outlet has
switched points on, a customer who gives their number earns points on every bill
they pay there — 5 for every ₹200 by default, in proportion and rounded down, on
what the bill came to after other discounts and before points — and spends them
on a later bill there, one point to the rupee, up to a share of the bill the
outlet sets (10% by default). Points never expire. A gold member earns at a
multiplier and may spend up to a higher share (50% by default), and packaging can
be free for them. Gold is granted by the owner or the outlet's manager, or by a
biller at the counter for a customer who has paid at least the outlet's monthly
threshold there in the last thirty days (₹2,000 by default), once the customer
agrees; it lasts a set number of months (six by default) from its grant. Points
and gold both belong to the outlet that gave them, because a franchisee should
honour and fund only the benefits it granted. Every number is the outlet's to
set, every outlet starts with all of it off, and Kalyani Cafe is the first to
switch it on, from its opening day, 2026-10-01.

Two consequences worth stating plainly:

- **Optional fields must be genuinely optional.** A required customer name would get filled with "a" a hundred times a day and destroy the customer data it was meant to create.
- **Shifts can cross midnight.** A quick-service food counter serving evening trade may ring a bill at 00:20. That bill belongs to the previous day's takings, and the drawer is counted once. This is why every record carries an explicit `business_date` with a per-outlet cutover, rather than deriving a day from a timestamp. See [Glossary](GLOSSARY.md#business-date).

## Devices in the field

- **One tablet per outlet, at the counter.** Shared across billers and shifts, stays in the shop, always the same physical device. This is what the billing role is anchored to: the tablet is set up to one outlet, and a person opens a shift on it from their own phone.
- **Personal smartphones for everyone else.** Owner, franchise admins, and employees use their own phones. Android-dominant, mixed and sometimes old hardware, on mobile data.

Mobile data in small-town West Bengal is generally fine and occasionally not. The counter cannot care. See [Offline And Sync](OFFLINE_AND_SYNC.md).

## Growth assumption

The franchise pitch is live and explicitly targeting expansion across West Bengal. Design every outlet-scoped feature so that **adding outlet number seven is a data operation, not a code change** — no hardcoded outlet lists, no per-outlet branches, no assumption that the count is two.
