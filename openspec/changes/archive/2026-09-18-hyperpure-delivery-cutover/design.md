# Design: Hyperpure Delivery Cutover

## Context

The Hyperpure statement is account-level. It does not carry a reliable Ops
outlet assignment per order, and the supplier's app-side delivery location may
lag the physical operation. Ops currently fills that gap with
`outlets.hyperpure_delivery`, a unique boolean that can name one outlet but
cannot say when that outlet changed.

The statement parser copies the flagged outlet into one top-level payload and
`ingest_supply_statement` writes every order to it. Its idempotency key is
`(outlet_id, source_system, source_ref)`. Those choices were consistent while
both kitchens drew from one inventory delivered to one permanent address. They
are not consistent after a real delivery cutover: changing the flag makes the
same replayed order a different identity.

Production evidence and the owner's physical-delivery confirmation establish
the boundary:

- Kanchrapara traded through 15 September 2026.
- The Hyperpure order invoiced on 17 September 2026 was delivered to Kalyani.
- Therefore Kanchrapara is authoritative through 15 September and Kalyani from
  16 September, leaving no ambiguous invoice date.

## Goals / Non-Goals

**Goals**

- Route each Hyperpure order to the physical delivery outlet in force on its
  invoice date.
- Preserve every order through 15 September at Kanchrapara and correct the
  17 September order to Kalyani.
- Make an order one identity across the supplier account, even when routing
  changes and a statement overlaps the boundary.
- Keep scheduled and uploaded statements on one authoritative path.
- Deploy without requiring login, capture or OTP and without creating a window
  in which an old parser can duplicate money.

**Non-Goals**

- Changing provider-side account metadata, credentials, capture cards or auth.
- General cost allocation between kitchens. This change records physical
  delivery, not consumption ratios.
- Reclassifying historical deliveries because one outlet later paused.
- Deactivating Kanchrapara.

## Decisions

### D1. Delivery routing is an effective-dated database fact

Add `supplier_delivery_routes` with:

- `source_system text`
- `effective_from date`
- `outlet_id uuid references outlets(id)`
- primary key `(source_system, effective_from)`

For a supplier order, the route is the row for that source with the greatest
`effective_from` not later than the order's invoice date. Successive starts
form non-overlapping implicit intervals without storing an independently
editable end date.

Seed Hyperpure with Kanchrapara from `0001-01-01` and Kalyani from
`2026-09-16`. The first date expresses the known historical default without a
database-infinity sentinel, so the retained purchase whose invoice predates the
books resolves to Kanchrapara before its ledger date is clamped to the books'
opening date. A future source with no route on or before an invoice date is
refused rather than guessed.

The table carries `outlet_id`, so it is outlet-scoped under the repository's
hard rule. RLS is enabled. No client receives insert, update or delete. The
Super Admin may read the routing history; Franchise Admin, Biller, Employee and
anonymous callers may not. The service role owns configuration changes.

*Rejected: flip `outlets.hyperpure_delivery` to Kalyani.* It has no date and
turns a replayed pre-cutover order into a Kalyani order.

*Rejected: hard-code `2026-09-16` in TypeScript or SQL.* The next operational
move would require another code branch, and manual upload could drift from the
scheduled reader.

*Rejected: derive the route from Hyperpure's current app location.* The owner
has explicitly confirmed that provider metadata may lag the physical delivery,
and a current value cannot classify history on both sides of a cutover.

### D2. The database resolves the route per order

`ingest_supply_statement` resolves `outlet_id` inside its order loop from the
source and invoice date. It verifies every resolved outlet is in
`p_permitted_outlets` before writing. A statement spanning the cutover can thus
produce Kanchrapara and Kalyani rows atomically without trusting a caller's
single top-level outlet.

The existing version-1 payload remains accepted during rollout. Its top-level
`outlet_id` is treated as a compatibility field, not routing authority. The
Edge parser can then stop querying `hyperpure_delivery` after the database
migration is live, without a deploy-order outage. A later cleanup may remove
the field and legacy outlet column under a separately versioned contract.

*Rejected: split the workbook into one payload per outlet in the Edge Function.*
That would make application code the money-routing authority and would still
leave the database unable to defend itself against a stale or malformed
payload.

### D3. Hyperpure order identity is global across outlets

Add a partial unique index on `(source_system, source_ref)` for every Hyperpure
source row, including a withdrawn row: one supplier order remains one recorded
identity throughout its lifecycle. Retain the existing outlet-scoped source
index for other origins, whose external references may legitimately be local
to an outlet.

The Hyperpure ingest targets the global key. A repeat updates the one row's
amount, date, description and shared marker, but does not silently change its
outlet. If an existing order's outlet disagrees with the effective route, the
ingest refuses it as an attribution conflict requiring an audited correction.
This prevents both duplication and quiet historical rewriting.

*Rejected: make every source reference global.* Other source systems have not
proved account-global identifiers, so widening their contract would risk false
collisions unrelated to this change.

