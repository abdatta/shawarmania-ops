# Proposal: The App Asks The Server Less

> **Model**: Opus · **Kind**: runtime efficiency, not a roadmap change ·
> **Gate**: with the change gate on, the kitchen reads its categories only when
> its filter changes; the counter reloads its menu when the menu changes and at
> most every two minutes otherwise, and one burst of sale notices refreshes the
> bills and the rail once; the expense list asks for category names in one
> request; a badge re-reads on returning to the foreground only when its count
> is older than two minutes; the aggregator page checks a running sync every
> three seconds; a tablet's minute health report brings back the gate answers,
> so it no longer reads the gates separately every minute; every one of these
> still shows a change made elsewhere; a new request budget, run with the gate
> on, holds the lower numbers; with the gate off, every screen reads exactly as
> it does today; both states are proved in unit tests and both browser suites.

## Why

Supabase writes one ~2.8 KB API-gateway log line for every request the app
makes, and from the start of 2027 the Free plan allows 1 GB of those a month.
Measured on 15 October from production's own logs: about 30,000 requests a day,
96% of the month's log volume, on course for about 2 GB this cycle. Nothing in
Supabase's settings lowers that line's volume; the only lever is fewer requests.
The Postgres log settings its guide points at are already at their quietest
defaults here.

Most of those requests re-read something that has not changed:

- **The kitchen re-reads its menu categories on every board read**, about 1,800
  times a day. Its effect watches the filter's category list, which is a new
  array on every read, so the effect runs every 20 seconds.
- **Every sale reloads the counter's whole menu.** One change notice for an
  order or a bill re-reads the categories, items, discounts, discount categories
  and outlet settings, and one sale sends two or three notices, each refreshing
  the bills and the rail as well.
- **The expense list counts every category one request at a time** to show
  suggestions that use only the names: one phone sent 758 such requests in six
  hours.
- **Each delivery badge re-reads on every return to the foreground**, which on
  the owner's laptop is every switch between browser tabs, and each re-read is
  several requests per outlet and channel.
- **The aggregator page checks a running sync every 0.7 seconds.**
- **Each tablet makes three calls a minute when idle**: its unsent-bills
  heartbeat, its health report and a re-read of the change gates.

A 26 September analysis found the same shape at 18,600 requests a day; nothing
changed, and the count has since grown. Fewer requests also mean less load on
the smallest database size, which is what froze the counter on 12 October.

## What Changes

- **The kitchen reads its categories when its filter changes**, and when the
  filter sheet opens, not on every board read.
- **The counter's menu follows the menu.** A change to a category or a dish
  reloads it at once, as now. A sale reloads it only when the last reload is more
  than two minutes old, because discounts and the outlet's settings have no
  change notice of their own and still have to arrive during a shift.
- **One burst of sale notices refreshes the bills and the rail once.** Notices
  arriving within 300 milliseconds of each other are answered by one refresh.
- **The expense list asks for the category names in one request.** The
  categories page, which shows how often each is used, still counts them.
- **A badge re-reads on returning to the foreground only when its count is more
  than two minutes old.** A badge still re-reads at once when the surface it
  counts says it has done some of the work, and on first load.
- **The aggregator page checks a running sync every three seconds.**
- **A tablet's health report brings back the gate answers.** The minute report
  the tablet already sends returns every gate's answer, and the tablet stops
  re-reading the gates separately each minute. A turned gate still reaches it
  within seconds through its live channel, on returning to the foreground and on
  regaining the connection; if a report fails, the tablet reads the gates
  directly instead, so a minute is still the slowest a turn can take.
- **One shared place decides how fresh is fresh enough**: the two-minute ages,
  the 300 ms burst and the three-second sync check are named once, with a small
  helper to merge bursts, so the next screen uses them instead of a timer of its
  own.

Estimated together: about 30% fewer requests, from about 30,000 a day to about
21,000, which is about 1.5 GB of log volume a month rather than 2 GB. The
estimate per item is in `design.md`. It does not on its own get the month under
1 GB; `design.md` lists the remaining levers and why they are not in this change.

## Change gate

**`fewer-requests`**, code **`FR`**, depends on nothing.

- **On:** The app skips re-reads it does not need: menus and categories when nothing changed, badges seconds after the last read, a tablet's separate gate check.
- **Off:** Every screen re-reads exactly as it does today.

Off is today: each toggle point keeps its old code path untouched and takes the
new one only with the gate on. The on path persists nothing; it changes when the
app reads, never what it writes. The owner means to run it on for a full billing
cycle to see the month's log volume, then retire it on or remove the change.

## Non-goals

- **No change to how fresh the kitchen board, the counter's rail, or the
  counter's kitchen marks are.** The board's 20-second re-read and its
  out-of-sync rule stay as they are. Food that reaches the kitchen late costs
  more than log volume.
- **No change to the unsent-bills heartbeat.** It lives in the outbox, which
  never reads a gate.
- **No change to how often a session is revalidated.** Deactivation must keep
  biting within minutes.
- **No change to what any screen shows**, nor to any write, money figure, policy
  or the offline path.
- **No Supabase setting is changed by this change.** Turning off `pg_cron`'s
  statement log (about 2% of volume) is a production configuration step for the
  owner, recorded in `docs/OPERATIONS.md`.

## Docs

- `docs/ARCHITECTURE.md`: how a screen keeps its data fresh, and the shared
  freshness constants.
- `docs/TESTING.md`: the second request budget, run with this gate on.
- `docs/OPERATIONS.md`: where Supabase's log volume comes from, how to measure
  it, and how to read the logs without spending the query allowance.
- `docs/RELEASES.md`: the tablet's health report now carries the gate answers.
