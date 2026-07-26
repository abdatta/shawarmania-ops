# Proposal: billing-live

> **Model**: Fable · **Wave**: D · **Depends on**: #6, #7, #9 · **Gate**: a real order settles both online and offline; totals match the domain tests; per-outlet bill numbers are server-assigned with no gaps or collisions across two devices; a 00:20 bill carries the previous business date; a Biller sees only their own shift's bills; a void never mutates the original; surfaces promoted `demo → live`.

**This is a `*-live` change.** Its job is to make the screens from #6 and #7 real and promote their gates. It does **not** redesign them — if it finds itself rebuilding UI, the mock was the wrong shape; fix the mock and record why.

## Why

**The counter starts taking real money.** Every bill the business ever rings inherits this change's contract — snapshots, totals, numbering, business-date resolution — which is why it gets more design care than anything else in the wave.

Menu, billing and bill history ship together because they are one user-visible capability: a counter you cannot review or correct is not usable in a real shop, and void semantics are needed before daily cash reconciliation in #12.

## Scope

**Menu live** — Franchise Admin edits real prices and toggles availability; Biller reads and provably cannot edit; Super Admin reads across outlets. A price change applies to future bills only.

**Billing live** — bill and bill-item writes through the outbox, with **snapshotted** item name and unit price. Server-side per-outlet bill number allocation via an Edge Function, with the provisional local reference until it returns. Money arithmetic in the domain layer over integer paise, unit-tested independently of the UI.

**History and void** — the Biller's shift view (own shift only, running totals by payment method), the Franchise Admin's outlet bill history with filters, and the void flow: reason captured, `voided_by` and `voided_at` recorded, original totals untouched, voided bills excluded from every sales and cash figure.

## Non-goals

- **Record-only.** No printing, GST, or digital share. All three are anticipated in the schema and tracked in `openspec/todos/`; adding any here is scope creep against an explicit decision.
- No editing a settled bill, ever. Corrections are voids plus new bills.
- No discounts beyond a simple bill-level amount, unless the business asks.

## Watch out for

The Biller does not see the outlet's full history. Reviewing the day is a manager's job, and a shared tablet should not expose the outlet's takings to whoever is standing at it.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/DATA_MODEL.md` (billing section), `docs/LIMITATIONS.md` (confirm the record-only note still describes reality).
