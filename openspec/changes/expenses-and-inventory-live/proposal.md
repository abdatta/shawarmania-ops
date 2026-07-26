# Proposal: expenses-and-inventory-live

> **Model**: Opus · **Wave**: E · **Depends on**: #4, #7 · **Gate**: a cash expense moves the day's cash figures and a UPI expense does not; the movements ledger reconciles exactly to current quantity; a correction is a movement with a note, never a silent overwrite; the low-stock warning fires at threshold; surfaces promoted `demo → live`.

**This is a `*-live` change.** Its job is to make the screens from #7 real and promote their gates, not to redesign them.

## Why

The two inputs daily cash and profit both depend on. They ship together because they are the same kind of work — an adapter swap plus a movements ledger — and because #12 needs real expenses while #13 needs real consumption.

## Scope

**Expenses** — recording with category, amount, payment method, description and business date, scoped by RLS. `recorded_by` on every row. Only cash expenses affect the drawer.

**Inventory** — items with unit, purchase cost and low-stock threshold. The movements ledger (`added` / `used` / `wasted` / `correction`) where **the ledger is the truth and `current_quantity` is a derived cache**, so "why does the system think we have 4kg?" is always answerable. Low-stock warnings.

**Isolation test cases** for both tables.

## Non-goals

- No recipe or bill-of-materials modelling. Stock is not deducted automatically when a shawarma is sold — that needs per-item recipes the business has not defined.
- No supplier management, purchase orders, or stock valuation beyond purchase cost (no FIFO, no weighted average).
- No approval workflow, receipt attachments, or recurring expenses.

## Design questions to settle during `/opsx:propose`

- Whether `current_quantity` is trigger-maintained or a view, and how the reconciliation test proves the two agree.
- **Which cost a `used` movement is valued at** when purchase cost has changed between lots. This directly determines #13's food-cost figure.

## Watch out for

Raw-material expenses are one half of the P&L double-counting trap in `docs/DATA_MODEL.md`. This change records them; #13 decides how they are counted. Do not resolve it here.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/DATA_MODEL.md` (inventory section).
