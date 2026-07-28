# Design: ui-billing-counter

## Context

The counter screen is what the business *is*: a tablet on a shelf, a queue in front of it, and a biller who must go from a spoken order to a cleared screen in about two taps. It is the hardest UI in the product and the one that benefits most from being built against mocks, because speed at a counter is a matter of layout, target size and tap count — all three iterate far faster with fake data behind them.

This change builds the whole Biller experience behind the `demo` gate and wires none of it to a backend. `counter-devices-and-offline` (#9) brings the real outbox and device enrolment; `billing-live` (#10) swaps the adapter, promotes the gate, and — per the roadmap's standing principle — **must not have to redesign anything here**.

What it inherits and does not revisit:

- **The write contract already exists as a spec.** `openspec/specs/counter-billing/spec.md` says bill numbers are server-assigned and per-outlet sequential, settled bills are append-only, line items snapshot name and unit price, counter writes are idempotent by client UUID, and the business date is validated against the outlet's cutover. The mock in this change must behave the way that spec says the database will, or the demo teaches a product this one is not.
- **The schema exists** — `bills`, `bill_items`, `shifts`, `bill_number_counters`, `customers` are all in the generated types, and every fixture is typed from them.
- **The menu belongs to `ui-outlet-operations` (#7).** `menu_items` is that change's table and its `MenuAdapter` is that change's seam. The grid here consumes it. This is the one real ordering constraint between two changes the roadmap calls parallel: **#7's menu seam lands first**, then this change in full. See that change's design, Context.
- **The counter never blocks.** Settling is not awaited. That rule is older than this screen and outranks every convenience in it.
- **Money is integer paise.** Totals are computed by a pure domain function, never inline in a component.

## Goals / Non-Goals

**Goals:**

- A full order rung and settled in demo mode on a tablet viewport, in two taps from a complete order to a cleared screen.
- The **whole menu visible without scrolling** at tablet size — asserted by a test, not by eye.
- Customer name and phone that are genuinely optional and can never block a settle.
- All six payment methods, with cash visually distinct because it alone touches the drawer.
- Shift unlock and handover, so attribution exists before a bill is rung.
- The sync indicator in all three of its states — synced, N pending, and the escalated warning — reviewable before the queue behind it exists.
- A settle that can be undone in the seconds before the next customer, **without introducing bill editing**.

**Non-Goals:**

- No real bills, no durable outbox, no server bill numbers — #9 and #10. `src/outbox/` stays empty; this change's queue is a mock adapter's internal state and says so.
- Record-only: no printing, no GST breakup, no digital share. The schema already carries `pricing_mode` and `tax_paise` so none of those needs a migration later; they are `no_tax` and `0` here.
- **No bill history and no void** — that ships with #10, which is why `counter-my-shift` stays `hidden`.
- No discounts. `discount_paise` exists and is `0`; a discount is a pricing decision the business has not made.
- No attendance kiosk (#9), no device enrolment (#9).

## Decisions

### D1 — The tablet's home *is* the counter

`counter-home` is `live` and shows a placeholder saying billing lands here next. Rather than leaving a biller with two tabs that both mean "the counter", `counter-home` renders a redirect to `billing` **when the gate registry says the billing surface is renderable for this session**, and the placeholder otherwise. `counter-billing` therefore loses its navigation entry: it is the home destination, not a sibling of it.

This is a gate branch, not a mode branch — exactly what the registry is for, and the same question `GatedSurface` already asks. When #10 promotes billing to `live`, the redirect starts applying to real billers with no further edit, which is the end state anyway.

### D2 — A shift is required before a bill can be rung, and the demo starts with one open

`bills.shift_id` is `not null`: a bill without a shift is unrepresentable, so the screen must not pretend otherwise. With no open shift the counter shows what to do and a way to the Shift surface, rather than a disabled Settle button.

The demo store nevertheless **starts with a shift already open** for the demo biller, so the gate — ring and settle a full order — is one tap from landing. The shift surface stays fully walkable: close the shift, hand over, reopen.

**PIN.** Billers unlock a shift with a short PIN which "selects attribution — it is not the security boundary" (`AGENTS.md`); the real thing arrives with #9. The mock holds a PIN per demo biller and **refuses a wrong one with one identical sentence**, because a demo whose PIN pad accepts anything teaches a product where it does. The demo PIN is a fixture fact and is recorded in `docs/DEMO_MODE.md`, the way the demo personas' names are.

*Alternative rejected*: no PIN at all until #9. It would leave the handover screen — explicitly in scope — with nothing to demonstrate, and #9 would then be designing a screen rather than swapping an adapter.

### D3 — Quantity is adjusted in the bill panel; the tile is one large target that only adds

The proposal asks this to be judged against one-handed use. Decision: **the tile adds and only adds**, showing the current count as a badge; `−` / count / `+` live on the line in the bill panel.

Reasoning: a `−`/`+` pair on the tile cuts the add target roughly in half at exactly the moment speed matters, and a mis-tap then *decrements* an order instead of missing it — a silent wrong bill rather than a visible non-event. The bill panel is also on the side a tablet is held from, so corrections land under the thumb, and corrections are the rarer action for a one-to-three item order.

*Alternative rejected*: long-press on the tile for quantity. Invisible, slow, and unusable with wet hands.

### D4 — The customer field is free text now, shaped so select-from-history can be added without relayout

The brief says "enter **or select** the customer name" and `customers` exists for it. v1 ships **free text only**: two optional inputs, name and phone, below the total and above the payment methods.

Why not select-from-history yet: pulling customer names and phone numbers onto a shared counter tablet puts PII on a device several people use, and `docs/SECURITY_AND_PRIVACY.md` treats phone numbers as PII to be collected narrowly. Whether the counter may read the customer list is a decision for the change that makes billing real (#10), not one to make against fixtures.

The name input is therefore given the shape a combobox needs — a labelled text input with `autoComplete="off"`, its own row, and room for a suggestion list beneath it — so adding suggestions later is a behaviour change and not a layout change.

### D5 — The provisional reference is deliberately unlike a bill number

Bill numbers are the server's, assigned at insert, per-outlet sequential. Until a queued bill syncs it has none, and showing a plausible-looking number would be the worst possible lie to tell a biller or a customer.

So a queued bill is identified as **`Queued · A3F9`** — the word, a separator, and four Crockford-base32 characters taken from the client UUID — and the confirmation says the number is assigned when it syncs. Once the mock queue "sends" it, the same bill gains `Bill 143`. Nothing anywhere formats a provisional reference as a bare integer.

### D6 — Undo cancels a queued write; it never edits a bill

The proposal asks how a settle is undone in the seconds before the next customer, without introducing bill editing. Decision: **the settle enqueues, and undo removes it from the queue while it is still unsent.**

Concretely: settling clears the bill panel immediately and shows a confirmation strip carrying the total, the provisional reference, and **Undo**. The queued bill is held for `UNDO_WINDOW_MS` (6 s) before it is sent; Undo within that window cancels the queue entry and restores the order to the panel. After it is sent — or the strip auto-clears — there is no undo, and the only correction is a void, which is #10's.

This is coherent with the offline model rather than a special case bolted onto it: an unsent queue entry is not yet a bill, so cancelling it edits nothing and violates nothing. It also degrades correctly offline, where nothing sends and the window is the only thing that closes.

*Alternative rejected*: a confirm-before-settle dialog. It adds a tap to every single bill to protect against a rare mistake — the wrong trade at a counter.

*Alternative rejected*: allowing an edit of the just-settled bill. That is bill editing, and settled bills are append-only by specification.

### D7 — Sync state is driven by the browser's real connectivity, not by a demo toggle

The proposal wants the sync indicator's three states reviewable before the queue exists. A demo-only "pretend to be offline" button would be UI that ships and then has to be removed.

Instead the mock queue watches `navigator.onLine` and the `online`/`offline` events: online it drains, offline it accumulates. So the states are reached the way they will really be reached — put the device in aeroplane mode (or `page.context().setOffline(true)`) and ring bills.

Three states, from `src/domain/billing.ts` so #9 inherits the thresholds:

| State | Condition | Treatment |
|---|---|---|
| `synced` | nothing pending | dot plus the word "synced" |
| `pending` | 1–4 pending, or fewer than `SYNC_ESCALATION_MS` old | count plus "pending" |
| `stalled` | `SYNC_ESCALATION_COUNT` (5) or more pending, or the oldest older than `SYNC_ESCALATION_MS` (2 min) | warning icon and a sentence |

Never a dialog, at any state: `docs/SCREENS.md` is explicit that sync is a small persistent indicator, and a modal in front of a queue is a modal in front of a customer.

### D8 — Shell chrome subscribes to the adapter directly; no new provider

The counter shell's header already reserves `shift-status` and `sync-indicator`. Both are now filled by components that subscribe to `billing.subscribeCounter(listener)` through `useSyncExternalStore`, with the adapter as the single source of truth. No context, no provider, no prop-drilling through the shell — and the billing screen subscribes to the same store, so the header and the screen cannot disagree about whether a shift is open.

The shell therefore stays mode-agnostic: it asks the adapter it was given. In real mode the adapter reports no shift and nothing pending, which is exactly today's static text — so the shell's behaviour does not change until #10 makes it true.

### D9 — Totals are a pure domain function that enforces the database's own invariants

`src/domain/billing.ts` holds `billTotals(lines, { discountPaise, taxPaise })`, returning `{ subtotalPaise, discountPaise, taxPaise, totalPaise }` and enforcing, in integer paise:

```
lineTotal = unitPrice × quantity     (per line)
total     = subtotal − discount + tax
```

These are the constraints the database enforces on `bills` and `bill_items`. Having them here as a tested function means the screen and the schema cannot disagree, and #10 inherits an invariant rather than writing one. Non-integer input throws, like every other money path.

Line items **snapshot** `item_name` and `unit_price_paise` when the line is created, not when the bill settles — so changing a menu price mid-order cannot rewrite the line already on the panel, and the snapshot rule is demonstrated rather than asserted.

### D10 — The business date is resolved from the outlet's cutover at the moment of settle

`resolveBusinessDate(now, outlet.business_day_cutover)` already exists in the domain layer and mirrors `app_business_date`. The settle path calls it and stamps the queued bill; nothing derives a day from `created_at` at read time. A bill rung at 00:20 under an 04:00 cutover carries the previous day, and there is a test that says so — because that is the case the whole business-date column exists for, and it is invisible in any test that runs at noon.

### D11 — The mock queue is idempotent by client UUID and assigns numbers only on send

The mock mirrors four clauses of the counter-billing spec, each next to a comment naming it:

- a bill's primary key is the **client-generated UUID**, and enqueuing the same UUID twice stores one bill and reports the second as a duplicate;
- **bill numbers are assigned on send**, per outlet, sequentially, from the store's counter — never by the client, never on enqueue;
- a **cancelled** queue entry consumes no number;
- a settled bill is **append-only** — the mock exposes no update path at all.

*Alternative rejected*: assigning a number on enqueue so the confirmation can show a real one. It is exactly the invariant #10 must not have to un-teach, and it would make a cancelled bill burn a number.

### D12 — The real billing adapter exists and answers honestly

`DataAdapters` is total, so `createSupabaseAdapters()` must supply `billing` today. It is a module whose reads resolve to nothing — no open shift, no billers, nothing pending — and whose writes reject with `DataActionError('not_live', …)`, naming #9/#10 in a comment. The surface is `demo`-gated so nothing calls the writes, and the reads are not a lie: there genuinely is no open shift in the real system yet, and the shell chrome resting at "No shift open / synced" is the correct thing for it to say.

### D13 — Layout: a fixed two-pane counter that cannot scroll by surprise

The counter is `grid-cols-[1fr_22rem]` inside the shell's fixed content region: menu grid left, bill panel right, neither scrolling the page. The menu region is a responsive grid sized so the seven live items and their two category headings fit a 1024×768 tablet without vertical scroll, and the bill panel scrolls **internally** only when an order runs long — the panel's total, payment methods and Settle are pinned below it and are never scrolled off.

Below tablet width the two panes stack (bill panel first), because a phone is not the counter's device but the screen must still be usable on one.

The whole-menu-fits claim is asserted at the smallest supported tablet size by comparing the grid's `scrollHeight` with its `clientHeight`, so a future menu item that breaks it fails a test instead of a shift.

## Risks / Trade-offs

- **A demo PIN in a public repo reads like a credential.** → It is a fixture for a mock that touches nothing, recorded in `docs/DEMO_MODE.md` beside the demo personas; #9 introduces real PIN handling, where a hash and a real refusal path arrive together.
- **The mock queue is not the outbox, and someone may mistake it for one.** → It lives in `src/data-access/mock/`, `src/outbox/` stays empty with its existing "deliberately empty until #9" comment, and the mock's own header says it simulates the queue's *observable states* and none of its durability.
- **`navigator.onLine` is a weak signal** — it reports link state, not reachability. → Acceptable and honest for a mock whose only job is to reach three visual states; #9 owns real reachability, and the thresholds it will need are already domain constants here.
- **Undo could be read as "bills can be unsettled".** → The strip says the bill has not been sent yet, and the affordance disappears the moment it is. Once sent, the screen offers nothing but the next customer.
- **Two panes fixed at tablet size is a strong layout commitment.** → It is the commitment `docs/SCREENS.md` already made, and the menu is seven items against a stated ceiling of about twenty. The no-scroll assertion is what will tell us if that ceiling is ever crossed.
- **This change depends on #7's menu seam, which the roadmap calls parallel.** → Recorded in both designs and in both task files; the dependency is one adapter and one fixture file, and it is one-directional.
