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
`id`, `code` (short slug, e.g. `kalyani`), `name`, `location_label`, `address_line1`, `address_line2`, `city`, `district`, `pincode`, `phone`, `latitude`, `longitude`, `geofence_radius_m` (default 150), `business_day_cutover` (`time`, default `04:00`), `arrival_deadline` (`time`, default `13:00`), `billing_live_from` (nullable `date`), `is_active`, `created_at`.

Coordinates and radius exist for attendance verification. The cutover time is what makes cross-midnight trade reconcile correctly.
`billing_live_from` is the explicit per-outlet handover after which the temporary
ledger reads Cash and UPI from bills. It must be scheduled for a business date
that has not begun and becomes immutable once it starts.


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

Assignment starts and endings use the **Asia/Kolkata calendar**. The atomic
edit and Mark as left database commands pin their own timezone, so an action
between midnight in Kolkata and midnight UTC cannot end a row on the previous
day or produce `ended_on < started_on`.

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

**`counter_devices`** — the tablets set up at each counter.
`id`, `outlet_id`, `label`, `set_up_by`, `set_up_at`, `removed_at`, `last_seen_at`, `last_reported_unsent`.

`id` **is** the machine's `auth.users.id`. A tablet has no profile and no assignment: it is a machine principal, and what it may reach comes from the shift open on it rather than from anything it is.

At most one active tablet per outlet, by a partial unique index on `(outlet_id) where removed_at is null`. A removed tablet's session must stop working immediately, so every policy it goes through checks `removed_at is null` — and removal is permanent, taking the live shift and any pending request with it in the same transaction.

`last_seen_at` and `last_reported_unsent` are written by the tablet's own heartbeat and are read as **what it last said**, never as what is true now.

`counter_operations_snapshot(outlet_ids[])` is the management read boundary over
this hardware. It returns one server-timestamped snapshot of the live shift,
operator name, bill count, effective Cash and UPI, waiting orders and drawer Cash.
It is not stored state: Cash/UPI are derived through `effective_bill_payments`,
so a superseded allocation never contributes again. The database refuses every
caller except an active Super Admin or an assigned Franchise Admin of every
requested outlet; no customer identity, bill line or operator identifier leaves
the function.

**`counter_device_setup_codes`** — `id`, `outlet_id`, `label`, `code_hash`, `issued_by`, `issued_at`, `expires_at`, `attempts`, `consumed_at`, `consumed_device_id`, `superseded_at`.

Hash only, single-use, fifteen minutes, one live code per outlet. **No client role holds any privilege on this table at all** — not even select.

**`counter_shift_requests`** — `id`, `device_id`, `outlet_id`, `person_id` (nullable), `requested_username`, `code_hash`, `attempts`, `created_at`, `expires_at`, `resolution`, `resolved_at`, `shift_id`.

`person_id` is **nullable on purpose**: an unrecognised username produces a row exactly like a recognised one, so the tablet cannot be used to discover who works here. `resolution` is one of `confirmed`, `rejected`, `cancelled`, `superseded`, `exhausted`, `not_eligible`, and it is paired with `resolved_at` by constraint. One pending request per tablet, by partial unique index.

`code_hash` is **withheld by column grant from every client role**, including the person the request names, so `select *` is refused with 42501. The four digits exist on the tablet's screen and in the response that created it, and nowhere else.

Readable by the tablet and by the person named, and by nobody else — not the outlet's manager, not the owner. There is no fallback approver, so there is nobody else with a reason to look at a pending request.

**`counter_shifts`** — `id`, `device_id`, `outlet_id`, `person_id`, `opened_at`, `business_date`, `expires_at`, `ended_at`, `ended_reason`.

The approved counter session, and what a bill or a counter expense is attributed to. `expires_at` is the outlet's next cutover, stored rather than computed by a job, so "is this shift live?" is a `where` clause and there is nothing scheduled to fail. One open shift per tablet. Readable by the tablet, the operator, the outlet's manager and the owner — unlike the request, a shift is an operational fact about the outlet.

