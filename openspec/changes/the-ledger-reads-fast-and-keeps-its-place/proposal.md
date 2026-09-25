# Proposal: the-ledger-reads-fast-and-keeps-its-place

> **Model**: Opus · **Roadmap**: deliberately unlisted — this corrects a shipped
> surface rather than sequencing new capability, so it takes a change folder and
> no row · **Gate**: on production, signed in as the owner, a Ledger day step
> settles in under 1.5 s and a Ledger month in under 3 s on the same connection
> that measured 4–5 s and 15–16.5 s on 2026-09-24; a day is read in at most two
> sequential round trips and a month in at most two, whatever the number of dates;
> a month switched away from mid-load cancels its reads; any source that fails to
> read produces a visible error instead of a nought or a missing section; the
> error clears when the period or outlet changes; figures from one outlet or
> period are never shown under another; switching outlet keeps the chosen date
> and month, pulled back only to that outlet's today; and the month and each of
> its days still agree to the paisa.

## Why

The owner reported on 2026-09-24 that the Ledger is slow to open, slower still on
the month, and "messy" when the date or month is changed while it loads. It was
measured the same day on production, in the owner's own signed-in browser at
Kalyani:

| Reading | Time | Requests |
|---|---|---|
| Ledger opened cold | 6.5 s | 26 |
| One day step (four runs) | 4.0–5.0 s | 21–22 |
| September month | 16.5 s | 632 |
| August month | 15.0 s | 602 |
| Three month switches 1.5 s apart, then the last | 26 s after the last tap | 734 |

**Every request costs about 300 ms whatever it asks**, so the page's speed is its
number of *sequential* round trips, not how much the database works. A day makes
thirteen of them one after another: one wave of seven reads, then five lookups
that each wait for the last, then the opening balance (three more), then the
closing balance (three more) — which could run alongside the opening and does not.
13 × 300 ms is the four seconds.

**The month is thirty-one days fired at once**, about 600 requests. They queue:
the median request stays at 330 ms but one in twenty takes 1.8 s and the slowest
9 s. And the month keeps almost nothing it read — of each day's reading it uses
the revenue, the expenses and one word (counted, carried or not tracked yet). The
drawer balances, the timeline, names, adjustments and verifications, roughly two
thirds of the requests, are computed and discarded.

**A month abandoned mid-load keeps loading.** The screen stops listening to the
old answers but never cancels the requests, so the month you want waits behind
the ones you stepped past: June alone reads in about 15 s, and took 26 s behind
two skipped months.

The existing timing guard (`zz-ledger-month-timing.test.ts`) measured 285–389 ms
for a month and never saw any of this, because it runs against a local stack
where a round trip costs nothing. It measures database work, and the cost is
elsewhere.

Reading the code for the "messy" part found no path that renders one date's
figures under another date's label — the surface already checks the reading's own
date against the chosen one. It found four nearby defects that produce the
experience described, one of them serious:

1. **A failed read renders as nought.** Of a day's two dozen reads, only bills and
   expenses are checked for an error. Any other that fails — a channel's figures,
   the counts, the cash out, a balance — is taken as empty, so a day can lose its
   Zomato section, read *carried* instead of *counted*, or show a wrong balance,
   and say nothing. With six hundred requests queued, timeouts are the ordinary
   way a request fails. This is the one rule the ledger most insists on — an
   unknown is never rendered as an absence — broken at the transport.
2. **An error never clears.** Once *Could not read that month* appears it stays,
   over correct figures, until Verify is pressed.
3. **An outlet switch shows the previous outlet's figures** for as long as the new
   read takes, because readiness compares the date and not the outlet.
4. **Verify's reload is not guarded.** Stepping to another date while it runs can
   overwrite the reading with the old date and leave the skeleton up.

And one the owner raised directly: **switching outlet throws away the chosen date
and month**, returning both to today. Each outlet has its own cutover, so the
surface recomputes *today* on a switch — which is right — and then overwrites the
selection with it, which nothing requires.

## What changes

**A day reads in two round trips, not thirteen.** Every read that does not depend
on another starts at once; the drawer balance at an instant becomes one server
read instead of five; the reads that do depend on the first wave — the payment
split, the names, the adjustments — all start together in a second. The figures
are unchanged.

**A month reads in one server call, not thirty-one days.** A single read returns,
for each date of the month, exactly what the month uses and nothing else: cash,
UPI, discount, each channel's figures, the expense lines and the drawer's word for
that date. It is derived on read from the same sources as a day, stores nothing,
and is checked against the thirty-one day readings to the paisa. The month's
cards, words and figures are unchanged.

**A reading answers for the outlet and period on screen, or says it could not.**
A read that fails anywhere fails the whole reading, visibly, rather than
rendering a nought or leaving a section out. A reading for another outlet or
period is never shown under this one. The error message belongs to the period it
was about and goes when the reader moves on. A read the reader has moved away from
is cancelled, not left queuing.

**Switching outlet keeps your place.** The chosen date and the chosen month stay
where they are when the outlet changes. Only a date later than the new outlet's
own today is pulled back to that today, because the database refuses a future
business date.

## Non-goals

- **No change to any figure, word, card or control on the Ledger.** The day and
  month read exactly as they do; only how fast, and whether they admit a failure.
- **No stored day or month row, and no materialised table.** The month read is a
  function over the live sources, computed on every read. The ledger spec forbids
  a stored row, and a materialised model would need refreshing — the round trips
  were the cost, not the database work, so neither is needed.
- **No change to who may read the ledger.** The new server reads admit exactly the
  readers the drawer already admits, and refuse everyone else outright.
- **No change to how a manager's month decides which channels an outlet trades
  on.** The channel mapping stays a separate owner-only read with its existing
  fallback; folding it into the new function would widen that read to managers,
  which is a policy decision this change does not make.
- **No change to business-date bounds.** The day reader's 04:00 cutover constant
  is kept and mirrored exactly by the month read, so the two cannot disagree.
  Whether both should follow each outlet's own cutover is a separate question.
- **No caching or prefetching of neighbouring days or months.** Two round trips
  make that unnecessary, and a cache is a second place a figure can be stale.
- **No change to Overview**, which already reads through its own server functions.
- **No offline path.** The Ledger is a reading and has never worked offline.

## Docs to update before archiving

- `docs/LIMITATIONS.md` — *The derived ledger month is measured, not assumed*:
  the 2026-09-24 production figures, why the local timing never saw them, and the
  round-trip budget that replaces the millisecond ceiling.
- `docs/TESTING.md` — the latency-injected ledger timing check and the month/day
  parity check.
- `docs/SCREENS.md` — the Ledger paragraph: the period survives an outlet switch,
  and a reading that could not be completed says so.
- `docs/DATA_MODEL.md` — the two new read functions, beside the drawer's existing
  ones.
- `openspec/specs/ledger-statement/spec.md` — via the delta in this change folder.

## How to run the gate

- `npm run format`, then `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run contrast`, `npm run build`, `npm run test:e2e`.
- `npm run test:db` and `npm run test:rls` against a freshly reset local stack
  (the stack is shared with other sessions — reset before trusting it), including
  the ledger timing phase, which now injects latency and asserts round trips.
- Regenerate `database.types.ts` from the reset schema and confirm a clean diff.
- On production after the owner picks the deploy window, in the owner's own
  browser: repeat the 2026-09-24 table — cold open, four day steps, September,
  August, and three month switches — and compare.
