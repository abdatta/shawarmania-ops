# Proposal: Freeze Aggregator And Supply Entry

> **Model**: Opus · **Wave**: D · **Depends on**: #42 (must archive first: this change moves columns #42 added and withdraws a capability it introduced) · **Gate**: a Hyperpure order reaches the ledger exactly once whatever combination of statement re-read, ZPL recovery and re-upload it passes through, proved by replaying one order through all three; a ZPL recovery reconciles its cycle and creates no expense while a non-Hyperpure deduction still creates one; Zomato revenue and commission have no writable path from any client, proved by a hand-crafted save carrying them being refused by the database; a day with no drawer count still reads its Zomato figures for a past date; a Hyperpure purchase lands on its invoice date, or on the books' opening date where the invoice precedes it; each of the three statement shapes is parsed from a real downloaded fixture with no network access available, and the Zomato order-history parser stores neither Customer ID nor Customer Phone; an FA, Biller and Employee are each refused every new table and the statement bucket by the database, proved by a hand-crafted request; the restatement is rehearsed and leaves August's Hyperpure total at ₹85,206.37 across 16 rows; and the four-role demo walkthrough still walks.

## Why

Two figures in the ledger are wrong today, and both are wrong because a person types them.

**Zomato revenue is typed, so it is an estimate.** #42 made the sync write it, but left the input in place, so a typed figure and a measured one still compete for the same column.

**Hyperpure is typed, and the numbers are worse than anyone assumed.** Measured against Hyperpure's own statement for 1 to 18 August:

| | |
|---|---|
| Real spend | ₹71,006.47 across 15 orders |
| Recorded by hand | ₹47,170.00 across 8 rows |
| Rows matching a real order | 6, each rounded down to whole rupees |
| Rows matching nothing | 2, worth ₹16,439.00 |
| **Orders never recorded at all** | **9, worth ₹40,272.46** |

More than half of August's supply spend is missing from the books. The dating is not consistent either: of the six rows that do match an order, three are dated by invoice date and three by order date.

**And one purchase is already counted twice in production.** Order `ZHPWB27-OR-0028753023` (₹9,311.11) was typed as ₹9,311.00 on 2 August and booked again by the sync as ₹2,555.24 at Kalyani plus ₹2,981.29 at Kanchrapara on 1 August. A third recovery slice of ₹3,774.58 has not landed yet. The cause is structural: `ingest_aggregator_cycle` turns every Zomato payout deduction into an expense, but a Hyperpure deduction is not a purchase, it is the collection of a purchase Hyperpure already invoiced.

**Why now.** The sync went live on 18 August, so every further cycle deepens the double count. And the reason to do the whole thing at once rather than only the arithmetic: a frozen field with no fallback is a field nobody can correct when the reader is blocked. Investigation on 2026-08-18 confirmed that every figure this change freezes can be recovered by hand from a downloadable file, so the freeze can be total without becoming a trap.

## What Changes

- **BREAKING: Zomato revenue and commission can no longer be typed, by anyone.** They arrive from the daily sync or from an uploaded statement. The inputs are gone rather than disabled, because the columns move out of reach.
- **Zomato figures leave `manual_ledger_days`** for a table of their own, one row per outlet per business date. This is forced rather than chosen: `opening_cash_paise` and `counted_cash_paise` are `NOT NULL`, so a day row cannot exist without a drawer count, yet a day nobody counted must still show what Zomato paid. Making those columns nullable would make "counted zero" and "never counted" the same value and destroy the drawer check.
- **A past date with no ledger row now shows its Zomato figures**, locked, instead of an empty form that hides them.
- **BREAKING: Hyperpure cannot be typed either.** It becomes a reserved category the database recognises, and near-spellings are refused rather than warned about, because `normalizeCategory` only trims whitespace and "hyper pure" walks straight past a warning.
- **One Hyperpure order becomes exactly one expense**, keyed on the order number. That key, not a tolerance match, is what makes the double count impossible.
- **A ZPL recovery stops being an expense.** It reconciles its payout cycle and writes no ledger row. A non-Hyperpure deduction, advertising and promotions, still writes one, because nothing else sees those.
- **A Hyperpure purchase is dated by invoice date**, which is the day the stock arrived and the day the statement itself filters on. A purchase invoiced before the books begin enters on the books' opening date, so money that left an in-period payout is not lost.
- **A Hyperpure reader** joins the Zomato one: same private repo, same Vault-held session, same schedule. It reconciles the statement against Hyperpure's order list and reports any delivered order the statement omitted, rather than under-reporting in silence.
- **A statement upload** appears on the aggregator surface, accepting three file shapes distinguished by content rather than filename. It is disaster recovery, so an uploaded file must be self-sufficient: no lookup against any portal.
- **The daily Zomato reader switches to the order-history export**, because the dashboard JSON it reads today silently omits cancellation refunds, and the export carries them as columns.
- **Commission may stay undetermined, permanently.** The manager self-write path #42 added is withdrawn. Zomato's own portal makes this unavoidable: the settlement download is unavailable until a cycle is paid, so commission for the current week is obtainable by no route at all. A month total carrying an undetermined day is a ceiling.
- **August's Hyperpure history is restated** from the statement: 10 rows replaced by 16, ₹52,706.53 becoming ₹85,206.37. August cost rises ₹32,499.84 and August profit falls by the same.

