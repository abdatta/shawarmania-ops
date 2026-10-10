# Tasks

## Database

- [x] 1. Migration (dated after the newest on main): `aggregator_cycle_reconciliations` gains `accepted_by`, `accepted_computed_paise`, `accepted_stated_payout_paise`, null together with `accepted_at`; `accept_aggregator_week(outlet, channel, cycle_start, cycle_end)` as in `design.md`, owner-only, granted to `authenticated`, revoked from `public`.
- [x] 2. Same migration: redefine `ingest_aggregator_cycle` **in full** from its live definition (never by textual replace; see `20260831030001`'s header): a stored acceptance at matching figures counts as accepted; an acceptance whose figures moved, or whose week reconciles, is cleared with its `owner`-sourced difference deleted; the accepted difference insert becomes an upsert; a cycle ending before `synced_from` returns `ok` with nothing written and `before_boundary`.
- [x] 3. Same migration: delete reconciliations ending before their outlet/channel's `synced_from`, with any accepted difference on them, and `raise notice` how many; no asserted count.
- [x] 4. Regenerate `database.types.ts`; check its diff for telemetry noise.
- [x] 5. pgTAP: the RPC's refusals (Franchise Admin, Biller, Employee, deactivated owner, anonymous, a reconciled week, an already-accepted week); accept → ingest at the same figures settles the days with the payload's per-order figures, records the difference with `accepted_by`, returns `ok`; figures moved → acceptance and difference withdrawn, no refusal; a re-check that now reconciles a previously accepted week succeeds; a payload `accepted_by` still works; a pre-boundary cycle writes nothing and returns `ok`; a straddling cycle reconciles whole; the cleanup removes only pre-boundary rows; **isolation** — the new columns are readable only by those who may read the outlet. `45_a_run_says_what_moved.sql`'s frozen-copy comparison still passes unchanged.

## Function and app

- [x] 6. `request-aggregator-sync`: `mode` is `sync` (or absent) or `reconnect`; anything else is `400 unknown_mode` and dispatches nothing. Function tests; `functions:typecheck` with `~/.deno/bin` on PATH.
- [x] 7. Adapter: `acceptDifference` calls the RPC, then requests a read with `mode: 'sync'`; a refusal surfaces as the action's error. Mock adapter mirrors it. Unit tests.
- [x] 8. Delivery surface: after Accept the week reads accepted on the next refresh and the badge clears; component test.

## Close

- [x] 9. Update `docs/OPERATIONS.md`, `docs/DATA_MODEL.md`, `docs/SCREENS.md` and `docs/TESTING.md`.
- [x] 10. Run every gate CI runs, including the database, RLS, functions and both e2e suites.
- [ ] 11. Release in a window the owner picks. Then in production: confirm the Cafe's two September weeks are gone and Kalyani's remain; the owner accepts the Cafe's Swiggy 1–3 Oct week once; confirm the read settles 1–2 Oct, records ₹173.16 against the owner and reads `ok`, and the Delivery badge clears.
- [ ] 12. PHASE GATE (fix, no roadmap row; checkpoint is `aggregator-settlement-sync`'s *A disputed week may be re-checked or accepted…*): an owner's Accept on a disputed week settles it on the read it starts, with the difference recorded against them and no day adjusted; moved figures withdraw it without refusing the run; nobody but the owner can accept; a week ending before an outlet's sync start is never recorded against it; an unknown sync request is refused; and the four-role demo walkthrough still walks.
