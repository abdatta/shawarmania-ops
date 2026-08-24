# 9.3 wide-window rehearsal — findings (2026-08-24)

## First run: every cycle mismatched
Reader's order-level sums exceeded stated payouts by ₹652–₹3,246 with varying
ratios. Root cause: `getOrderLevelPayoutsV2.restaurantPayoutAmount` is NOT the
settlement basis; cycle-level fees/taxes/ads are withheld outside it, and the
portal's own A–F headers do not sum to net either (Δ₹52.55 on Aug 9–15).

## Contract captured from the portal itself
- `getRestaurantPayoutDetailsV3` input rides `getRestaurantPayoutDetailsV3Input`
  with **epoch-millisecond** `from`/`to` and `panId: null` (seconds were accepted
  loosely by order-level but returned an unrelated record for details).
- Its response carries `payoutSummary` (the A–F breakdown with sub-headers) and
  presigned `attachments { annexure, taxInvoice, paymentAdvice }`.

## Exact reconciliation equation, proven on live data
From the payout annexure XLSX (`Order Level` sheet, header row 3):

- gross per order = **Net Bill Value (before taxes) [1+2−3]**
- net per order = **Net Payout for Order (after taxes) [A−B−C−D]** — fees and
  taxes are already inside it
- cycle-level additions = Complaints(C) + Growth/Ads(E) + Other(F) only

Σ(order net) + C+E+F ties the stated final payout within the ₹1 tolerance on
**all seven PAID cycles** July 1 → Aug 22, including both SHORT month-boundary
cycles (Jul 1–04: Δ1p; Jul 26–31: Δ−3p; Aug 9–15: Δ0). Gross Σ Net Bill Value
matches the summary sub-header math exactly (e.g. ₹8,621.00 on Aug 9–15).

The annexure downloads browser-free over plain HTTPS via the presigned URL.

## Consequence for the ingest contract
Settlement candidates must be built from annexure facts; API order rows remain
provisional telemetry only (their basis is neither Net Sales nor final payout).
Same-day authoritative writes stay blocked until a cutover-safe live source
exists, exactly as design decision 3 anticipated.

## Reader fixes included
- details epochs now milliseconds; payoutSummary parsed onto each cycle as
  integer-paise components incl. the Net Sales basis parts.
# 9.3 rehearsal result (2026-08-24, post-annexure wiring)

Wide window 2026-07-01..08-24, RID 1096540 (Kalyani), no writes:

| Cycle | Status | Stated paise | Delta | Note |
|---|---|---|---|---|
| Aug16-22 | PENDING | — | provisional only | correctly not settled |
| Aug09-15 | PAID | 530448 | **0** | ads −58882 as cycle deduction |
| Aug01-08 | PAID | 612260 | **+6** | |
| Jul26-31 SHORT | PAID | 404996 | **−3** | |
| Jul19-25 | PAID | 515507 | **−3** | |
| Jul12-18 | PAID | 560999 | **+3** | |
| Jul05-11 | PAID | 434101 | **+6** | |
| Jul01-04 SHORT | PAID | 219060 | **+1** | |

All seven FINAL/PAID cycles reconcile within the ₹1 tolerance from annexure
facts; both required shortened month-boundary cycles included. Cutover-safe
timestamps come from the annexure Order Date column. Net Sales basis proven
(Σ Net Bill Value = summary sub-header math exactly). No financial writes.

Also fixed en route: details epochs are milliseconds and panId must be null
(real PAN suppressed payoutSummary); sync commit 610b3d0.
