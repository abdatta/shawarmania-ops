# Separate implementation review

Reviewed on 2026-09-17 against the isolated full production restore. This file
contains only schema names, aggregate outcomes and hashes; it contains no row
identifiers, customer or employee facts, receipt tokens or credentials.

## Artifacts compared

The review compared `proposal.md`, design decisions D2–D14, the 34-relation
dependency inventory, the transfer migration, its 39-assertion pgTAP suite,
the Edge/UI adapter path, the incident operator, the generated targeted
before-image/reversal shape and the clone-per-case rehearsal harness.

The restored-schema scan followed every foreign key whose referencing or
referenced relation was one of `bills`, `bill_items`, `bill_payments`,
`orders`, `order_items`, `billing_commands`, `expenses`, `counter_devices`,
`counter_shifts` or `counter_shift_requests`. Every dependent stored relation
was already represented as a mutation target, immutable reference, preserved
row set or required-absent refusal in design D6 and `inventory.md`. The scan
also compared the complete trigger, constraint, policy, index, view and
dependent-function catalog captured by the external bundle. No additional
incident row graph was found.

## Findings fixed during review

1. The operator incorrectly refused a plan before the incident shift's stored
   expiry, despite D9 and task 4A.4 requiring both sides of the 04:00 IST
   boundary. Planning now accepts either side, records the fixed stored expiry,
   and apply closes at the earlier of that expiry and transaction time.
2. Canonical hashing treated JavaScript `Date` objects as empty objects. Dates
   are now serialized to ISO instants before hashing, so timestamp drift is
   covered and a written/read-back bundle retains the same digest.
3. Disposable database cleanup attempted to terminate PostgreSQL background
   workers. It now terminates only client connections before dropping a clone;
   this changes no repair behavior.

The current external bundle checksum is
`2a184e5293ccb6d774b9a401d9f68c49a4969916ef1206382dc11629ef5708a4`; its
plan digest is
`807fb5e9340120c114a98d2f947622ff48b64186ab2d159dfc3232647b1aa8e8`.

## Reverification after fixes

Fresh full-dump clones passed exact plan/apply/fresh-process verify/rollback,
pre-expiry closure at transaction time, post-expiry closure at stored expiry,
the next request/confirm-shift path and genuine first billing RPC (Kalyani bill
1027 with Kanchrapara high-water 778), all twelve injected transaction failure
points, all reviewed drift refusals, lock refusal and unsafe-rollback refusal.
The transfer's real local Edge/Auth suite remained green with 11 tests, the
database transfer suite remained green with 39 assertions, and tablet editing
passed component plus phone/tablet light/dark browser coverage.

The review found no production-write instruction hidden in deployment: the
migration changes only the durable edit/RLS feature, while the incident graph
continues to require the explicit operator command and matching fresh plan.
Production remained untouched throughout review.
