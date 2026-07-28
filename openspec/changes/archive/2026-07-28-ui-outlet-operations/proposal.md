# Proposal: ui-outlet-operations

> **Model**: Opus · **Wave**: C · **Depends on**: #3 · **Gate**: menu, inventory, expenses and a full day-close are all walkable in demo mode — including a low-stock warning and a deliberate cash mismatch.

## Why

Every manager-facing operational surface, built together because they share one shape — a list, an editor, a detail view — and one user in one session. Building them as a set keeps the patterns consistent instead of converging them later.

Daily cash is the screen the business was commissioned to get right, so its layout deserves review before the arithmetic behind it is wired.

## Scope

**Menu** — categories and items, add/edit, price editing, the availability toggle as a distinct thumb-reachable action, veg/non-veg by shape as well as colour. Plus the Biller's read-only view, so the permission difference is visible in the demo.

**Inventory** — item list with current quantity, a low-stock treatment using an icon and label rather than colour alone, the movement form (added / used / wasted / correction), and the per-item movement ledger.

**Expenses** — the day's list with cash entries visually distinct, and a fast add form (category, amount, payment method, description).

**Daily cash** — opening float, derived cash sales and cash expenses, withdrawals, expected closing, the actual-count field, and the difference shown prominently the moment it is entered. The day-close flow, and the reconciliation-exception state for a late bill arriving against a closed day.

**Deliberately awkward states in the demo path** — a low-stock warning and a cash mismatch. A reconciliation screen that has only ever been seen balancing has not really been reviewed.

## Non-goals

- No real data, arithmetic or persistence — #11 and #12.
- No recipe or bill-of-materials modelling, no supplier management, no denomination counting.

## Watch out for

Raw-material expenses are one half of the P&L double-counting trap in `docs/DATA_MODEL.md`. This change only displays them; #13 decides how they are counted. Do not resolve it here.

## Docs to update before archiving

`docs/SCREENS.md`.