## Menu

**`menu_categories`** — `id`, `outlet_id`, `name`, `sort_order`, `is_active`.

**`menu_items`** — `id`, `outlet_id`, `category_id`, `name`, `description`, `price_paise`, `is_veg`, `is_available`, `sort_order`, `created_at`, `updated_at`.

Menu is per-outlet from day one. Two outlets may share item names and differ on price, and a franchise will want its own availability. A shared master catalogue is a future convenience, not a foundation — see [Limitations](LIMITATIONS.md).

`is_available` is the biller-facing toggle (sold out today). `is_active` on the category and soft-deletion on items handle permanent removal.

## Billing

**`orders`** — `id` (client UUID), `outlet_id`, daily `order_number`, owning
tablet, creator and counter shift, `ordered_at`, explicit `business_date`,
customer-form snapshot, integer-paise totals, `status` (`open` | `paid` |
`cancelled`), and separate revision, cancellation and payment attribution.

An order is short-lived working state while food is prepared. Only `open` may
be revised. Payment or cancellation makes it immutable. The order number is
allocated per outlet and business date, restarts at 1 after cutover, and never
touches the permanent bill-number counter.

**`order_items`** — `id`, `order_id`, `menu_item_id`, captured `item_name` and
`unit_price_paise`, `quantity`, `line_total_paise`. Existing lines retain their
snapshot through later menu changes.

**`bills`**
`id` (client UUID), `outlet_id`, permanent `bill_number`, optional source
`order_id`, `ordered_at` and `business_date` (revenue), `paid_at` and
`payment_business_date` (drawer), operator/tablet/counter-shift attribution,
customer snapshot, integer-paise totals, optional single-method summary, status and void
attribution.

- `payment_method`: nullable compatibility summary. It is `cash` or `upi` for a single-tender bill and null for mixed tender. Aggregators, Card and Other are not accepted payment categories.
- `pricing_mode`: `no_tax` | `gst_inclusive` | `gst_exclusive`. **v1 always writes `no_tax` and `tax_paise = 0`.** It exists now so that when GST is enabled, historical bills stay unambiguous instead of being silently reinterpreted under new rules.
- `unique (outlet_id, bill_number)` — bill numbers are unique within an outlet, not globally.
- **`bill_number` is assigned by the database**: a `before insert` trigger allocates from a per-outlet counter row (`bill_number_counters`, invisible to clients) inside the insert transaction — race-safe, and gapless because a failed insert rolls the allocation back with it. A client-supplied value is overwritten, never trusted; the column's `default 0` exists only so generated client types treat it as server-supplied. *Divergence:* this replaced the "issue bill number" Edge Function sketched in the architecture — a trigger is atomic with the insert, an extra network hop cannot be.
- Both business clocks are explicit. Paying an order preserves its original
  order clock and resolves the drawer clock at payment, so a 03:55 order paid
  at 04:05 puts revenue and cash on their respective business dates.
- **Append-only once settled**, enforced by trigger: the only legal update is `settled → void` touching only the void columns, role-gated to the outlet's Franchise Admin and the Super Admin; deletes are refused even for privileged writers. A mistake is voided and re-rung; totals are never edited in place.
- `business_date` is **validated at write time**: a bill (or shift, or attendance check-in) whose stated date contradicts its timestamp under the outlet's cutover is rejected, not repaired.

**`bill_items`**
`id`, `bill_id`, `menu_item_id` (nullable reference, for analytics only), `item_name` (**snapshot**), `unit_price_paise` (**snapshot**), `quantity`, `line_total_paise`.

The snapshot is the point. `menu_item_id` is nullable and advisory — if an item is later removed, the bill still reads correctly. Never compute a historical bill's value by joining to `menu_items`.

