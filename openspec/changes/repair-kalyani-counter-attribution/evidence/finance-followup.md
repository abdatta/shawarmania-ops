# Finance and tablet-history follow-up

## Live read-only finding — 2026-09-18 03:15 IST

The owner drawer screenshot was not a revenue failure. The latest Kalyani
observation counted 520,000 paise, collected 500,000 paise from that same
observation and left 20,000 paise. No cash bill, cash expense or later cash-out
exists after the count, so **20,000 paise in the drawer now** and **zero cash
from bills since the count** are correct.

The screenshot did expose one stale copied figure: the observation's stored
expected total and difference were calculated before the incident attribution
changed. The corrected interval contains 213,000 paise moved cash receipts and
38,000 paise moved cash expenses, a net increase of 175,000 paise. The physical
count and collection do not move. The reviewed forward result is therefore:

| Figure | Before follow-up | Correct result |
|---|---:|---:|
| Counted | 520,000 | 520,000 |
| Expected | 522,000 | 697,000 |
| Difference | -2,000 | -177,000 |
| Collected from count | 500,000 | 500,000 |
| Left now | 20,000 | 20,000 |

## Canonical money reconciliation

Fresh production reads used separate bill aggregates and effective payment
aggregates so split-tender rows could not multiply bill totals.

| Outlet / business date | Bills | Bill total | Effective payments | Cash | UPI | Range |
|---|---:|---:|---:|---:|---:|---:|
| Kalyani / 2026-09-16 | 37 | 906,000 | 906,000 | 213,000 | 693,000 | 990–1026 |
| Kalyani / 2026-09-17 | 35 | 753,000 | 753,000 | 256,000 | 497,000 | 1027–1061 |

No settled bill in either reviewed date has a total different from the sum of
its latest effective allocations. Kanchrapara has no incident-day bill. The
incident's five Kalyani expenses total 38,000 paise, all cash. No identifier,
customer fact, employee identity or receipt token is recorded here.

A fresh pre-deploy production verification at 05:14 IST reproduced the original
cutover digest and every stable graph hash, exact 37/35 bill blocks, 906,000 and
753,000 paise totals, 213,000/693,000 and 256,000/497,000 Cash/UPI splits,
source/target high-water marks 778/1061, target device state and closed incident
shift. A separate read-only transaction found zero live counter shifts and zero
pending unexpired shift requests. Production remains unchanged by the follow-up.

## Finance dependency inventory

| Reader/state | Source and follow-up treatment |
|---|---|
| Bills/history | `bills` plus `effective_bill_payments`; already derives corrected outlet and money. |
| Overview sales/revenue | Database functions sum settled bills and effective payments by current `bills.outlet_id`; no stored counter-sales total. |
| Ledger day/month | Assembled on read from bills/effective payments, `effective_expenses`, channel days, observations and cash-out; no stored daily ledger total. |
| Current drawer card | Latest physical observation plus post-observation effective cash receipts, effective cash expenses and cash-out; current ₹200 is correct and must not receive another ₹2,130 movement. |
| Drawer observation history | Stores opening/expected/difference at count time. Exactly one later Kalyani observation contains the moved incident facts; its expected/difference need the forward correction above. |
| Drawer exceptions | Derived from bill payment/sync instants. No new cash event or acknowledgement is invented by this correction. |
| Counter operations snapshot | Derives Cash/UPI through effective payments; no copied revenue. |
| Public receipt | Resolves the same bill and effective payment identity; links/tokens remain unchanged. |
| Expenses | `effective_expenses` resolves the live canonical rows; the five moved rows already derive at Kalyani. |
| Aggregator channel days | Independent delivery-channel facts; no counter bill is copied into them. |
| Archived manual ledger | Closed runtime archive; no application reader uses it and the incident rows did not originate there. |

## Historical tablet identity

Billing history currently embeds the mutable `counter_devices.label`; that is
why genuine old Kanchrapara bills changed display when the device was renamed.
The durable fix is an effective-dated identity relation and one batched,
authority-checked label read per bill/order page. Bills and orders remain free
of copied labels. The lookup is covered by `(device_id, valid_from desc)` and a
database test explains a 1,000-interval lookup through that index.

The retained targeted before-image proves the transferred tablet's previous
label was `Kanchrapara`. Production currently has no device event after the
incident, so the follow-up operator can split the generic backfill inside the
empty interval before first use without ambiguously relabelling an event.

