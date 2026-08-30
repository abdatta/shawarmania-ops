# Design: The Demo Counter Is The Real Counter

## Context

Two facts about the code decide most of this design, and both were verified
against the tree at `7d03ec1`.

**The tablet is its own branch.** `/counter` is resolved by `CounterRoot`
(`src/auth/counter-root.tsx`), which builds Supabase adapters, provides a
`CounterDeviceSession` through `CounterDeviceContext`, mounts a
`CounterDeliveryRuntime` and then renders `CounterShell`
(`src/features/counter/counter-shell.tsx`). That shell is the whole tablet: a
header with the device label, `SyncIndicator`, the "Open since … Ended from the
operator's own phone, or at this outlet's cutover" line, **Hand over** and
**Finish day**; then `BillingCounter` and `CounterExpenses` stacked. When there
is no shift, or during a handover, it renders `ShiftRequestScreen` instead. It
reads `useCounterDevice()`, which throws outside that tree.

**The demo biller is a different shell entirely.** `DemoRoot`
(`src/demo/demo-root.tsx:103`) picks `src/shell/counter-shell.tsx` for the biller
persona — tab navigation derived from the gate registry, an outlet name, a theme
toggle, `ShiftStatus` and `SyncIndicator` — and the role router then mounts
`BillingCounter` at `billing` and the expense list at `ledger/expenses` as
separate pages. Nothing in that tree can reach `Hand over`, `Finish day` or
`ShiftRequestScreen`, because nothing in it mounts the file they live in.

The demo also holds the counter's central fact twice. `DemoStore.shifts`
(`src/data-access/mock/store.ts:241`) seeds `DEMO_OPEN_SHIFT_ID` open for Demo
Biller at Kalyani and is what billing attributes bills to and what
`readDeviceOperations` reads. `DemoCounter.shifts`
(`src/data-access/mock/counter.ts:105`) seeds `[]` and is what `listLiveShifts`
returns. `confirmShift` writes only the second; `endShift` deletes only from the
second. They have never agreed and nothing makes them.

Finally, the demo's structural safety rail matters here: `demo-safety` asserts
the demo tree never imports the Supabase client or the real adapters, and eslint
enforces the boundary. Any route to mounting the tablet shell in demo must not
weaken it.

## Decisions

### D1. The demo hosts the tablet shell itself; it never reaches for `CounterRoot`

A new demo-owned host renders `CounterDeviceContext.Provider` around the real
`CounterShell`, with a `CounterDeviceSession` it builds from the demo store. It
lives in the demo tree and imports only mock-side modules.

Reusing `CounterRoot` was rejected outright: it imports `createSupabaseAdapters`
and `useRealSessionContext`, so importing it into the demo tree would break the
`demo-safety` boundary and eslint on the same line. The property that makes the
demo safe is that reaching the backend is *unrepresentable*, not merely unused,
and that property is worth more than the handful of lines the host duplicates.

What the host duplicates is small and deliberately so: a context provider, a
delivery runtime mount, and a `shift`/`onShiftChanged` pair. Everything a viewer
actually sees comes from `CounterShell`, which is the same file production runs.
That is the whole point of the change: the demo cannot drift from the tablet
again, because there is no second copy left to drift.

### D2. The demo moves onto `counter_shifts` and stops modelling the retired `shifts` table

**This decision was reversed during implementation.** The first version of this
design assumed the demo held one fact twice and told the implementer to keep
`DemoStore.shifts` and delete `DemoCounter.shifts`. That was backwards, and the
evidence is unambiguous.

