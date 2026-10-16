# Design: A Sale Taken on Paper Says So

> Every question in `proposal.md` was answered by the owner on 2026-10-15. This
> design follows those answers; where one decides a section, the section names
> it (Q1–Q12).

## Context

A bill today is attributed three times over, and the schema insists on two of
them:

- `bills.counter_device_id` is `not null`, referencing `counter_devices`, whose
  `id` **is** an `auth.users` id: a tablet is a sign-in principal.
- `bills.biller_profile_id` is `not null`, referencing `profiles`.
- `bills.counter_shift_id` is nullable (the retired `shift_id` was made nullable
  in `20260811000001`), but every command-written bill has one.

Fourteen triggers fire on `bills`. What each does to a paper bill:

| Trigger | Effect on a paper bill |
|---|---|
| `bills_command_insert` | Refuses an insert by a signed-in caller unless `app.billing_command = '1'`. The paper function sets it, as every billing command does. |
| `bills_assign_number` | Allocates the next number in the outlet's sequence (Q3). |
| `bills_prepare_clocks` | Inside a billing command it trusts the supplied clocks. The paper function supplies both. |
| `bills_business_date_valid` | Refuses a business date its timestamps contradict under the outlet's cutover. Applies unchanged: the stated time must fall in the stated business day. |
| `bills_snapshot_customer_tier` | With a customer (Q8), records the membership at the stated time, as for any bill. |
| `bills_points_on_settle` / `_on_void` | With a customer, earns at the outlet's rules, and reverses on void (Q8). |
| `bills_receipt_after_settle` | **Would queue a receipt SMS** for a bill with a customer and a valid +91 mobile once delivery is enabled. Q8 says no SMS; see *No receipt SMS*. |
| `bills_mint_public_link` | Mints a receipt link. Harmless: nothing sends it. |
| `bills_stamp_departure_exception` | Concerns a tablet delivering after its operator left. With no shift, `recorded_after_shift_end` stays false. Apply confirms it does not dereference the shift. |
| `bills_discount_total_guard` / `bills_payment_total_guard` | Apply unchanged: a paper bill's arithmetic is a bill's arithmetic. |
| `bills_append_only` / `bills_no_delete` / `bills_void_only` | Apply unchanged. A paper bill is voided like any other. |

Cash and UPI live in `bill_payments`, which the drawer and every revenue read
already sum. #76 states the property this change depends on: counter money
agrees on every screen *because every screen sums the same settled bills*.

## Decision: a paper sale is a row in `bills`

Same table, same line items, same payments, same numbering, same void. A paper
bill differs in four new columns:

- `entry_source text not null default 'counter'`, `'counter'` or `'paper'`.
  Every existing row, and every row a published build writes, is `'counter'` by
  the default.
- `entered_by uuid null references profiles(id)` and
  `entered_at timestamptz null`, stamped by the function from the caller's own
  session, never accepted from the payload (the pattern of attendance's
  `check_in_entered_by`).
- `entry_payload_hash text null`, the canonical hash (`billing_payload_hash`) of
  the outlet and the payload sent, which is how the same written order sent
  again is told from different content under its id.

and in two columns that become nullable: `counter_device_id` and
`biller_profile_id` (`alter column … drop not null`, which `lint:migrations`
admits). A paper bill stores null in both, and in `counter_shift_id`.

There is no "time not recorded" column: every paper bill carries a time (Q2).

### Rejected: a separate `paper_sales` table

It keeps `bills` untouched, which is its whole appeal. But every reader of
revenue — Overview, the Ledger, Analytics, the drawer, the month P&L, and #76's
single definition — would have to learn a second source, and each one that did
not would under-report silently, with nothing failing. Paper sales also need
everything a bill already has: line snapshots, discounts, tender split,
numbering, customer linking, points, voids.

### Rejected: a "paper till" per outlet

A `counter_devices` row named *Paper* would satisfy the `not null` with no
schema change. But a device's id is an `auth.users` id, so the paper till would
be a sign-in principal that never signs in, and the bill would still need a
biller. It is the invented tablet of 1 October with an honest name, and the
owner's objection was to the invention, not to the name.

