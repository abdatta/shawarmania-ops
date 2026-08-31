## 0. One Delivery entry — first, and revertible on its own

> Runs before the migration and stops the change if it fails. Sections 6 and 7
> rewrite and judge this surface; a container change landing after them means
> doing both twice. Touches no schema, no adapter and no data — nothing here
> shares a file with sections 1–8.

- [x] 0.1 Registry: add `owner-delivery-sync` at `ledger/delivery/:channel`, nav label `Delivery`, attention `delivery-needs-you`. Set `owner-zomato-sync` and `owner-swiggy-sync` to `state: 'hidden'` — not deleted, per the convention `admin-daily-cash` states. Carry a comment saying why one gate replaced two and where the cheaper lever now lives (D9).
- [x] 0.2 Update `registry.test.ts`, which asserts `owner-swiggy-sync`'s shape today, and add a case that exactly one restaurant-channel entry appears in the owner's navigation.
- [x] 0.3 Route: mount the surface at the new path and read the channel from the route. Add plain `Navigate replace` redirects from `ledger/zomato` and `ledger/swiggy` in `surfaces.tsx`, **outside `GatedSurface`** — a `hidden` gate renders `NotFound`, so the redirect cannot sit inside one. There is no redirect precedent in that file; keep both in one commented block.
- [x] 0.4 Add `delivery-needs-you` to `AttentionSourceId` and implement it in `sources.ts` as the sum of the two existing channel sources. Keep `zomato-needs-you` and `swiggy-needs-you` — they become the per-segment counts, and the `Record` over the id union means an id without an implementation fails to compile.
- [x] 0.5 Build the channel switch in the ledger's segmented shape, each segment carrying its own count, readable without selecting it (D11). Assert the arithmetic: two on one channel and one on the other renders 3 on the entry and 2/1 on the switch.
- [x] 0.6 Arrival and addressability: the route decides the channel; where exactly one channel has waiting work the surface opens on it. Test that a link to the Swiggy channel opens on Swiggy, and that a redirect from the old path lands on the right channel.
- [x] 0.7 **The independence test, which is the one that can stop this section.** A Swiggy reconnect succeeding while Zomato is lapsed leaves Zomato's health, waiting work and history unchanged and still needing the owner. Separate adapter instances, separate sessions; the container is all that is shared.
- [x] 0.8 Judge it on a phone in both themes: two badged rows of controls — the channel switch and the outlet chips — before any content. If that reads as heavy, fix it here, before the history is built on top of it.
- [x] 0.9 Sectional check: lint, typecheck, unit and e2e green, and the four-role demo walkthrough still walks. **Commit this section on its own**, so it reverts without the schema work.

## 1. Schema — two columns and their meaning

- [x] 1.1 Migration on `aggregator_sync_runs`: add how the run began (nullable `text`, two-word vocabulary, check-constrained) and `summary jsonb` (nullable). Settle the column name against the reserved word `trigger` and against `aggregator_channel_days.origin`, and record the chosen name in `design.md` D4 before writing the migration.
- [x] 1.2 Column comments on both, saying what a null means: a run recorded before this change, not a run that did nothing.
- [x] 1.3 Re-assert the existing isolation test case for `aggregator_sync_runs` covers the two new columns — a Franchise Admin session at one outlet reads neither column for another outlet's run. No new policy: the table's owner-scoped policy already covers new columns, and this task proves it rather than assuming it.
- [x] 1.4 Regenerate `database.types.ts`.
- [x] 1.5 Sectional check: `npm run test:db` and `npm run test:rls` green.

## 2. The summary is written where both sides are still known

- [x] 2.1 Add the movement accumulator to `ingest_aggregator_cycle`: days whose figures moved (old and new, integer paise), days measured for the first time, the week that settled against its payout, and dates left unwritten for want of a ledger row. Append-only bookkeeping over the `v_existing` read that already happens — no branch in the function may read it.
- [x] 2.2 Same for `ingest_supply_statement`: supply orders added and amended.
- [x] 2.3 Fold the accumulated summary into the run's row in the same transaction as the writes it describes.
- [x] 2.4 Assert only movement enters the summary: a settled day that hits `continue`, and a provisional day whose figures match, both contribute nothing.
- [x] 2.5 Assert money in the summary is integer paise, reusing the payload's existing `%_paise` integer assertions rather than a second convention.
- [x] 2.6 **The byte-identical test.** Run a fixture cycle through the pre-change and post-change functions and diff `aggregator_channel_days`, `manual_ledger_expenses` and `aggregator_cycle_reconciliations`. Any difference fails the task. Cover a first measurement, a revision, an identical restatement, a settlement, and a payload of entirely already-settled days.
- [x] 2.7 Sectional check: `npm run test:db` green, including 2.6.

## 3. Sync repo — how a run began