A setup/current comparison across every proven production tablet found only the
incident device different from its setup label or outlet. That device is now
`Kalyani Counter 2` at Kalyani; the retained before-image records `Kanchrapara`
at Kanchrapara. Its latest bill/order/shift event remains on the incident date,
before the proposed split. No production identifier is stored in source or in
this evidence.

## Restored-production rehearsal

The final full production dump was restored into an isolated local database and
the temporal-history migration applied. The follow-up operator then passed, in
order: read-only plan, external restrictive before-image capture, atomic apply,
fresh verify, guarded rollback, a second apply and a second verify.

- The original version-3 bundle checksum is frozen in the operator.
- Apply changed only the affected observation's expected/difference pair and
  split the transferred tablet's generic interval into old/current identities.
- Verify proved counted cash remained 520,000 paise, the collection remained
  500,000 paise, expected became 697,000 paise and difference became -177,000
  paise.
- Verify also re-proved the 37 incident and 35 later bills, both exact
  Cash/UPI splits, five cash expenses, both number ranges and zero bill/payment
  mismatches.
- The historical lookup resolved all 778 pre-boundary bills and 829
  pre-boundary orders to the old label.
- Rollback restored the copied observation pair and the generic history row,
  and refused in design if any later device event crossed the captured boundary.
- A fresh restore then injected one failure after the history split and another
  after the observation update. Both transactions rolled back completely: the
  same captured digest was accepted by the next run, and a normal apply/verify
  again produced the exact finance figures and 778 historically labelled bills.

The final post-cutover full snapshot rehearsal also froze the interval's
canonical components separately: 40 effective Cash allocations totalling
818,000 paise, 13 effective Cash expenses totalling 141,000 paise, and no
independent cash-out inside the interval. This prevents offsetting late rows
from hiding behind an unchanged net. Apply now binds the locked observation and
generic history byte-for-byte to the captured before-image. A rehearsal found
that ordinary rollback advanced `updated_at`; rollback now suspends only the
named timestamp trigger inside its transaction, restores the captured timestamp,
re-enables the trigger and asserts it is enabled before commit. The complete
failure/apply/verify/rollback/re-apply/re-verify matrix then passed.

After rollback was hardened to lock the exact device, observation and complete
history set before it verifies or writes, a newly restored production clone ran
the final plan/capture/apply/verify/rollback/re-apply/re-verify sequence again.
It reproduced expected 697,000 paise, difference -177,000 paise, unchanged
counted/collected cash, both exact business-date bill/payment splits, two
identity intervals, 778 historical bills and 829 historical orders. Production
was not connected for this rehearsal.

## Production follow-up

Commit `f402c5f082534a054900471e87e46abaa6030f2d` passed the complete deploy
workflow: repository gates, production migration, Edge Functions and frontend
publication. The hosted application returned HTTP 200 and its published asset
contained that exact build SHA. A new production plan still matched the frozen
incident bundle.
The final outside-Git before-image is checksum
`81c8f2e075dfbbc3bd3eef8f2684dbfa698b1ffe9b56c55d3d32fde038b5c515`;
its ACL has one entry for the current Windows owner.

One guarded production transaction committed. A fresh verifier and a separate
read-only SQL transaction then agreed on all material facts:

- Kalyani 2026-09-16: 37 settled bills, 906,000 paise of bills/payments,
  213,000 Cash, 693,000 UPI and numbers 990–1026.
- Kalyani 2026-09-17: 35 settled bills, 753,000 paise of bills/payments,
  256,000 Cash, 497,000 UPI and numbers 1027–1061.
- Zero bill/payment mismatches, zero source incident bills and counters
  Kalyani 1061 / Kanchrapara 778.
- Five incident expenses total 38,000 paise. The latest Kalyani observation
  remains counted 520,000 and collected 500,000 paise; expected is 697,000,
  difference is -177,000 and zero later cash activity leaves 20,000 paise.
- The transferred tablet has exactly two non-overlapping intervals: the former
  Kanchrapara identity and current active Kalyani identity. They resolve 778 old
  bills and 829 old orders to the former label.
- The migration, bounded label function, both indexes and overlap trigger are
  live. `authenticated` has no direct history-table grant. No live shift or
  pending unexpired request existed at postflight.

No customer, employee, device or receipt identifier is recorded here.

The rehearsal bundle remained outside the repository under the operating
system's temporary directory. It contains production identifiers and is not
committed.
