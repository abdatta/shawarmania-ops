# Design

## What was found, 2026-10-10

- `src/data-access/supabase-adapters/aggregator-sync.ts` `acceptDifference` posts `{mode: 'accept', cycle_start, cycle_end}` to `request-aggregator-sync`.
- `supabase/functions/request-aggregator-sync/index.ts` reads `mode` as `body.mode === 'reconnect' ? 'reconnect' : 'sync'`, so `accept` becomes `sync`; the dates are discarded and an ordinary read is dispatched.
- `ingest_aggregator_cycle` (last defined in `20260831030001_a_run_says_what_moved.sql`) already honours `accepted_by` in a payload: it records the week disputed-and-accepted, books the gap as an `unexplained_settlement_difference` cycle deduction attributed to that account, and writes the days. **No reader in `abdatta/shawarmania-sync` ever sends `accepted_by`.** The action has never worked; every earlier dispute resolved itself on a later read.
- The same upsert keeps `accepted_at` through `coalesce` even when a later read **reconciles** the week, which the check `accepted_only_when_disputed` refuses. That read would abort the run.
- The function skips **days** before the outlet's `synced_from`, but writes the week's reconciliation regardless. After the Kalyani → Kalyani Cafe feed move (Cafe `synced_from` 2026-10-01), Zomato 21–27 Sep and Swiggy 27–30 Sep were recorded as settled weeks of the Cafe, and are re-recorded on every read while they remain in the readers' window.

## The acceptance lives in the database

1. **`accept_aggregator_week(p_outlet_id, p_channel, p_cycle_start, p_cycle_end)`**, `security definer`, granted to `authenticated`, refusing anyone but an active owner (`app_is_owner()` and `app_account_active()`, as every owner RPC does). It finds that outlet/channel/week's reconciliation, and only if it is `disputed` and not yet accepted, records `accepted_at = now()`, `accepted_by = auth.uid()` and the figures accepted (`accepted_computed_paise`, `accepted_stated_payout_paise`). It returns `accepted`, `already_accepted` or `not_disputed`; it writes nothing else.
2. The adapter calls it, then asks for a read through `request-aggregator-sync` with `mode: 'sync'`, exactly as **Re-check** does.
3. `ingest_aggregator_cycle`, reading the week's prior reconciliation (it already does, for the movement summary), treats the week as accepted when the payload carries `accepted_by` **or** the prior row carries an acceptance whose accepted figures equal this read's computed and stated figures. From there the existing accepted path runs unchanged: per-order figures written, days settled, the difference recorded as an `unexplained_settlement_difference` attributed to the accepting account, run `ok`.
4. **An acceptance lapses when the figures move.** If a read finds different computed or stated figures, or the week now reconciles, the row's acceptance columns are cleared and that week's `owner`-sourced `unexplained_settlement_difference` deduction is deleted, so nothing stale survives; the week is then reconciled or disputed afresh, and a dispute can be accepted again. This also removes the refusal that a reconciling re-read would hit today.
5. The accepted deduction's insert becomes an upsert on its existing key, so a re-acceptance at new figures records the new amount.

## The boundary is a week, not just its days

Directly after `synced_from` is read: a cycle whose `cycle_end` is before it returns `ok` having written nothing — no days, no deductions, no reconciliation — with the movement summary empty and a `before_boundary` flag, in the same result shape the Edge Function already folds onto the run. A cycle straddling the boundary is unchanged: its reconciliation is computed from the whole week's orders in the payload, and only its days before the boundary are skipped, as today.

The migration deletes reconciliations whose `cycle_end` is before their outlet/channel's `synced_from`, together with any `owner`-sourced accepted difference on them. In production that is the Cafe's two September weeks; Kalyani has no switch row left and is untouched. It **reports** how many it removed rather than asserting a count: an exact count on a live table aborts a deploy when the data has moved.

## The Edge Function refuses what it does not know

`request-aggregator-sync` accepts `mode` of `sync` or `reconnect` (absent still means `sync`, which existing callers rely on) and answers anything else with `400 unknown_mode`. A silent reinterpretation is what hid this defect for two months.

## Money, RLS, offline

- **Money.** No new arithmetic. The difference is `computed − stated` and its record is `−difference`, both integer paise, exactly as today. Reconciliation tolerance (₹1) is unchanged.
- **RLS.** Three nullable columns on `aggregator_cycle_reconciliations`, covered by its existing read policy (who may read the outlet); still no client write path to the table. The new RPC is the only writer of an acceptance, owner-only, proved by pgTAP for a Franchise Admin, a Biller, an Employee, a deactivated owner and an anonymous caller.
- **Offline.** None.

## The production week

After release the owner presses **Accept the difference** once on the Cafe's Swiggy 1–3 Oct week. The read it starts settles 1 and 2 Oct with Swiggy's own per-order figures (cancellation charges, no sales), records +₹173.16 as an unexplained settlement difference attributed to the owner, and the Swiggy run reads `ok`. Whether Swiggy later deducts that ₹173.16 from a future payout is a question for that later week.

## Rejected

- **Settling the week in the database at the moment of acceptance.** Its per-order figures are not stored anywhere but in the next read; the days would be written with no commission, against the spec's "writes the aggregator's own per-order figures".
- **Carrying the acceptance through the sync repository** (a workflow input naming the week and the account; the reader adds `accepted_by` to that one cycle). Two repositories, an account id in a GitHub dispatch, and an acceptance lost if that single run fails. Held in the database, every later read honours it, scheduled or not.
- **An acceptance that survives changed figures.** It would quietly accept a difference nobody saw, which the requirement's "by nothing that conceals it" forbids.
- **Deleting the pre-switch weeks by hand.** They come back on the next read.
- **Mapping unknown modes to `sync`.** That is the defect.