### Rejected: day totals and summary bills

Retired with the manual ledger (#12), and refused again by the owner (Q4): one
bill per written order keeps average order value and dish counts true.

### Rejected: an entry screen

Refused by the owner (Q5): paper days are hundreds of orders, entered by an agent
or by commands. A screen would be the largest part of the change and nobody
would use it.

### Rejected: a change gate

The owner asked whether one was needed (Q9). A gate here would hold back a
function nobody calls except deliberately, and a mark that renders only on bills
that function wrote; it could not hold back the migration, and could not take
back a paper bill once written. The proposal says `No gate:` with that reason,
and the way out is the script's undo.

## A rule the database holds (Q12)

One new check on `bills`, in one statement:

`bills_entry_source_attribution`, in
`20261026000000_a_sale_taken_on_paper_says_so.sql` under the inline
`-- release-lint: allow constraint` exception that records the owner's agreement:
a counter bill has a tablet and a biller and no enterer, entry time or hash; a
paper bill has none of tablet, biller, counter shift, retired shift or order,
and has all three. It is validated on creation, so every existing row satisfied
it (every one has a tablet and a biller, both `not null` until this migration),
and the full pgTAP suite and seed load with it in place.

## The write path

One `security definer` function, a new name so no published build calls it:
`record_paper_bill(p_bill_id uuid, p_outlet_id uuid, p_payload jsonb) returns jsonb`, one bill per
call, so a file of five hundred orders is five hundred small idempotent calls and
a failure stops at one order rather than rolling back a day.

- **Authority is re-derived from the caller's session (Q1)**: the owner for any
  outlet; a Franchise Admin only for an outlet they manage, through the same
  assignment helpers every manager write uses. **A counter tablet's session is
  refused**, and so is a Biller's or Employee's. The payload names no person.
- **Outlet and day (Q6)**: the outlet may be marked closed. The business date
  must be on or before the outlet's current business date. The stated time must
  resolve to that business date through the outlet's cutover.
- **Idempotent on `p_bill_id`**, exactly as `billing-command-contract` requires
  of a command: the same id with the same content returns the recorded bill and
  its number; the same id with different content is a conflict, not an
  overwrite.
- **Totals go through the same validation a counter bill does.** The payload is
  compact (dish, quantity, an optional stated price and line discount, an
  optional flat bill discount, payments, an optional customer); the function
  builds the full payload a till would send and runs the counter's own
  `billing_content_payload_well_typed`, `billing_points_shape_ok`,
  `billing_validate_totals`, `billing_validate_discounts` and
  `billing_validate_payments` over it, so `lint:totals` keeps guarding one
  arithmetic. The total rounds up to the rupee as at the counter. A bill discount
  is a flat amount with `source = 'biller'`; the counter's discounts carry no
  reason column, so neither does a paper bill's (Q7's "with its reason" has
  nowhere to live). **A dish given free is billed at ₹1** (owner, 2026-10-16:
  "that's something we already do today"): the script's ` free` states a ₹1
  price, so a wholly free order is still a bill, of ₹1 a dish.
  `bills_total_whole_rupees` and the payment guard require at least ₹1 and one
  payment, as at the counter, and stay as they are. The function still accepts
  a whole-line discount, stored with `discount_percent_bp = 10000`, for a raw
  call that wants one; the script no longer sends it.
- **Line items snapshot name and unit price** from the outlet's menu item named
  in the payload. The unit price defaults to the menu's current price and may be
  stated, because a sheet entered a week later may predate a price change; the
  stated price is what the customer paid, and it is what the snapshot keeps.
  A dish not active on this outlet's menu is refused, naming it. The counter's
  `billing_validate_lines` is not used: it requires the menu's current price,
  which is exactly what a stated price is not, so the function checks the dish
  against `menu_items` itself.
