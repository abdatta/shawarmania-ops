# Proposal: Swiggy Settlement Sync

> **Model**: Ox Alpha · **Wave**: D · **Depends on**: #44 `aggregator-reconnect-and-hyperpure-automation` · **Gate**: Kalyani's Swiggy sales appear in the ledger from two browser-free reads each day; a portal-declared closed payout cycle settles those days against the exact payout after every fee, tax, ad charge, complaint, cancellation, refund and adjustment; a headed login is used only when the independent Swiggy session genuinely needs repair; a real Swiggy annexure can reproduce the same result offline; legacy typed Swiggy history survives the handover; and an unserved outlet is shown as not connected rather than as zero trade.

## Why

Swiggy trade is still typed into the stopgap ledger, so same-day revenue can go stale and the amount the business actually receives after all deductions is neither independently measured nor reconciled. The live portal investigation proved that Swiggy exposes timestamped per-order payout detail whose `Total Customer Paid - GST Collected` equals the final annexure's pre-tax Net Bill Value, alongside provisional current-cycle payout data, closed-cycle final payout data and downloadable evidence. That is enough to give Swiggy the same trustworthy owner workflow as Zomato without making scheduled reads depend on a browser.

## What Changes

- Add a Super Admin Swiggy tab alongside Zomato with the same per-outlet health, last-success, Read again, reconnect, just-in-time OTP, event history, provisional/settled/revised/disputed reconciliation and manual-upload workflows. Swiggy has no Hyperpure child line.
- Add an independent Swiggy credential and login lifecycle. Reconnect first probes only the Swiggy session, stops silently when it is healthy, and dispatches the headed Playwright login only when repair is required; normal daily and payout reads remain browser-free HTTP/GraphQL jobs.
- Run one serialized Swiggy job twice daily. Each run refreshes current/open-cycle order data and rereads recent portal-declared closed cycles so same-day figures advance during the day and newly final or revised payouts are discovered promptly. A failed, lapsed or shape-changed read never writes zeroes or replaces the last measured value.
- Define Swiggy's daily gross as the timestamped per-order `Total Customer Paid - GST Collected` basis, which fixture reconciliation proves equals final `Net Bill Value` before taxes; derive each business date from order timestamps and the outlet cutover, retain capture/as-of time on provisional values, and never assign a midnight-to-midnight portal aggregate to an outlet business date.
- Treat an open cycle's current payout as provisional. Treat the portal's final payout for its own declared cycle boundaries as the exact post-commission-and-deduction settlement target; reconcile order payouts plus separately dated or cycle-level fees, taxes, ads, complaints, cancellations, refunds and adjustments without spreading undated cycle deductions across days.
- Generalize the measured aggregator tables, ingest/rehearsal commands, accepted-difference identities, adapters and health/event contracts from Zomato-only to channel-aware behavior while continuing to exclude Hyperpure from restaurant-sales money tables.
- Support multiple explicit Swiggy restaurant references for one outlet, because the account exposes an active and a dormant Kalyani identity. Leave Kanchrapara unconfigured until the business supplies evidence that Swiggy serves it; unconfigured outlets produce no sync rows and no synthetic zeroes.
- **BREAKING**: remove Swiggy revenue and commission from the writable manual-ledger contract after a measured backfill and coverage audit. Preserve every legacy typed value and its provenance as superseded history, keep historical totals unchanged until authoritative data replaces that date, and make stale clients carrying the removed fields fail loudly.
- Let Franchise Admins read measured daily aggregator figures for assigned outlets so freezing both Zomato and Swiggy does not make their existing ledger incomplete. Settlement cycles, deductions, credentials, sync controls and the owner Swiggy tab remain Super Admin-only.
- Extend manual statement upload through content recognition, not filenames. A Swiggy payout-annexure XLSX can supply the full order/cycle ingest; a Business Metrics XLSX can supply portal-calendar sales evidence but cannot be written as an outlet business date unless the cutover attribution is proved; and a deterministic payment-advice PDF can settle or verify a matching cycle only when sufficient daily/order evidence already exists. A file that cannot establish the required facts is rejected clearly and never invents daily gross. Scanned/OCR-only documents remain unsupported until verified.
- Store accepted upload evidence privately under outlet/channel isolation, discard customer PII during parsing, make replay idempotent, and require confirmation before an upload restates an already settled period.
- Add demo data and tests for active, provisional, settled, revised, disputed, lapsed-session, upload-fallback and not-connected states while keeping screens behind the typed adapter seam.

