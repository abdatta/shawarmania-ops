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

Foundation capabilities landed with `project-foundations`; they describe how the repository and the shell behave rather than what the business does.

- [`project-scaffold`](project-scaffold/spec.md) — a clone that builds, layer boundaries enforced by tooling, CI (including the database suite), safe client configuration, committed drift-gated schema types.
- [`design-system`](design-system/spec.md) — token layering, both themes, verified contrast, the money and date formatters, touch sizing.
- [`pwa-and-deployment`](pwa-and-deployment/spec.md) — installable, offline shell, non-disruptive updates, identifiable builds, sub-path hosting.

Domain capabilities landed with `data-model-and-tenancy`. These are **schema-level contracts**: they bind every future writer, while their screens and flows arrive with later changes.

- [`outlet-tenancy`](outlet-tenancy/spec.md) — outlet isolation enforced in the database, claims-based scoping, immediate deactivation and revocation, enumerated coverage, two-outlet synthetic seeds.
- [`counter-billing`](counter-billing/spec.md) — server-assigned gapless bill numbers, append-only bills with a void-only transition, snapshot line items, idempotent client-UUID writes, cutover-validated business dates.
- [`inventory-ledger`](inventory-ledger/spec.md) — the movements ledger as append-only truth with a database-maintained stock cache.
- [`daily-cash-reconciliation`](daily-cash-reconciliation/spec.md) — day close computed and snapshotted by the database, never recomputed, arithmetic held by constraints.
- [`attendance-and-location`](attendance-and-location/spec.md) — location evidence stored beside the verdict, one row per employee per business day.

Owner-facing capabilities landed with `ui-owner-console-and-demo`. These are **surface contracts against a mocked seam**: the behaviour is required now, and `owner-console-live` (#13) makes the figures real without changing what is required of the screens.

- [`cross-outlet-oversight`](cross-outlet-oversight/spec.md) — every outlet on one screen, figures derived from recorded rows, closed days read from their snapshots, a switcher that never widens, and no export of demonstration figures.
- [`profit-estimates`](profit-estimates/spec.md) — two named bases, the basis always stated, raw materials counted exactly once, integer paise.
- [`outlet-alerts`](outlet-alerts/spec.md) — categorised and prioritised alerts with a response thread, a one-step-at-a-time status ending terminal, and a cross-outlet inbox only the owner reads.

One capability belongs to the business rather than to any outlet, landed with `global-customer-identity`. It is the single deliberate exception to outlet scoping, which is why it is called out on its own rather than filed beside the outlet contracts.

- [`global-customer-identity`](global-customer-identity/spec.md) — one canonical phone is one customer business-wide, retrievable only by a complete exact phone from a billing context, with no browse or direct-table path for any role, a rate bound that logs no phone input, a separate owner read, and no widening of transaction access. `outlet-tenancy` carries the matching clause requiring the catalog to classify it as global and to keep every customer-linked transaction outlet-scoped.

## Expected capabilities

The remaining domain capabilities, derived from the roadmap; each arrives as its change archives:

`staff-authentication` · `counter-device-trust` · `menu-catalogue` · `offline-settlement` · `expense-tracking`
