# Each analytics page remembers its range and view

> **Model**: Sonnet · **Roadmap**: no row (owner, 2026-10-18: a small preference beside the running-total view, same session)

## Why

Owners and managers read Analytics in different ways. One looks at today, hour by hour, every day; another mostly reads the week or the month for the overall trend. Today both pages open on the last 7 days, as a chart, every time, so a person who always wants 1d, or always reads the table, taps it on every visit. The outlet they picked is already remembered between visits. The range and the way the trend is read should be too, and **separately for each page**: the owner may want Sales on 7 days and Items on 1 day, always.

## What changes

- **Each page opens on the date shortcut last tapped there.** Tapping **1d**, **7d**, **30d** or **Month** on Items remembers it for Items. Tapping one on Sales remembers it for Sales. Neither changes the other. The next visit, a reload or the app opened tomorrow starts on that shortcut, counted back from the business date of that day: 1d is today by hour, 7d and 30d end today by day, and Month is the 1st of this month to today.
- **It is remembered for that person on that phone**, as the outlet is: kept in the browser, per signed-in person and separately for the demo, so a phone handed to someone else opens on their own choice, or on 7d.
- **Only a shortcut is remembered.** Picking dates by hand or stepping back a period is a one-off look and leaves the remembered shortcut as it was. A link that already names dates still opens on those dates.
- **Where a shortcut is not offered, its nearest one is used.** Sales shows Month in place of 30d while *One revenue* is on; a remembered Month opens as 30d where Month is not offered, and a remembered 30d opens as Month where it is.
- **Nothing remembered means 7d**, as today.
- **Each page's trend reopens as it was last read** (owner, 2026-10-18): Chart, Cumulative or Table, remembered the same way, per person and per page. Choosing Table on Items leaves Sales as it was. A link that names a view (`show=…`) still opens on it.

## Non-goals

- Remembering anything else on the page: measure, grouping, Compare or the charted dish.
- Remembering a custom range or a stepped-back period.
- Carrying the choice across phones or browsers. It is not stored on the server.
- Forgetting it when the person signs out (design D3 says why).

## Change gate

No gate: this is a change away from the counter and kitchen that a revert cleanly undoes (AGENTS.md → *A revert is enough*). **The revert is clean.** The change adds new browser-storage keys (`shawarmania.analytics-range.*` and `shawarmania.analytics-view.*`) that only the new build reads. It reshapes no value an older build reads, writes nothing to the database or the outbox, and after a revert the keys are ignored and both pages open on 7d, as a chart, as before. **It cannot reach the counter or kitchen.** The code lives in the Analytics surface and its trend card, which only owners and managers open. It touches no shell, sign-in or sign-out code (design D3), no routing, no gate snapshot, and adds no load on the database.

## Durable documentation

Before archive: `docs/SCREENS.md` (Analytics: the date shortcuts) and `docs/TESTING.md` (what the demo browser tests cover).