## Capabilities

### New Capabilities

- `aggregator-figures`: a channel's measured figures for a business date, held apart from the day a person records, readable where no such day exists, and writable by no client.
- `supply-statements`: a supplier's own statement as the sole origin of a supply purchase, one purchase per order, dated by invoice, with the collection of that purchase held distinct from the purchase itself.
- `statement-uploads`: recovering a period by hand from an operator-issued file when the reader cannot run, including what such a file may never carry into storage.

### Modified Capabilities

- `manual-ledger`: aggregator revenue and commission leave the day row and lose every typed path; a day's aggregator reading no longer requires the day to exist.
- `expense-categories`: categories may be reserved, and a reserved category refuses near-spellings instead of warning about them.

Three capabilities the proposal originally listed as modified carry no requirement
change and so get no delta, only implementation: `outlet-expenses` keeps its
four-field rule unchanged, since it is the category that is refused rather than
the form that is restructured; stored-file isolation is stated by
`statement-uploads` rather than duplicated into `outlet-tenancy`; and demo
fixtures are tasks, not requirements.

## Impact

- **Migrations**: new `aggregator_channel_days`, `supply_purchases` source identity, reserved categories, `aggregator_cycle_reconciliations` extension, the restatement itself, and the column move off `manual_ledger_days` with its backfill.
- **Rewritten**: `ingest_aggregator_cycle` (deduction handling splits by kind), `supabase/migrations/20260818000001_deductions_respect_the_boundary.sql`'s expense insert.
- **New Edge Function**: statement parsing and ingest, shared by the reader and the upload so one parser serves both.
- **New infrastructure**: Supabase Storage, first use in this repo, with bucket policies carrying the outlet rule that the database enforces everywhere else.
- **App**: `src/features/manual-ledger/*` loses its aggregator inputs; `src/features/zomato-sync/*` gains upload; `src/domain/expense-category.ts` gains reservation; `src/data-access/supabase-adapters/aggregator-sync.ts` gains the persistence `markNotDuplicate` needs.
- **Private repo** `shawarmania-sync`: a Hyperpure channel beside the Zomato one, a second Vault session, and a second scheduled job.
- **Production data**: a rehearsed, reviewable restatement of August's Hyperpure rows, shipped as a migration through `deploy.yml` rather than a local write.

## Non-goals

- **Swiggy is not read.** The upload path is built channel-agnostic so a Swiggy payout file works the day one exists, but Swiggy revenue stays typed, with the asymmetry stated on screen rather than left to look like a bug.
- **The invoice PDF is not parsed.** It carries no ToUnicode CMap and its order number appears nowhere in its bytes, so its figures would need OCR, and an OCR misread with typing forbidden would be uncorrectable. A PDF may be attached as evidence; figures always come from a statement.
- **Hyperpure purchases are not split between outlets.** Both kitchens draw on one inventory, so a purchase is booked once against its delivery outlet and flagged as a shared cost, reallocatable later without re-reading Hyperpure.
- **No GST input credit work.** The account is not GST-registered with Hyperpure and the portal offers credit up to 28% of order value; that is a separate change and a separate decision.
- **No commission override.** A cycle Zomato never settles stays undetermined.
- **Data before the books begin is not imported.** Production holds no ledger day and no expense before 2026-08-01.

## Docs to update before archiving

- `docs/DATA_MODEL.md`: the aggregator-figures table, the supply-purchase source identity, reserved categories, the storage bucket.
- `docs/OPERATIONS.md`: the two readers, their sessions, and the by-hand recovery procedure naming each of the three files and where to download it.
- `docs/ARCHITECTURE.md`: the one-parser seam shared by reader and upload.
- `docs/PRODUCT.md`: that aggregator and supply figures are read, not entered, and what a person does when a reader is blocked.
