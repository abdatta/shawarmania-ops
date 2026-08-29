## 1. Carry the moment through the mapper

- [x] 1.1 Add `asOfAt: string | null` to `ZomatoSettlement` in `src/data-access/adapters.ts`, documented as the moment the source was current — last confirmed, not last moved.
- [x] 1.2 Map `row.as_of_at` in `toZomatoSettlement`. One mapper serves the mock and the Supabase adapter, so neither side needs its own change.

## 2. Print it where a figure could be mistaken for a live one

- [x] 2.1 Day view: print the stamp beneath each channel's reading block, via the existing `formatDayTime`. Omit it where there is no measured figure or `asOfAt` is null.
- [x] 2.2 Month view: carry the latest `asOfAt` per channel through `MonthReading`, and print one stamp beneath each channel's rows. Not one per day, and not one shared across both channels.

## 3. Pin it

- [x] 3.1 One test at the surface: the day view shows the stamp for a measured figure, and shows none for a day with no measured figure. Prove it fails before the fix.
- [x] 3.2 Extend it to the month view's per-channel stamps, including the case that makes a shared stamp wrong: a fresh Zomato read alongside a stale Swiggy one must not read as one freshness.

## 4. Gate

- [x] 4.1 `npm run typecheck`, the touched test files, `npm run format:check`.
- [x] 4.2 **Gate:** a measured figure on the day view carries the moment its source was current, the month view carries one stamp per channel, and a reading taken last night can no longer pass for a live value.
