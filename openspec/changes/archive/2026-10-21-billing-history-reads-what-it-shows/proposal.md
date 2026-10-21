# Proposal: Billing History Reads What It Shows

> **Model**: Opus · **Kind**: runtime efficiency, not a roadmap change (it
> changes how fast the owner's Billing history answers, not what anyone can do
> with the app) · **Depends on**: #78 `billing-day-at-a-glance` (the Filter
> sheet, Stats and the day-scoped Open orders this reads for), #76
> `revenue-reads-the-same-everywhere` (the revenue definition the day's figures
> now come from) · **Archives after**: #78, whose `counter-billing` delta this
> one modifies · **Gate**: none (see *Change gate*). The Bills tab lists the
> first screenful of the chosen day's bills and the next as the owner scrolls;
> each row carries only what its folded card shows; every sort and filter runs
> on the server; Cash, UPI, Total and AOV come from the same revenue definition
> as Overview and the Ledger; Stats opens with no read; a tapped bill's details
> load once and stay loaded until the page is left; cancelling a bill changes
> that row in place without a shimmer; Open orders makes one round trip; the
> sync problems are the chosen day's, not the newest hundred commands'.

## Why

The owner said on 2026-10-18 that Billing history feels slow and asked whether
recent deploys made it worse. Production's edge logs say they did not: per
request, the page's reads take what they took before the 16 and 18 October
deploys. The page is slow by construction, and it gets slower as the outlet
gets busier:

- **Every bill of the day is read in full on every open.** One request brings
  every bill with ten nested tables — dish lines, discounts, payments, receipt,
  public link, order, three names and attribution reviews — about 2.2 KB a bill.
  Kalyani Cafe's days doubled this week (48 bills on 14 October, 125 on the 16th,
  128 on the 17th), so the read went from about 107 KB to 289 KB. Measured on
  18 October, the server alone took 190 ms for 17 bills and 290–610 ms for 78–90
  from India, and 770–1,500 ms for 85–125 from the owner's US connection, before
  the phone downloads, parses and draws all of it. The list shows a folded card
  per bill; almost none of that data is on screen until a bill is opened.
- **The day's figures are added up on the phone.** Cash, UPI, Total and AOV are
  summed from the bills the page holds, which is why it has to hold them all. It
  is also the last surface that counts counter revenue its own way: Overview and
  the Ledger read the one definition #76 put on the server.
- **The sync problems are the newest hundred commands'.** At about 700 commands a
  day, a hundred covers the last one and a half to three hours, so a refusal at
  lunch has vanished from the chip by evening although nothing fixed it, and the
  window shrinks as sales grow. A hundred measures nothing.
- **Cancelling a bill reloads the page.** The whole list turns to a shimmer, all
  six reads run again, and the owner loses their place in the list.
- **Open orders waits twice.** It reads the orders and the kitchen ticks, then a
  second request for each order's till name, which the Orders card never shows.

## What changes

**Bills tab**

- The list shows the **first screenful and a little more** — about 30 bills —
  and reads the next 30 as the owner nears the end, until the day is shown.
- Each row carries **only what its folded card shows**: bill number, state, total,
  tender, time, biller or Paper, tablet. No dish lines, no customer details.
