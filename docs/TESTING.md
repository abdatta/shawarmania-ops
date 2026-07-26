# Testing

> Describes the intended strategy. No test harness exists yet; it lands with `project-foundations`.

Testing effort follows risk, and in this app risk is concentrated in three places: **money arithmetic**, **tenancy isolation**, and **the offline path**. Those get disproportionate coverage. A settings form does not.

## The layers

| Layer | Tool | Covers |
|---|---|---|
| Domain unit tests | Vitest | Money maths, expected cash, business-date resolution, P&L, geofence distance |
| Database policy tests | pgTAP or SQL fixtures | Row-Level Security isolation on every outlet-scoped table |
| Component tests | Vitest + Testing Library | Interactive components, especially the billing surface |
| End-to-end | Playwright | The critical paths, including offline billing |

## The three suites that matter

### 1. Money arithmetic

Pure functions over integer paise, so they are trivially testable and there is no excuse for gaps.

- Bill totals: `total = subtotal − discount + tax`, across quantities and rounding edges.
- Expected closing cash: `opening + cash_sales − cash_expenses − cash_withdrawn`, including the cases that produce a negative expected balance.
- Cash difference sign convention — short is negative, over is positive. Assert it explicitly; it is exactly the kind of thing that silently inverts.
- P&L in both modes, with an explicit test that the two do **not** double-count raw materials.
- Formatting: paise → Indian-grouped rupees (`₹1,23,456`), including zero and negative values.

**No floating point anywhere.** A test that asserts a money value equals a float is itself a bug.

### 2. Tenancy isolation

The most important suite in the repo, because tenancy bugs are silent — nothing errors, a query just quietly returns more than it should.

For **every** outlet-scoped table, with sessions for each role:

- A Franchise Admin, Biller, or Employee scoped to outlet A **cannot read** outlet B's rows.
- The same session **cannot write** outlet B's rows, including by supplying B's `outlet_id` directly.
- A Super Admin **can** read across outlets.
- A revoked counter device **cannot** read or write anything.
- A deactivated account **cannot** read or write anything, without waiting for token expiry.
- An Employee can read **only their own** attendance rows.

**A new outlet-scoped table without a case in this suite is an incomplete change.** The suite should be structured so that adding a table and forgetting the test is caught — enumerate the tables from the schema and fail on any that is uncovered, rather than relying on someone remembering.

### 3. The offline path

End-to-end, with the network genuinely disabled rather than mocked away.

- Go offline, ring up several bills, come back online → **exactly** that many bills land, with no duplicates.
- Reload the page mid-queue → the outbox survives and still drains.
- Force a duplicate submission of the same client UUID → one row.
- Bill numbers are assigned by the server, are sequential per outlet, and never collide across two devices.
- A bill settled at 00:20, synced at 09:00, carries the **previous** business date.
- A malformed bill is quarantined and surfaced, not silently dropped.

## Verification before calling a change done

- `npm test` green, `npm run lint` clean, `npm run typecheck` clean.
- **Tenancy-touching changes**: the isolation suite passes, including new cases for any new table.
- **Billing or offline changes**: the offline E2E path passes.
- **UI changes**: run the app and look at it — phone viewport and tablet viewport, light and dark themes.
- **Theme changes**: the contrast validator passes. AA is the floor.
- **Schema changes**: migrations apply cleanly to a fresh database *and* to a copy with existing data.

## Fixtures

- **Never use real customer or employee data.** Seed data is synthetic: invented names, obviously fake phone numbers.
- The seed set covers the real menu and both real outlets, because those are business facts rather than personal data.
- Seeds must produce at least two outlets. A single-outlet fixture set cannot catch isolation bugs, which is the whole point of having them.

## Honesty

If a gate was not run, say so. A change reported as verified when the offline path was never exercised is worse than one reported as unverified — it spends trust that has to be repaid later, usually at a counter with a customer waiting.
