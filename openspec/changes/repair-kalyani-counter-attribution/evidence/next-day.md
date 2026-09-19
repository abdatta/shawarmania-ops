# Next-day acceptance — 2026-09-19

Task 7.9 ran after the 04:00 IST business-date rollover, from a fresh read-only
production transaction. The database reported the current business date as
2026-09-19, so 2026-09-18 — the first post-transfer trading day — was closed.

No identifier, customer fact, employee identity, device id or receipt token is
recorded here.

## Canonical agreement

| Outlet / business date | Bills | Range | Bill total | Effective payments | Cash | UPI |
|---|---:|---:|---:|---:|---:|---:|
| Kalyani / 2026-09-16 | 37 | 990–1026 | 906,000 | 906,000 | 213,000 | 693,000 |
| Kalyani / 2026-09-17 | 35 | 1027–1061 | 753,000 | 753,000 | 256,000 | 497,000 |
| Kalyani / 2026-09-18 | 38 | 1062–1099 | 846,000 | 846,000 | 150,000 | 696,000 |

Both repaired dates reproduce the frozen figures exactly. Every date is
number-contiguous: bill count equals the range span, so no number was reused,
skipped or reserved. Zero settled bills disagree with the sum of their latest
effective allocations.

The closed 2026-09-18 day exceeds the 21:01 IST first-use checkpoint of 33
bills and 771,000 paise by five later bills (1095–1099) worth 75,000 paise,
20,000 Cash and 55,000 UPI. That is ordinary trade after the checkpoint, not a
disagreement.

Orders: 39 on 2026-09-16, 35 on 2026-09-17, 42 on 2026-09-18. Kalyani expenses
on 2026-09-16 remain five rows totalling 38,000 paise, all cash.

Counters stand at Kalyani 1099 and Kanchrapara 778; the source counter has not
moved since the cutover.

## The source outlet stayed silent

Since the 2026-09-16 04:00 IST boundary, Kanchrapara has zero bills, zero
orders, zero effective expenses, zero counter shifts and **zero billing
commands**. No delayed command arrived from the transferred tablet at any
point. The incident graph still carries zero payment corrections and zero
attribution reviews, so no fictional correction trail exists. All 37 incident
and all 38 post-transfer bills still resolve a public receipt link.

## Drawer

The latest Kalyani observation is unchanged: counted 520,000, expected 697,000,
difference -177,000, with 500,000 collected from that count and 20,000 left.
Recomputed with the application's own rules — `coalesce(occurred_at,
created_at)` for expenses and the exclusive lower bound on `paid_at` — the
forward position is 20,000 + 150,000 Cash receipts - 15,000 Cash expenses - 0
later cash-out = **155,000 paise expected**. This extends the 135,000 paise
checkpoint by the same five later bills.

## Historical identity survived a real rename

At 01:18:58 IST on 2026-09-19 an operator renamed the transferred tablet from
its post-cutover label to a new one, and renamed the other Kalyani tablet. A
third outlet has since been created with its own counter.

The temporal identity relation absorbed this unprompted production event
exactly as designed: the rename closed the current interval and opened the next
one atomically, leaving three contiguous, non-overlapping intervals. The 741
pre-boundary bills still resolve to the former Kanchrapara label and all 37
incident bills still resolve to the post-cutover Kalyani label. No bill, order,
payment or money row moved.

## Both frozen verifiers are now superseded

Neither operator `verify` mode can run against production any longer. Both
failures are consequences of legitimate later activity, not of disagreement:

- `repair-kalyani-counter-attribution.mjs verify` fails its catalog assertion.
  Three deployments have changed the schema it pins since the before-image was
  captured: this change's own temporal-history migration (the
  `counter_device_history` foreign keys, both identity triggers and the batched
  label function), the Hyperpure delivery cutover (its route foreign key,
  cutover function and unique source index) and the ticket-as-two-switches
  change (which retired the open-payment-edit guard and its end-of-day trigger
  and rewrote the command entry points).
- `repair-kalyani-finance-and-device-history.mjs verify` refuses with
  `Transferred device does not have exactly two identity intervals`, because
  the 2026-09-19 rename correctly created a third.

The frozen bundles could only ever prove a schema and an interval count that
production has since moved past. Next-day acceptance was therefore proved by
freshly written read-only queries against canonical rows, which is the stronger
claim. No future re-run of either operator should be expected to pass.

## Shift and end-of-day observation

The 2026-09-18 shift opened at 16:51 IST and remained open past its stored
04:00 IST expiry at the time of this check. `billing_end_of_day_confirmations`
holds no row for any date from 2026-09-15 onwards, including dates before the
incident. Neither fact was introduced by this repair, and neither affects any
figure above; both are recorded so that a later reader does not mistake the
absence of a confirmation row for an unclosed repaired day.
