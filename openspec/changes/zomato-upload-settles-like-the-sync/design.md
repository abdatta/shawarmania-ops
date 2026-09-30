# Design: zomato-upload-settles-like-the-sync

## Context: what the workbook proves, measured

Read on 2026-09-30, with the owner's permission, from three real Kalyani payout
workbooks: 14-20 Sep (PAID), 21-27 Sep (TO BE PAID) and 27 Jul-02 Aug (PAID). The
owner's download and the API's `download-report` produce the same file.

| Where | What it holds | Paid week | Unpaid week |
|---|---|---|---|
| `Summary`, `Payout Breakup` | formulas only | `#REF!` / 0 | `#REF!` / 0 |
| hidden `HSummary`, row 2 | report period `21 Sep 2026 - 27 Sep 2026`, res id, PAN/GSTIN/address, bank UTR | UTR present | UTR empty |
| `Order Level` `Settlement status` | per order | `settled` | `pending` (a zero-payout cancelled order reads `settled`) |
| `Order Level` `Settlement date` / `Bank UTR` | per order | a date / a UTR | `NA` / `NA` |
| `Order Level` `Unsettled Amount` | per order | `0.0` | equal to the order payout |
| `Addition Deductions Details` | Additions; A) growth services (Ads, **TDS 194O**); B) Hyperpure; C) Other; D) Adjustments from previous weeks; `Total Deductions`; each row with its own Settlement Status | `settled` | `pending` |

Zomato's own net payout formula (`Payout Breakup`!D57) is order figures, less
growth services (E), less Hyperpure (F), less other (G), plus additions (H). The
order-level payout column already contains each order's cancellation refund. So a
week's payout is **Σ order-level payout − Total Deductions + Total Additions**, all
three read from the file.

`Order Level` also carries `Customer ID`. It is personal data, and nothing here
reads it.

## D1. Paid is proved by the order rows, not by a header cell

A Zomato workbook may settle only when every order row reads `settled`, carries no
unsettled amount, and every order with a non-zero payout names a bank UTR. Every
row on the deductions sheet must also read `settled`. Anything else refuses the
upload, naming how many orders are still pending, and writes nothing.

*Rejected:*
- **`HSummary`'s UTR cell alone.** It is found only by position in a hidden sheet
  beside PAN and GSTIN. The order rows state the same fact once per order, under
  named headers.
- **Asking the owner to confirm the week is paid.** The file already knows, and a
  tick-box is how a TO BE PAID week gets settled by mistake.
- **Settling anyway and letting a later file revise it.** A settled day is final by
  contract, which is exactly why a TO BE PAID week must not become one.

## D2. The week comes from the file's report period, never from order dates

The cycle is the `DD Mon YYYY - DD Mon YYYY` period, found **by pattern** anywhere
in `HSummary` rather than by cell position. Every order's IST calendar date must
fall inside it. With no period found, the upload is refused.
`operator_cycle_ref` is left for the ingest to derive from `cycle_start`, exactly
as it does for the sync, so both paths name one week once.

