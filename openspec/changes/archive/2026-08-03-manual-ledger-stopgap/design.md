## Context

The counter is trading now, and nothing records it. Billing (#10), expenses and inventory (#11) and daily cash (#12) are all proposed or seeded, and the owner expects them within the month. August 2026 therefore falls in a gap: real revenue and real cash movements are happening, and the only record of them is memory.

Two questions have to be answerable at month end: what did each outlet earn and spend, and did the drawer balance each day. Both need facts captured daily. Neither can be reconstructed in September.

The constraint that shapes every decision below is that **this code is designed to be deleted.** It has a known lifespan of roughly four weeks. Its value is entirely in the rows it captures, not in the surface that captures them, so the surface should be as small and as separable as the requirements allow, and it must not entangle itself with the live features that will replace it.

The competing option, a spreadsheet with Google Forms, was rejected for one reason: it turns the eventual merge into a CSV import and mapping exercise, while rows written into Postgres now are already in the database the live features read.

## Goals / Non-Goals

**Goals:**

- Capture, per outlet per day, revenue split four ways, cash movements with reasons, a drawer count, and categorised expenses.
- Answer the daily cash question (expected against counted) and the monthly question (cash-basis profit, aggregator revenue net of commission).
- Keep every derived figure reproducible in integer paise, with commission rates snapshotted per day so a retrospective edit changes only the day it names.
- Confine the whole capability to one migration, one feature folder, one adapter, one registry entry and one route, so retirement is a deletion rather than an untangling.
- Grant no authority that outlives the change.

**Non-Goals:**

- Any part of #10, #11 or #12. No bills, no line items, no menu, no stock, no movement ledger, no day sign-off, no approvals.
- Consumption-basis profit, GST, deferred payment, offline entry, or manager-level entry.
- An audit trail. A wrong number is retyped; who typed it is not recorded, because this is a notebook and the only person with access is its owner.

## Decisions

### D1. Two purpose-built tables, not a reuse of the live ones and not one blob

Add `manual_ledger_days` (one row per outlet per business date) and `manual_ledger_expenses` (many rows per outlet per business date). Both carry `outlet_id`, an explicit `business_date date`, integer-paise money columns and integer basis-point commission columns.

Naming both tables with the `manual_ledger_` prefix makes the retirement query obvious and makes an accidental live reference easy to grep for.

Rejected alternatives:

- **Writing into the eventual `daily_cash_records` and `expenses` tables.** This is the tempting one and it is wrong. Those tables belong to #11 and #12, which have not been designed yet; guessing their shape now would either constrain those changes or produce rows they reject. It also collapses the authority boundary: an owner writing cash figures into the real cash record is exactly what `docs/LIMITATIONS.md` says the database must refuse.
- **One table with a JSON payload.** Loses every check constraint, so a negative drawer count or a blank reason becomes a UI-only rule, which the standing principles forbid.
- **One table with expenses as an array column.** Makes "expenses by category for a month" a JSON aggregation, and makes a single mistyped expense an update to a whole day's array.

### D2. Commission and opening cash are stored per day, not derived at read time

Each day row stores `zomato_commission_bp`, `swiggy_commission_bp` and `opening_cash_paise` as ordinary columns. The form offers defaults when it opens (commission from the most recent earlier row at that outlet, opening cash from the immediately preceding row's count) and the owner may overwrite either. Nothing recomputes them afterwards.

This is the decision that makes the owner's stated requirement work. Copy-forward-then-editable and effective-from-until-changed produce the same readings, but only the stored version lets a single day be corrected without touching its neighbours, and only the stored version keeps a chain of days from silently rewriting itself when an old count is fixed.

It is also the repo's existing rule about closed periods, applied here: a figure a human entered is evidence, and a figure recomputed on read is not. A derived opening cash would mean correcting day 3's count silently moves day 4 through day 31's expected cash and difference, which is precisely the compounding error this ledger exists to catch.

The cost is that the chain can break: day 8's stored opening may not equal day 7's count. The surface therefore surfaces that disagreement read-only and repairs nothing, which is the honest treatment. A repair would hide the very break it detected.

Rejected alternatives:

- **Deriving opening cash from the previous row.** Discussed above; silently propagates corrections and destroys the daily difference as a measurement.
- **A separate `commission_rates` table with `effective_from`.** Fewer rows, identical monthly output, but correcting one isolated day needs two rows inserted and is easy to get wrong. With a row per day already existing for other reasons, the column is free.

### D3. Every derived figure is computed in TypeScript; the database stores facts and constraints only

No view, no SQL function, no generated column, no trigger. Postgres holds the columns, the uniqueness constraint, the check constraints and the RLS policies. Expected cash, the difference, per-day net aggregator revenue, monthly totals by category and the profit estimate are all computed in one tested TypeScript module reading raw rows.

Two reasons. First, retirement: a migration that drops two tables is trivially reviewable, while dropping views and functions invites leaving one behind. Second, the rounding rule has to be identical wherever it runs, and there is exactly one implementation if there is exactly one language.

The commission rule is stated once and implemented once, in integer arithmetic:

```
commission_paise = (stated_paise * bp + 5000) / 10000     // integer division, round half up
net_paise        = stated_paise - commission_paise
```

Applied per day, then summed. Never applied to a month's total, because days may carry different rates.

### D4. Owner-only RLS through the existing helpers, and the isolation suite gains both tables

Both tables get `enable row level security` and one policy each for select, insert, update and delete, all predicated on `public.app_is_owner() and public.app_account_active()`. No outlet-role predicate appears anywhere, because no outlet role has any access to grant.

The tables carry `outlet_id`, so the isolation suite that enumerates tables from the catalog will find them and fail on any it cannot classify. They are classified as owner-only, and the added cases prove a Franchise Admin, Biller and Employee are each refused select and insert at an outlet where they hold a live assignment. That is a stronger claim than ordinary outlet isolation and needs to be written as its own case rather than inherited from the generic pattern.

### D5. One deletable feature folder, one registry entry in `live`, and a mock adapter because demo mode requires one

The derivation module and the screen land in `src/features/manual-ledger/`. One entry in `src/gates/registry.ts` in the `live` state, one route, one navigation item conditioned on the Super Admin role.

**Corrected during implementation (2026-08-04).** This decision originally put the adapter interface, the Supabase implementation, the mock implementation and the fixtures in the feature folder too. That is not where this repo keeps them: `docs/ARCHITECTURE.md` states that every adapter interface lives in `src/data-access/adapters.ts`, mocks and fixtures in `src/data-access/mock/`, and real adapters in `src/data-access/supabase-adapters/`. It also has to be that way for this surface to work at all, because `DataAdapters` is what `useAdapters()` returns and both factories construct, so the interface has to be visible to `src/data-access/`. Following the original wording would have made the data-access layer import upward from the feature layer — a layering inversion that would have outlived the stopgap that introduced it, which is the one cost this whole design is trying to avoid.

Retirement is a deletion either way, and the count is not much larger: one section of `adapters.ts`, one line of `DataAdapters`, one line in each of the two factories, `mock/manual-ledger.ts`, `mock/fixtures/manual-ledger.ts`, two slices of `mock/store.ts`, `supabase-adapters/manual-ledger.ts`, the feature folder, one registry entry, one route, and two tables. Every one of them is greppable by `manualLedger` or `manual_ledger`, which is what the naming prefix was chosen for.

The mock adapter is not optional. The `demo-mode` capability requires every surface to read through a typed adapter with mock and real implementations, requires every fixture to be typed from generated schema types, and the four-role demo walkthrough is a standing gate on every change. The mock stays thin: a few days of fabricated figures at one outlet, enough that the surface renders coherently and the derivation module is exercised.

Rejected alternative: shipping real-only and leaving the surface absent in demo mode. It would contradict the registry contract, and the walkthrough gate would have to be argued around rather than passed.

### D6. Editing is an upsert on `(outlet_id, business_date)`, with no correction history

The day form writes with `on conflict (outlet_id, business_date) do update`. An expense row is inserted, updated or deleted outright. Nothing records who changed what or when, beyond the ordinary `created_at` / `updated_at`.

This is a deliberate omission and the clearest illustration of the notebook rule. Audited corrections are a real pattern in this repo (#26, and the attendance time corrections archived today), and they exist because attendance rows are contested evidence about a person's pay read by several roles. A manual ledger has exactly one reader and one writer, and giving it a correction workflow would cost more than the month of data it protects.

### D7. The retirement obligation is written into #12, because code cannot hold it

Nothing in the type system can force a future change to migrate these rows before dropping the tables. So the obligation is recorded in three places that a future session will actually read: a requirement in this capability's spec, a line in `docs/LIMITATIONS.md` describing the stopgap and its exit, and a task added to `openspec/changes/daily-cash-live/proposal.md` so #12 inherits it as scope rather than discovering it.

The migration itself is the straightforward part: day rows become cash records and expense rows become expenses, both already carrying outlet, business date, integer paise and category. Writing it is #12's job, when the target schema exists.

### D8. Reuse the existing `expense_category` enum unchanged, and record no capital spending at all

The shared `public.expense_category` enum already exists with `raw_materials`, `salaries`, `rent`, `electricity`, `packaging`, `maintenance`, `marketing` and `other`. The manual ledger reuses it unchanged, adds no value to it, and adds no marker of its own.

Reusing the enum makes the retirement mapping one-to-one: a manual ledger expense row already carries the exact category type the live `expenses` table expects, so #12's carry-over needs no translation table and no lossy guess. It also means this change introduces no new type to drop later. The enum already satisfies the spec's prohibition, since it contains no value for aggregator commission, cash banked or an owner drawing.

**Capital purchases are out of scope entirely** (owner-confirmed 2026-08-04), which is what removes the need for a marker. An earlier draft carried an `is_capital` boolean so a fridge could be excluded from a month's profit; with capital spending simply not recorded here, the boolean would always be false and the exclusion logic would be dead code.

Two consequences, both deliberate:

- **The monthly figure is an operating estimate**, not a full account of money out. That is the more useful monthly number anyway (it answers whether trading covered running costs), but the surface must say so, which is why the spec requires the words rather than leaving the reader to assume.
- **A capital purchase paid from the drawer is recorded as cash taken out with its reason**, not as an expense. This is the load-bearing half of the decision. Without it, a ₹40,000 fridge bought with drawer cash makes that day read ₹40,000 short and the daily cash check, one of the two reasons this ledger exists, silently breaks on the first large purchase. The `cash_out` column and its reason already exist, so this costs no schema and is purely a stated rule plus documentation.

Rejected alternative: keeping the flag "just in case". A field that is always false is worse than no field, because it implies the month's profit accounts for capital spending when nothing in the ledger does.

### D9. The month reads one outlet at a time, through the existing outlet switcher

The month view shows a single outlet, reached through the outlet switcher already used by every other outlet-scoped surface, and remembered per person per device as `#28` established. No side-by-side comparison of the two outlets is built.

Owner-confirmed on 2026-08-04. A combined reading is genuinely more useful at month end and would cost roughly one extra column, but comparing outlets is the owner console's job (#13), and building a small version of it inside a surface designed to be deleted produces two screens answering the same question, one of which is the throwaway. The switcher is one tap, and #13 is the change that should own the comparison.

Rejected alternative: two columns in this surface. Cheap to add, and precisely the first step by which a notebook becomes a feature nobody wants to remove.

### D10. An expense description is required, not optional

Every expense row carries a mandatory free-text description of what the money was spent on, refused blank or whitespace-only by a database check constraint rather than by the form, following `blank-is-not-a-value` (#19). It is rendered in the day's expense list and in the month's expenses by category.

Owner-confirmed on 2026-08-04, and it corrects an earlier draft that made the field optional. A category and an amount identify a purchase for about a week; `raw_materials ₹2,400` is unidentifiable by month end, and an expense nobody can identify is not a record, which defeats the only purpose this ledger has. The friction is a few words per entry against a month of auditable rows.

The day row's note stays optional, because it exists to explain a cash difference and most days have none to explain.

### D11. A recorded day collapses to a reading; the inputs go behind an Edit button

The entry card renders as a form only while the day is unrecorded or deliberately being corrected. Once a day row exists, that card becomes a dense read-only card in the same idiom as the drawer and month readings, with Edit and Cancel as the two controls. Editing reseeds every field from the stored row; cancelling discards the draft and writes nothing.

Owner-confirmed on 2026-08-04, after seeing the drawer reading. Twelve inputs holding figures nobody intends to retype are twelve chances to change one by accident, and on a 390px screen they push the two readings this surface exists for below the fold — the entry cost was optimised and the reading cost was not. The live-typing property in D3 is untouched: the difference still appears as figures are typed, in exactly the state where figures are being typed.

Two consequences worth stating, because they are what makes the read state complete rather than decorative:

- The recorded card carries the **revenue side only** — UPI and each aggregator's stated revenue, commission rate and net. The drawer card below already holds every cash figure, and repeating them would put two answers to one question a thumb's width apart.
- A **cash movement's reason moves onto the drawer reading**, beside the amount it explains. It was previously legible only in the input that captured it, which no longer stands open; `₹2,000 brought in` with no reason is unaccountable by month end.

Rejected alternative: leaving the form open and merely collapsing it behind a disclosure. The fields still exist, still hold stale drafts, and a disclosure that opens onto twelve inputs is the same screen with an extra tap.

### D12. The entry form is laid out for a phone: paired fields, per-aggregator blocks, and explanations on request

Money fields sit two to a row with the unit inside the box; each aggregator is one outlined block holding its stated figure, its rate for the day, and the net computed as those two are typed; the explanatory paragraphs move behind a control beside each section title; labels shorten to one or two words.

Owner-requested on 2026-08-04. The first build optimised for saying everything and produced a four-screen form for figures that are two to six digits long — a full-width input per field, and more height in paragraphs than in fields. Three things carry the redesign:

- **The per-aggregator block is the substantive change, not the cosmetic one.** Splitting revenue and commission into two groups put each rate three fields from the figure it reduces, and left the net — the only one of the three that is money actually received — computed nowhere on the day view at all. It is now shown as it is typed, through `netAggregatorPaise`, so the day and the month cannot round differently.
- **The explanations are read once and the form is opened nightly.** They stay one tap from the field they govern, in a panel that is a real button (a hover tooltip is unreachable on the device this is used on), reports `aria-expanded`, closes on Escape or a tap outside, and is absolutely positioned so opening it never moves the field somebody was about to type into.
- **Shortening a visible label does not shorten the accessible one.** `As stated` appears twice on screen and the outlined block that disambiguates them says nothing to a screen reader, so the hidden half of each label carries the rest: "As stated for Zomato, in rupees".

Two constraints held throughout. Field height drops from `--size-control` to `--size-control-phone` — this surface is the manager-phone case — but **font size is untouched**, because the base layer forces 16px on inputs to stop iOS Safari zooming the viewport on focus, and a `text-sm` on the input silently defeated it. And the one hint that stays permanently visible is the opening-cash line, because on an outlet's first day it is the reason two required fields arrive empty.

Rejected alternative: a denser grid still, three or four fields to a row. At 390px that is a 90px field holding a five-digit rupee figure, and labels that truncate to `Count…`.

### D13. The controls above the form borrow the attendance idioms rather than inventing three of their own

The period is a stepper in the same bordered strip the attendance range picker uses; the day inside it is a button reading `Today` or `03 Aug 2026`, which opens the platform calendar and cannot be typed into; the view toggle is a two-segment control the same width; the outlet switcher becomes a chip per outlet, which makes the shared switcher one control in two modes rather than a dropdown here and chips on attendance. Ledger also moves ahead of People in the owner's navigation.

Owner-requested on 2026-08-04, in three passes, and each pass removed something rather than adding it:

- **The day was a 35-option dropdown.** Stepping back one day is the nightly case and the arrows own it; going to a specific date is the month-end case, and reading thirty-five options to find one is not how anybody looks for a date. A bare `input type="date"` replaced it and was wrong in turn — it prints the browser's locale format (`03-08-2026`) where the app writes `03 Aug 2026`, it carries a calendar glyph beside two arrows that already say what the control does, and it invites typing, which on a control that reloads a day per change is a reload per keystroke. So the visible control is a button and the native input sits behind it, unfocusable and `aria-hidden`, purely to own `showPicker()`.
- **The month keeps a label, not a field.** `input type="month"` is a text box in Firefox, and there is nothing to type that two taps do not reach. This is exactly what the attendance picker already does, down to the `August 2026` wording.
- **The outlet dropdown never looked like one control with its caption.** A select's options are floored at 16px so a phone does not zoom on focus, so a 12px "Outlet" beside it was always going to mismatch — and the caption was carrying nothing the outlet's own name did not already say. Chips fix the mismatch by deleting one of the two mismatched things, and the "current choice cannot be cleared" rule the multi-outlet chips already had turns out to be exactly right for a single choice: the outlet you are on is the one you cannot press.

`readMonth`'s `daysRecorded` also stops being part of a heading: `What came in, over 2 days` read as a sentence and named the section differently from the day card a tap away. Both are now `Sales breakdown`, the month's count sits beside it as a fact rather than in its name, and `What went out` follows to `Expenses breakdown`.

The cost is honest: the shared switcher changed shape for every outlet-scoped surface, which is fifteen assertions across six suites. They now go through one helper (`src/test/outlet-scope.ts`), so the next change to that control is not a fifteen-file edit.

## Risks / Trade-offs

- **This becomes permanent because the live features slip.** → The rows remain correct and useful regardless, since they are facts rather than a workflow. The exposure is that an owner-writes-cash surface lives longer than intended, which is why the authority boundary is stated in the spec, in the docs and in #12's scope rather than resting on the schedule holding.

- **The owner types both outlets nightly and stops doing it by week two.** → Not solvable in code, and the honest mitigation is that the surface asks for as little as possible: one short form per outlet per day, defaults pre-filled from yesterday, and expenses entered as they happen rather than reconstructed at close.

- **A broken opening-cash chain is reported but never fixed, and accumulates.** → Accepted and visible by design (D2). The alternative silently launders the error into every later day. The signal makes the break a decision rather than a surprise.

- **Half of #11 or #12 gets built here.** → The Non-goals in the proposal and the notebook framing in D6 are the guard, and the gate includes no workflow behaviour to tempt it. Any urge to add sign-off, approval or badges is #12 asking to start early.

- **A live surface quietly reads a `manual_ledger_` table.** → The spec forbids it and the prefix makes it greppable. The stronger protection is that no live feature has any reason to: this data answers questions the live features will answer from their own rows.

- **Commission rounding disagrees between the day view and the month view.** → One implementation in one module, applied per day in both places, unit-tested on a month of mixed rates.

## Migration Plan

1. One forward-only migration creating both tables with constraints and RLS policies. Nothing existing is altered, so there is no compatibility window with the currently published frontend, and the migration is safe under the schema-before-frontend ordering.
2. Regenerate database types and prove the snapshot is current.
3. Ship the feature folder, registry entry, route and navigation item.
4. Seed nothing in production. The owner enters the first day, which is also the only day requiring opening cash and commission rates to be typed rather than inherited.

**Rollback**: the surface can be withdrawn by flipping its registry entry to `hidden`, which removes the route and navigation without touching data. Schema rollback is forward-only as always, and dropping these tables is only correct after #12 has carried the rows across.

## Open Questions

None. The expense category list was settled against the existing shared enum (D8), the month view reads one outlet at a time (D9), and the expense description is required (D10). Deferred payment, GST, consumption-basis profit and manager-level entry are all owner-confirmed out of scope and recorded as Non-goals in the proposal rather than as open questions.
