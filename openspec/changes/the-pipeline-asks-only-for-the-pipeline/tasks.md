# Tasks: the-pipeline-asks-only-for-the-pipeline

> **The client-side filter stays.** It stops being what protects the wire and
> goes on being what decides the projected result after the overlay. A task that
> deletes it has misread the change — see [`design.md`](design.md).

## 1. The Read Asks For The Rail

- [x] 1.1 Write the failing test first: a recording client captures the `.or()` argument of the pipeline read, and asserts it carries `status.eq.open` and `and(status.eq.paid,prepared_at.is.null)`. It fails today because no `.or()` is sent at all.
- [x] 1.2 Give the fake clients in `billing.test.ts` an `.or()` that returns the query, so every existing read keeps working. Without it the whole suite throws `query.or is not a function`.
- [x] 1.3 Add the `.or(…)` to `readOrders` under `pipelineOnly`, built from the pipeline predicate. Leave the select shape, the outlet `.eq`, the ordering and the trailing `inPipeline` filter exactly as they are.
- [x] 1.4 SECTION GATE — `npm run typecheck`, `npm run lint`, and the billing adapter suite green.

## 2. The Orders A Pending Command Is About

- [x] 2.1 Write the failing test first: the server holds one order that is paid **and** prepared, an undelivered `void_order_payment` envelope names it, and `listOpenOrders` must return it reopened. With only the section 1 filter this fails — the row is never fetched, so the overlay's `if (current)` guard drops the unwind on the floor.
- [x] 2.2 Add the same test for `set_order_preparation(false)` against a paid-and-prepared order. Different command, same guard, same failure.
- [x] 2.3 Extend the `.or(…)` with `id.in.(…)` over the order ids named by `projectableEnvelopes`, which `readOrders` already reads before it builds the query. Derive the ids through one named helper rather than reaching into each command payload at the call site.
- [x] 2.4 Name `ENVELOPE_ID_QUERY_LIMIT` and fall back above it to the read this replaces — `status in ('open','paid')`, not an unfiltered one, so a tablet that deep offline pays yesterday's price rather than more than it. The reasoning goes beside the constant: a 414 breaks the pipeline outright, and correctness outranks the egress saving for a tablet that has been offline that long. Test both sides of the threshold.
- [x] 2.5 SECTION GATE — the billing adapter suite, plus `npm run test:rls` (the offline/outbox configs are where the projection is pinned end to end).

## 3. The Rail Still Reads The Same

- [x] 3.1 Run the counter surfaces against a production build in the browser: the pipeline lists what it listed before, cards carry their reference, age, customer, lines and total, and the console is clean.
- [x] 3.2 Confirm on the wire, not by assertion. Three links, each checked separately: a recording client pins the exact string the adapter passes to `.or()`; a supabase-js probe shows it encoded as `or=(…)` and ANDed with `outlet_id=eq.…`; and real PostgREST, given a four-state order matrix, returns exactly the rows the SQL predicate returns — and returns the paid-and-prepared one back once `id.in.(…)` names it.
- [x] 3.3 Walk the demo seam: `/demo` still walks all four roles, and the demo makes no request beyond the app origin.
- [x] 3.4 SECTION GATE — `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e` all green.

## 4. What The Next Reader Needs

- [x] 4.1 One line in `docs/ARCHITECTURE.md`: a list's read asks for the list, and a predicate the screen applies belongs in the query.
- [x] 4.2 `docs/OPERATIONS.md` — where egress is read in the Supabase dashboard and the per-endpoint log query that attributes it, so the next spike is diagnosed rather than rediscovered.
- [x] 4.3 File the `billing_event_device_labels` snapshot-column question under `openspec/todos/`, with the sizing that makes it not worth doing yet, so it is a decision on record rather than an oversight.
- [ ] 4.4 PHASE GATE — no roadmap row; this is a correction. The gate is the proposal's: the pipeline read asks only for the pipeline plus locally-touched orders, the rail lists exactly what it listed before including a paid-and-prepared order reopened by a pending unwind, and the `orders` request on the wire carries the narrowed filter.
