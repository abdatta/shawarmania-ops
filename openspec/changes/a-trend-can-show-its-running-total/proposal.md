# A trend can show its running total

> **Model**: Sonnet · **Roadmap**: no row (owner, 2026-10-18: "it's just another view of the same analytics")

## Why

The trend card on Analytics → Items and Analytics → Sales draws each day, week or hour on its own. To answer the question the owner actually asks mid-period, "are we ahead of last week by now?", they have to add the points up in their head. A running total answers it at a glance: one line that only climbs, with each earlier period's own line beside it, so where the current line sits against the others *is* the answer.

## What changes

The trend card's **Chart / Table** switch gains a third choice, **Cumulative**, between the two: Chart | Cumulative | Table.

- **Cumulative draws the same chart as running totals.** Each point is everything from the start of the period to that point. On Items that is items sold or dish revenue so far; on Sales, revenue or orders so far. On the Hour grouping it is everything up to that clock hour ("by 2 pm we had done ₹4,200").
- **AOV is a running average, not a sum.** Adding averages together means nothing, so on AOV each point is all counter revenue so far divided by every counter bill so far. The line levels off rather than climbing. A bucket with no bills holds the average where it was; before the first bill there is no point, as today. It does not start from ₹0: with no bills there is no average, and a ₹0 start would read as a leap in bill size on the first day of trade (owner asked, 2026-10-18; kept as a gap).
- **Every compared period gets its own running line**, aligned by elapsed day as the chart already is. The current period's line stops at the last finished (or ongoing) point. The earlier periods run to their end. A point that has not started yet is still not drawn, and an ongoing one is still hollow and reads **so far**.
- **A day with nothing recorded adds nothing**, so the line runs flat across it. Missing delivery imports are disclosed by the card's existing **Delivery coverage** chip, as today. They are not drawn as a separate mark.
- **Inspection reads the running figure.** Tap, hover or the arrow keys show the date and the total (or average) up to that point for every period.
- **Unchanged:** the headline figure and its chips, the caption, the table and its CSV (always per bucket), the hourly pattern card, and every read. Cumulative reuses the loaded snapshot. The choice is kept in the address as `show=cumulative`, the same way Table is, so it survives a reload or a change of subject.

## Non-goals

- A cumulative table or CSV column. The table stays per bucket, exact to the paisa.
- Cumulative on the hourly pattern card (the second Sales card), the Dishes list, Customers, Overview or the Ledger.
- Targets, goal lines or a projection of where the period will end.
- Any change to what a bucket counts, to the database or to the snapshot.

## Change gate

No gate: this is a change away from the counter and kitchen that a revert cleanly undoes (AGENTS.md → *A revert is enough*). **The revert is clean.** The change adds a value of `show` in the page address and a client-side transform of figures the page already holds. It writes nothing to the database, the outbox or browser storage, so after a revert the old build meets nothing new; an old link carrying `show=cumulative` opens the chart, because the old build reads anything but `table` as Chart. **It cannot reach the counter or kitchen.** The trend card and its chart are used only by the two Analytics pages, which only owners and managers open. The change touches no shared component, shell, sign-in, routing or gate snapshot, and adds no load on the database.

## Durable documentation

Before archive: `docs/SCREENS.md` (Analytics: the trend card's switch), `docs/OPERATIONS.md` (what a switch reads) and `docs/TESTING.md` (what the demo browser tests cover for the switch).
