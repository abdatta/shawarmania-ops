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
> and month — on the Ledger, Billing history, Expenses and Attendance's day
> view — following the new outlet's today only when the reader was on today or
> past it; and the month and each of its days still agree to the paisa.

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

**Switching outlet keeps your place — on every screen that has both an outlet
picker and a period.** The chosen date and the chosen month stay where they are
when the outlet changes. A reader who was on today stays on today, the new
outlet's; a date later than the new outlet's today is pulled back to it, because
the database refuses a future business date.

Asked about on the Ledger, and then found in three more places on 2026-09-25:
**Billing history** and **Expenses** both drop their date back to today on a
switch, and **Attendance's day view** rebuilds itself from scratch whenever the
outlet chips change — deliberately, so a half-built approval selection cannot
survive into other outlets — and takes the date with it. Attendance's
person-and-month view already keeps its month, on purpose, and is the model for
the rest. The owner chose to land all four in this change rather than a second
one: the rule is one rule, so it is written once, in the shared outlet-picker
contract (`app-shell`), rather than per screen.

## Round two, after the first deploy (2026-09-25)

The first round shipped and was measured on production in the owner's browser,
through the path people actually use — the app already open, then a tap:

| Reading | Before | After round one |
|---|---|---|
| Tapping Ledger | — | 1.6 s |
| Stepping a day | ~4 s | 1.1–1.3 s |
| The month | 15–16.5 s | 0.4–0.8 s |
| Tapping Billing history | — | 1.8 s |
| Tapping Drawer | — | 4.2 s |

The owner asked for the time to open the Ledger, and to switch its outlet, date
or month, to come down further, and for any other page with the same problem to
be fixed the same way. Four causes, each measured:

- **Every outlet-scoped page asks for its outlet before anything else** (~0.35 s),
  only to learn the outlet's cutover. The Ledger, Billing history, Expenses, the
  Drawer and the outlet day view all do it, on every open and every switch.
- **The effective payments view scans every bill the reader can see.** It resolves
  each bill's latest payment correction up front, and the correction table's
  policy then checks all 2,127 bills rather than the day's forty: 131 ms of
  database work for one day, growing with every bill ever rung. The Ledger's day,
  Billing history and the Drawer (twice) all read it. A rewrite that looks
  corrections up per bill returns identical rows over every production bill, in
  4 ms.
- **Billing history's delivery log has no index for its own question** — the last
  hundred commands at an outlet — so it reads all 4,304 of them, applies the
  policy to each and sorts: 317 ms, growing with every bill.
- **The Ledger's day still makes a second wave, and the Drawer makes nine.** The
  day waits on its first wave for the payment split, the names and the
  adjustments; the Drawer reads nine things one after another that depend only on
  its first read.

**What changes, round two.** A page opened a second time, or switched to another
outlet, no longer asks for the outlet. The payment view and the delivery log are
fast at any size. A Ledger day reads in one round trip, Billing history in two,
the Drawer in three. Nothing on any screen looks or reads differently.

## Round three: Billing history and the Drawer (2026-09-26)

After round two, measured on production: Billing history 1.0 s, the Drawer 1.4 s.
The owner asked for both to come down too. Measured, read-only, on production:

- Billing history's pipeline read asks for open and unprepared paid orders —
  of which production holds **none** — and takes 80 ms of database time to find
  that out, because no index narrows to them: all 1,468 of Kalyani's orders go
  through the policy first. Under the four reads the screen makes at once, that
  read settled at 0.63–0.69 s.
- The Drawer's two recent-bill reads ("the last forty settled", "the ones that
  synced late") walk every settled bill at the outlet through the policy, 80 ms
  and 60 ms, settling at 0.55–0.75 s.
- Both screens then wait one more round trip for data keyed on what came back:
  Billing history for each bill's effective payments and historical till label,
  the Drawer for the cash split of the recent bills.

**What changes.** Partial indexes let those reads touch only the rows they
return. Billing history asks for the day's payments and till labels by outlet
and date, alongside the bills rather than after them. The Drawer asks for its
recent and late bills with their cash already split, in its second wave. Nothing
on either screen reads differently.

## Round four: the Drawer shows each part as it arrives (2026-09-26)

The owner asked for the Drawer to load the way Overview does — each part on
screen as soon as its own data is in, rather than the whole page waiting for its
slowest read — and for the loading placeholder to look like what replaces it.

The Drawer has three independent parts: the **balance card** (and the Count &
Collect action that works from it), the **recent counts**, and the **exceptions**
card. They were one read, so the page showed nothing until all three were ready,
and a single generic placeholder stood in for all of them.

**What changes.** Each part is read on its own and appears when its read lands:
the recent counts in one round trip, the balance and the exceptions in two, all
at once. Each has a placeholder in its own shape — the balance card's headline,
chips and three figures; the counts' rows — so nothing jumps when it arrives.
Count & Collect is available as soon as the balance is. A part that fails to
read says so in its own place and leaves the others on screen.

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
  Round two caches outlet rows — a name, a cutover — and never a figure.
- **No policy change.** The payment view is rewritten under the same
  `security_invoker` and reads the same tables through the same policies; the
  delivery log gains an index. The correction policy's harmless tautology
  (`b.outlet_id = b.outlet_id`) is noted, not touched.
- **No change to Overview**, which already reads through its own server functions.
- **No offline path.** The Ledger is a reading and has never worked offline.

## Docs to update before archiving

- `docs/LIMITATIONS.md` — *The derived ledger month is measured, not assumed*:
  the 2026-09-24 production figures, why the local timing never saw them, and the
  round-trip budget that replaces the millisecond ceiling.
- `docs/TESTING.md` — the latency-injected ledger timing check and the month/day
  parity check.
- `docs/SCREENS.md` — the Ledger paragraph (a reading that could not be
  completed says so), and the outlet-switcher paragraph: every surface with a
  period keeps it across an outlet switch.
- `docs/DATA_MODEL.md` — the two new read functions, beside the drawer's existing
  ones.
- `openspec/specs/ledger-statement/spec.md` and `openspec/specs/app-shell/spec.md`
  — via the deltas in this change folder.

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
