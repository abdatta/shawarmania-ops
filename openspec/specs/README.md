# Living Specs

**This directory is empty until the first change archives.** That is expected, not an oversight.

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

## Expected capabilities

Derived from the roadmap; each arrives as its change archives:

`outlet-tenancy` · `staff-authentication` · `counter-device-trust` · `menu-catalogue` · `counter-billing` · `offline-settlement` · `inventory-ledger` · `expense-tracking` · `attendance-and-location` · `daily-cash-reconciliation` · `profit-estimates` · `outlet-alerts` · `cross-outlet-oversight`
