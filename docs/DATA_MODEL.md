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
- Rows are **soft-deleted** (`is_active`, or a status enum) wherever history matters. Menu items and people (`profiles`) are never hard-deleted — old bills and attendance records reference them. **One row can be hard-deleted, and only one: an `outlet` that nothing anywhere references** (see below). The rule protects history; an outlet with no staff, no accounts, no recorded days and no bills has none.
- **Client privileges are explicit grants**, not defaults: the final migration is the manifest of every verb a session may even attempt (current Supabase images grant clients nothing automatically). DELETE is granted to **exactly one** client capability — the Super Admin deleting an `outlet` nothing references, added by `20260728000001_outlet_deletion.sql` — and to no client role on any other table. `anon` holds nothing anywhere.

## Tenancy and identity

**`outlets`** — the isolation unit.
`id`, `code` (short slug, e.g. `kalyani`), `name`, `location_label`, `address_line1`, `address_line2`, `city`, `district`, `pincode`, `phone`, `latitude`, `longitude`, `geofence_radius_m` (default 150), `business_day_cutover` (`time`, default `04:00`), `arrival_deadline` (`time`, default `13:00`), `is_active`, `created_at`.

Coordinates and radius exist for attendance verification. The cutover time is what makes cross-midnight trade reconcile correctly.


**The one table a client may delete from.** `outlets_delete` lets the Super Admin remove an outlet, and sixteen foreign keys — not one of which cascades — mean the delete succeeds only while nothing anywhere references it. There is no bookkeeping column and no maintained list: the check *is* the live referential state, so an outlet whose staff and stock have been moved elsewhere becomes deletable on its own with nothing to re-mark. A deactivated account still counts as a reference. `public.outlet_reference_counts(uuid)` reads the foreign-key set from the catalog and reports what is still attached, so a table added later is covered without anyone editing it.

`is_active` remains the answer for an outlet that traded — its staff, attendance and bills are history the business keeps. Deletion is for an outlet that should never have existed, and the app offers it only once the outlet is already marked closed.

**`profiles`** — one row per person, `id` matching `auth.users.id`.
`id`, `full_name`, `phone`, `is_active`, `role_title`, `created_at`.

