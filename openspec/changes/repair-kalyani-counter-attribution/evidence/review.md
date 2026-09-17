# Separate implementation review

Reviewed initially on 2026-09-17 and again on 2026-09-18 against the isolated
fresh full production restore. This file
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
4. The delayed cutover allowed genuine Kalyani bills 990–1024 to occupy the
   original incident target range. The amended design freezes that complete
   35-bill graph, shifts it intact to 1027–1061, keeps the incident at
   990–1026, and makes 1062 the next number. No bill is voided or recreated.
5. A bulk rollback could transiently collide with the non-deferrable per-outlet
   bill-number uniqueness check. Apply and reversal now stage all affected
   numbers in a reviewed high range inside the same locked transaction and the
   plan refuses any pre-existing row in that range.
6. Command hashing excluded the whole JSON result although only `billNumber`
   may change. It now removes only that key (and incident outlet where expected),
   so every other result field is sealed across apply and rollback.

The current reviewed external rehearsal bundle checksum is
`ba3f289719bb076670bffac702395efd36e0d8835aa6360b8976b94222203e91`; its
plan digest is
`2ddd9538e42cb0141885db927d471a6d74ecc58a6654ac4622db9f954ba4b5a2`.

## Reverification after fixes

Fresh full-dump clones passed exact plan/apply/fresh-process verify/rollback,
pre-expiry closure at transaction time, post-expiry closure at stored expiry,
the next request/confirm-shift path and genuine first billing RPC (Kalyani bill
1062 with Kanchrapara high-water 778), active later-shift refusal, all fourteen
injected transaction failure points, later bill gap/void/command drift refusals,
all earlier reviewed drift refusals, lock refusal and unsafe-rollback refusal.
The transfer's real local Edge/Auth suite remained green with 11 tests, the
database transfer suite remained green with 39 assertions, and tablet editing
passed component plus phone/tablet light/dark browser coverage.

The review found no production-write instruction hidden in deployment: the
migration changes only the durable edit/RLS feature, while the incident graph
continues to require the explicit operator command and matching fresh plan.
Production remained untouched throughout review.