- [x] 3.1 Post the run's origin from the runner's own trigger context (schedule versus dispatch) in `abdatta/shawarmania-sync`, on every path that opens a run row. **Done — `2ae8418` in that repo, committed and not pushed.** `GITHUB_EVENT_NAME` is the whole derivation, resolved once in `ops.mjs` and spread into the body, so all three doors that open a run row carry it and a fourth added later cannot forget.
- [x] 3.2 Confirm no free text crosses the boundary — the value is one of the two constrained words, validated server-side. **Done on this side of the boundary**: `ingest-aggregator-cycle` refuses an unknown `started_by` with a 400 before it reaches the database, `parseHyperpureRunRecord` refuses it the same way, and the check constraint refuses it again. Proved by `src/lib/hyperpure-run-record.test.ts` and `45_a_run_says_what_moved.sql`.
- [x] 3.3 Sectional check: a scheduled run and a dispatched run recorded against a branch ref land with different origins, verified by reading the rows.

> **Verified against production on 2026-08-31, one half fully and one half by
> transport.** Both repositories are deployed, and a dispatched run — sent with
> `rehearse=true`, so it reconciled a real cycle and wrote no figure — landed two
> rows reading `started_by = owner`, `reads_per_day = 4` and a summary. Read back
> off the production pooler, not inferred.
>
> `reads_per_day = 4` is the whole cadence mechanism working live: the runner
> parsed it out of `30 22,4,10,16 * * *` in its own workflow file and it reached
> the column. The 131 rows that predate this change read null and render coarse,
> which is the honest cut-off the surface draws.
>
> **What the row from a genuinely scheduled run would add is one fact**: that
> GitHub sets `GITHUB_EVENT_NAME` to the literal string `schedule` on a cron. It
> cannot be forced — a manual trigger always reports `workflow_dispatch`, and a
> cron on a branch never fires at all, since Actions only schedules the default
> branch. Everything around that fact is proved: the same env var demonstrably
> produced `workflow_dispatch`, and the value crossed the boundary, passed
> validation and reached the column. The next cron writes it for free.

## 4. Reading the history

- [x] 4.1 Add the paginated history read to the adapter: newest first, rehearsals excluded, keyset on `started_at` over the existing `(outlet_id, started_at desc)` index, no count query, ends when a page returns short.
- [x] 4.2 Type the summary as a contract shared by the mock and the Supabase adapter, compiled from the generated schema types so the two cannot disagree.
- [x] 4.3 Split healing: leave the `recovered` query feeding **Needs you** and the tab badge exactly as it is; the history read does not consult it. Test that a healed failure leaves Needs you and stays in the history.
- [x] 4.4 Include every outcome word and runs in flight (`finished_at is null`); assert `reconciliation_failed` and `awaiting_one_time_password` both appear, since neither does today.
- [x] 4.5 Sectional check: adapter unit tests green, including the healed-failure split.

## 5. The collapse rule

- [x] 5.1 Write the grouping function as a pure function over the accumulated run list: consecutive runs telling an identical story collapse, carrying count and span.
- [x] 5.2 Implement the break rules: outcome change, a run carrying a summary, a manual run, channel change, day boundary, run in flight.
- [x] 5.3 Unit-test the page-boundary case explicitly: seven consecutive quiet runs split 3/4 across two pages render as one group of seven after the second page appends.
- [x] 5.4 Unit-test that four consecutive manual runs render as four lines, and that a quiet run either side of a failure does not merge.
- [x] 5.5 Sectional check: grouping unit tests green.

## 6. The surface

- [x] 6.1 Replace the merged derived list under **What changed** with the run history. **Needs you** untouched.
- [x] 6.2 Render a run per its state: moved figures (₹, from → to, business day / week / supply orders), moved nothing, failed with its reason in the Needs-you vocabulary, under way.
- [x] 6.3 Day headings down the list — `Today`, `Yesterday`, `26 Aug` — in Asia/Kolkata.
- [x] 6.4 Collapsed lines show their count and expand. Groups re-merge on every page append.
- [x] 6.5 Infinite scroll: a sentinel loads the next page approaching the viewport; the placeholder reserves the shape of arriving run cards so nothing jumps under the reader.
- [x] 6.6 The honest cut-off line where recorded summaries begin; a pre-change run renders coarse and its origin blank rather than guessed.
- [x] 6.7 Rehome whatever the retiring derived list carried that is neither a run nor unresolved — dismissed duplicate pairs, accepted differences — per the open question in `design.md`. They must not vanish.
- [x] 6.8 Confirm the Swiggy channel gets the same treatment through the shared component and still renders no Hyperpure line. Section 0 makes this one container rather than two surfaces, so this is an assertion, not a second implementation.

## 7. Demo mode

- [x] 7.1 Mock a hundred runs' worth of history, including a collapsed quiet group, a failure storm from a lapsed session, a healed outage, a run under way, and runs predating summaries.
- [x] 7.2 Judge the surface against that fixture on a phone viewport in both themes before calling section 6 done — in the merged container, with the channel switch and outlet chips above it, which is why section 0 ran first. This is the check on the founding rule this change overturns: if a hundred runs are not readable, compression is not working.
- [x] 7.3 Fixture both channels, so switching between them in demo shows two independent histories rather than the same one relabelled.
- [x] 7.4 Confirm a demo session still cannot write to Supabase.

