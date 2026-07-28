# Data Model

> The authoritative version is the migration set in `supabase/migrations/` (landed with `data-model-and-tenancy`, 2026-07-26); this page explains intent and invariants. Where implementation settled an open question or diverged from the original sketch, the decision is recorded inline with its reason.

## Conventions

Applied everywhere, without exception:

- **Primary keys** are `uuid`. Records created at the counter use **client-generated** UUIDs so an offline device can reference its own rows before they reach the server.
- **Money** is `bigint`, in **paise**, suffixed `_paise`. Never `numeric`, never `float`.
- **Timestamps** are `timestamptz`, stored UTC, suffixed `_at`.
- **Business dates** are `date`, named `business_date`, written explicitly. Never derived from a timestamp at read time — see [Glossary](GLOSSARY.md#business-date).
- **Every outlet-scoped table** carries `outlet_id uuid not null references outlets(id)` and ships an RLS policy in the same migration.
- **Enums** are Postgres enum types, so an invalid value is a constraint violation rather than a bad row.
- **A required text column cannot be blank.** `not null` stops a column being *absent* and says nothing about it being *empty*, and an empty string satisfies it while satisfying nothing a person needs — which is how an outlet with no name reached production. Every `not null` text column a human types and a human later reads to identify something carries `check (length(btrim(<column>)) > 0)`, named `<table>_<column>_not_blank`. `btrim` is the point: whitespace-only is the case a naive `<> ''` guard still lets through. The forms refuse it too, but the forms are the convenience — this is the boundary. Nullable columns are deliberately exempt: a blank optional field is stored as `null`, which is the correct representation of *not known*.
- Rows are **soft-deleted** (`is_active`, or a status enum) wherever history matters. Menu items and employees are never hard-deleted — old bills and attendance records reference them. **One row can be hard-deleted, and only one: an `outlet` that nothing anywhere references** (see below). The rule protects history; an outlet with no staff, no accounts, no recorded days and no bills has none.
- **Client privileges are explicit grants**, not defaults: the final migration is the manifest of every verb a session may even attempt (current Supabase images grant clients nothing automatically). DELETE is granted to **exactly one** client capability — the Super Admin deleting an `outlet` nothing references, added by `20260728000001_outlet_deletion.sql` — and to no client role on any other table. `anon` holds nothing anywhere.

## Tenancy and identity

**`outlets`** — the isolation unit.
`id`, `code` (short slug, e.g. `kalyani`), `name`, `location_label`, `staff_code_prefix`, `address_line1`, `address_line2`, `city`, `district`, `pincode`, `phone`, `latitude`, `longitude`, `geofence_radius_m` (default 150), `business_day_cutover` (`time`, default `04:00`), `is_active`, `created_at`.

Coordinates and radius exist for attendance verification. The cutover time is what makes cross-midnight trade reconcile correctly.

`staff_code_prefix` is the three characters every staff code at this outlet begins with — `KAL`, `KAN` — unique across outlets and enforced as such. It is stored rather than derived from `code` at read time, because a derivation can collide retroactively: `kalyani` and a future `kalimpong` both truncate to `KAL`, and by then `KAL-` codes belong to somebody. When an outlet is created without one the database derives it (first three alphanumerics of the code, uppercased, numeric suffix if taken), so the form pre-fills a proposal rather than asking a question. **It freezes the moment any roster row exists at that outlet**, enforced by `outlet_prefix_guard`: every code already issued reads from it, and re-pointing it would leave them naming something that no longer exists.

**The one table a client may delete from.** `outlets_delete` lets the Super Admin remove an outlet, and seventeen foreign keys — not one of which cascades — mean the delete succeeds only while nothing anywhere references it. There is no bookkeeping column and no maintained list: the check *is* the live referential state, so an outlet whose staff and stock have been moved elsewhere becomes deletable on its own with nothing to re-mark. A deactivated account still counts as a reference. `public.outlet_reference_counts(uuid)` reads the foreign-key set from the catalog and reports what is still attached, so a table added later is covered without anyone editing it.

`is_active` remains the answer for an outlet that traded — its staff, attendance and bills are history the business keeps. Deletion is for an outlet that should never have existed, and the app offers it only once the outlet is already marked closed.

**`profiles`** — one row per app login, `id` matching `auth.users.id`.
`id`, `full_name`, `phone`, `role` (`super_admin` | `franchise_admin` | `biller` | `employee`), `outlet_id` (null only for `super_admin`), `is_active`, `created_at`.

Mirrored into JWT claims by the access-token hook. `is_active` is checked in policies directly so deactivation takes effect immediately rather than at next token refresh.

**`counter_devices`** — enrolled tablets.
`id`, `outlet_id`, `label`, `enrolled_by`, `enrolled_at`, `revoked_at`, `last_seen_at`.

A revoked device's session must stop working immediately, so policies on billing tables check `revoked_at is null`.

## Menu

**`menu_categories`** — `id`, `outlet_id`, `name`, `sort_order`, `is_active`.

**`menu_items`** — `id`, `outlet_id`, `category_id`, `name`, `description`, `price_paise`, `is_veg`, `is_available`, `sort_order`, `created_at`, `updated_at`.

Menu is per-outlet from day one. Two outlets may share item names and differ on price, and a franchise will want its own availability. A shared master catalogue is a future convenience, not a foundation — see [Limitations](LIMITATIONS.md).

`is_available` is the biller-facing toggle (sold out today). `is_active` on the category and soft-deletion on items handle permanent removal.

## Billing

**`bills`**
`id` (client UUID), `outlet_id`, `bill_number` (server-assigned, per-outlet sequential), `business_date`, `biller_profile_id`, `counter_device_id`, `shift_id`, `customer_id` (nullable), `customer_name` (nullable), `customer_phone` (nullable), `subtotal_paise`, `discount_paise`, `tax_paise`, `total_paise`, `pricing_mode`, `payment_method`, `status` (`settled` | `void`), `voided_by`, `voided_at`, `void_reason`, `created_at` (client clock), `synced_at` (server clock).

- `payment_method`: `cash` | `upi` | `card` | `swiggy` | `zomato` | `other`.
- `pricing_mode`: `no_tax` | `gst_inclusive` | `gst_exclusive`. **v1 always writes `no_tax` and `tax_paise = 0`.** It exists now so that when GST is enabled, historical bills stay unambiguous instead of being silently reinterpreted under new rules.
- `unique (outlet_id, bill_number)` — bill numbers are unique within an outlet, not globally.
- **`bill_number` is assigned by the database**: a `before insert` trigger allocates from a per-outlet counter row (`bill_number_counters`, invisible to clients) inside the insert transaction — race-safe, and gapless because a failed insert rolls the allocation back with it. A client-supplied value is overwritten, never trusted; the column's `default 0` exists only so generated client types treat it as server-supplied. *Divergence:* this replaced the "issue bill number" Edge Function sketched in the architecture — a trigger is atomic with the insert, an extra network hop cannot be.
- Both clocks are kept. The client clock is what the biller experienced; the server clock is what the system can trust. When they disagree materially, that is a signal worth surfacing.
- **Append-only once settled**, enforced by trigger: the only legal update is `settled → void` touching only the void columns, role-gated to the outlet's Franchise Admin and the Super Admin; deletes are refused even for privileged writers. A mistake is voided and re-rung; totals are never edited in place.
- `business_date` is **validated at write time**: a bill (or shift, or attendance check-in) whose stated date contradicts its timestamp under the outlet's cutover is rejected, not repaired.

**`bill_items`**
`id`, `bill_id`, `menu_item_id` (nullable reference, for analytics only), `item_name` (**snapshot**), `unit_price_paise` (**snapshot**), `quantity`, `line_total_paise`.

The snapshot is the point. `menu_item_id` is nullable and advisory — if an item is later removed, the bill still reads correctly. Never compute a historical bill's value by joining to `menu_items`.

**`shifts`** — `id`, `outlet_id`, `counter_device_id`, `biller_profile_id`, `business_date`, `opened_at`, `closed_at`. A shift never spans two business dates.

**`customers`** — `id`, `outlet_id`, `name`, `phone`, `first_seen_at`, `last_seen_at`, `bill_count`, `total_spend_paise`.

Scoped per outlet, which means the same person visiting both outlets is two records. That is the correct v1 trade: cross-outlet customer identity would require reading across the isolation boundary, and the business value is small next to the risk. Noted in [Limitations](LIMITATIONS.md).

## Inventory

**`inventory_items`** — `id`, `outlet_id`, `name`, `unit` (`kg` | `litre` | `packet` | `piece`), `current_quantity` (`numeric`), `purchase_cost_paise` (per unit), `low_stock_threshold`, `is_active`, `last_updated_at`.

**`inventory_movements`** — `id`, `outlet_id`, `inventory_item_id`, `movement_type` (`added` | `used` | `wasted` | `correction`), `quantity_delta` (`numeric`, signed), `unit_cost_paise` (nullable; set on `added`), `note`, `recorded_by`, `business_date`, `created_at`.

**The movements ledger is the truth; `current_quantity` is a derived cache** maintained by trigger. This is what makes stock auditable — "why does the system think we have 4kg?" is always answerable by reading the ledger. A correction is itself a movement with a note, not a silent overwrite.

Quantity is `numeric`, not integer paise — 1.5 kg is a real quantity. Money on these rows still follows the paise rule.

## Expenses

**`expenses`** — `id`, `outlet_id`, `business_date`, `category`, `description`, `amount_paise`, `payment_method`, `recorded_by`, `created_at`.

`category`: `raw_materials` | `salaries` | `rent` | `electricity` | `packaging` | `maintenance` | `marketing` | `other`.

Only expenses with `payment_method = 'cash'` affect the daily cash record.

## Employees and attendance

**`employees`** — `id`, `outlet_id`, `profile_id` (nullable), `employee_code` (issued, see below), `full_name`, `phone`, `salary_paise`, `address`, `role_title`, `employment_status` (`active` | `inactive` | `terminated`), `joined_on`.

**`employee_code` is issued by the database, never asked for.** A `before insert` trigger fills a blank or absent code with the outlet's `staff_code_prefix`, a hyphen, and four characters of Crockford base32 — `KAL-7KQ2`. The alphabet drops `I`, `L`, `O` and `U` because these codes are read aloud across a counter and dictated down a phone. A code that *was* supplied is stored unchanged, so an import arriving with its own numbering keeps working. Blank and absent mean the same thing on insert (*issue me one*) and different things on update, where `employees_code_not_blank` still refuses a blank outright — the row already has a code, so clearing it is a mistake rather than a request.

The column is **display-only**: nothing keys on it. `attendance.employee_id` references the roster row's UUID, there is no foreign key on `employee_code`, and no query looks a person up by it. Its whole job is telling two people with the same name apart in three lists. **Only the Super Admin may change one**, enforced by `employee_code_guard` rather than by the form — `employees_update` is a row policy, and a row policy permits every column on a row it permits, so a restriction living in the UI would be decoration.

`profile_id` is nullable because an employee record can exist before — or without — an app login. The employee roster and the auth system are deliberately separate concerns.

**`attendance`** — `id`, `outlet_id`, `employee_id`, `business_date`, `status` (`present` | `absent` | `half_day` | `leave`),
check-in: `check_in_at`, `check_in_lat`, `check_in_lng`, `check_in_accuracy_m`, `check_in_distance_m`, `check_in_source` (`phone` | `counter_tablet`),
check-out: the same five fields prefixed `check_out_`,
override: `override_by`, `override_reason`, `override_at`.

`unique (employee_id, business_date)`.

Captured coordinates, GPS accuracy, **and** computed distance are all stored. Storing the inputs alongside the verdict is what makes a disputed check-in reviewable instead of a black box — "the app said no" is not an acceptable answer to an employee.

## Daily cash

**`cash_withdrawals`** — `id`, `outlet_id`, `business_date`, `amount_paise`, `reason`, `withdrawn_by`, `recorded_by`, `created_at`.

**`daily_cash_records`** — `id`, `outlet_id`, `business_date`, `opening_cash_paise`, `cash_sales_paise`, `cash_expenses_paise`, `cash_withdrawn_paise`, `expected_closing_paise`, `actual_closing_paise`, `difference_paise`, `closed_by`, `closed_at`, `notes`. `unique (outlet_id, business_date)`.

The invariant:

```
expected_closing = opening_cash + cash_sales − cash_expenses − cash_withdrawn
difference       = actual_closing − expected_closing
```

The three derived inputs come from settled `cash` bills, `cash` expenses, and withdrawals for that outlet and business date. They are **snapshotted onto the record at close**, not recomputed on read — a bill that syncs late from an offline device must not silently rewrite a drawer count a manager already signed off. A late-arriving bill after close is a reconciliation exception, and should be surfaced as one.

This is structural, not conventional: clients cannot write `daily_cash_records` at all. The `close_business_day()` function is the only path — it computes the three derived inputs server-side in the same transaction that writes the snapshot, is available only to an active Franchise Admin of that outlet (deliberately not the Super Admin), and refuses a duplicate close. CHECK constraints hold both equations on every row regardless of writer.

## Alerts

**`alerts`** — `id`, `outlet_id`, `raised_by`, `subject`, `message`, `category` (`inventory` | `equipment` | `cash_mismatch` | `employee` | `supplier` | `other`), `priority` (`low` | `normal` | `high` | `urgent`), `status` (`open` | `acknowledged` | `resolved` | `closed`), `created_at`.

**`alert_responses`** — `id`, `alert_id`, `responder_profile_id`, `message`, `created_at`.

Alerts are the one place a Franchise Admin deliberately writes data the Super Admin reads, and the only cross-role write path in the system.

## Two modelling traps in this domain

### 1. Double-counting food cost in profit and loss

Raw materials appear **twice** in the natural reading of this schema: once as an `expenses` row with category `raw_materials` when stock is bought, and again as inventory `used`/`wasted` movements valued at purchase cost. Summing "all expenses" *and* "food cost" double-counts.

The P&L therefore has two explicit modes, and the UI must always say which one it is showing:

| Mode | Formula | Answers |
|---|---|---|
| **Cash basis** | `sales − all expenses` | "Did more money come in than went out?" |
| **Consumption basis** | `sales − non-raw-material expenses − inventory consumed` | "Did we make money on what we actually sold?" |

Cash basis is simpler and matches the drawer. Consumption basis is more accurate month to month, because it does not punish a period for a bulk purchase. Neither is more correct in general — but silently mixing them is always wrong.

### 2. Late writes rewriting closed periods

Offline bills can arrive after their business date has been reconciled. Any figure a human has signed off — a closed cash record, most obviously — must be **snapshotted, not recomputed**, and late arrivals must surface as exceptions rather than quietly changing history. Reports over open periods may recompute freely; reports over closed periods must not.

## Integrity checks, tested

Every check below is enforced by the schema and covered by the suites in `supabase/tests/`: pgTAP with simulated claims (`npm run test:db`) plus REST-level probes that sign seeded personas in through the real auth service (`npm run test:rls`).

- Every outlet-scoped table has an RLS policy, and the isolation suite covers it — by enumerating tables from the catalog and failing on any it cannot classify, so a new table without a test fails by name.
- `total_paise = subtotal_paise − discount_paise + tax_paise` on every bill.
- `line_total_paise = unit_price_paise × quantity` on every bill item.
- `(outlet_id, bill_number)` is unique, and per-outlet sequences have no gaps attributable to the client.
- An inventory item's `current_quantity` equals the sum of its movements' `quantity_delta`.
- `expected_closing_paise` matches the invariant above from its own snapshotted inputs.
- No bill's `business_date` disagrees with what the outlet's cutover implies for its `created_at`.