- **Tender**: cash, UPI, or both, as `bill_payments` rows summing to the total.
- **Customer (Q8)**: an optional phone and name. The phone is normalised and
  linked through the same path a counter command uses
  (`billing-command-contract`: *the server links the sale to the customer, from
  the phone it was given*), so a paper bill earns points at its outlet. It earns
  under the outlet's rules **as they stand when it is entered**, because
  `bills_points_on_settle` reads the outlet's current settings and cannot be
  edited; recorded in `docs/LIMITATIONS.md`. A phone that is not an Indian mobile
  is refused rather than dropped, so the transcription is fixed. A paper bill
  never **spends** points: the payload has no field for it.
- **It is online only.** It is an admin's action run by an agent or a terminal,
  never the counter's: no outbox entry, nothing queued.

### No receipt SMS

`bill_receipt_enqueue` runs as a deferred constraint trigger at commit and
inserts into `bill_receipt_deliveries` with `on conflict (bill_id) do nothing`.
It cannot be edited (published builds' bills rely on it). So the paper function,
after inserting a bill that carries a phone, inserts that bill's delivery row
itself, already `skipped`; at commit the trigger meets the conflict and does
nothing, and `bill_receipt_claim` never picks up a skipped row.
`failure_code` is constrained to five values and adding one is a constraint
change, so the row carries `failure_code = null` with `state = 'skipped'`, which
the state check admits; the receipt line reads a skipped row as *SMS not sent*.
pgTAP proves a paper bill with a valid mobile, at an outlet with delivery
enabled, never reaches `bill_receipt_claim`.

### The undo

Cancelling uses the path Billing history's **Cancel this bill** already uses,
`void_billing_bill`, called by the signed-in admin with a reason, once per bill
in the file. It takes no shift for an admin's void and checks only that the
caller is the owner or the bill's outlet's manager, so it accepts a paper bill
unchanged; no `void_paper_bill` was needed. Points earned are reversed by the
existing `bills_points_on_void` (pgTAP). The script derives each void's command
id from the bill, and voids only bills still settled, so a second undo changes
nothing.

## How it is called: `scripts/paper-sales.mjs`

The documented entry path, and the runbook in `docs/OPERATIONS.md` explains it
end to end.

- **Input is a CSV of orders**, one row per written order: outlet code,
  business date, time (required, Q2), dishes and quantities, cash amount, UPI
  amount, optional flat discount, optional phone and name, and a
  stable **order key** the transcriber writes (for example `puja26-d1-p2-07`:
  day, page, line). The script derives each bill's UUID from the outlet and the
  order key (UUIDv5), so a rerun of the same file, or of a corrected file, is
  recognised order by order, without the transcriber handling UUIDs.
- **It dry-runs by default.** It resolves dishes against the outlet's menu,
  computes every bill, and prints the day's totals: orders, items, cash, UPI,
  discounts, bills already recorded. Those are the figures to hold against the
  sheet's own totals and the UPI app. `--commit` writes. `--undo --reason
  "<why>"` cancels the file's recorded bills, and dry-runs the same way first.
- **It signs in as the person entering**, with their own credentials from an
  untracked `.env`, and calls the function with that session, so `entered_by` is
  true by construction and the authority check is the real one. It never uses
  the service-role key: a service-role call has no `auth.uid()`, so it would have
  nobody to record.
- **`--target staging` first, then production.** Staging is where a malformed
  file is found.
- Raw SQL remains possible: a session that sets `request.jwt.claims` to the
  enterer's profile and calls the function is the same call, the shape the
  drawer and attendance repairs already use. The script is the documented path
  because it does the dry run.

## RLS

No new table. Paper bills are visible exactly where an outlet's bills are
visible today, through the existing outlet-scoped `bills` policies. No insert
policy is added: the definer function is the only writer. A counter tablet reads
the bills of its own shifts, and a paper bill has no shift, so no tablet reads
one — correct, and it means nothing at the counter changes. Tests: a manager of
one outlet calling the function for another outlet is refused; a counter tablet
session, a Biller and an Employee are refused; an anonymous call is refused.

## Money

Integer paise throughout; no new arithmetic. **The drawer**: a cash paper bill
raises the expected cash of the interval containing its payment time, as any
cash bill does. Entered after a count, it is late-arriving work beside that
count: `drawer_recent_cash_bills` lists as late every settled bill whose
`synced_at` is after the count, and a paper bill's `synced_at` is the moment it
was entered, which is the arrival the exception is about (pgTAP). The count
itself never moves.

## Offline semantics

None. The function is never called from the counter and the outbox never sees
it.

## Version skew — audited 2026-10-16

**What the audit found.** Every database function reading `public.bills` was
listed from the live catalogue after the migration (37 of them). **None
inner-joins a bill to `counter_devices`, `counter_shifts`, `shifts` or
`profiles`**: Overview, the Ledger, Analytics (both versions), `revenue_figures`,
the drawer's receipts and late list, customer activity and the counter snapshot
all sum or list bills by outlet and date, so a paper bill counts in every one of
them with no `_v2` and no published build under-reporting.
`billing_event_device_labels` joins the till's history and so returns no label
for a paper bill, which is right: it has none. `counter_operations_snapshot`
reads by counter shift and so never sees one, also right. On the client, a
published build's Billing history shows a paper bill as *by Counter operator*
with no till (its biller embed is null), and Customers' bill list the same.
Nothing crashes and no figure is wrong; that line is the one untrue thing an old
build says, and it goes when the device reloads. Nothing reports per biller or
per tablet beyond those labels.

What the audit checked for, kept for the next change that touches bills:

A published build never writes a paper bill, but **it may read one**, and its
generated types say `counter_device_id: string` and `biller_profile_id: string`.

1. **Every SQL function and view that reads `bills`** (about fifty migrations
   mention the table) is listed with each **inner** join from `bills` to
   `counter_devices`, `counter_shifts` or `profiles`. An inner join drops a paper
   bill without an error. A function that sums money and drops paper bills
   would under-report revenue in every build that calls it, and **there is no
   gate to hide that behind**: it is fixed in place only if the fix is a
   correction every build should get (`-- release: emergency`, with the owner's
   agreement), otherwise by a `_v2` the new build reads. A function that lists
   bills for a tablet's shift is correct to drop them. **No paper bill is
   written in production until every money read counts it**, proved by a test
   per read that seeds one paper bill and asserts the figure moves.
2. **Every client read that renders a bill's till or biller** — Billing history
   above all, which resolves the till's name from the identity effective at
   payment — must render null as *from paper*. Apply records what a published build
   shows for a null on each such screen; it cannot be changed for that build,
   and the owner reads it before the first production entry.
3. **Per-person and per-tablet figures**, wherever they exist, gain a *Paper*
   bucket or say they count counter bills only.
4. **By-hour reads** include paper bills at their stated time (Q2). No delta to
   `sales-analytics`.

The new columns are additive with defaults; a published build's inserts are
unchanged and satisfy the new check.

## UI

The whole UI change is the mark. Billing history's row reads **from paper** where a
counter bill names its till and biller, and the expanded bill says *Entered by
<name> · <date>*. Any other screen that names a bill's till or biller (found by
audit step 2) does the same. Nothing is added to navigation. The shimmer is
unchanged because the row's shape is.

## Demo

The demo scenario gains a few paper bills at one outlet, so the mark is walkable
at `/demo`. There is no entry screen, so there is no demo write path to add.

## Risks

- **The audit finds a revenue read that drops paper bills in a published
  build.** Mitigated by the rule above: nothing is entered in production until
  every money read is proved to count one.
- **A guessed time misplaces cash around a mid-day count** (Q2). Bounded by the
  exception the drawer already raises, and visible because the bill says Paper.
- **Out-of-order numbers at an outlet that also has a counter** (Q3). The price
  of not renumbering; explained by the mark.
- **A transcription error.** The dry run's totals against the sheet and the UPI
  app are the check; the undo is the repair.