- **Sort and filter run on the server.** Every Filter sheet choice and every sort
  (paid time, order time, amount, wait) reads the matching bills afresh; the list
  shows its loading state for that moment, well under a second [owner: "a sub
  second load after filter change is acceptable"]. The tab still reads
  `Bills (12/140)` while a filter hides some.
- **Opening a bill reads its details once** — dish lines, discounts, customer,
  timeline, receipt, review — in one request. What the row already holds shows at
  once; the rest fills in a moment later. Once read, a bill's details **stay
  loaded until the owner leaves the page**: collapsing it, opening another and
  coming back never loads or shimmers again [owner].
- **Cancelling a bill changes that row in place.** No shimmer, no lost place; the
  day's figures refresh quietly beside it.

**The day's figures and Stats**

- **Cash, UPI, Total and AOV come from the server**, from the revenue definition
  Overview and the Ledger already use, so all three always agree. A day the
  phone-side sum read differently — by a rupee, or a refund — now reads the
  agreed figure.
- **Stats needs no read of its own.** Its figures arrive with the day's figures
  when the page opens or the day changes.
- **The sync problems are the chosen day's refusals**, every one of them, however
  busy the day. The chip's *In sync · 3 min ago* still speaks for now. The red
  count on the Stats tab is that day's.

**Open orders**

- One round trip: the chosen day's open orders and the kitchens' ticks, asked for
  together. The till name read the card never used is gone.

**Coming back to the page**

- Returning to the app or the browser tab after more than two minutes re-reads
  the day's figures and the bills already shown, quietly, keeping the filter, the
  open bill and the owner's place — the same two-minute rule the delivery badges
  follow.

## Change gate

**No gate:** a revert is enough (AGENTS.md → *A revert is enough*), and both
conditions hold.

1. **The revert is clean.** The change writes nothing. The migration adds two
   read-only functions only the new build calls; every read the old build uses —
   `billing_history_day_extras`, `billing_day_stats`, the bills, orders and
   `billing_commands` reads — stays published and unchanged. The detail cache and
   the loaded pages live in memory and are gone when the page is left; nothing is
   written to browser storage. After a revert every row, outbox item and stored
   value is exactly what the old build expects.
2. **It cannot reach the live counter or kitchen.** Billing history is an owner
   and manager screen that no counter or kitchen screen renders. The billing
   adapter's counter reads — `readOrders`, the outbox overlay, `readBills` as the
   counter calls it — are untouched: Open orders gets a manager-only read of its
   own. No shared component changes. The new reads replace heavier ones on an
   owner screen opened a handful of times a day, so the load on the database
   falls.

## Non-goals

- **The burst of requests when the app opens.** Opening the owner's app fires
  about 40 requests at once (Overview and the delivery badges), and in that burst
  each took 0.8–1.1 s instead of 0.25 s. It slows whatever the owner opens next,
  and it deserves its own investigation; this change does not touch it.
- **The customer's bill list.** It already reads slim rows a page at a time. The
  new list read is shaped so it could serve it later, but this change does not
  move it.
- **Searching bills** by number or name.
- **New filters, sorts or figures.** Every choice, figure and word on the page is
  #78's; only where they are worked out changes.
- **The counter's own screens**, the kitchen, the outbox and the request budget:
  untouched.
- **Removing old database reads.** The functions the old build calls stay until a
  later contract migration has a reason to drop them; migrations only add.

## Capabilities

### Modified

- `counter-billing`: Billing history's Bills tab reads its rows a page at a time,
  sorted and filtered by the server, with details read on opening and kept; the
  day's figures come from the shared revenue definition; Stats' sync problems are
  the chosen day's; a cancellation changes its row in place.

## Impact

- **Database**: one migration adding `billing_history_bills` (a page of the
  outlet-day's bill rows, sorted and filtered) and `billing_day_numbers` (the
  day's Cash, UPI, settled-bill count, bill count, Stats figures, sync refusals
  and newest command, open-order count and unpaid total, and the day's tablets).
  No table, column, policy, trigger or changed function.
- **Billing history**: opening the page reads the outlet (as today), a page of
  rows, the day's figures and the billers, together; a filter change reads only
  rows; Stats reads nothing; Open orders reads two things together; opening a
  bill reads one.
- **Adapters**: `listManagerHistory`, `listDeliveryDiagnostics`,
  `countManagerOpenOrders` and `readDayStats` lose their only caller and are
  deleted, live and demo. `getBill`, which the customer card uses, is unchanged.
- **Counter and kitchen**: none.

## Docs To Update Before Archive

- [`docs/SCREENS.md`](../../../docs/SCREENS.md): Billing history — the list
  reads as you scroll, details on opening, the figures from the shared
  definition, sync problems by day.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md): the two new read
  functions, and which reads Billing history no longer makes.
