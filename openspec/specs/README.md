# Living Specs

Each subdirectory here is one **capability** — a coherent slice of system behaviour — holding a `spec.md` that states what the system is contractually required to do **right now**, in the present tense.

```
openspec/specs/<capability>/spec.md
```

## How specs get here

You do not write these by hand. They are assembled from change deltas:

1. A change under `openspec/changes/<id>/` writes **spec deltas** in `specs/<capability>/spec.md`, using `## ADDED` / `## MODIFIED` / `## REMOVED` / `## RENAMED Requirements` sections.
2. When the change is archived with `/opsx:archive`, those deltas are merged into the living spec here.
3. The living spec then describes current required behaviour, with no history. History lives in `openspec/changes/archive/`.

## Format

Requirements are testable statements using SHALL/MUST, each with concrete scenarios:

```markdown
## Purpose

<one paragraph: what this capability guarantees>

## Requirements

### Requirement: Outlet-scoped bill access

The system SHALL restrict bill reads to the requesting session's outlet, and MUST
reject a request that names another outlet's identifier explicitly.

#### Scenario: Franchise Admin reads their own outlet

- **WHEN** a Franchise Admin scoped to Kalyani lists bills
- **THEN** only Kalyani's bills are returned

#### Scenario: Franchise Admin names another outlet

- **WHEN** the same session requests bills filtered to Kanchrapara's outlet id
- **THEN** the request returns no rows, because the database policy excludes them
```

Write behaviour, not implementation. A spec that names a React component or a file path has described *how*, and will be wrong the first time that code is refactored.

## Current capabilities

This alphabetical list maps every capability required now. For planned work, read the
[reconciled roadmap](../changes/ROADMAP.md).

- [`app-shell`](app-shell/spec.md) — four role-appropriate shells, gate-derived navigation, uniform real and demo sessions, reachable theme controls, stable role paths, and shared layout primitives.
- [`attention-badges`](attention-badges/spec.md) — a consistent, contextual count of work waiting for a reader, visible wherever that work can be reached.
- [`attendance-and-location`](attendance-and-location/spec.md) — reviewable attendance evidence: capture coordinates, accuracy, distance, source, verdict, and approval beside each business-day record.
- [`billing-command-contract`](billing-command-contract/spec.md) — an atomic, replay-safe database command boundary for billing writers, historical shift attribution, and day-close readiness.
- [`counter-billing`](counter-billing/spec.md) — server-assigned bill numbers, append-only settlement history, snapshot line items, idempotent client UUIDs, and cutover-validated business dates.
- [`counter-device-sessions`](counter-device-sessions/spec.md) — secure one-outlet counter-tablet enrollment and named-person shift opening from the employee's own phone.
- [`cross-outlet-oversight`](cross-outlet-oversight/spec.md) — owner comparison of every permitted outlet from recorded rows and closed-day snapshots, without widening a switcher or exporting demo figures.
- [`daily-cash-reconciliation`](daily-cash-reconciliation/spec.md) — database-computed cash close records that become immutable snapshots, protecting a counted drawer from later recalculation.
- [`demo-mode`](demo-mode/spec.md) — a visibly fabricated, no-authentication four-role demo through typed adapters, structurally unable to write real data.
- [`design-system`](design-system/spec.md) — semantic token layering, AA-verified light and dark themes, and shared money and date formatters.
- [`expense-categories`](expense-categories/spec.md) — business-wide expense-category suggestions grown from use, with historical category text preserved and deliberate owner-led rewrites.
- [`global-customer-identity`](global-customer-identity/spec.md) — one business-wide normalized-phone customer record with exact billing lookup, no enumeration, separate owner access, and no widened transaction access.
- [`identity-and-access`](identity-and-access/spec.md) — admin-provisioned four-role accounts, username or private-email sign-in, assignment-derived authority, and immediate deactivation.
- [`inventory-ledger`](inventory-ledger/spec.md) — an append-only stock-movements truth with a database-maintained current-quantity cache and correction-by-new-entry history.
- [`manual-ledger`](manual-ledger/spec.md) — temporary hand-entered outlet takings, expenses, and drawer reconciliation, with correct per-day aggregator commissions and a guarded retirement path.
- [`menu-management`](menu-management/spec.md) — outlet menus with role-bounded availability and deliberate non-retroactive price changes.
- [`order-lifecycle`](order-lifecycle/spec.md) — editable counter orders with daily customer-facing numbers, ownership, terminal states, attributed cancellation, and day-close participation.
- [`outlet-alerts`](outlet-alerts/spec.md) — categorised, prioritised outlet-to-owner issues with response threads, one-step status progression, and an owner-only cross-outlet inbox.
- [`outlet-expenses`](outlet-expenses/spec.md) — explicit-business-date, integer-paise outlet expenses, where only cash payments reduce the drawer at close.
- [`outlet-tenancy`](outlet-tenancy/spec.md) — database-enforced outlet isolation, immediate deactivation and device revocation, and schema-enumerated coverage that a new table cannot skip.
- [`profit-estimates`](profit-estimates/spec.md) — stated cash- or consumption-basis profit estimates that never double-count raw materials and always use integer paise.
- [`project-scaffold`](project-scaffold/spec.md) — a buildable, testable repository whose security and delivery boundaries are enforced by tooling and CI.
- [`pwa-and-deployment`](pwa-and-deployment/spec.md) — installable, offline shell access, non-disruptive updates, identifiable builds, and safe static sub-path hosting.
