# Proposal: retire-auto-approve-at-the-shop

> **Kind**: gate retirement, no roadmap row. Seeded 2026-11-02 when
> `a-check-in-at-the-shop-approves-itself` (#81) was archived, on the owner's
> word. Retires the change's three gates together, because each of the other two
> depends on the one before it.

## Why

#81's three gates have done their job. All three were turned on in production
at 12:04 IST on 30 October 2026 and have stayed on: `change_gate_events` holds
those turns and nothing since. **None was pulled**: on 2 November the owner
waived the pull and the staging try, on one auto-approved check-in in production
(11:14 IST that day, 13 m inside a 150 m fence) and good reports from the shop.
The category list was in daily use by then. Their off paths are now dead code
with a switch on them.

| Key | Code | `retireBy` | Depends on |
| --- | --- | --- | --- |
| `auto-approve-at-the-shop` | AA | 2027-02-28 | — |
| `refreshed-staff-screens` | RS | 2027-02-28 | AA |
| `expense-category-list` | EL | 2027-02-28 | RS |

## What changes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), both halves,
for all three at once. A dependant retires before or with its parent, so none is
left depending on a retired key.

- **Code.** Every toggle point keeps its on branch: the check-in's
  auto-approval and the outlet's attendance settings; the staff phone's Home,
  My attendance and By staff calendars, and the expense lists' day headings,
  You tag and amount-first form; the category tiles. The three keys move to
  `RETIRED_CHANGE_GATES`. Their off and round-trip tests go and their `@cg-on`
  tags drop. The demo's gate copy goes, and the demo's fixtures keep only their
  gate-on shape.
- **Database later.** After every registered device runs the retirement build
  and the counter has traded three services on it, one contract migration
  (`-- release: contract` for each key) rewrites each reader to its on branch
  and retires the rows, EL's first. On 2 November production had two readers:
  `attendance_submit_attempt_v3(…)` reads `auto-approve-at-the-shop`, and the
  policy `expense_category_choices.expense_category_choices_select_tablet`
  reads `expense-category-list`. Re-run the reader query before writing it.

## Change gate

No gate: a retirement keeps the behaviour already on.