## Capabilities

### New Capabilities

- `aggregator-channel-sessions`: Extend the independent channel-session capability introduced by dependency #44 with Swiggy-specific probing, OTP timing, secret storage, repair and scheduled-reader behavior. This change must be applied and archived after #44, at which point this is an extension of that capability rather than a competing session model.

### Modified Capabilities

- `aggregator-settlement-sync`: Admit Swiggy order and cycle payloads, independent restaurant mappings, portal-declared cycles, exact payout reconciliation, twice-daily browser-free reads and channel-safe revisions/disputes.
- `aggregator-figures`: Store Swiggy provisional and settled business-day figures with truthful source/as-of provenance, legacy supersession and assigned-outlet Franchise Admin reads.
- `manual-ledger`: Replace writable Swiggy inputs with sourced read-only figures while preserving pre-handover history and complete assigned-outlet ledger visibility.
- `statement-uploads`: Recognize and safely ingest Swiggy XLSX/PDF evidence with explicit full-versus-cycle-only semantics, privacy, isolation, idempotency and restatement confirmation.

## Impact

- **Ops database and Edge Functions**: channel constraints, normalized outlet/operator identifiers, credential/auth mailbox metadata, sync boundaries and runs, daily figures, cycle deductions/reconciliations, ingest/rehearsal RPCs, statement decoding/storage and RLS policies.
- **Ops application**: channel-generic sync adapters/components, a gated `/ledger/swiggy` owner route and navigation item, attention state, ledger day/month adapters and forms, demo fixtures and role-aware tests.
- **Sync repository and CI**: production Swiggy API parsers, pagination and payout arithmetic, Vault session loading, the headed login workflow, twice-daily browser-free workflow, retries/classification, serialized concurrency and fixture/live rehearsal coverage.
- **Rollout**: widen contracts and seed explicit Kalyani mappings; capture a Swiggy login; prove same-day cutover behavior and at least two closed-cycle reconciliations without writes; backfill and audit coverage; then remove manual fields, enable authoritative writes and scheduling, and promote the Swiggy gate. Kanchrapara remains visibly not connected.
- **Roadmap**: add this as #47 after #44 and before #46 `aggregator-login-live-stages` and #12 `daily-cash-live`; #12 inherits this change as a dependency because it retires the manual ledger. Adding the sibling tab also fires the existing flat-navigation todo, which remains a separately sequenced shell change.

## Non-goals

- No Hyperpure behavior, statement format, capture flow or supply-data change.
- No synthetic Kanchrapara restaurant mapping, inferred zero revenue or automatic fuzzy outlet matching.
- No hard-coded Swiggy commission percentage and no estimate presented as an exact payout.
- No assumption that payout cycles are calendar weeks; Swiggy's portal-provided start and end dates are authoritative.
- No browser automation in scheduled daily or payout jobs, and no automatic login/OTP attempt from a schedule.
- No item-level Swiggy sales analytics or menu-demand reporting beyond the figures needed for ledger and payout reconciliation.
- No broad owner-navigation redesign; the existing navigation-capacity todo is only sequenced by this change.
- No OCR pipeline for scanned PDFs and no claim that a payout advice or tax invoice can reconstruct facts it does not contain.

## Docs to update before archiving

`docs/PROJECT_OVERVIEW.md`, `docs/BUSINESS_CONTEXT.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/TESTING.md`, and `docs/LIMITATIONS.md`.
