## Context

`customers` is currently outlet-scoped and carries outlet-local spend aggregates,
but no live adapter writes it. The owner has now chosen one global identity per
normalized phone so either outlet can recognize a returning customer. The safe
boundary is deliberately narrow: exact complete-phone lookup for an active
billing context, no outlet-role browsing, and no cross-outlet transaction history.

## Goals / Non-Goals

**Goals:**

- Make one canonical phone identify one business-wide customer profile.
- Permit exact lookup and automatic first creation from eligible billing flows.
- Prevent outlet roles from enumerating global PII or reaching another outlet's bills.
- Migrate safely before real billing creates customer data.

**Non-Goals:**

- Loyalty, marketing, aggregates, exports, or digital receipts.
- Updating an existing profile from billing.
- Household/multi-person phone sharing.
- A general cross-outlet customer browser for outlet roles.

## Decisions

### Customers are global profiles; transactions remain outlet-owned

`customers` loses `outlet_id`, `bill_count`, and `total_spend_paise`. It retains
identity/profile facts only: UUID, canonical phone, optional name, and internal
created/last-used timestamps. Bills/orders retain outlet scope, customer foreign
key, and name/phone snapshots. Outlet reports never derive scope from customer.

Keeping aggregates on the global row was rejected because an exact lookup could
leak activity from another outlet and cached totals create correction drift.
Keeping duplicate outlet customers was rejected because it does not meet the
chosen reuse behavior.

### Canonical phone is the global key

A single database function normalizes Indian mobile input by removing permitted
presentation separators and canonicalizing accepted `10-digit`, `91...`, and
`+91...` forms to `+91` plus ten digits. Invalid or incomplete input is refused
before lookup/create. The canonical column is non-null and unique.

Storing the typed presentation as identity was rejected because the same phone
would produce duplicates. Fuzzy matching was rejected because a wrong merge is
more damaging than a missed match.

### Outlet roles receive no table SELECT

Direct customer-table privileges are revoked from ordinary authenticated and
machine sessions. A security-definer exact-lookup function normalizes the full
input, verifies an active device and billing grant, applies a per-device rate
bound, and returns only ID, canonical phone, and display name. A create-or-get
function uses the same checks and never updates an existing row.

Prefix search, `ilike`, and list endpoints were rejected as enumeration paths.
Relying only on the UI to send complete phones was rejected because a crafted
request must meet the same boundary.

### Super Admin access is explicit and separate

SA may read the global directory through an owner-authorized management path,
but no editing UI ships now. FA/Biller/device access never inherits that path.
Future profile editing must be its own flow and must not be smuggled into billing.

### Billing snapshots remain authoritative history

Autofill copies profile values into the order form. Payment stores the final form
values on the bill/order snapshots. Later profile changes cannot rewrite history.
If form values conflict with an existing profile, billing may use its form values
for that transaction but does not update the profile.

### Migration aborts on ambiguous real data

The migration first normalizes existing non-null phones. Same-phone rows with
equivalent names can merge by rewiring foreign keys to a deterministic retained
UUID. Conflicting nonblank names or invalid phones cause a precondition failure
with counts only, never PII in migration output. The expected production state
is empty; synthetic seeds are rewritten directly.

Choosing one conflicting name automatically was rejected because it silently
changes a global identity. Dropping unmatched rows was rejected as data loss.

## Risks / Trade-offs

- **Exact lookup can still be brute-forced** → require complete canonical input,
  rate-limit per device/caller, expose minimal fields, and test no list/prefix path.
- **Phone numbers are reassigned or shared** → document the launch identity rule
  and defer reassignment/household handling until a real case appears.
- **Automatic saving collects durable PII** → collect only phone plus optional
  billing name, never log it, keep exports absent, and retain the existing data-
  retention todo.
- **Global identity is a franchise-policy exception** → classify it explicitly as
  global, keep transaction data isolated, and require franchise onboarding docs
  to state the shared-directory rule before #14.

## Migration Plan

1. Run a read-only preflight for row count, invalid phones, and conflicting duplicates.
2. Add canonical phone and global constraints/functions; rewire safe duplicates.
3. Remove outlet/aggregate columns and direct outlet-role customer SELECT.
4. Regenerate types/seeds and add catalog classification plus isolation tests.
5. Keep UI gates non-live until #31/#10 consume the adapter.

Rollback is safe only before new global identities are written. After activation,
rollback requires copying global profiles into outlet-local records from their
outlet transactions and would intentionally lose business-wide identity; prefer
forward repair.

## Open Questions

None for owned-outlet launch. The franchise agreement must disclose the shared
directory before `outlet-onboarding` enables a third-party outlet.
