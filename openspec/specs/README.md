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

- [`aggregator-figures`](aggregator-figures/spec.md) — outlet-and-day channel figures kept apart from drawer counts, written only by ingest, with nullable undetermined commission and retained superseded values.
- [`aggregator-channel-sessions`](aggregator-channel-sessions/spec.md) — one Vault session per restaurant channel, an independent mailbox per login, a probe that asks the portal itself, and reconnect dispatches that can only ever repair their own channel.
- [`aggregator-settlement-sync`](aggregator-settlement-sync/spec.md) — measured per-order aggregator revenue reconciled against the payout that actually arrives, with provisional, settled, revised and disputed cycles, deductions dated to the purchase, and a run record a person can act on.
- [`app-shell`](app-shell/spec.md) — four role-appropriate shells, gate-derived navigation, uniform real and demo sessions, reachable theme controls, stable role paths, and shared layout primitives.
- [`attention-badges`](attention-badges/spec.md) — a consistent, contextual count of work waiting for a reader, visible wherever that work can be reached.
- [`attendance-and-location`](attendance-and-location/spec.md) — reviewable attendance evidence: capture coordinates, accuracy, distance, source, verdict, and approval beside each business-day record.
- [`billing-command-contract`](billing-command-contract/spec.md) — an atomic, replay-safe database command boundary for billing writers, historical shift attribution, and day-close readiness.
- [`billing-delivery`](billing-delivery/spec.md) — durable local counter acceptance, single-leader dependency-aware draining, evidence-based retry classification, and resolved online day finish.
- [`cash-drawer`](cash-drawer/spec.md) — an outlet's drawer as a continuous balance observed at instants, with database-computed interval figures, approximate count times that say so, and no figure the app may change on a person's behalf.
- [`counter-billing`](counter-billing/spec.md) — server-assigned bill numbers, append-only settlement history, snapshot line items, idempotent client UUIDs, and cutover-validated business dates.
- [`counter-device-sessions`](counter-device-sessions/spec.md) — secure one-outlet counter-tablet enrollment and named-person shift opening from the employee's own phone.
- [`cross-outlet-oversight`](cross-outlet-oversight/spec.md) — owner comparison of every permitted outlet from recorded rows and closed-day snapshots, without widening a switcher or exporting demo figures.
- [`demo-mode`](demo-mode/spec.md) — a visibly fabricated, no-authentication four-role demo through typed adapters, structurally unable to write real data.
- [`design-system`](design-system/spec.md) — semantic token layering, AA-verified light and dark themes, and shared money and date formatters.
- [`expense-categories`](expense-categories/spec.md) — business-wide expense-category suggestions grown from use, with historical category text preserved and deliberate owner-led rewrites.
- [`global-customer-identity`](global-customer-identity/spec.md) — one business-wide normalized-phone customer record with exact billing lookup, no enumeration, separate owner access, and no widened transaction access.
- [`identity-and-access`](identity-and-access/spec.md) — admin-provisioned four-role accounts, username or private-email sign-in, assignment-derived authority, and immediate deactivation.
- [`ledger-statement`](ledger-statement/spec.md) — a trading day derived on every read and never stored: revenue by channel, the drawer ordered by instant, no editable field, and an unconfirmed balance that says so.
- [`menu-management`](menu-management/spec.md) — outlet menus with role-bounded availability and deliberate non-retroactive price changes.
- [`order-lifecycle`](order-lifecycle/spec.md) — editable counter orders with daily customer-facing numbers, ownership, terminal states, attributed cancellation, and day-close participation.
- [`outlet-expenses`](outlet-expenses/spec.md) — explicit-business-date, integer-paise outlet expenses, where only a cash payment moves the drawer and does so by the instant it happened.
- [`outlet-tenancy`](outlet-tenancy/spec.md) — database-enforced outlet isolation, immediate deactivation and device revocation, and schema-enumerated coverage that a new table cannot skip.
- [`profit-estimates`](profit-estimates/spec.md) — a named cash-basis operating profit estimate on the Ledger's month, presented as a ceiling while any commission is undetermined and withheld entirely where nothing was billed.
- [`project-scaffold`](project-scaffold/spec.md) — a buildable, testable repository whose security and delivery boundaries are enforced by tooling and CI.
- [`pwa-and-deployment`](pwa-and-deployment/spec.md) — installable, offline shell access, non-disruptive updates, identifiable builds, and safe static sub-path hosting.
- [`statement-uploads`](statement-uploads/spec.md) — content-recognised operator files that restore figures without a live reader, discard customer data, preserve outlet isolation, and ask before restating closed periods.
- [`supply-statements`](supply-statements/spec.md) — supplier orders booked once by source identity and delivery date, separated from payout recoveries, with omitted delivered orders reported rather than ignored.