*Rejected:*
- **The first and last order dates (today's behaviour).** A Monday with no Zomato
  order moves the start date and files a second reconciliation for the same week.
- **The `Week No.` column.** It is a Zomato-internal number and says nothing about
  dates.

## D3. One restaurant per file, and it must be one this person may write for

A workbook's order rows must all carry one res id. It must map to an outlet in
the caller's permitted map. The payload names it as `restaurant_ref`, so the
ingest's existing checks (enabled, same outlet) apply. An unmapped restaurant is
refused **by number**, instead of today's silent skip, which "succeeded" having
written nothing. A multi-restaurant workbook is refused, because deductions carry
no reliable restaurant. The Hyperpure rows name **22675834 (Kanchrapara)** even
when Kalyani's payout paid them.

## D4. Reconciliation: Zomato's totals against the itemised lines

- **Stated payout** = Σ order-level payout − the file's `Total Deductions` line +
  its `Total Additions` line.
- **Computed** = what the payload itemises, which is exactly the ingest's own
  arithmetic: Σ order net − Σ deductions + Σ signed cycle deductions.

The parser checks both **before** calling the ingest. If they differ by more than
the ingest's ₹1 tolerance, it refuses with both amounts and the difference, so an
upload never marks days disputed. A clean upload then passes the ingest's gate on
the same numbers.

**Money:** each cell becomes integer paise once, through `toPaise` (round half
away from zero on ×100). All sums are integer sums. A 55-order week drifts at
most a few paise against Zomato's unrounded figures, which is why the tolerance
is a rupee. This is unchanged from the sync.

*Honestly stated:* this check is the file against itself. It catches a line the
parser failed to itemise or misclassified, which is its purpose. It is **not** a
second witness to the bank transfer. D5 supplies that witness when one exists.

*Rejected:*
- **Stated = Σ order payouts (today's behaviour).** It cannot fail.
- **Asking the owner to type the payout from Zomato's payouts page.** It
  reintroduces typing into a path whose point is to need none. The file's own
  totals are the same figure.

## D5. A week already settled is not rewritten

Before ingesting, the Edge Function reads the reconciliation for (outlet,
`zomato`, cycle start):

- **`reconciled`, or disputed and accepted:** nothing is written. The answer says
  the week is already settled, and whether this file agrees with the held payout
  to within the tolerance, naming both figures when it does not.
- **`disputed` and not accepted:** the upload proceeds. The spec already lets a
  later authoritative read resolve a dispute, and a dispute is exactly when a
  person reaches for the file.
- **None:** the upload proceeds.

*Rejected:*
- **Relying on the ingest to skip settled days.** It does skip them, but it
  would still rewrite the reconciliation row and insert deductions keyed
  differently from the sync's (D6), which would book a cost twice.

## D6. What each deduction-sheet line becomes

| Workbook line | Payload | Why |
|---|---|---|
| B) Hyperpure | `deductions`, category `Hyperpure`, `source_ref` `hyperpure:<order no>`, dated to the period start | Subtracted for reconciliation. The reserved-category trigger then skips the expense row, because the Hyperpure reader already booked that purchase under its own order number. |
| A) `TDS 194O` | `cycle_deductions`, `tax_deducted_at_source`, negative | A tax, not a spend on any day |
| A) any other line (Ads…) | `deductions`, category = Zomato's type text, `source_ref` `<type>:<invoice or campaign id>` | Matches the sync, which books Zomato's expense rows as expenses |
| C) Other deductions, D) Adjustments from previous weeks | `cycle_deductions`, `other_adjustment`, negative | Belongs to no trading day |
| Additions (194H, rebates) | `cycle_deductions`, `other_adjustment`, positive | Same |

**The identity gap, stated rather than hidden.** The sync keys a Zomato
deduction on the expenses tab's `expense_id`. The workbook never shows that id,
only the invoice or campaign id. So an ad booked by the sync and again by an
upload would be two expense rows. D5 prevents an upload after the sync has
settled the week. An upload settling a week *first*, followed by the sync, could
still book an ad twice. Since go-live every Zomato deduction has been a Hyperpure
bill, which neither path writes, so the gap costs nothing today. It is recorded
in `docs/LIMITATIONS.md` and in `openspec/todos/`, and the real fix is for the
sync to read the same sheet.

**TDS.** The upload follows Zomato's formula, so a TDS week reconciles. The sync
reads the expenses tab, which carries no TDS line, and assumes TDS lives inside
order payouts. The first TDS week will show which is right: if the sync is wrong,
its gate names the difference. Unresolved by design (see proposal non-goals).

## D7. A refusal reaches the owner as its reason

- **Screen side.** `functions.invoke` puts the HTTP `Response` in
  `error.context`, so the adapter reads its JSON body's `detail`, then `error`,
  and only then falls back to the generic line.
- **Edge Function side.** The ingest's own contract refusals (SQLSTATE `22023`
  bad payload, `42501` not permitted) come back as `422` carrying their message,
  instead of `500 ingest_failed`. Those messages name a restaurant or a rule,
  never a customer. Anything else stays a `500`.

## D8. The sync half (companion repo)

`isFinal(cycle)` is true when Zomato's status is exactly `PAID`. A closed week
that is not final is posted `provisional`, carrying its workbook orders
(commission known) and no stated payout. The ingest's gate therefore does not
run, and the days show net figures marked provisional. Orders are read from the
newest closed cycles until two final ones are in, so a Monday run still carries
two settled weeks and a held payout is re-read until it settles. It was measured
against production by a read-only rehearsal on 2026-09-30: 21-27 Sep posted
provisional, 14-20 and 07-13 Sep settled, and ops answered `ok`.

## Offline and RLS

Nothing here is offline. An upload already refuses without a connection. No
table, policy or migration changes: the Edge Function reads
`aggregator_cycle_reconciliations` with the service client, **for an outlet it
has already proved the caller may write for**. The ingest keeps its permitted-
outlet check.
