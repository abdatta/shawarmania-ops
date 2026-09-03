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

There is no `billing_live_from`. It was the per-outlet handover after which the
temporary ledger read Cash and UPI from bills, and it went with the ledger in
`retire-the-manual-ledger` (#12): with one record of a trading day there is no
second one to hand over from, and a column nothing reads is a question a form
keeps asking.


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
`id`, `outlet_id`, `label`, `set_up_by`, `set_up_at`, `removed_at`, `last_seen_at`, `last_reported_unsent`, `last_reported_oldest_unresolved_at`.

`id` **is** the machine's `auth.users.id`. A tablet has no profile and no assignment: it is a machine principal, and what it may reach comes from the shift open on it rather than from anything it is.

An outlet may hold **several** active tablets, each with its own machine identity and bound to that one outlet for life. What is unique is the **label**, among an outlet's live counters, by a partial unique index on `(outlet_id, lower(btrim(label))) where removed_at is null and session_proven_at is not null` — so a manager choosing which counter to remove, and an operator reading which till took an order, are never guessing.

A row is a counter only when `removed_at is null and session_proven_at is not null`, which is the canonical predicate every policy and helper asks. A redeemed setup code writes a row that is **not yet** a counter: it reaches nothing, appears nowhere, and lapses on its own when the code's own `proof_expires_at` passes, so a setup whose sign-in never lands costs a code and not a counter. Removal is permanent, taking the live shift and any pending request with it in the same transaction.

The tablet heartbeat writes `last_seen_at`, the number of locally unresolved
outbox envelopes and the creation time of the oldest one. The deployed
`last_reported_unsent` column keeps its name for rolling compatibility, but its
meaning includes pending, held, retrying and needs-attention envelopes. These
fields are always read as **what the tablet last said**, never as what is true
now. A positive legacy heartbeat has an unknown oldest instant; zero clears it.

`counter_operations_snapshot_v2(outlet_ids[])` is the current management read boundary over
this hardware. It returns one server-timestamped snapshot of the live shift,
operator name, heartbeat telemetry, bill count, effective Cash and UPI, waiting
orders and drawer Cash. The original snapshot remains callable during rolling
frontend deploys.
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

The approved counter session, and what a bill or a counter expense is attributed to. `expires_at` is the outlet's next cutover, stored rather than computed by a job, so "is this shift live?" is a `where` clause and there is nothing scheduled to fail. `ended_reason` distinguishes an operator's remote leave from day finish and device removal; only remote leave permits the bounded last-known-context rule for an offline command. One open shift per tablet. Readable by the tablet, the operator, the outlet's manager and the owner — unlike the request, a shift is an operational fact about the outlet.

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

`recorded_after_shift_end` and its paired `attribution_shift_ended_at` are
server-stamped immutable facts. They are true only when a command from an
offline tablet is accepted after the attributed operator remotely left, before
any later shift or cutoff. The bill remains in ordinary revenue and tender
totals and retains its original person and shift; the flag qualifies that
attribution rather than replacing it.

- `payment_method`: nullable compatibility summary. It is `cash` or `upi` for a single-tender bill and null for mixed tender. Aggregators, Card and Other are not accepted payment categories.
- `pricing_mode`: `no_tax` | `gst_inclusive` | `gst_exclusive`. **v1 always writes `no_tax` and `tax_paise = 0`.** It exists now so that when GST is enabled, historical bills stay unambiguous instead of being silently reinterpreted under new rules.
- `unique (outlet_id, bill_number)` — bill numbers are unique within an outlet, not globally.
- **`bill_number` is assigned by the database**: a `before insert` trigger allocates from a per-outlet counter row (`bill_number_counters`, invisible to clients) inside the insert transaction — race-safe, and gapless because a failed insert rolls the allocation back with it. A client-supplied value is overwritten, never trusted; the column's `default 0` exists only so generated client types treat it as server-supplied. *Divergence:* this replaced the "issue bill number" Edge Function sketched in the architecture — a trigger is atomic with the insert, an extra network hop cannot be.
- Both business clocks are explicit. Paying an order preserves its original
  order clock and resolves the drawer clock at payment, so a 03:55 order paid
  at 04:05 puts revenue and cash on their respective business dates.
- **Append-only once settled**, enforced by trigger: the only legal update is `settled → void` touching only the void columns, role-gated to the outlet's Franchise Admin and the Super Admin; deletes are refused even for privileged writers. A mistake is voided and re-rung; totals are never edited in place.
- `business_date` is **validated at write time**: a bill or shift whose stated
  date contradicts its timestamp under the outlet's cutover is rejected, not
  repaired. A phone attendance check-in instead derives both its timestamp and
  date at the database boundary; manager-entered and correction times remain
  explicit and receive the same cutover validation.

**`bill_items`**
`id`, `bill_id`, `menu_item_id` (nullable reference, for analytics only), `item_name` (**snapshot**), `unit_price_paise` (**snapshot**), `quantity`, `line_total_paise`.

The snapshot is the point. `menu_item_id` is nullable and advisory — if an item is later removed, the bill still reads correctly. Never compute a historical bill's value by joining to `menu_items`.

**`bill_payments`** — `id`, `bill_id`, `outlet_id`, `method`, `amount_paise`, `created_at`.

These append-only rows are the canonical tender truth. Each method appears at most once per bill, every amount is positive integer paise, and the deferred integrity guard requires their sum to equal the bill total. A mixed bill remains one fully paid bill, never a partially paid order. The drawer sums only rows whose method is `cash`, so ₹100 Cash + ₹39 UPI contributes ₹100 to the drawer and ₹139 to revenue.

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
changed reuse of the UUID is `identity_conflict`. A receipt accepted through
the bounded remote-leave exception freezes the same post-shift flag and shift
end time that the created bill receives.

**`billing_attribution_reviews`** — one append-only manager review per flagged
bill. It preserves the original operator and records one outcome:
`confirmed_original`, `assigned_other` with an outlet-eligible biller, or
`operator_unknown` with a required reason. It also stamps the reviewing account
and time. Only the outlet's Franchise Admin or the Super Admin may read and
create it; update and delete are refused. The review never mutates the bill.

**`billing_end_of_day_confirmations`** — one tablet/business-date confirmation
with its final shift and last acknowledged command watermark. A later shift or
accepted command for that tablet/date makes it stale. The tablet can confirm
only after participating and reporting zero unsent and zero needs-attention
operations. The confirmation command itself refuses open orders and atomically
ends that tablet's shift. Readiness requires no open orders, no live shifts,
and a current confirmation from every participating tablet. A settled bill's
still-open five-minute payment-correction window is reported to the tablet as an
advisory; it does not prevent confirmation, and confirmation deliberately ends
the tablet's opportunity to submit that correction.

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

## The customer's receipt link

**`bill_public_links`** — `bill_id` (primary key, references `bills`), `token`
(unique), `created_at`, `revoked_at`. One row per bill, written by an
after-insert trigger on `bills`, so **every bill is reachable at a public URL
from the moment the server has it** with no share step, no application code and
nothing new happening at the counter. A bill still in a tablet's outbox has no
link yet, which is correct: nobody can hand out a link to a bill the server has
not accepted.

The token is ten URL-safe characters — sixty bits — from
`left(translate(encode(gen_random_bytes(8), 'base64'), '+/', '-_'), 10)`.
Truncating base64 is sound: every character carries six independent bits of the
underlying random bytes.

**`token` deliberately carries no length check.** If the business reaches
franchise scale the generator starts minting twelve or fourteen characters for
new bills and every link already in a customer's phone keeps working. That is
what makes ten a reversible choice rather than a one-way door, and a
`check (length(token) = 10)` would quietly close it.

### The invariant: a bill's link is not its identity

`bills.id` is a CSPRNG UUID and genuinely unguessable, so enumeration was never
the reason it is not the public key. Three other things were:

1. **No revocation.** `bills` is append-only, so a link that leaked into a group
   chat could never be killed by any means.
2. **It would make a primary key sometimes-secret.** `bills.id` is safe today in
   a log line, an export, a support message, a future ops URL. Make it the
   credential and every one of those becomes a disclosure, forever, prevented
   only by somebody remembering. This schema puts invariants in the database
   precisely so nobody has to.
3. Every bill in the table becomes reachable the instant the endpoint ships —
   which was later chosen deliberately anyway, but should be a decision rather
   than a side effect of a key choice.

The token also lives in its own table rather than on `bills` for a reason worth
keeping: `bills_void_only()` refuses every update to a bill except
`settled → void` touching only the void columns, and that trigger is the
append-only guarantee over the money. Putting the token there would have meant
amending it so a column could be mutated for a link to be revoked — weakening a
financial invariant for a publishing concern. Here, revocation is an ordinary
update on a table that was never append-only, and **no operation on a link can
reach a bill at all**, asserted by reading the bill byte for byte across a
revoke, a reissue and an update.

Revocation is the off switch and it is permanent for that token: reissuing mints
a new one, so the revoked token thereafter names no row. There is no expiry —
[`data-retention-policy`](../openspec/todos/data-retention-policy.md) records
that nothing is deleted, ever, and bills are financial records — so revocation
had to be real, and it is strictly better for a leak because it acts now rather
than in a year and never breaks a receipt a customer legitimately kept. A link
row is never deleted; deletion would leave a bill silently unshareable with
nothing recording that anybody meant it.

**`bill_public_link_views`** — `id`, `token`, `viewed_at`,
`client_address_digest`, `user_agent`. Enough to make a harvesting attempt
visible after the fact and nothing more. It records the **token**, not the bill,
so a row does not even name the sale; and a digest salted from
`public_receipt_settings.viewer_salt`, never the address, because an unsalted
hash of an IPv4 address is walkable in seconds and would therefore *be* the
address. Its column list is asserted from the catalog, so a later migration
adding something that identifies a customer fails by name.

A row is written **only once a token resolves.** A flood of invalid tokens must
not be turnable into a flood of inserts; that amplification belongs to the edge
to absorb, and a write here would hand an attacker the lever.

**`public_receipt_settings`** — one row for the whole business: `enabled`, the
kill switch, and `viewer_salt`. Flipping `enabled` refuses every receipt at once,
at the database, for every caller, with no deploy. Both this and the view record
are `service-only`: no grant and no policy for any client role, because nothing
in the app shows who opened a receipt and nothing lets a session flip the switch.

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

**`effective_expenses`** — a view, and **the only relation a live surface should
read for expenses**. It is now the un-voided rows of `expenses` and nothing else.

It exists because there were once two expense tables. The original `expenses`
never held a row: expenses went live in #36 and #38 against the notebook's
`manual_ledger_expenses`, which is what every live Expenses surface wrote, while
the derived Ledger and the drawer read `expenses` directly. So the Ledger
reported *"Nothing recorded"* on days with real expenses and **the drawer's
expected balance was overstated by every cash expense since the last count**,
which would have surfaced as a shortfall at the next count. The view named the
live record wherever it lived until `retire-the-manual-ledger` (#12) made that
one place: the empty table was dropped and the notebook's was **renamed** to
`expenses`, carrying its policies, indexes, triggers and every row, with nothing
copied. The view survives the promotion because callers name it, and because
"un-voided" is still worth saying once rather than in every caller.

It is a `security_invoker` view, like `effective_bill_payments`. Without that it
would run as its owner, RLS on the base tables would be bypassed, and any
authenticated session could read every outlet's expenses through it.

Only cash expenses affect any drawer figure. A cash expense belongs to a drawer
interval by `coalesce(occurred_at, created_at)`, so a spend before a count and
one after it land on opposite sides of that count. `occurred_at` is nullable and
is never a required field: it defaults to nothing, and interval membership falls
back to when the row was written.

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

For a `phone` self-check-in, the stored attempt time is the database statement
receipt time, and the stored business date is calculated from that same instant
and the outlet cutover. The browser's GPS-reading timestamp may remain in the
legacy command shape so an already-loaded app can finish its request, but it is
not stored as attendance time and it cannot choose or backdate the day. The
canonical `check_in_at` initially equals that server time. A manual entry or a
manager's time correction is different: it records the manager's deliberately
chosen historical time, with the acting manager and cutover validation as its
attestation. `created_at` remains the row-insertion audit timestamp, not a
second asserted arrival time; it will normally be close to a phone attempt's
server-authored `attempted_at`, while manual and corrected event times may be
historical.

The old evidence and approval columns on `attendance` remain as a compatibility
projection for existing reads and service/seed setup; live browser mutations go
only through the guarded attendance commands. The migration materialises every
recognised legacy check-in, approval, manual entry and row-only outcome without
recomputing historical GPS, and aborts on an unrecognised or lossy shape.

**The command boundary owns attendance state.** Submit-attempt, decide-set,
correct and manual-entry commands derive the caller and authority from the
session, validate live assignments, active outlets, deadlines, evidence and
reasons, lock the canonical person/day, and advance its version. A phone
submit-attempt takes its current time and business date at the database, while
manager commands validate the explicitly attested date and time. The
`attendance_current_context` read exposes one server receipt time and the
current business date for each outlet the caller can already read; it never
widens outlet scope. Client UUIDs make an exact replay idempotent; reusing one
with different evidence is refused. An expected version and attempt id make a
stale sheet or racing decision fail instead of overwriting the winner. Time
correction is settled-only and may reach historical days; the database refuses
future timestamps and any timestamp whose outlet cutover maps it to a business
date other than the row's explicit date.

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

**A `manual` event is an admin recording attendance on someone's behalf** — the escape hatch for a phone that cannot check in, the kiosk having been rejected. The `entered_by` / `entered_by_name` pair is stamped by the command from the acting session, never accepted from the client; constraints tie the pair to the `manual` source and forbid coordinates on manual events, so the geofence never judges them. The named business date may be current or historical but never future, the attested instant must be in the past and resolve through that outlet's cutover to the named date, and the subject must be current Employee/Biller staff whose assignment window includes the date. This keeps a departed-only profile off the writable roll-call while preserving real historical rows. A Franchise Admin enters for their own outlet, the Super Admin for any; an Employee or Biller session is refused.

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

## The cash drawer

**The drawer is a continuous balance, and a count is a point-in-time observation
of it.** The business day is not its container; it has none. Days remain real for
revenue, expenses and reporting, and are derived for the drawer.

That is a replacement rather than a refinement, and the reason is measurable. The
drawer is counted mid-shift, at a time the collector picks, sometimes after
skipping a day or two, and sometimes entered an hour later from somewhere else. A
count taken at 22:00 measured against a whole business date's cash sales produces
a difference that is fiction — **₹4,640 of it in one month across two outlets**,
measured on August 2026 production data by
`scripts/rehearse-august-drawer.mjs`. At Kanchrapara it is the ordinary case
rather than an edge: 8 of its 13 cash dates traded past 22:00.

**`drawer_observations`** — `id`, `outlet_id`, `counted_at`, `recorded_at`,
`is_anchor`, `opening_paise`, `expected_paise`, `difference_paise`,
`counted_total_paise`, `is_approximate`, `tolerance_minutes`, `recorded_by`,
`corrected_by`, `recorded_lat`, `recorded_lng`, `recorded_accuracy_m`,
`recorded_distance_m`, `recorded_on_site`, `away_reason`, `note`, `created_at`,
`updated_at`.

**`drawer_cash_out`** — `id`, `outlet_id`, `kind` in `('collection','spend')`,
`amount_paise` (**signed, non-zero**), `occurred_at`, `recorded_by`,
`observation_id`, `reason`, the same position columns, `created_at`.

**`drawer_observation_adjustments`** — `id`, `observation_id`, `outlet_id`,
`original_counted_total_paise`, `corrected_counted_total_paise`, `reason`,
`adjusted_by`, `adjusted_at`. Append-only.

**`ledger_day_verifications`** — `id`, `outlet_id`, `business_date`,
`verified_by`, `verified_at`, `note`.
`unique (outlet_id, business_date, verified_by)`.

**`drawer_reconciliation_acknowledgements`** — `id`, `outlet_id`,
`observation_id`, `source_kind` in `('bill','expense')`, `source_id`,
`acknowledged_by`, `acknowledged_at`, `note`.
`unique (observation_id, source_kind, source_id)`.

### The invariant

```
expected     = opening
             + cash receipts whose payment instant is in (previous counted_at, this counted_at]
             − cash expenses whose occurrence instant is in that interval
             − cash out in that interval not belonging to this observation

difference   = counted_total − expected
next opening = counted_total − this observation's own cash out
```

The three terms are read by `drawer_cash_receipts_paise()`,
`drawer_cash_expenses_paise()` and `drawer_cash_out_paise()`. All three are
`security definer`, because they are the database's half of this arithmetic and
must see rows a caller's own policies would filter — and all three therefore
carry `app_may_reach_drawer()` themselves. That is the same predicate every
drawer table's policy uses, so the two cannot drift; they shipped without it,
which let any authenticated session read any outlet's cash totals as an
aggregate. A caller with no reach gets nought rather than an exception, which is
the answer an RLS-filtered select would have given them.

Two **grouped** readers sit beside them and answer the same two questions one
`group by` apart: `drawer_cash_receipts_by_day()` returning
`(business_date, paise, bills)` and `drawer_cash_expenses_by_day()` returning
`(business_date, paise, rows)`, both over `(p_from, p_to]`, newest first, with
the same guard and the same `security definer` posture. They exist so the drawer
surface can explain a figure without a second opinion about it: same relation,
same predicate, same interval, so the groups sum to the scalar exactly. The
business date comes from `app_business_date(instant, outlets.business_day_cutover)`
read from the outlet's **own row** — the adapter used to carry
`const CUTOVER = '04:00'`, which is right at both outlets today and is exactly
the kind of constant that stays right until an outlet opens with a different one.

**The partition is of the interval, never of a calendar day.** The interval is
bounded by instants, so its oldest group is routinely a *fragment* of a business
date: the part after the count that bounds it. Nothing may fetch whole days and
trim them, which is the model `cash-is-counted-not-closed` replaced.

Intervals are bounded by **timestamps, not business dates** — half-open at the
start and closed at the end, so a payment at exactly the previous count's instant
belonged to that count and one at exactly this instant belongs to this one. A
date cannot express 22:00, which is precisely why the previous model was wrong.

Cash receipts are the **latest accepted effective Cash allocation** of settled
bills, read through `effective_bill_payments`. Production already holds a tender
correction in each direction — one that removed a cash allocation, one that
created one — so reading the raw allocations gets two real bills wrong today.

### Four properties that are load-bearing

**The carry-forward anchors to the COUNTED figure, never the expected one.** This
is what makes the whole design safe: every observation re-anchors the balance to
physical cash, so a mistake, or a correction posted three weeks late, can only
ever pollute the one interval it sits in. It cannot ripple through a month. A
₹500 shortfall is recorded as a variance on the observation that found it and is
not carried forward as phantom cash.

**The opening is stored per row and never recomputed on read**, exactly as the
retired notebook's own opening was and for the same stated reason:
correcting Tuesday must not silently move every row after it. Where a stored
opening disagrees with the previous observation's carry-forward, **the surface
reports the break and repairs nothing.** Note that this is the opposite of the
rule *inside* one row, where a third derivable column is refused because it could
disagree with the two it comes from. Within a row, derive. Across rows, store.
Both rules exist to stop a figure changing without anybody deciding it should.

**An outlet's first observation is a pure anchor**, carrying no opening, no
expected total and no difference — `is_anchor` is true and all three are null
together, tied by check constraints in both directions and by a partial unique
index. Not a fabricated opening and not a zero: Kalyani has traded since
2026-08-01 and its drawer is not empty, so a zero would record a variance of
roughly the whole float as an excess, permanently, on the first row anybody
reads. Business dates before the anchor read **`not tracked yet`**, which is a
different claim from `carried`.

**Cash into the drawer has no concept of its own.** `amount_paise` is signed:
positive leaves the drawer, negative is added to it. The arithmetic subtracts
this term whatever the sign, and subtracting a negative adds — so a ₹1,000 top-up
against a ₹450 count leaves ₹1,450 by the existing formula with no branch
anywhere. A `spend` must be positive, because drawer cash cannot un-buy a fridge.
A `spend` has never been recorded: measured on production 2026-08-29,
`drawer_cash_out` holds two rows, both collections, both attached to an
observation.

**The application no longer records a movement outside a count**, and the record
is unchanged by that. `the-drawer-explains-its-figures` deleted the two surface
controls that could create one, so every movement the app writes belongs to an
observation and reduces the following opening — which is what makes the balance
card's three figures a complete account of its headline. The table keeps both
kinds, the positive-spend constraint, its policies and its grants, and
`record_drawer_cash_out` keeps its grant, so a movement arriving by any other
path is still bound by them and a historical spend stays readable. Re-offering a
spend is a matter of adding a control, not of writing a migration.

### The write path

Structural, not conventional: **clients cannot write any of these five tables.**
There is no insert, update or delete grant and no write policy. Every write goes
through a `security definer` command that computes the derived figures inside the
transaction that writes the row — `record_drawer_observation`,
`record_drawer_cash_out`, `edit_drawer_observation`,
`adjust_drawer_observation`, `acknowledge_drawer_exception`,
`verify_ledger_day`. `record_drawer_observation` takes a per-outlet advisory lock
so two concurrent counts cannot each read the same predecessor and both insert.

An observation is **fully editable, with no reason and no trail, until the next
observation at that outlet is recorded** — that next one reads its
`opening_paise`, which is the moment the figure becomes load-bearing. From then a
correction is an append-only adjustment carrying a required reason, with both
figures readable and no later stored opening moved.

Fully editable means **the counted total, the note and the counted instant**.
`edit_drawer_observation(p_observation_id, p_counted_total_paise, p_note,
p_counted_at)`:

- **A moved instant recomputes the expected total and the difference**, by
  *calling* `drawer_cash_receipts_paise`, `drawer_cash_expenses_paise` and
  `drawer_cash_out_paise` over `(the previous observation's instant, the new
  instant]` — the same three, in the same order, as `record_drawer_observation`,
  excluding this observation's own movements. The instant IS the interval's upper
  bound, so an expected total that survived a moved instant unchanged would
  measure the count against bills that were never in the drawer. The stored
  opening does not move: it is the previous count's carry-forward.
- **The moved instant is bounded exactly as a recorded one is** — not in the
  future, strictly later than the preceding observation, not before the outlet's
  earliest drawer activity — and each refusal names what it collided with. The
  later-observation lock runs first.
- **A null `p_note` leaves the stored note alone**; an empty string clears it.
  The parameter defaulted to null and was assigned unconditionally, so every
  amount correction silently wiped a note the caller never mentioned.

A `spend` is **not** an expense. `docs/DATA_MODEL.md` records that there is
deliberately no capital marker and the month is a cash-basis **operating**
estimate, so a ₹40,000 fridge routed through expenses would move the drawer
correctly and wreck the month.

### The ledger day is derived and never stored

No table holds a per-outlet-per-day ledger row. The day is computed on read from
bills, expenses, `aggregator_channel_days`, drawer cash out and observations. Two
properties follow and both are worth the read cost: the row can never disagree
with itself, and a day nobody touched still renders in full.

A reconciliation exception is derived the same way — a payment or occurrence
instant inside an already-observed interval that arrived after the observation was
recorded. Only the human act of acknowledging one is stored.

### Superseded, and removed

`cash_withdrawals` and `daily_cash_records` were the day-close model: a signed-off
snapshot of a business date's cash, and the withdrawals that fed it. Neither ever
held a production row — verified by read-only query on 2026-08-26, again on
08-27, and asserted inside `retire-the-manual-ledger` (#12)'s own transaction
before it dropped them. `cash-is-counted-not-closed` (#11) deliberately dropped
and renamed nothing, which was its entire revert story: one edit to
`src/gates/registry.ts` and a deploy, with no data to recover. #12 spent that
revert on purpose, once the drawer had produced real counts at both outlets.

`close_business_day()` went with them, and so did
`billing_assert_day_ready()`, which had exactly one caller. The question it
answered — whether a business date's billing is complete — is real, but it
cannot gate counting cash at 22:00 with orders open and tablets live, and no
day-level seal was ever performed by anybody. It was **not re-homed**; it retired
with its caller. The closed-day guard on `counter_shifts` went too: a counted
drawer is an observation, not a lock on the business day, so a shift may be
opened on any date.

## Aggregator channel days

Commission is an **exact amount in paise, never a rate** [owner, 2026-08-17]. The
measured take moves between roughly 24% and 35% day to day, because the charge is
a base service fee plus a per-kilometre fulfilment fee less a capping discount
plus a payment fee plus tax on all of it: Zomato publishes 14% for an order whose
real take was 37.8%. A stored percentage was therefore an estimate in the shape of
an exact figure. A channel's **net is revenue less commission and is not stored**,
because a third column could disagree with the two it is derived from.

**`aggregator_channel_days`** — `id`, `outlet_id`, `channel`, `business_date`
(`unique (outlet_id, channel, business_date)`), `revenue_paise`,
`commission_paise` (**nullable — null is undetermined, not nought**),
`net_paise` (present with commission on a settled row), `settlement_state`
(`provisional | settled | disputed`), `origin` (`daily_reader | settlement |
supplied_by_hand | legacy_typed`), `source_ref`, `as_of_at`, the superseded pair
(`superseded_revenue_paise`, `superseded_commission_paise`, `superseded_at`) kept
when a figure is replaced and excluded from every total, the revision pre-image
(`provisional_revenue_paise`, `provisional_commission_paise`, `revised_at`)
present only where settling moved the figures, `created_at`, `updated_at`.

**No client role may write it.** The freeze is the absence of an
insert/update/delete grant, not a disabled control: only the ingest path writes,
so a hand-crafted request and a missing form field are refused by one rule. The
owner reads across outlets; an assigned Franchise Admin reads only their
outlet's daily aggregate, while Biller and Employee read none.

These figures were always on their own table rather than on the notebook's day
row, because that row could not exist without an opening balance and a drawer
count, yet a day nobody counted must still show what an aggregator stated. That
independence is why the notebook could retire without an aggregator figure
moving: nothing here was ever carried, converted or re-keyed.

**Commission is applied per day**, then summed — never a rate on a month's
total, because each day's commission is its own measured figure. A day whose
commission is still undetermined makes the month a **ceiling** and the surface
says so.

## Expenses

**`expenses`** — `id`, `outlet_id`, `business_date`, `category`
(a normalised free-text snapshot), `is_cash`, `amount_paise`, `description` (an
optional Note, refused blank when present), `occurred_at`, `recorded_by`,
`recorded_away`, `source_system`, `source_ref`, `shared_cost`, `updated_by`,
`voided_at`, `voided_by`, `voided_reason`, `created_at`, `updated_at`.

**This is the notebook's table under the canonical name.** There were two expense
tables until `retire-the-manual-ledger` (#12): an original `expenses` from #7 that
never held a row, and `manual_ledger_expenses`, which held all of them and had
outgrown the other — free text categories instead of an enum, void with its actor
and reason, a last corrector, a supply origin and the recorded-from-away marker.
Migrating rows from the richer table into the poorer one would have lost exactly
what had to survive, so #12 dropped the empty one and **renamed** the real one.
No row was copied, every identity was preserved, and the migration asserted row
for row that nothing changed across the rename.

Seven properties are load-bearing and easy to undo by accident:

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
  already recorded it. A machine-sourced row carries its source identity **instead
  of** a recorder, rather than falsely naming a human.
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
- **An expense is withdrawn, never deleted.** `DELETE` is revoked from `expenses`
  and a `reject_mutation()` trigger refuses it behind the grant, so a service-side
  mistake is refused too. A withdrawn row keeps `voided_at` and `voided_by`;
  `voided_reason` is **optional**, on the same reasoning as
  `attendance_approval_reason` — demanding one on the fastest correction path
  collects a column of "mistake". The three travel together under checks shaped
  like `attendance_approval_complete`: actor and time both present or both absent,
  a reason only beside a void, and never blank.
- **`recorded_away` is stamped at insert, never derived on read.** True when the
  recording account held no live assignment at that outlet at the moment it wrote
  the row. Deriving it from today's assignments would make a manager's old rows
  silently become "from away" the week they leave — a statement about now dressed
  up as a fact about then. It is frozen afterwards for the same reason
  `recorded_by` is, and the surface shows it only on a drawer expense, where it
  explains why expected cash moved without anybody at the outlet spending it.
- **Only cash expenses reach a drawer figure**, by
  `coalesce(occurred_at, created_at)`, so a spend before a count and one after it
  land on opposite sides of that count. `occurred_at` is nullable and never a
  required field.

A blank expense description and a future business date are refused, as is a
negative amount.

**RLS.** Owners and Franchise Admins reach an outlet's rows through
`app_outlets_for('franchise_admin')`; `app_has_role_at('biller', …)` and
`app_has_role_at('employee', …)` additionally read every row at their outlet and
correct only their own. **No select policy carries a date predicate**: the
surface's two-day window is a presentation default, and enforcing it would cost a
correlated subquery to protect a row that is not a revenue figure. The staff date
limits — record on the current business day, correct only while that day is still
running — live in the row guard instead, because both resolve the outlet's own
cutover through `app_business_date`. An owner and a manager are deliberately not
held to that window: they step or pick to any past business date and record
against the day on screen.

`expense_people()` is a `security definer` read returning display names, and only
display names, for accounts that wrote expenses the caller may already read. It
exists because `profiles` cannot answer that question for the readers this
capability added: its select policy needs a shared outlet assignment and a caller
whose role is `franchise_admin` or `biller`, so an Employee sees nobody and
nobody at an outlet sees an owner — whose assignment carries no outlet at all,
and who recorded most of the rows already stored. Its predicates mirror the row
policies deliberately, and `supabase/tests/21_manual_ledger.sql` asserts the two
agree rather than trusting that they do.

## The archived notebook

**`archived_manual_ledger_days`** — the forty day rows the manual-ledger stopgap
(#36) accumulated while August 2026 was trading, under an explicit archive name.
`retire-the-manual-ledger` (#12) carried each counted row into a drawer
observation and each cash movement into drawer cash out, then renamed this table
rather than dropping it: a carry-over is a transformation, and a transformation
can be wrong in a way nobody notices for a month. Keeping the source costs
nothing and is the only thing that makes the carry-over checkable afterwards.

It stays in `public`, with RLS enabled, **no policy, no runtime grant** and a
`reject_mutation()` trigger, so no role can read or change it and no application
query names it. Moving forty rows into a second schema would have added a restore
path without adding protection.

## Operator restaurant mappings

**`outlet_channel_restaurants`** — `id`, `outlet_id`, `channel`, `external_ref`,
`state`, and audit timestamps. It maps an operator's restaurant reference to the
one Shawarmania outlet that owns it. `channel` identifies the operator and
`external_ref` is the operator-side restaurant identity; an enabled mapping is
the identity an automated statement reader, owner-triggered sync, or session
probe may act on.

`state` is an enum-like field with the values `enabled` and `dormant`.
**There is no boolean `enabled` column.** Dormant rows retain an old or
decommissioned identity for audit and must not trigger automated work. Edge
Functions obtain automated mappings through the generated-schema typed shared
helper, so the column/value distinction is checked before deployment.

## Alerts

**`alerts`** — `id`, `outlet_id`, `raised_by`, `subject`, `message`, `category` (`inventory` | `equipment` | `cash_mismatch` | `employee` | `supplier` | `other`), `priority` (`low` | `normal` | `high` | `urgent`), `status` (`open` | `acknowledged` | `resolved` | `closed`), `created_at`.

**`alert_responses`** — `id`, `alert_id`, `responder_profile_id`, `message`, `created_at`.

Alerts are the one place a Franchise Admin deliberately writes data the Super Admin reads, and the only cross-role write path in the system.

## Two modelling traps in this domain

### 1. Double-counting food cost in profit and loss

Raw materials appear **twice** in the natural reading of this schema: once as an `expenses` row when stock is bought, and again as inventory `used`/`wasted` movements valued at purchase cost. Summing "all expenses" *and* "food cost" double-counts.

**The consumption basis is withdrawn, and this section describes a mode that is going away.** It matched the exact word `raw_materials`, a value of the closed category list that `expense-categories-grow-from-use` replaced with free text, so nothing a person types has matched it since. Rather than fix a matcher for a basis nobody can compute, `retire-the-manual-ledger` (#12) withdraws the consumption basis entirely, because inventory is shelved (`openspec/todos/inventory-is-shelved.md`) and there are no movements to count. The double-count this section guards against cannot occur without them. Both return together or not at all.

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
- `total_paise = subtotal_paise − discount_paise + tax_paise + rounding_paise` on every bill **and every order**, with `total_paise` always a whole number of rupees and never below ₹1. The rounding term exists because a percentage of an odd subtotal produces paise nobody at a counter can be handed; it is always in the business's favour and always stored rather than derived on read. **This identity is written in three places** — the check constraints, `billTotals()` and `billing_validate_totals` — and `npm run lint` fails when the shared case table in `src/domain/billing-totals-cases.json` drifts from its copy in the pgTAP suite.
- `discount_paise` equals the sum of its lines' `discount_paise` plus its own `bill_discounts` / `order_discounts` rows, enforced by a deferred constraint trigger. A menu discount rides the line it reduced, carrying the percentage that produced it; a discount on the whole bill has no line and gets a row.
- `line_total_paise = unit_price_paise × quantity` on every bill item.
- Every bill has exactly one `bill_public_links` row with a unique, URL-safe token, including every bill rung before the capability existed — the migration backfills them and **asserts the row counts match**, so a partial backfill aborts it whole rather than leaving some bills silently unshareable. No link operation can modify a bill, asserted by reading the bill byte for byte across a revoke, a reissue and an update.
- A menu discount's rows on the customer's receipt are grouped by the database, and `npm run lint` fails when the shared case table in `src/domain/discount-row-cases.json` drifts from its copy in the pgTAP suite — the same treatment the bill identity gets, because the grouping is a sum performed both in TypeScript for the counter's draft and in SQL for the receipt, and a divergence would show a customer different rows from the ones the till showed them.
- `(outlet_id, bill_number)` is unique, and per-outlet sequences have no gaps attributable to the client.
- An inventory item's `current_quantity` equals the sum of its movements' `quantity_delta`.
- `expected_closing_paise` matches the invariant above from its own snapshotted inputs.
- No order or bill date disagrees with what the outlet cutover implies for its
  matching order or payment timestamp.