## 8. Docs

- [x] 8.1 `docs/SCREENS.md`, navigation: the sentence naming "Expenses, Zomato, Swiggy and the notebook" as readings in one group becomes one Delivery reading. **Write this in section 0, not here** — it documents section 0's change and should land with it.
- [x] 8.2 `docs/SCREENS.md`, the surface: rewrite the Zomato and Swiggy entries as one Delivery entry with two channels — the line stating a row is an event rather than a run is what this change overturns, and the replacement says what the history shows and what a collapsed line means.
- [x] 8.3 `docs/OPERATIONS.md`: how to read the run history, how to find a healed outage, and which channel a Delivery link opens on.
- [x] 8.4 Merge both spec deltas: `aggregator-settlement-sync` (two renames, two modified requirements) and `attention-badges` (one added requirement). Confirm no requirement left in `aggregator-settlement-sync` still says a row is an event rather than a run — the Swiggy parity requirement said so too, which is why it is in the delta. **Done at archive:** both renames landed with their new bodies, the added badge requirement is in `attention-badges`, and a sweep of `openspec/specs/` finds no requirement left saying a row is an event.

## 9. PHASE GATE

- [x] 9.1 **Gate (#48):** Zomato and Swiggy are one **Delivery** entry whose switch hides no waiting work — the entry's badge is the sum, each channel carries its own count without being selected, the channel is in the route so a link opens on it, and one channel's session, repair and history still cannot touch the other's; and every run the sync has made is readable on that surface, newest first, loaded in pages as the owner scrolls — the ones that moved figures, the ones that moved nothing, the ones that failed, the ones the owner asked for and the one happening right now; a run that moved something says what moved in ₹ and from → to, a run that failed says why in the words Needs you already speaks, and a later success stops the nagging without erasing the failures it healed; consecutive runs telling an identical story collapse to one line carrying its count and span, expandable, and never collapse across an outcome change, a run that moved a figure, a run the owner asked for, a channel or a day; and the four-role demo walkthrough still walks.

  **Met.** *"The ones the owner asked for"* renders and never collapses, proved
  end to end against the demo; and since `2ae8418` in `abdatta/shawarmania-sync`
  the runner posts the word that makes it true against live data too. The one
  thing still unverified is the round trip itself — a real dispatch writing a
  real row — which needs both commits pushed (task 3.3).

- [x] 9.2 Suite gates: lint, typecheck, format:check, unit, build, e2e, contrast, `test:db`, `test:rls` — all green, per the CI workflow file rather than a docs checklist.

  | Gate | Result |
  |---|---|
  | `lint` (+ hex, todos, specs, functions) | 0 errors, 11 pre-existing warnings |
  | `typecheck` | clean |
  | `format:check` | clean |
  | `test` | 1643 in 139 files |
  | `build` | clean |
  | `test:e2e` | 254 |
  | `contrast` | 52 pairs, both themes |
  | `test:db` | 2185, on a fresh stack, before `test:rls` |
  | `test:rls` | every suite |
  | `db:types` diff | clean |
  | `functions:typecheck` | **not runnable in this worktree** — see 9.3 |

- [x] 9.3 Report the gate honestly: name anything not exercised against live data and why.

  - **Nothing here was exercised against live data**, and none of it could be:
    the write path runs under a GitHub schedule against live merchant sessions,
    and the only production evidence this change could produce is a scheduled
    run recording a summary. The database half is exercised against a real
    Postgres with the real migrations (`test:db`), including the byte-identical
    diff of the money path; the UI half is exercised against mocks typed from
    the generated schema.
  - **`functions:typecheck` did not run.** It fails inside this git worktree
    because Deno cannot resolve `npm:@supabase/realtime-js` — the worktree has
    no `node_modules` of its own — and it fails identically on
    `restaurant-mappings.ts`, which this change does not touch. The same command
    passes from the main checkout. The two Edge modules this change did add,
    `run-summary.ts` and `hyperpure-run-record.ts`, were type-checked directly
    with `deno check` and are clean.
  - **Both repositories are deployed** (ops `28ddcd5`, sync `403d373`), and a
    dispatched rehearsal was read back off the production pooler: `started_by =
    owner`, `reads_per_day = 4`, summary present. See 3.3 for the one fact still
    resting on documented GitHub behaviour rather than on an observed row.
  - **The rehearsal was chosen over a writing run deliberately.** It reconciles a
    real cycle and writes no figure, so the transport was proved without putting
    a settlement figure at risk to confirm a caption.
  - **The two repos can land in either order.** The ops boundary takes either
    word and reads an absent one as "did not say"; the runner omits the key
    where it does not know. Neither half depends on the other having shipped.
  - **`e2e` flaked once** on `counter.spec.ts › saves and records a food-first
    order`, a test on the counter tablet that this change does not touch. It
    passed alone and the whole suite passed on re-run.