**`bill_payments`** — `id`, `bill_id`, `outlet_id`, `method`, `amount_paise`, `created_at`.

These append-only rows are the canonical tender truth. Each method appears at most once per bill, every amount is positive integer paise, and the deferred integrity guard requires their sum to equal the bill total. A mixed bill remains one fully paid bill, never a partially paid order. Daily cash sums only rows whose method is `cash`, so ₹100 Cash + ₹39 UPI contributes ₹100 to the drawer and ₹139 to revenue.

**`bill_payment_corrections`** records one append-only revision for a settled
bill: bill/outlet, sequential revision, originating tablet and shift, command,
creator and creation time. **`bill_payment_correction_allocations`** carries that
revision's complete positive integer-paise Cash/UPI replacement. Update and
delete are refused on both tables. `effective_bill_payments` exposes the
original `bill_payments` at revision zero or only the latest replacement; it is
the sole allocation source for billing totals and revenue reads. The correction
RPC accepts the same bill identity only from its originating tablet and current
shift, under a bill lock, at the expected revision and no later than the stored
`paid_at + 5 minutes`. Exact command replay returns its recorded revision without
appending again.

**`billing_commands`** — compact idempotency receipts containing envelope
identity, attribution, command type/version/hash, client and server clocks,
affected dates, result category, entity references and a server watermark. They
store no customer or line payload. Exact replay returns the original result;
changed reuse of the UUID is `identity_conflict`.

**`billing_end_of_day_confirmations`** — one tablet/business-date confirmation
with its final shift and last acknowledged command watermark. A later shift or
accepted command for that tablet/date makes it stale. The tablet can confirm
only after participating and reporting zero unsent and zero needs-attention
operations. The confirmation command itself refuses open orders and atomically
ends that tablet's shift. Readiness requires no open orders, no live shifts,
and a current confirmation from every participating tablet. An insert or update
is also refused while that tablet has a settled bill whose five-minute
payment-correction window is still open.

All order and bill mutations use versioned command RPCs. Authenticated clients
have no direct insert, update or delete privilege on the money tables, so
parent, lines, state, number allocation and receipt commit together or not at all.

**`shifts`** — `id`, `outlet_id`, `counter_device_id`, `biller_profile_id`, `business_date`, `opened_at`, `closed_at`. A shift never spans two business dates.

**`customers`** — `id`, `phone` (canonical, unique, not null), `name` (nullable), `created_at`, `last_used_at`.

**The one table in this schema that belongs to no outlet.** One normalized phone is one customer for the whole business, so a returning customer is recognised at either counter. `phone` is stored as `+91` plus ten digits — `public.normalize_indian_phone()` canonicalises the ten-digit, `91…` and `+91…` forms and refuses everything else — and a check constraint means the column can hold nothing but its own canonical form.

It carries **identity only**. There is no `outlet_id`, no `bill_count` and no `total_spend_paise`, and their absence is the design: a cached total on a globally readable row would disclose one outlet's trade to the other through a customer they share. Anything about trading is read from `bills`, which are outlet-scoped and always were.

Access is correspondingly narrow, and none of it is a table grant:

| Who | May | Through |
|---|---|---|
| A tablet holding a live shift, or the person holding that shift | Retrieve one customer by their **complete** phone; create one the first time a phone is seen | `customer_lookup_by_phone()`, `customer_create_or_get()` |
| Super Admin | Read the directory | `customer_directory()` |
| Everybody else, including a direct `select` from any role | Nothing | — |

No client session holds `select` on the table itself, so there is no browse, prefix, wildcard or count path — and no database verb that could become one. `customer_create_or_get()` never overwrites a saved profile: a differing name typed at the counter goes onto that bill's own `customer_name` snapshot, which is history, and the global identity is left alone. Lookups are rate-bounded per caller through `customer_lookup_attempts`, which records who asked and when and **nothing about what was asked**.

