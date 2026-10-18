# Design: Each analytics page remembers its range and view

## D1. Remember the shortcut, not the dates

What is stored is the shortcut (`1d`, `7d`, `30d` or `month`), never the dates. Remembered dates would open tomorrow on yesterday's range. A shortcut is re-counted from the outlet's business date on every opening, through the same cutover the buttons already use.

The memory is written when the range changes to one a shortcut produces. That is a tapped shortcut, or a step forward that lands on one, such as stepping a week forward back onto the last 7 days. A range no shortcut produces (dates picked by hand, a stepped-back period) leaves the memory alone.

Rejected: **writing the memory from an effect whenever the address matches a shortcut.** Opening a shared link would then overwrite the reader's preference without them choosing anything. The write lives in the page's own change handler, so it happens only on the reader's action.

## D2. Where it is read, and what the address still decides

`OutletAnalytics` reads the remembered shortcut for its page (`items` or `sales`) and uses it only for what the address leaves out: `from` (and so the range), and, when `from` is absent, the grouping (Hour for 1d, Day otherwise) and Sales' Month alignment. An address that names `from` and `to` opens exactly as before, so links and reloads of a chosen range are unchanged. Because the default is computed rather than written into the address, opening a page adds no history entry.

Shortcut fallback (the buttons on offer differ): Month exists only on Sales with *One revenue* on, in place of 30d. So a remembered `month` opens as 30d where Month is not offered, and a remembered `30d` opens as Month where it is.

## D3. Per person and per mode, like the outlet, but not cleared at sign-out

Keys are `shawarmania.analytics-range.<mode>.<userId>.<page>`, the same namespacing as `remembered-outlet.ts`. The person is part of the key so a handed-over phone opens on its new reader's own choice, and the mode is part of it so a demonstrator's choice cannot reach a real session. Storage that throws (private mode) degrades to 7d silently. A missing session provider (as in component tests that render the surface alone) reads as nothing remembered.

The outlet memory is also cleared at sign-out. This one is not, on purpose. Clearing it would mean editing `use-real-session.ts`, which is app-wide sign-in code that the counter tablets run, and that would take the change out of *A revert is enough*. Nothing is lost by keeping it: the key is already per person, and a range preference reveals nothing about anyone's takings.

Rejected: **one preference shared by both pages.** The owner asked for them separately (2026-10-18): Sales on 7 days and Items on 1 day is a real pattern.

Rejected: **storing it on the server per profile.** It would follow the person across phones, but it needs a migration and a write path for a convenience. Nothing asked for that.

## D4. The view, kept the same way

The trend card's Chart / Cumulative / Table choice (`show` in the address, added by `a-trend-can-show-its-running-total`) is remembered under `shawarmania.analytics-view.<mode>.<userId>.<page>`. Tapping a view writes it. With no `show` in the address the card opens on the remembered view, and with nothing remembered, on Chart. Tapping Chart writes `chart` as well as clearing `show`, so the card does not fall back to an older remembered Table. One helper, `remembered-choices.ts`, keeps both choices, so they share their namespacing and failure handling. `TrendCard` takes the page it belongs to (`page`) rather than deriving it from its test id.

A link that names a view opens on it, but opening it does not change what is remembered, for the same reason as D1: only the reader's own tap writes.

## Money, RLS, offline, version skew

No money arithmetic, RLS policy, table, function or offline path is touched. No database object changes, so a build published before this one keeps working. An older build ignores the new storage keys, so a revert simply opens on 7d, as a chart, again.