Since `multi-outlet-people` (#22) the account carries **who somebody is and
whether they may sign in, and nothing about where they work.** Role, outlet and
the dates are on the assignment below, because a person may work at more than
one place and a column cannot say so.

**`assignments`** — who may do what, where. One row per person per role per
outlet.
`id`, `person_id`, `role` (`super_admin` | `franchise_admin` | `biller` | `employee`), `outlet_id` (null exactly for `super_admin`), `started_on`, `ended_on`, `created_at`.

A live row has `ended_on` null; **ending is a date, never a delete**, because
rows written under an assignment have to stay explicable. Two partial unique
indexes enforce one live assignment per person per outlet, and one live
`super_admin` row per person (two indexes rather than one, because null outlet
ids do not collide in a plain unique index). `person_id` cascades — one of
three identity-plumbing references permitted to cascade, alongside the invite
and private account-email row — because
an assignment is *placement* rather than history, and without it a
half-provisioned account could never be cleaned up. Every table that genuinely
is history still points at `profiles(id)` with NO ACTION, and any one of them
aborts the delete.

Every policy in the schema resolves scope from this table. Nothing about
authority is carried in an access token, so a grant or an ending bites at the
next request — see [Roles And Permissions](ROLES_AND_PERMISSIONS.md).

There is no access-token hook and no claim to mirror into: it was emptied by #22 and dropped once nothing registered it (2026-07-30), so no code path exists by which a token could be handed authority. `is_active` is likewise checked in policies directly, so deactivation takes effect immediately rather than at the next token refresh.

**The person is the account** (`staff-as-accounts`, #21): there is no separate
roster table and no link step. Every person receives one admin-chosen canonical
username, stored by Supabase Auth as
`<username>@login.shawarmania.invalid`. That reserved alias is the username's
provider encoding, not a real email and never a profile or contact field.
If a private email is associated with the account, either that email or the
username reaches the same Auth user and password.
A person who never opens the app still has a usable username and a pending
one-time code; there is no placeholder-address or *Needs an address* state.

`is_active` and an assignment's `ended_on` are **two independent facts**:
deactivation is the session lever and bites immediately; ending an assignment
is staff-list membership at *one* outlet — it removes the person from that
outlet's lists and new attendance days while every recorded day stays, and
leaves their other assignments and their account alone. Having left the
business is holding no live assignment anywhere, and is derived rather than
stored. No payroll column exists anywhere, by owner decision. **Deleting a
person with recorded history is refused by the foreign keys themselves**:
every FK onto `profiles(id)` is NO ACTION except three that are account
plumbing rather than history — invite, assignment, and account-email rows —
and a migration-time self-check aborts a deploy that ever introduces another.

**`account_invites`** — the single outstanding activation or admin-reset
credential for a person.
`id`, `profile_id`, `code_hash`, `issued_by`, `issued_at`, `expires_at`,
`consumed_at`, `superseded_at`.

The plaintext code is returned once and never stored. Preview parses the
person's current username from their Auth alias; redemption requires that
displayed username plus a matching new password. A username mismatch consumes
nothing. Unknown, expired, spent, superseded, and inactive-account codes remain
indistinguishable.

**`account_emails`** — zero or one private associated email per account.
`profile_id`, `email`, `created_at`, `updated_at`.

The table has RLS enabled, no client policy, and no privileges for `anon` or
`authenticated`. A deferred invariant makes the Super Admin requirement exact:
every person with a live `super_admin` assignment has one row. Another role may
have zero or one, so a future Franchise Admin email needs no new identity
migration. Current ordinary People creation does not collect one. The email is
a permanent alternate sign-in identifier; for a live Super Admin it is also
the foundation for later recovery or security features. Ending that role
retains the association until a separately authorized operation removes it.

**`invite_redemption_attempts`** and **`email_sign_in_attempts`** are
short-window abuse ledgers. They store hashes of caller IP and submitted
identifier, never raw addresses, and have no client-readable policy.

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

## Staff facts and attendance

Staff facts live on `profiles` — there is no employees table since #21, and no staff code since #22. What remains is `full_name` and `role_title`, updatable as an ordinary column-scoped RLS write (`profiles_update_staff`: the Super Admin for anyone, a Franchise Admin for people at outlets they manage). Access columns stay reachable only through the privileged function, and placement is an assignment with its own policy.

Staff codes were retired by `multi-outlet-people` (#22, owner decision
2026-07-29). #18 recorded that their only job was telling two same-named people
apart in lists, and explicitly kept them meaningless; role title and joining
date do that without a second identifier for anybody to maintain, read aloud,
or get wrong. Nothing ever keyed on one. If a real staff numbering scheme
arrives, re-adding it is one migration and #18's archived design is the recipe.
(One-time **activation codes** are unrelated and unaffected.)

**`attendance`** — `id`, `outlet_id`, `person_id` (→ `profiles(id)`, no cascade), `business_date`, `status` (`present` | `absent` | `half_day` | `leave`),
check-in: `check_in_at`, `check_in_lat`, `check_in_lng`, `check_in_accuracy_m`, `check_in_distance_m`, `check_in_source` (`phone` | `counter_tablet` | `manual`), `check_in_entered_by`, `check_in_entered_by_name`,
the deadline that applied: `arrival_deadline`,
approval: `approved_by`, `approved_by_name`, `approval_reason`, `approved_at`, `approver_lat`, `approver_lng`, `approver_accuracy_m`, `approver_distance_m`.

**There is no check-out.** Ten columns and four constraints were dropped by
`attendance-approved-on-site` (#26, owner decision 2026-07-31), with a full
production dump taken beforehand and held outside the repo. Nobody used it, and
unused monitoring data is the kind [Security And Privacy](SECURITY_AND_PRIVACY.md)
says not to keep. A day is one arrival event.

**The approval columns were `override_*` until #26.** An override was the
exception path for a check-in the fence refused; approval is now the only path
for every check-in, so the word described nothing. The rename is faithful to what
was already stored — every historic override carried an approver, a time and a
reason, which is exactly an off-site approval under the new rule — so no existing
row changed meaning and none was recomputed. `approval_reason` became nullable in
the same change: an approval taken inside the fence on the row's own business day
is not asked for one.

**`approver_*` is the manager's own evidence**, mirroring the check-in leg
exactly and for the same reason. `approver_distance_m` is recomputed by the
trigger from the stored coordinates, never accepted from the client. Whether the
approver was *on site* is derived from it against the outlet's radius rather than
stored, so it cannot disagree with the coordinates it comes from. A position may
exist only beside the approval it belongs to; without one it would be stray
location data about a manager.

**`arrival_deadline` is the rule that applied**, stamped by the guard from
`outlets.arrival_deadline` when the check-in first lands and frozen with the rest
of the captured evidence. Lateness is judged against it, in the outlet's local
reckoning of the business day — so editing an outlet's deadline next month never
relabels a day recorded under the old one. Null on a day with no arrival, and on
every day recorded before deadlines existed.

`unique (person_id, outlet_id, business_date)` — per outlet since
`multi-outlet-people` (#22). A morning at Kalyani and an evening at
Kanchrapara on one business date are two rows, which is what they are; two rows
at the *same* outlet on one date are still refused.

**A `manual` event is an admin recording attendance on someone's behalf** — the escape hatch for a phone that cannot check in, the kiosk having been rejected. The `entered_by` / `entered_by_name` pair is stamped by the guard trigger from the acting session, never accepted from the client; constraints tie the pair to the `manual` source and forbid coordinates on manual events, so the geofence never judges them. Times must be in the past, on the outlet's current business day. A Franchise Admin enters for their own outlet, the Super Admin for any; an Employee or Biller session is refused.

A `manual` arrival is also **settled by the act of recording it**: the guard
stamps `approved_by` as the entering session, because the admin has already
attested to the arrival by typing it in and making them approve their own entry
would be a second signature on the same sentence. No approver position is
recorded, because none was read.

Captured coordinates, GPS accuracy, **and** computed distance are all stored. Storing the inputs alongside the verdict is what makes a disputed check-in reviewable instead of a black box — "the app said no" is not an acceptable answer to an employee.

**Three readings are not columns**: waiting for a manager, late, and absent
because nobody came. Each is derived from the stored rows and the outlet's clock
in one shared module (`src/features/attendance/attendance-record.ts`), so every
surface agrees by construction. No scheduled process manufactures attendance
rows — a job writing an absence per assigned person per day would need a backfill
for every past day and would race the late arrival it was trying to describe.

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