The boundary is proved rather than asserted — `supabase/tests/20_global_customer_identity.sql` and the customer probes in `supabase/tests/rest/rls-probes.test.ts`, including that a customer id legitimately held at one outlet opens none of that customer's bills at the other.

## Inventory

**`inventory_items`** — `id`, `outlet_id`, `name`, `unit` (`kg` | `litre` | `packet` | `piece`), `current_quantity` (`numeric`), `purchase_cost_paise` (per unit), `low_stock_threshold`, `is_active`, `last_updated_at`.

**`inventory_movements`** — `id`, `outlet_id`, `inventory_item_id`, `movement_type` (`added` | `used` | `wasted` | `correction`), `quantity_delta` (`numeric`, signed), `unit_cost_paise` (nullable; set on `added`), `note`, `recorded_by`, `business_date`, `created_at`.

**The movements ledger is the truth; `current_quantity` is a derived cache** maintained by trigger. This is what makes stock auditable — "why does the system think we have 4kg?" is always answerable by reading the ledger. A correction is itself a movement with a note, not a silent overwrite.

Quantity is `numeric`, not integer paise — 1.5 kg is a real quantity. Money on these rows still follows the paise rule.

## Expenses

**`expenses`** — `id`, `outlet_id`, `business_date`, `category`, `description`, `amount_paise`, `payment_method`, `recorded_by`, `created_at`.

`category` is normalised free text: outer whitespace is trimmed, internal
whitespace collapses to one space, and case is preserved. It is a snapshot on
the expense row, not a foreign key. Renaming or retiring a suggestion therefore
cannot silently rewrite historical reporting; the owner must explicitly choose
a history rewrite or merge when that is the intended correction.

**`expense_categories`** — `id`, `name`, `created_by`, `created_at`. This is a
business-wide suggestion list alongside `customers`, because the same vocabulary
is useful at every outlet. Recording a new category mints its suggestion in the
same transaction. Names are unique without regard to case and must already be
normalised. There is deliberately no foreign key from either expense table:
retiring a suggestion must not invalidate the rows that used it.

**`expense_category_operations`** — `id`, `operation` (`rename` | `merge`),
`name_before`, `name_after`, `ledger_rows_moved`, `expense_rows_moved`,
`performed_by`, `performed_at`. One immutable row explains each owner rename or
merge and records how much history moved in each expense table.

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

`attendance` is the **one canonical person/day outcome**. Its
`current_attempt_id`, `outcome_attempt_id`, `latest_decision_id`,
`retry_blocked` and monotonically increasing `state_version` point into the
immutable history and make competing manager/employee commands serialize on
one row. `outlet_id` follows the current attempt while one is waiting and the
settled attempt otherwise. A denial sets the outcome to absent; a later retry
changes the current attempt and waiting outlet but does not suspend that absent
outcome. Only approving or correcting the day changes it.

**`attendance_attempts`** stores every employee or manager-entered arrival:
client UUID, canonical attendance/person/date, outlet, time, source, coordinates,
accuracy, server-computed distance, stamped arrival deadline, superseded/settled
times and a server request fingerprint. **`attendance_decisions`** stores every
approval, denial, correction and retry-policy change with its client UUID,
actor snapshot, affected attempt, previous/new outcome, reason, retry policy
and manager evidence when the action is one that reads it. It also carries
`command_id`: the one manager action that wrote it, shared by every decision in a
selected set and null for a decision made on its own or recorded before sets
existed. It correlates decisions so history states that these people were settled
by one act rather than leaving it to be inferred from adjacent timestamps; it
never replaces them, and each person keeps their own complete decision. A `correct_time`
decision additionally holds `previous_check_in_at` and `new_check_in_at`: it
updates only the canonical effective `attendance.check_in_at`, while the
attempt's captured timestamp and GPS/manual evidence remain immutable. Both tables are
append-only: updates and deletes are refused, including after a later retry or
correction.

