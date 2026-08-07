# Proposal: the-ledger-opens-to-the-outlet

> **Model**: Opus · **Wave**: D · **Depends on**: #22, #36, #37 · **Gate**: a Biller records a cash expense at their own outlet from their own phone and is refused yesterday's by the database; a Franchise Admin reads the full day and month at outlets they are assigned to and no others; an Employee is refused every revenue, drawer and commission figure by a hand-crafted request, not by a hidden screen; a voided expense stays visible, struck through, and stops counting; and a pending expense counts in the month the day it is incurred while moving the drawer only on the day it is settled, leaving every already-counted day byte-for-byte unchanged.

## Why

**The Ledger is being used, and the person who spends the money cannot reach it.** Twelve day rows across six trading days at both outlets by 2026-08-07 says the nightly habit has taken. But every write goes through one of two owners, and the expenses being written are the ones somebody else made hours earlier: something ran out, a staff member went and bought it, and the figure reached the app by memory at closing time.

The owner's request (2026-08-07): staff record expenses at their own outlet as they happen. Everyone at the outlet reads them, each staff member corrects only their own, and the owner corrects anything.

The second half arrives with it because it is the same edit to the same policies. **Franchise Admins get the Ledger at outlets they manage.** The capability was written owner-only for a reason that has expired: in August 2026 production has two Super Admins and no live Franchise Admin assignment at either outlet, so the owners are the managers. When real managers are appointed, a manager who counts the drawer but cannot see whether the month covered its costs is being asked to run half a shop.

## Scope

**The Ledger stops being owner-only.** Six policies across two tables, replacing `app_is_owner()` with membership through `app_outlets_for` and `app_has_role_at`. A Franchise Admin reads and writes the full day and month at outlets they hold a live assignment at, and nothing at any other. This is the whole of the database work and it is why both halves are one change: splitting them means two migrations rewriting the same six policies a fortnight apart.

**A staff expenses surface**, its own tab in the Biller and Employee shells. It shows that outlet's expenses for the last two business days, every row regardless of who recorded it, and **no revenue, drawer, commission or monthly figure**. A separate surface rather than the Ledger with sections stripped by role: one screen rendering four different amounts of financial truth is the shape that leaks eventually.

**What staff may do.** Record against today only, because a purchase noticed the next morning is the owner's or manager's to add, and they can reach any date. Correct or void their own rows, today only; a row that survives its business date is frozen to its author. Settle a pending expense, whoever recorded it.

**Void replaces delete for expenses.** A voided row stays visible, struck through, and stops counting toward the day and the month. `DELETE` was granted on these tables on the stated grounds that they have "exactly one reader and one writer"; that stops being true here, and a row that can vanish without trace defeats the only reason to open the surface up.

**Three payment states, named by where the money came from.** From the drawer, from the bank, and pending. `is_cash` becomes a three-valued column; the drawer arithmetic keeps asking exactly one question of it.

**Pending, and what settling does.** A pending expense counts in the month the day it is incurred, so a supplier postponing ₹40,000 of chicken cannot make this month look excellent and next month terrible. Settling in cash **writes a cash-out line on the settlement day** and marks the expense settled with no drawer effect of its own. Cash out is already not an expense, so nothing double-counts, the drawer moves on the day the money actually left, and no day the owner has already counted is rewritten. Pending items appear on the staff surface **regardless of age**, because a two-day window would hide the supplier bill somebody is standing there to settle.

**Attribution.** `recorded_by` stays frozen by the existing guard; `updated_by` is added so a corrected day reads as "recorded by X, last corrected by Y" rather than silently as X's. Every expense row names its recorder. Detail lives behind an expandable card so the default row stays lean.

**Isolation tests for four roles across both tables**, every verb, at their own outlet and at the other one.

## Non-goals

- **No edit history for expense figures.** Void is traced; an amount corrected in place is not. The failure the owner described is a row disappearing, not a row being quietly inflated. A separate change if it is ever wanted.
- **No structured "owed to" field.** Who is owed goes in the note. Revisit if the pending list routinely runs past ten rows.
- **No approval workflow, spend limit or receipt attachment.** The nightly drawer count and visible attribution are the controls.
- **No offline queue.** `src/outbox/index.ts` is still an empty placeholder and the real one arrives with #9. A failed submit says so and keeps everything typed, so one tap retries. A second half-queue would make the real one harder to land.

## Design questions to settle during `/opsx:propose`

- **Whether a Biller reaches this surface on the shared counter tablet at all.** #9 replaces the Biller's personal login with an enrolled device plus a shift PIN, and `AGENTS.md` is explicit that the PIN "selects attribution, it is not the security boundary". At that point "their own rows" degrades to "this shift's rows" and RLS cannot enforce ownership against a device session. **The owner has deferred this deliberately** (2026-08-07) to be settled when #9 is built. What this change owes is that the degradation is written into the spec and `docs/LIMITATIONS.md` now, not discovered later when the rule quietly stops meaning what it says.
- **What a Franchise Admin sees of a day recorded by the owner, and the reverse.** Both can now correct the same row and there is no concurrency control on it. Last write wins is right for a notebook; the reading has to say whose figures are on screen.
- **Whether an Employee needs this tab at all, or only a Biller.** The owner asked for "all staff"; whether an Employee who is not at the counter ever spends outlet money is worth one question before building two tabs.
- **The exact wording that replaces "cash-basis operating estimate"** on the month. Counting pending when incurred makes it no longer a cash basis, and `profit-estimates` requires any profit figure to name its basis truthfully.

## Watch out for

- **This is the change that makes the manual ledger's exit harder, and #12 must be told.** #12 currently owes carrying rows across with "no translation table". After this it owes attribution, void state, settlement state and the three payment states as well. Update `daily-cash-live`'s inherited obligation in this change, not later.
- **`test:e2e:auth` asserts what each role lands on and the chrome around it.** Adding a tab to the Biller and Employee shells is inside its blast radius. `ui-owner-console-and-demo` broke that suite while every other gate stayed green, and "it does not touch auth" was the wrong question.
- **The `manual-ledger` spec's first requirement is "reachable only by an owner, and the database is what refuses everyone else", with four scenarios.** That requirement is being rewritten, not amended. `supabase/tests/21_manual_ledger.sql` writes the owner-only refusal out longhand rather than inheriting it from the generic sweep, and every one of those assertions changes.
- **The day row holds one `cash_removed_paise` and one reason**, so two settlements on one day merge into a single line with a combined reason. **Accepted by the owner** (2026-08-07). State it in the spec rather than letting somebody discover it as a bug.
- **A false cash entry is not caught by the drawer count.** It lowers expected cash, so the count still matches. This is already true of the ordinary cash expenses being granted here, which is why settlement is not restricted further; the control is attribution, and the spec should say that rather than imply the count is a check.

## Docs to update before archiving

`docs/ROLES_AND_PERMISSIONS.md` (the capability matrix's manual-ledger rows, currently owner-only on both lines), `docs/SCREENS.md` (the staff expenses surface, and the Ledger's new readers), `docs/DATA_MODEL.md` (payment states, void, settlement), `docs/LIMITATIONS.md` (shared-tablet attribution, the merged cash-out line), and `openspec/changes/daily-cash-live/proposal.md` (the grown carry-over obligation).
