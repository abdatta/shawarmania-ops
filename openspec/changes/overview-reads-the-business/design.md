## Context

The existing Overview waits for all outlet reads and its live insights adapter returns null. Ledger month reads every detailed day. Drawer already distinguishes Last Left from expected now. Navigation attention sources share reads. See proposal.md for the agreed product scope.

## Goals / Non-Goals

Deliver useful production and demo summaries without making detailed Ledger requests on Home. Preserve all write paths, accounting basis and role boundaries. Do not change the one-minute heartbeat or the thirty-minute unresolved-work evidence threshold.

## Decisions

1. Add a dedicated Overview adapter with separate sales, drawer, revenue and expense reads. Read-only SQL aggregates return small payloads, with explicit owner/manager authority checks for the requested outlet and no service key. No new table or widened RLS policy. Rejected detailed getMonth reuse because it expands into hundreds of requests.
2. Revenue uses settled bills' effective allocations and stored business dates plus delivery net when commission is known, gross otherwise, matching Ledger. Expenses use effective_expenses. P&L is the existing operating estimate; no-sales periods withhold profit and incomplete delivery data suppresses growth claims. Money stays integer paise.
3. Determine periods per outlet business cutover in Asia/Kolkata. Through yesterday normally; day one uses the previous full month. Compare the same last included day clamped to the preceding month, except full months compare full months. Zero/missing comparison has no percentage.
4. Each outlet metric uses independent request state, cancellation protection and retry. Current revenue appears before comparison; profit shares revenue and expenses. Refresh on foreground and user retry; a visible clock refreshes outlet status and rolls business dates without delaying finance.
5. Tablet status uses successfully proven non-removed devices and a three-minute presence window (two missed one-minute heartbeats allowed). Keep the existing thirty-minute unresolved-work helper unchanged: that is evidence about pending writes, not online presence. The status text links to Tablets; partial availability has a screen-reader description without visible counts.
6. Reuse visible navigation definitions and attention sources for one row per destination, deduplicated by source. Summary wording is metadata with a generic fallback, so future badged pages require no Overview edit. Delivery adds one per blocked integration and preserves distinct reconciliation/duplicate work; no run-history multiplication. Zero rows disappear; unresolved reads do not assert all-clear.
7. Explicit outlet query parameters initialise the shared scoped destinations within allowed outlets, overriding remembered filters for the visit. Ledger accepts a validated month and month view. Links stay inside the current role shell and demo namespace.

8. Use compact inset 2×2 cards, semantic tinted icon tiles, 13px labels/captions and 22px extra-bold headline figures. Omit paise at the Overview display edge without changing stored/calculated values. Metric headings and supporting numbers are bold. Seven-digit totals use 18px bold; six-digit positive/negative amounts retain 22px. Keep one caption row by shortening labels and compacting large supporting amounts; exact values remain in titles and source pages. Top icons remain neutral; revenue follows valid comparison direction and P&L follows its sign. Zero/unavailable values remain neutral. Loading placeholders reserve the same label, value/icon and single-caption geometry.

## Risks / Trade-offs

- Delivery settlement or absent data can revise the month → carry qualification and suppress misleading growth/margin.
- A registered spare tablet counts as expected → pending/removed devices are excluded; no speculative scheduling configuration.
- Home and Ledger currently use different month cutoffs → label Home's completed period; destination opens the named month.
- New SQL reads could bypass tenancy → explicit role/outlet checks, database tests with forged outlet requests and generated schema parity.
- Async work can return after navigation → request identity and cleanup guards prevent stale cards.

## Migration Plan

Add read-only functions and grants before deploying frontend. Frontend rollback leaves unused read functions, with no transformed data. Run database reset, policy and REST tests, auth E2E and schema generation before delivery. No offline write semantics change.

## Open Questions

None blocking implementation. Query timing is measured during verification rather than asserted from inspection.
