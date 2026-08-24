# Timestamped daily-gross detail rehearsal — 2026-08-24

## Scope and privacy

This was a local, owner-authorized, read-only rehearsal against the active
Kalyani Swiggy session. It made no Ops financial write. The run retained no
token, cookie, customer field, PAN, UTR, live order reference, or financial
amount; this note records only structural findings and aggregate outcomes.

## Observed portal contract

- `getOrderLevelPayoutDetails(orderId, restaurantId)` returns an order
  timestamp, status, and `payoutSummary` headings.
- A normal delivered order exposes one `Total Customer Paid` heading and one
  `GST Collected` sub-heading. Its candidate gross is the former less the
  latter.
- An explicitly cancelled order can omit `GST Collected`. Its observed shape
  can still carry customer-payment components, but the closed annexure audit
  proves its Net Bill Value is zero.
- The V2 list's `customerPaidAmount` is not used as money. It supplies the
  timestamped order references to enrich only.

## Result and remaining proof

The first strict parser correctly stopped on a harmless portal-label variation
and on the no-GST cancellation shape; both are now represented by fail-closed
parsing rules and synthetic, redacted unit fixtures. The first local session
later lapsed with HTTP 403, but the existing CI Vault session remained usable.

That CI session read four payout cycles and reconciled the annexure rows
without an Ops financial write. It found three cancellation-only mismatches
under the former item-and-discount candidate; all three exactly matched the
zero-gross candidate. The reader now uses that proved zero-gross rule.

This proves the current detail basis for the cycles read, but does **not** yet
complete every remaining promotion task, but it completes the daily-gross
evidence gate: the retained synthetic fixture contains no token, customer
data, PAN or UTR; the Aug 6 and 8 figures are independently recorded as exact
annexure matches in `coverage-audit.md`; and the CI audit checked every
annexure row in four cycles.

## Credentialed rollout (2026-08-24)

The existing Vault-captured owner session was used directly by the browser-free
CI reader; no headed login or OTP was invoked. A read-only reconciliation run
completed successfully with **97/97** annexure orders matching at paisa
precision across four cycles. Two immediate production-ingest replays then
completed successfully with zero additional rows written, proving the updated
reader's idempotent hand-off. The twice-daily schedule now uses this proven
write path; manual dispatch remains read-only unless its explicit `write`
input is true. The still-deferred headed-login/OTP proof and the production UI
promotion remain separate tasks.

An explicit-restaurant manual reconciliation against the committed workflow
also succeeded with the same 97/97 result and no post. The local database suite
passed all 1,909 tests, including the Swiggy ingest assertions that allocate a
03:59 placement to the prior 04:00-cutover business day and a 04:00 placement
to the new one. Together with the candidate-builder unit tests, this proves the
CLI/workflow preserves timestamped provisional orders through the same
cutover-safe ingest contract it uses in write mode.