The old evidence and approval columns on `attendance` remain as a compatibility
projection for existing reads and service/seed setup; live browser mutations go
only through the guarded attendance commands. The migration materialises every
recognised legacy check-in, approval, manual entry and row-only outcome without
recomputing historical GPS, and aborts on an unrecognised or lossy shape.

**The command boundary owns attendance state.** Submit-attempt, decide-set,
correct and manual-entry commands derive the caller and authority from the
session, validate live assignments, active outlets, the target outlet's current
explicit `business_date`, deadlines, evidence and reasons, lock the canonical
person/day, and advance its version. Client UUIDs make an exact replay
idempotent; reusing one with different evidence is refused. An expected version
and attempt id make a stale sheet or racing decision fail instead of overwriting
the winner. Time correction is settled-only and may reach historical days; the
database refuses future timestamps and any timestamp whose outlet cutover maps
it to a business date other than the row's explicit date.

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

`unique (person_id, business_date)` — **a day belongs to the person, not to the
shop** (`attendance-one-day-per-person`, #29). #22 had briefly made it
`(person_id, outlet_id, business_date)` on the assumption that a split day across
two outlets was a real thing to record. It is not: somebody staffed at two
outlets works at one of them on any given day, and their month is a mix. Under
the per-outlet rule a person who worked at Kalyani was *derived absent* at
Kanchrapara on the same date, which is a false claim about a day they are paid
for.

A second row is therefore refused whatever outlet it names, and **recording a
genuine split day is impossible** — deliberately, and recorded in
[Limitations](LIMITATIONS.md). Production held no split day when the constraint
went on (7 rows, 5 people, 0 violations, read 2026-08-01), so it needed no
backfill.

Reversing it is two migration statements plus one module
(`src/features/attendance/attendance-record.ts`), and rows written under the
narrower rule already satisfy the wider one, so a rollback loses no data.

**`attendance_elsewhere(uuid[], date)`** is the one consequence of that rule
which the client could not compute for itself. Row-Level Security means a
Franchise Admin cannot see another outlet's rows at all, so they cannot tell
somebody who was absent from somebody who worked elsewhere. This `security
definer` function answers, for a set of outlets and a date, which people on
those outlets' own staff lists hold a row somewhere outside the set — person ids
and nothing more. See [Security And Privacy](SECURITY_AND_PRIVACY.md).

**A `manual` event is an admin recording attendance on someone's behalf** — the escape hatch for a phone that cannot check in, the kiosk having been rejected. The `entered_by` / `entered_by_name` pair is stamped by the guard trigger from the acting session, never accepted from the client; constraints tie the pair to the `manual` source and forbid coordinates on manual events, so the geofence never judges them. Times must be in the past, on the outlet's current business day. A Franchise Admin enters for their own outlet, the Super Admin for any; an Employee or Biller session is refused.

A `manual` arrival is also **settled by the act of recording it**: the guard
stamps `approved_by` as the entering session, because the admin has already
attested to the arrival by typing it in and making them approve their own entry
would be a second signature on the same sentence. No approver position is
recorded, because none was read.

Captured coordinates, GPS accuracy, **and** computed distance are all stored. Storing the inputs alongside the verdict is what makes a disputed check-in reviewable instead of a black box — "the app said no" is not an acceptable answer to an employee.

**Three readings are not outcome columns**: waiting for a manager, late, and absent
because nobody came. Each is derived from the stored rows and the outlet's clock
in one shared module (`src/features/attendance/attendance-record.ts`), so every
surface agrees by construction. Lateness uses the canonical effective check-in
time, so an audited correction can move the tag in either direction without
relabeling the original attempt. No scheduled process manufactures attendance
rows — a job writing an absence per assigned person per day would need a backfill
for every past day and would race the late arrival it was trying to describe.

Waiting now means exactly **the canonical current attempt is unsettled**. A
denied-absent day with a later attempt therefore belongs to both the absent
outcome tally and the manager's waiting work. The explicit person/date and
outlet/date links on attempts and decisions prevent a history row from being
attached to a different day, including across outlets with different cutovers.

## Daily cash

**`cash_withdrawals`** — `id`, `outlet_id`, `business_date`, `amount_paise`, `reason`, `withdrawn_by`, `recorded_by`, `created_at`.

**`daily_cash_records`** — `id`, `outlet_id`, `business_date`, `opening_cash_paise`, `cash_sales_paise`, `cash_expenses_paise`, `cash_withdrawn_paise`, `expected_closing_paise`, `actual_closing_paise`, `difference_paise`, `closed_by`, `closed_at`, `notes`. `unique (outlet_id, business_date)`.

The invariant:

```
expected_closing = opening_cash + cash_sales − cash_expenses − cash_withdrawn
difference       = actual_closing − expected_closing
```

The three derived inputs come from settled cash bills whose
`payment_business_date` matches, cash expenses, and withdrawals. They are
**snapshotted onto the record at close**, never recomputed by a late command.

This is structural, not conventional: clients cannot write
`daily_cash_records`. `close_business_day()` locks and rechecks billing
readiness, computes the figures and writes the snapshot in one transaction. A
closed date also refuses a new counter shift.

## The manual ledger (temporary, #36)

Two tables that exist because billing, expenses and daily cash were not live
while August 2026 was trading. Billing now replaces their Cash/UPI inputs one
outlet/date at a time; aggregator trade, expenses and drawer facts remain here.
**Both are designed to be dropped**, by
the change that first carries their rows into the live records (#12 — see
[Limitations](LIMITATIONS.md#the-manual-ledger-is-a-stopgap-with-a-stated-exit)).
The `manual_ledger_` prefix is what makes that removal, and any accidental
reference from a live surface, greppable.

**`manual_ledger_days`** — `id`, `outlet_id`, `business_date`,
`opening_cash_paise`, `cash_revenue_paise`, `upi_revenue_paise`,
`swiggy_revenue_paise`, `cash_added_paise`, `cash_added_reason`,
`cash_removed_paise`, `cash_removed_reason`, `counted_cash_paise`,
`swiggy_commission_paise`, `note`, `recorded_by`, `updated_by`, `created_at`,
`updated_at`. `unique (outlet_id, business_date)`.

Commission is an **exact amount in paise, never a rate** [owner, 2026-08-17]. The
measured take moves between roughly 24% and 35% day to day, because the charge is
a base service fee plus a per-kilometre fulfilment fee less a capping discount
plus a payment fee plus tax on all of it: Zomato publishes 14% for an order whose
real take was 37.8%. A stored percentage was therefore an estimate in the shape of
an exact figure. A channel's **net is revenue less commission and is not stored**,
because a third column could disagree with the two it is derived from.

**Zomato's figures are no longer on this row** (#43). They moved to
`aggregator_channel_days`, because this row cannot exist without an opening
balance and a drawer count, yet a day nobody counted must still show what Zomato
paid. Swiggy stays here, because it is still typed. A day-row write that still
names a Zomato column fails on the absent column, which is the freeze against a
stale client.

**`aggregator_channel_days`** — `id`, `outlet_id`, `channel`, `business_date`
(`unique (outlet_id, channel, business_date)`), `revenue_paise`,
`commission_paise` (**nullable — null is undetermined, not nought**),
`settlement_state` (`provisional | settled | disputed`), `origin`
(`daily_reader | settlement | supplied_by_hand`), the superseded pair
(`superseded_revenue_paise`, `superseded_commission_paise`, `superseded_at`) kept
when a figure is replaced and excluded from every total, the revision pre-image
(`provisional_revenue_paise`, `provisional_commission_paise`, `revised_at`)
present only where settling moved the figures, `created_at`, `updated_at`.

**No client role may write it.** The freeze is the absence of an
insert/update/delete grant, not a disabled control: only the ingest path writes,
so a hand-crafted request and a missing form field are refused by one rule. The
owner reads across outlets; every outlet role is refused read entirely. A figure
can exist here for a business date that has no `manual_ledger_days` row, which is
the "day nobody counted" the sync now records instead of refusing.

**`manual_ledger_expenses`** — `id`, `outlet_id`, `business_date`, `category`
(the same normalised free-text snapshot used by `expenses`), `is_cash`,
`amount_paise`, `description` (an optional Note, refused blank when present),
`recorded_by`, `recorded_away`, `updated_by`, `voided_at`, `voided_by`,
`voided_reason`, `created_at`, `updated_at`.

Seven properties are load-bearing and easy to undo by accident:

- **Only live counter revenue is aggregated in the database.**
  `manual_ledger_counter_revenue()` groups settled bill-payment allocations by
  payment business date under RLS and excludes void bills. Expected cash, the
  difference, net aggregator revenue and the monthly estimate remain in
  `src/features/manual-ledger/ledger.ts`, so the rounding rule still has exactly
  one implementation.
- **Typed Cash/UPI is refused after go-live.** Ledger rows continue storing zero
  in those temporary columns because the same row still owns the drawer and
  aggregator inputs; the adapter replaces them from the allocation read model.
- **`opening_cash_paise` and both `_commission_bp` columns are stored per day,
  not derived.** This is the opposite of the `daily_cash_records` treatment above
  and for the same underlying reason: correcting day 3's count must not silently
  move day 4 through day 31. The cost is that the chain can break, and the
  surface reports the break rather than repairing it.
- **Commission is an exact amount, applied per day**, then summed — never a rate
  on a month's total, because each day's commission is its own measured figure.
  A day whose commission is still undetermined makes the month a **ceiling** and
  the surface says so.
- **Hyperpure is a reserved category** (#43). A person may not type it, nor any
  near-spelling of it — `reserved_expense_categories` names it and the folded,
  squashed, contained match refuses "hyper pure" and "Hyperpure Goods" alike, so
  a second spelling cannot recreate the duplicate reserving it prevents. It is
  written only by the supply origin, from a statement.
- **A supply purchase carries a source identity and a shared-cost marker.**
  `source_system`/`source_ref` (unique per outlet) key one supplier order to one
  row, so a re-read, a later statement and a hand upload cannot triplicate it;
  `shared_cost` marks a purchase booked once against its delivery outlet but drawn
  on by both kitchens from one inventory. A payout recovery of such a purchase is
  reconciliation only and writes no expense, because the supplier's own statement
  already recorded it.
- **There is no capital marker, deliberately.** Capital spending is not recorded
  here at all, so the monthly figure is a cash-basis *operating* estimate and the
  surface says so. Equipment paid for from the drawer is recorded as cash taken
  out with its reason, which keeps the day reconciling while leaving the month's
  expenses clean. A boolean that was always false would imply the opposite.
- **`is_cash` is a boolean and stays one.** A three-valued payment column with a
  `pending` state, and settlement built on top of it, was designed and cut in
  full (owner, 2026-08-09). Supplier credit is a real problem and not the one the
  owner described; carrying it here would have meant a new enum, settlement
  columns with cross-column checks, a `security definer` function that mutates a
  *different* day's row than the expense it settles, and the month ceasing to be
  a cash basis. Nothing regresses — a credit purchase is unrecorded today and
  stays unrecorded — but the month understates when goods arrive and overstates
  when they are paid for. Its own change if the owner starts buying on terms.
- **An expense is withdrawn, never deleted.** `DELETE` is revoked from
  `manual_ledger_expenses` and a `reject_mutation()` trigger refuses it behind
  the grant, so a service-side mistake is refused too. A withdrawn row keeps
  `voided_at` and `voided_by`; `voided_reason` is **optional**, on the same
  reasoning as `attendance_approval_reason` — demanding one on the fastest
  correction path collects a column of "mistake". The three travel together under
  checks shaped like `attendance_approval_complete`: actor and time both present
  or both absent, a reason only beside a void, and never blank. `manual_ledger_days`
  keeps `DELETE`, because a day typed against the wrong date is a mistake with no
  story worth keeping and only owners and managers reach that table.
- **`recorded_away` is stamped at insert, never derived on read.** True when the
  recording account held no live assignment at that outlet at the moment it wrote
  the row. Deriving it from today's assignments would make a manager's old rows
  silently become "from away" the week they leave — a statement about now dressed
  up as a fact about then. It is frozen afterwards for the same reason
  `recorded_by` is, and the surface shows it only on a drawer expense, where it
  explains why expected cash moved without anybody at the outlet spending it.

Negative revenue is permitted (a cash refund lowers that day's cash revenue);
negative opening cash, drawer count and cash movements are refused, as are a
future business date, a blank movement reason, a blank expense description and a
commission rate outside 0–10000 basis points.

**The two tables answer differently under RLS, and the difference is the point.**
`manual_ledger_days` reaches owners and Franchise Admins at outlets from
`app_outlets_for('franchise_admin')`, and carries **no outlet-staff branch on any
verb** — a stronger claim than ordinary outlet isolation, protecting the drawer on
the write side and past days, month aggregates, the other outlet and every
commission-net figure on the read side.
`manual_ledger_expenses` additionally admits `app_has_role_at('biller', …)` and
`app_has_role_at('employee', …)`, who read every row at their outlet and correct
only their own. **No select policy carries a date predicate**: the surface's
two-day window is a presentation default, and enforcing it would cost a
correlated subquery to protect a row that is not a revenue figure. The staff date
limits — record on the current business day, correct only while that day is still
running — live in `manual_ledger_guard()` instead, because both resolve the
outlet's own cutover through `app_business_date`.

`manual_ledger_people()` is a `security definer` read returning display names,
and only display names, for accounts that wrote in a ledger the caller may
already read. It exists because `profiles` cannot answer that question for the
readers this capability added: its select policy needs a shared outlet assignment
and a caller whose role is `franchise_admin` or `biller`, so an Employee sees
nobody and nobody at an outlet sees an owner — whose assignment carries no outlet
at all, and who recorded most of the rows already stored. Its predicates mirror
the row policies deliberately, and `supabase/tests/21_manual_ledger.sql` asserts
the two agree rather than trusting that they do.

## Alerts

**`alerts`** — `id`, `outlet_id`, `raised_by`, `subject`, `message`, `category` (`inventory` | `equipment` | `cash_mismatch` | `employee` | `supplier` | `other`), `priority` (`low` | `normal` | `high` | `urgent`), `status` (`open` | `acknowledged` | `resolved` | `closed`), `created_at`.

**`alert_responses`** — `id`, `alert_id`, `responder_profile_id`, `message`, `created_at`.

Alerts are the one place a Franchise Admin deliberately writes data the Super Admin reads, and the only cross-role write path in the system.

## Two modelling traps in this domain

### 1. Double-counting food cost in profit and loss

Raw materials appear **twice** in the natural reading of this schema: once as an `expenses` row when stock is bought, and again as inventory `used`/`wasted` movements valued at purchase cost. Summing "all expenses" *and* "food cost" double-counts.

**The consumption basis cannot currently tell which expenses were stock.** It matches the exact word `raw_materials`, which was a value of the closed category list before `expense-categories-grow-from-use` made categories free text. Nothing a person types matches it, so only the demo fixtures still do. This is invisible while the live expense record is empty and the P&L is demo-gated, and it must be settled before `expenses-and-inventory-live` (#11) — see [the backlog note](../openspec/todos/raw-materials-is-identified-by-a-word-nobody-types.md).

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
- No order or bill date disagrees with what the outlet cutover implies for its
  matching order or payment timestamp.