Production has two shift tables on purpose, and only one of them is alive.
`public.shifts` was created on 2026-07-26, before tablets were enrolled devices.
`public.counter_shifts` was created on 2026-08-10 to carry what the old shape
could not: `expires_at`, so a shift ends at the outlet's cutover without anybody
acting, and `ended_reason`, so `operator`, `device_removed` and (since #50)
`day_finished` are distinguishable. On 2026-08-11 the billing transaction
contract made `bills.shift_id` nullable and recorded that it "points at the
retired pre-tablet shift model and remains only for synthetic demo history. New
command bills use counter_shift_id exclusively."

Three checks confirm `public.shifts` is dead in the running app. No live adapter
references it — billing reads `bills`, `orders`, `billing_commands`,
`effective_bill_payments` and `assignments`, and otherwise calls RPCs.
`openShift` is `notLive`, and its only caller is the `hidden` PIN surface. Every
counter write goes through the command RPC, which uses `counter_shift_id`.

The demo, meanwhile, sets `counter_shift_id: null` on every bill it makes and
attributes through `shift_id`. Worse, it writes `shifts` ids into
`created_shift_id`, `paid_shift_id` and `cancelled_shift_id` on billing commands,
and in production **those columns are `references public.counter_shifts (id)`**.
The demo is not merely modelling a retired shape; it is storing values that could
not exist in production, and TypeScript cannot catch it because both sides are
uuid strings.

So the demo moves to `counter_shifts` and stops carrying `shifts` at all. Every
demo bill is within four days of today, so none of them is genuinely legacy
history; there is nothing for the old table to hold.

The mechanical shape of the move: `person_id` replaces `biller_profile_id`,
`device_id` replaces `counter_device_id`, `ended_at` plus `ended_reason` replace
`closed_at`, and `expires_at` arrives. `listLiveShifts`, `readDeviceOperations`,
the demo tablet session and billing attribution all read the one table.
`confirmShift` closes any open row for that device and inserts a new one for the
confirming persona; `endShift` closes it with `operator`; Finish day closes it
with `day_finished`.

The rejected alternative was joining the two representations and leaving demo
billing on the legacy table. It was cheaper and it would have fixed every visible
symptom, but it preserves a mock that contradicts the live schema — the same
blind spot that let the two expense tables diverge — and it cannot represent
`expires_at` or `ended_reason` at all, so a demo built on it can never show a
shift expiring at the cutover or Finish day recording `day_finished`. Migrating
makes more of #50 demonstrable, not less.

**Out of scope, and deliberately:** dropping `public.shifts` from the database.
Real bills from before 2026-08-10 still hang their attribution off it, so
removing it is a data decision rather than a cleanup, and it belongs in its own
change with its own answer about legacy bill attribution.

Two related repairs come with the move. `confirmShift` currently derives its
business date from `new Date().toISOString().slice(0, 10)`; it must resolve
through the outlet's `business_day_cutover` like every other date in the store,
or a demo opened after midnight opens a shift on the wrong trading day while
every other surface disagrees. And `openShiftRow()`
(`src/data-access/mock/billing.ts:208`) returns *any* open shift in the store,
which is correct only while exactly one exists; with a lifecycle that opens and
closes shifts during a walkthrough it must be scoped to the counter's device and
outlet.

### D2a. The migration is bounded, and it fails loudly

Recorded because the first version of this design called the move risky without
having measured it. There are 72 shift references across the mock: 57 in
`mock/billing.ts`, 10 in `mock/store.ts`, 5 in `mock/counter.ts`. The bulk is
mechanical renaming in one file.

The guards already exist and are the loud kind: `mock/billing.test.ts` (681
lines), `mock/daily-cash.test.ts`, `mock/insights.test.ts`, `mock/store.test.ts`,
`mock/alerts.test.ts`, `mock/manual-ledger.test.ts`,
`mock/effective-expenses.test.ts`, and the demo browser suites. Attribution
landing on the wrong person, or a figure ceasing to agree across surfaces, breaks
assertions that are already written. Note that `mock/store-drift.test.ts` guards
inventory quantities only, so it is not the money invariant's guard; the billing
and cash suites are.

### D3. The demo banner sits above the tablet, not inside it

The tablet has no chrome to hang the banner from, and it must not grow any:
"there is no navigation out of it, no account menu and no sign-out" is the shape
of the production screen, not an omission. So the demo host renders the banner
strip above `CounterShell` and lets the tablet own everything below it.

The role switcher lives in that banner, so it survives, and it has to: switching
from the tablet to a phone to approve a shift request is the demo's best scene
and the reason the handshake is worth demonstrating at all.

Putting the banner inside the tablet header was rejected because it would mean
editing the production component to carry a demo concern, which is the exact
coupling this change exists to remove.

### D4. The Biller's navigation entries and unlinked routes retire

With the tablet shell mounted, `counter-home` and `counter-expenses` no longer
have anywhere to draw a tab, and `/demo/biller/billing`, `/my-shift`,
`/open-orders` and `/ledger/expenses` are no longer reachable by any control.
The Biller's navigation entries go, and the gate registry records why, in the
registry's own voice, beside the entries that already explain their own absence.

`counter-billing`, `counter-my-shift` and `counter-open-orders` keep their
`live` state and their routes. They are already deliberately navigation-less, and
`BillingPanel` inside the tablet shell still asks
`isRenderable(getSurface('counter-billing').state, 'real')` before mounting the
till. The gate remains the single switch; only the tabs go.

`counter-shift-unlock` stays `hidden`. The legacy PIN surface is not what this
change brings back — the tablet-to-phone handshake is — and
`e2e/counter.spec.ts:540` should keep proving the PIN screen is gone while
proving the request screen has arrived.

### D5. Promote an existing bill to carry the attribution exception; do not invent one

The demo's standing invariant is that every figure on one screen is the rows
behind another, so a new bill would have to be threaded through the drawer, the
cash surface, the owner console and the day's takings, and any miss shows up as
two screens disagreeing about money. Promoting a bill that is already in all of
those keeps every total identical and changes only how the bill is labelled.

The bill chosen must be one already attributed to the Kalyani shift on today's
business date, and it must be one whose *time* can honestly sit after a remote
departure. Implementation sets `recorded_after_shift_end` true and
`attribution_shift_ended_at` to an instant before that bill's `paid_at` and after
the shift opened, and records in the seed comment which bill was promoted and
why. Nothing else about it moves: not its amount, not its payments, not its
number.

Because the demo's Kalyani shift is open and the flag describes a *departed*
shift, the honest arrangement is the one production produces: the flag belongs to
a bill whose shift has since ended. Implementation resolves this against the
seeded scenario and states the choice in the change's own comment rather than
inventing a second open shift to hang it on.

### D6. Finishing the day in demo lands on the request screen, and that is the point

Once Finish day works, a walkthrough can close the demo's shift, and the tablet
then shows the no-shift resting state — the screen that has been undemonstrable
since the tablet branch existed. That is a feature: it is the state a real tablet
spends every night in, and the request screen is how the next morning starts.
**Start again** in the banner puts the seeded open shift back, which is what it
already promises.

## Risks / Trade-offs

- **The walkthrough script changes shape.** The Biller section of
  `docs/DEMO_MODE.md` currently describes tabs and a landing page. It has to be
  rewritten around one screen with a header, and the new scenes (Finish day,
  Leave counter, the attribution review) have to be placed in the twelve minutes
  the walkthrough claims. Mitigation: the docs update is a task, not a footnote,
  and the two false sentences are fixed by construction rather than deleted.
- **E2E churn.** `e2e/counter.spec.ts` holds 22 tests against the demo biller,
  and the assertions at `:496-497` and `:543` are about absent navigation, which
  this change makes true for a different reason. Mitigation: those assertions are
  rewritten to say what they now mean rather than deleted, and the suite gains
  coverage of the states the demo could not previously reach.
- **The demo gains a way to reach a state the seeds do not describe.** A
  walkthrough can now end the shift, hand over to a persona and open a shift
  under somebody else, so the store can hold shift rows the fixtures never
  wrote. Mitigation: this is exactly the production behaviour, the unified
  lifecycle writes rows in the store's own shape, and reset restores the
  scenario.
- **`openShiftRow()` scoping is a behaviour change inside the mock.** Narrowing
  it to the device and outlet is correct but touches every mock billing path.
  Mitigation: the mock's existing unit suite
  (`src/data-access/mock/billing.test.ts`) runs against it, and the change adds
  cases for a second outlet's shift being ignored.

## Migration Plan

None. No migration, no policy, no RPC and no live adapter is touched. The change
is confined to the demo tree, the mock adapters, the demo store, the gate
registry's Biller entries, and the tests and docs that describe them.

## Open Questions

- ~~Which seeded Kalyani bill carries the attribution exception, and whether the
  scenario needs a closed second shift for it to hang from honestly.~~
  **Resolved in implementation.** It needed the second shift, and the demo
  already had the operator for it: `DEMO_MORNING_BILLER_ID` existed as an order
  creator with no shift of their own. They now hold a Kalyani shift from 07:00
  that ended at 11:00 with reason `operator`, which is the same instant Priya's
  opens — a handover, in the data. The 11:45 cash bill (₹417, the day's first
  under Priya's shift until now) carries the flag: it was already counted by the
  drawer, cash and owner console, so promoting it moved no money, and it is
  attributed to the departed operator rather than to Priya, which is the
  inheritance the contract forbids.
- ~~Whether the demo host should mount a delivery runtime at all.~~
  **Resolved in implementation: yes.** The tablet's own `SyncIndicator`
  subscribes while a shift is live, so on that path the runtime is redundant. It
  earns its place on the *no-shift* screen, which renders `ShiftRequestScreen`
  and no indicator at all — the state a walkthrough now reaches by finishing the
  day. Without it the seeded unsent bill would sit frozen there rather than
  draining, which is the opposite of what device-level delivery means.