*Rejected: shorten the replay window around the cutover.* Hyperpure invoices
arrive late; reducing the window trades duplicate risk for missing costs.

### D4. The post-cutover correction is bounded and migration-audited

The migration first snapshots every unvoided Hyperpure expense dated from
`2026-09-16` that still belongs to Kanchrapara: its row id, source ref, date and
amount, plus the set's count and total paise. This includes genuine deliveries
that may arrive while the change is being built. As an exact anchor, it also
expects one row with:

- source ref `ZHPWB27-OR-0030242357`
- business date `2026-09-17`
- amount `110129` paise
- current outlet Kanchrapara

It aborts if the anchor differs, if a post-cutover Hyperpure row is already at
an unexplained third outlet, or if a pre-cutover Hyperpure row is outside
Kanchrapara. It then moves the snapshotted set to Kalyani in the same transaction
as the routing and uniqueness changes, using a narrowly bounded migration-only
bypass of the ordinary expense identity trigger. The trigger is restored before
commit. Postconditions compare every snapshotted identity, date and amount,
assert the same count and paise at Kalyani, assert the anchor once globally, and
assert no global Hyperpure duplicates.

This is the deliberate exception to ordinary expense identity immutability. A
void-plus-replacement would preserve two rows carrying one supplier identity
and fight the new global key; an unrecorded direct production edit would have
no reviewable contract. The forward migration and its captured correction set
are the audit record for rows that were wrong when created.

### D5. Authentication remains untouched

The accounting change does not need a new provider session. Local tests use
fixtures. Production verification uses the already stored Hyperpure session
only for a no-write statement rehearsal and an ordinary live read.

No implementation or verification step dispatches `login.yml`, invokes the
full-login rung, opens an auth request, requests or submits an OTP, deletes a
credential, or changes the reconnect/capture code. The picker remains
Kanchrapara's `22675834`, and `HYPERPURE_DELIVERY_OUTLET_ID=1719650` remains the
working account-level API header.

If either stored session lapses naturally, production verification stops and
reports the external session blocker. It does not escalate into login. Current
evidence at proposal time is six consecutive successful Zomato runs and six
consecutive successful Hyperpure runs on 17–18 September 2026.

### D6. Health attribution follows the current delivery operation

After the data change is deployed, `HYPERPURE_OPS_OUTLET_ID` in
`shawarmania-sync` moves from Kanchrapara's Ops UUID to Kalyani's. This changes
where future Hyperpure run-health rows appear, not statement contents or
expense routing. Historical run rows remain where they were recorded.

## Security, Money, Time and Offline

- **RLS**: the new outlet-scoped route table ships with policy, grants and an
  isolation test in the same change. The service-only ingest verifies every
  resolved route against the caller's derived permitted outlets.
- **Money**: amounts remain integer paise and byte-for-byte unchanged during
  the correction. The global identity and migration assertions prevent double
  counting.
- **Time**: routing uses the explicit invoice `date`, not `created_at` or UTC.
  The cutover is `2026-09-16` in the business's India calendar.
- **Offline**: no counter or outbox path changes. Statement upload already
  requires a connection and remains so.

## Migration and Rollout Plan

1. Pause only the scheduled Hyperpure workflow. Zomato continues normally.
2. Apply the database migration: route table and RLS, dated rows, rewritten
   ingest, bounded post-cutover correction, global identity, assertions, and
   current-marker compatibility update.
3. Deploy the Edge parser cleanup that no longer treats the boolean as routing
   authority. Old and new parser versions are accepted across the boundary.
4. Regenerate schema types and deploy the normal Ops application/functions.
5. Change only `HYPERPURE_OPS_OUTLET_ID` to Kalyani in the sync repository.
6. Dispatch Hyperpure with `rehearse=true`. It reads the stored session and
   writes neither expenses nor run health.
7. Dispatch one ordinary Hyperpure read. Assert every source ref is globally
   unique, rows through 15 September remain Kanchrapara, and rows from
   16 September are Kalyani.
8. Resume the scheduled Hyperpure workflow.

Rollback after the migration is forward-only: do not reverse the cutover by
flipping a flag. If verification fails, keep the reader paused, retain the
corrected and globally unique data, and ship a forward repair. The production
build already live remains unaffected because this change has no UI dependency.

## Risks / Trade-offs

- A route configured with the wrong effective date misattributes money. The
  seeded boundary, exact production correction and cross-boundary replay test
  pin the date three ways.
- The compatibility boolean temporarily duplicates the idea of a current
  route. It remains only to make mixed-version deployment safe, is set to the
  latest route, and is explicitly non-authoritative. Removing it is deferred.
- A manager permitted at only one of the two outlets cannot upload a statement
  spanning both routes. That is the correct tenancy outcome, not a reason to
  split or guess; the Super Admin or scheduled reader handles the account-level
  file.
- Updating health attribution leaves older health history under Kanchrapara.
  Moving history would falsify where those runs were recorded and is rejected.
