# Incident dependency inventory

This inventory was derived from the schema in the verified production logical
snapshot and checked against its restored data. It contains no row identifiers,
customer facts, employee identity, receipt tokens or credentials. The complete
machine-readable definitions live only in the external targeted before-image.

## Row graph and treatment

| Tables | Treatment |
|---|---|
| `bills`, `bill_items`, `bill_payments` | Move outlet context, frozen bill numbers and approved menu mappings; preserve all commercial facts. |
| `orders`, `order_items` | Move outlet context and approved menu mappings; preserve order numbers and commercial facts. |
| `billing_commands` | Move outlet context and rewrite only accepted-result bill numbers. |
| `counter_shifts`, `counter_shift_requests` | Move the incident shift/request and close the expired shift. |
| `counter_devices` | Move and rename the same proven Auth/device identity. |
| `expenses` | Move the five reviewed same-operator rows. |
| `bill_number_counters`, `order_number_counters` | Preserve source high-water marks and advance only the reviewed target marks. |
| `assignments`, `menu_items`, `menu_categories`, `outlets`, `profiles` | Read and lock as authority/mapping/reference facts; do not rewrite. |
| `bill_public_links`, `bill_public_link_views` | Preserve the 37 link rows and any access rows byte-for-byte. |
| `counter_device_setup_codes` | Preserve the one consumed setup-code row; never expose its hash. |
| `bill_discounts`, `order_discounts`, `bill_payment_corrections`, `bill_payment_correction_allocations`, `billing_attribution_reviews`, `billing_end_of_day_confirmations` | Required absent for the incident graph. |
| `shifts` | Legacy device/day rows and legacy bill references are required absent. |
| `aggregator_dismissed_duplicates` | References to the five reviewed expenses are required absent. |
| `drawer_cash_out`, `drawer_observations`, `drawer_observation_adjustments`, `drawer_reconciliation_acknowledgements` | Required absent at both outlets for business date `2026-09-16`; the repair invents no drawer event or collection. |
| `inventory_items`, `inventory_movements` | Items are reference data; movements are required absent at both outlets for the frozen business date. |

Customer/profile/Auth parent rows, attendance, receipt-view telemetry and menu
category rows are not mutation targets. Their keys remain stable through the
repair. The plan refuses a nullable legacy-shift edge or any excluded child
rather than silently widening the graph.

## Guards that the repair temporarily changes

Only these seven triggers are disabled, transactionally and by exact name:

- `bills.bills_append_only`
- `bill_items.bill_items_immutable`
- `bill_payments.bill_payments_immutable`
- `orders.orders_guard`
- `order_items.order_items_guard`
- `expenses.expenses_guarded`
- `expenses.expenses_set_updated_at`

Only `bill_payments_bill_outlet_fk` is made temporarily deferrable. It is the
composite `(bill_id, outlet_id) → bills(id, outlet_id)` edge that otherwise sees
the parent and child halves of the same move at different statements. No
replication-role bypass or global trigger disable is used.

The snapshot schema also contains the ordinary total, command-insert,
business-date, receipt-link, discount and menu guards. They stay enabled. The
before-image records every trigger, constraint, policy and index on the reviewed
relation set—not only the eight temporarily changed objects—and compares all
definitions and enabled/deferrability states before commit and from a fresh
verification process.

## Derived readers and policy boundary

The dependency scan found the two public views `effective_bill_payments` and
`effective_expenses`. Function definitions include the billing command family,
counter/device handshake and snapshot functions, receipt readers, drawer cash
readers, owner overview readers, menu validators and their trigger functions.
These are readers or invariant enforcers, not additional stored incident rows.

All RLS policies on the reviewed relation set are in the catalog manifest. The
transfer migration specifically changes device-owned reads for `orders`,
`billing_commands`, `billing_end_of_day_confirmations`,
`counter_shift_requests`, `counter_shifts` and legacy `shifts`; child reads
remain inherited through their parent bill/order policies.

## Restored-production result

The expanded plan found 34 reviewed relations, 53 non-internal triggers, 322
constraints, 48 policies, 107 indexes, two dependent views and 126 dependent
function definitions in the pre-deployment production snapshot. Its catalog
hash was
`00c62a75a5e69cb8a8b447f5cdd4bd2ef8b0f7e7153e81d461bb72420cc4fae7`.
The count and hash are expected to change when the reviewed transfer migration
is deployed; the post-deploy production plan must freshly capture and freeze
that exact live catalog rather than accepting this pre-deployment value.

The current version-3 targeted bundle is outside Git under the backup root
documented in `backup.md`. Its SHA-256 is
`2a184e5293ccb6d774b9a401d9f68c49a4969916ef1206382dc11629ef5708a4`.
Its canonical hashes include timestamp values, and its plan records the stored
shift expiry without making the digest depend on whether the clock has crossed
that expiry. An attempted destination inside this repository was refused and
created no file.
