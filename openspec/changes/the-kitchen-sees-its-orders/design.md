# Design: The Kitchen Sees Its Orders

## Context

Everything a kitchen needs already exists on the counter. An order carries its
number, service and table (#60), its lines (`order_items`, snapshotted names and
quantities, `kind` separating packaging), its preparation (`prepared_at`, #45) and
its payment (`status`). The counter's rail asks for `status = 'open' or (status =
'paid' and prepared_at is null)` across the whole outlet (#35), and the counter
learns of changes through a shared Realtime channel used only as a nudge to re-read
under RLS (`docs/ARCHITECTURE.md`). A tablet is a machine principal whose reach
comes entirely from the live shift on it (`counter_devices`, `counter_shifts`,
`app_counter_shift_outlet()`), and its shift is opened by a username on the tablet
plus a four-digit code on the person's own phone (#9).

The owner's framing, held throughout discussion on 2026-10-07/08: **the kitchen
tablet is the simplest subset of the billing counter** — its rail, filtered, with
rings and animation on top — and should be structurally the same as the billing
tablet wherever it can be. Every decision below that departs from the counter says
why.

This change depends on `the-day-change-finishes-paid-orders` (#69): without it, a
forgotten Prepared tick would sit on the kitchen screen indefinitely.

## Decisions

### D1. A tablet has a kind

`counter_devices.kind text not null default 'counter' check (kind in
('counter','kitchen'))`. Setup is unchanged and produces a counter. The kind is
changed through the Tablets list's existing **Edit** dialog, as a third field beside
name and outlet, by the same people and the same server path that rename a tablet
(find how the dialog reaches `rename_counter_device` and follow it; do not invent a
second path). A Super Admin may change any tablet's kind; a Franchise Admin may
change a tablet's kind at an outlet they actively manage. The database enforces
this independently of the surface.

Changing the kind, in either direction:

1. cancels any pending shift request on the tablet;
2. ends any live shift on it with a new `ended_reason = 'device_kind_changed'`;
3. sets the kind.

All three commit together or not at all. The tablet learns of the ended shift
through the subscription it already holds on its own shift, re-reads its device
row, and shows the shift-start screen of its new kind.

**Becoming a kitchen is refused while the tablet owes the counter anything**:

- its most recent sufficiently fresh device report does not state zero unresolved
  local work (reuse the freshness rule the outlet transfer already applies); or
- any order with `device_id` = this tablet is still on the rail — `status = 'open'`,
  or `status = 'paid' and prepared_at is null`. Only the taking tablet may ever
  finish such an order (`prepare_billing_order` checks `device_id = auth.uid()`),
  so switching would strand it; order 35 is what stranding costs.

The refusal names what is outstanding. **Becoming a counter is never refused.** A
kitchen tablet has no outbox and takes no orders, so it cannot owe anything.

Kind is not tracked in the name/outlet effective-interval history: that history
exists so bill and order labels resolve to the name in force when they were made,
and a kitchen tablet makes neither.

### D2. A kitchen shift is a shift with a kind

`counter_shifts.kind` and `counter_shift_requests.kind`, same check, copied from the
device when the request is created. Confirmation refuses if the device's kind no
longer matches the request's (D1 cancels pending requests, so this is a backstop
against a race, not a path anyone should see).

Everything else about a shift is the counter's: the same request screen, the same
code on the same phone card, the same eligible people (an active Biller assigned to
the outlet, its active Franchise Admin, an active Super Admin), the same expiry at
the next cutover, the same Hand over, the same Leave, the same removal.

One person holding a counter shift and a kitchen shift at once needs no change: a
person's shifts on different tablets are already independent (`counter_shifts`
uniqueness is per device; confirmation ends only the confirming device's previous
shift — verified in `20260810000006_the_adversarial_review_findings.sql`).

**Finish Day neither waits for nor ends a kitchen shift.** Readiness's "no live
shifts" and "every participating tablet confirmed" rules consider counter shifts
only; a kitchen tablet never participates, because it issues no billing command.
(Discussion first proposed that Finish Day end kitchen shifts too; it has no reason
to — they expire at the cutover like any shift.)

### D3. The authority split is the core of this change

Today every device-authorised policy and RPC resolves the tablet's reach through
`app_counter_shift_outlet()` or `billing_device_context()`, both of which accept any
live shift. After this change:

- `app_counter_shift_outlet()` and `billing_device_context()` accept a live shift of
  kind `counter` only. **Every billing command, customer lookup, expense write,
  drawer read and bill read therefore refuses a kitchen shift with no further
  edits** — which is the point of narrowing the helper rather than adding a check to
  each caller.
- A new `app_kitchen_shift_outlet()` returns the outlet of the caller's live kitchen
  shift, or null.
- A kitchen shift's whole reach is listed, and nothing else is granted:

  | Reach | How |
  |---|---|
  | its board | `kitchen_board()` (D4) |
  | its outlet's menu categories, for the filter | `menu_categories` select policy gains `app_kitchen_shift_outlet()` |
  | its own filter | `set_kitchen_filter()` (D6) |
  | its acknowledgements | `kitchen_acknowledge()` and select on its own rows (D7) |
  | the freshness nudge | select on its outlet's `kitchen_pulses` row (D5) |
  | its own device row, shift, request and heartbeat | the policies that already serve the counter's shift-request screen, which run without a live shift |

**The implementation must enumerate every policy and `security definer` function
whose body calls `app_counter_shift_outlet()`, `billing_device_context()` or
`app_device_ok()`**, record the list in the PR, and add a hand-crafted kitchen-shift
request to the RLS suite for each that must refuse. A policy that reaches the device
some other way would be a hole this narrowing does not close; the enumeration is
how it is found.

### D4. The kitchen reads a board, not the orders table

A kitchen shift is **not** granted select on `orders`. An `orders` row carries
`customer_name`, `customer_phone`, `customer_id`, `customer_tier` and every money
column; Row-Level Security filters rows, not columns, so any select grant would hand
a hand-crafted request all of them. A customer's phone is PII that billing needs and
a kitchen does not (`AGENTS.md`, Data protection).

Instead, `public.kitchen_board()` — `security definer`, callable only with a live
kitchen shift, scoped to that shift's outlet — returns exactly:

- for each order on the rail (`status = 'open' or (status = 'paid' and prepared_at
  is null)`) that has at least one item line visible under this tablet's filter, and
- for each order cancelled during this kitchen shift's business date that had a
  visible line and has no `cancel` acknowledgement from this tablet:

  `id, order_number, service_type, table_number, ordered_at, changed_at, status,
  cancelled_at`, its **visible** item lines (`id, menu_item_id, item_name,
  quantity`), the **count** of its item lines not visible here, and this tablet's
  latest acknowledgement of each kind with its line snapshot (D7).

Packaging lines (`kind = 'packaging'`) are never returned. A line's category is its
menu item's current `category_id`. The filter is applied **in the query**, per
`docs/ARCHITECTURE.md`'s "a list's read asks for the list": the rail read once
downloaded every order the outlet had sold and cost 99% of the project's egress.

The rail itself is not filtered by business date, so neither is the board (owner's
decision; see Non-goals). Cancelled orders are, because a cancellation nobody
acknowledged must expire with its day (owner's fix, 2026-10-08).

### D5. Freshness: a pulse row, a re-read, and a staleness rule

The kitchen cannot subscribe to `orders` changes: Realtime's `postgres_changes`
delivers only rows the subscriber may select, and D4 withholds select on `orders`.

So a one-row-per-outlet table `kitchen_pulses(outlet_id primary key, bumped_at
timestamptz)` is bumped by an `after insert or update` trigger on `orders` and on
`order_items`, and added to the `supabase_realtime` publication. Its select policy
admits a live kitchen shift at that outlet (and the outlet's managers). The kitchen
subscribes to its outlet's row; every event is a nudge to call `kitchen_board()`
again, exactly the counter's contract. It carries no order data.

The bump takes a row lock on the outlet's pulse row for the remainder of the order
write's transaction. Order writes at one outlet are already serialised on the
per-outlet order-number and bill-number counters, so this adds no new contention in
practice; the PR records a two-till concurrency test showing no measurable change.

**Neither path is load-bearing alone**, as on the counter. The board is also
re-read every 20 seconds while the screen is visible, and on return to the
foreground. **The sync alert shows** when the browser reports no network, when the
Realtime channel is not subscribed, or when the last successful board read is older
than 45 seconds — so a silent subscription cannot leave the kitchen stale without
saying so. It clears on the next successful read.

Rejected here: polling alone (latency of the poll interval, and egress on every
tick); `realtime.broadcast_changes()` with private channels (a mechanism this repo
does not use yet; a reasonable replacement for the pulse table if the concurrency
test shows contention); select on `orders` (D4).

### D6. The filter lives on the tablet's own record

`counter_devices.kitchen_filter_mode text not null default 'exclude' check (in
('include','exclude'))` and `counter_devices.kitchen_category_ids uuid[] not null
default '{}'`. The default — exclude nothing — shows everything.

`set_kitchen_filter(p_mode, p_category_ids)` is callable by a tablet holding a live
kitchen shift, writes only its own row, refuses any id that is not a category of the
tablet's current outlet, and records who changed it and when. An outlet transfer of
the tablet clears the list, since the ids belong to the old outlet. A category later
deactivated is ignored by the board and dropped from the header's summary.

The owner chose the tablet as the place to set this (no setting on the owner's
page) and left the storage to judgement. **Browser storage was rejected**: it is
wiped by a reinstall, a cleared site, or the browser reclaiming space, and the
failure is silent — the tablet falls back to showing everything, and the wrong
kitchen cooks something before anybody notices. On the device row it survives all
of that, survives a switch to counter and back, and the Tablets list can show it.

The screen's header always reads the filter in force — *Only Pasta, Burgers* or
*Everything except Pasta, Burgers* or *Everything* — so an empty screen is never
mistaken for a quiet one.

### D7. Acknowledgements are rows, and the server snapshots what was acknowledged

`kitchen_acknowledgements`: `id` (client UUID, idempotent), `outlet_id`,
`device_id`, `shift_id`, `person_id` (the shift's holder), `order_id`, `kind`
(`new` | `edit` | `cancel`), `order_changed_at` (the order version acknowledged),
`lines jsonb` (the visible lines at that version: `menu_item_id`, `item_name`,
`quantity`), `acked_at` (server time). Append-only; update and delete refused.

`kitchen_acknowledge(p_id, p_order_id, p_kind, p_order_changed_at)` takes the
snapshot **itself**, from the order's current lines under the tablet's current
filter. It refuses if the order's `changed_at` differs from `p_order_changed_at`:
the cook acknowledged a version that is no longer current, and the card is already
re-alerting for the newer one. Exact replay of `p_id` returns the stored row.

RLS: select for the acknowledging device while it holds a live kitchen shift at
that outlet, and for that outlet's Franchise Admin and any Super Admin; no client
insert, update or delete outside the function. **This is an outlet-scoped table and
ships its isolation test.**

Server storage rather than local memory, because: a reload must not lose a cancelled
card — a screen that silently drops a cancellation is the failure ACK exists to
prevent; two kitchens acknowledge independently; and the owner can later measure
the time from `ordered_at` to a kitchen's `new` acknowledgement. The cost is that
ACK needs the network, which a kitchen tablet is expected to have; with the sync
alert up, ACK is disabled.

### D8. Each card's alert is derived, not stored

A pure function in `src/domain/kitchen.ts` takes a board row and returns the card's
state. With *visible* meaning lines this tablet's filter shows:

| Board row | No `new` ack | Latest ack's lines = visible lines | Latest ack's lines ≠ visible lines |
|---|---|---|---|
| open / paid-unprepared, visible lines | **New** | quiet | **Edited** (diff against the ack's lines) |
| cancelled, no `cancel` ack | **Cancelled** | **Cancelled** | **Cancelled** |

and, when an order this tablet has already acknowledged loses every visible line, it
is returned as **Cancelled** here (the board includes acknowledged orders whose
visible lines became empty, until a `cancel` acknowledgement exists).

Consequences, each of which the owner reviewed:

- **An edit before the first ACK** keeps the card New, showing current contents; one
  ACK covers it. The cook never acknowledged the old version, so there is nothing to
  diff against. The card shakes again and its rings restart.
- **Two edits before the edit ACK** are one Edited card diffed against the last
  acknowledged lines; one ACK covers both.
- **An edit touching only another kitchen's items** leaves the visible lines equal
  to the snapshot: quiet here.
- **An edit adding this kitchen's first item** to an order: no ack exists from this
  tablet, so it is New here.
- **An order ticked Prepared at the counter** leaves the board; its alert, and any
  ringing, stop without an ACK.

The diff keys lines by `menu_item_id` and shows added (marked), removed (struck
through) and changed quantity (old → new).

### D9. Sound: one speaker, three rings, a priority, and no ring on load

Tunes are synthesised with the Web Audio API — no audio files. New order: a rising
two-note chime. Edit: a single, different tone. Cancel: a falling, lower pattern,
distinct from both (owner agreed to a third tune). One *ring* is one play of a tune.

The queue:

- An **alert** is (card, kind) and is owed three rings.
- **One sound plays at a time**, with a short gap between rings.
- When choosing the next ring, the **most urgent kind with a ring owed** plays:
  cancel, then new, then edit. **One ring of a kind counts for every alert of that
  kind currently owed one**, so three orders arriving together ring three times in
  total and all three cards shake together.
- **ACK** removes that card's alert. If no alert is owed a ring, the current sound
  is cut and the queue stops.
- After its three rings an un-ACKed alert is silent but keeps its glow and button.
- A card whose content changes while its alert is still owed rings has its count
  reset to three.

**Only live transitions ring.** The first board read after mount establishes a
baseline silently; later reads compare against the previous read, and only a card
whose derived state became New, Edited or Cancelled (or whose content changed while
alerting) rings. After a network gap, orders that arrived during it do ring — they
are new to the kitchen.

**Autoplay.** Browsers refuse audio until the page has been touched. The shift-start
screen involves typing, which unlocks the audio context for that page's life. After
a reload into a live shift there is no such gesture, so if the audio context is not
running the screen shows the same unmissable floating alert as a sync failure —
*Sound is off — tap anywhere to turn it on* — and the first tap resumes it.

### D10. The card and the screen

Oldest first, in columns that fill left to right on a landscape tablet:

```
┌ Kitchen 1 · Everything except Pasta, Burgers ─────── Asha · ● live · 13:42 ┐
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│ │ #12 TABLE 4  │ │ #13 TAKEAWAY │ │ #14 DINE-IN  │ │ #15 TAKEAWAY │       │
│ │        14 m  │ │         9 m  │ │         3 m  │ │         0 m  │       │
│ │ 2 Chicken    │ │ 1 Paneer     │ │ 3 Classic    │ │ 1 Double     │       │
│ │   Shawarma   │ │   Shawarma   │ │   Shawarma   │ │   Shawarma   │       │
│ │ 1 Fries      │ │ ~1~ 2 Fries  │ │ +1 item for  │ │              │       │
│ │              │ │ + 1 Lassi    │ │ another      │ │              │       │
│ │              │ │              │ │ kitchen      │ │              │       │
│ │              │ │ [ ACK edit ] │ │              │ │ [   ACK   ]  │       │
│ └──────────────┘ └── warning ───┘ └──────────────┘ └── primary ───┘       │
└───────────────────────────────────────────────────────────────── ⚙ filter ┘
```

- The order number is the largest text on the card; the service tag follows it as
  on the counter's pipeline card (#60).
- Quantities are large and lead each line.
- The waiting time counts from `ordered_at`, turning to the warning tone at 10
  minutes and the danger tone at 20 (constants; the owner may tune them later). It
  reads in days for an order that has sat overnight.
- Tones are existing semantic tokens — `--primary` for New, `--warning` for Edited,
  `--danger` for Cancelled — and each ACK button is filled in its card's tone, so an
  edit ACK is visibly a different thing from a new-order ACK (owner's request). No
  new colour pair enters without the contrast validator passing in both themes. The
  owner dropped a *NEW* text label: the glow is enough.
- **Shake** is a short horizontal oscillation; under reduced motion it becomes a
  border pulse. The glow persists until ACK.
- **The filter** opens from the corner control as a sheet: a two-way choice, *Only
  these* / *Everything except these*, over the outlet's active categories as a
  checklist, and Save.
- The screen holds a Screen Wake Lock while visible and re-acquires it on return to
  the foreground; where the API is unavailable, `docs/LIMITATIONS.md` says so.
- The header carries the shift holder's name, as the counter's does.

### D11. The phone lists each live shift

The phone card that today shows one shift and **Leave counter** becomes a list when
a person holds more than one:

```
Your shifts · Kalyani Cafe
┌──────────────────────────────────────────────┐
│ Counter · Till 1 · since 10:40       [Leave] │
│ Kitchen · Kitchen 1 · since 11:02    [Leave] │
└──────────────────────────────────────────────┘
```

Each row's **Leave** confirms naming the kind and the tablet (*Leave the kitchen on
Kitchen 1?*), keeping today's distinction from Hand over. Shifts at different
outlets list under their outlet. With exactly one shift the card reads as it does
today, with *Leave kitchen* in place of *Leave counter* for a kitchen shift. The
pending-request card reads *Open the kitchen?* for a kitchen tablet. The button is a
verb, per the owner's UI conventions.

### D12. The Tablets list

The Edit dialog gains a **Type** choice, Counter or Kitchen. Switching asks for
confirmation naming the tablet, the change, and — if a shift is live — whose shift
will end. A refusal names what is outstanding.

A kitchen tablet's row shows *Kitchen*, its filter summary, and its live shift's
holder, and none of the counter's money figures, since a kitchen shift has none. Its
heartbeat keeps reporting (with nothing unresolved), so *out of touch* still works
for it.

### D13. Routing

The device session already resolves the tablet to `/counter`. It now resolves by
kind: a kitchen tablet goes to `/kitchen`, which mounts a `KitchenShell` showing the
shift-start screen (D2) or the board (D10). A kitchen tablet at `/counter`, or a
counter at `/kitchen`, is redirected. The kitchen shell mounts no outbox drain; it
keeps the device heartbeat.

### D14. The gate and demo mode

The kitchen surface is registered in `src/gates/registry.ts`, `hidden` until the
change's phase gate passes and `live` after; the Type field in the Edit dialog is
absent while it is hidden.

Demo mode adds a **Kitchen tablet** entry beside the Biller in the walkthrough,
mounting the real `KitchenShell` behind a synthetic device session at
`/demo/kitchen`, over the same mock billing store. So that a counter tab can ring a
kitchen tab — the walkthrough the owner was promised, and how the feature is shown
before there are tablets — the demo's mock billing store mirrors its mutations
across same-origin tabs with a `BroadcastChannel`. This lives only in demo mode;
nothing real is shared between tablets except through the server.

## Money, RLS and offline, called out

- **Money arithmetic:** none. The kitchen reads no amount and writes none.
- **RLS:** D3 is a narrowing of two shared helpers that every device policy uses,
  and is the riskiest edit in the change: written one predicate too wide, a kitchen
  shift reads bills or customers and every existing test still passes. Its proof is
  the enumeration and one hand-crafted refusal per enumerated reach. Two new
  outlet-scoped tables (`kitchen_acknowledgements`, `kitchen_pulses`) each ship
  policy and isolation test. `kitchen_board()` returns no customer fact.
- **Offline:** the kitchen is online-only by design; it holds no outbox and caches
  nothing for restart. It shows its last board, dimmed, under the sync alert. A
  switch to kitchen requires the counter's outbox to be empty (D1), so no counter
  work is ever stranded on a kitchen.

## Rejected alternatives

- **No sign-in on the kitchen tablet.** The owner rejected it: a set-up tablet in
  the wrong hands would be a live feed of the shop's orders.
- **A "locked/unlocked" state with its own screen and words.** Proposed in
  discussion and rejected by the owner: the counter already has a shift-start screen
  after every cutover, and the kitchen reuses it with the kitchen's name.
- **A new kitchen or cook role.** Unneeded: the people who may hold a counter shift
  hold a kitchen shift. A cook role can come later without changing D2's shape.
- **Carrying a live shift across a type change.** Proposed for counter → kitchen;
  the owner chose symmetry — every switch ends the shift and somebody starts a new
  one — since the switch is made from an admin's phone anyway. It also removes the
  worse direction, kitchen → counter, which would have made the morning's kitchen
  opener answerable for the till's cash without their agreement.
- **Refusing a switch while a shift is live.** The transfer rule does this; for a
  type change the owner preferred ending the shift.
- **A kind chosen at setup.** Kept out for scope; a new tablet is a counter and one
  Edit away from being a kitchen.
- **Kitchen actions: Prepared, Ready, bump.** The owner kept the screen passive in
  this version apart from ACK. Preparation stays the counter's tick.
- **No ACK at all.** The owner's first position; reversed in discussion, because a
  ringing screen nobody can silence rings over a busy kitchen.
- **One ACK style for every alert.** The owner wanted an edit's ACK to look
  different from a new order's, so it is a different colour.
- **A NEW text label.** The owner judged the glow enough.
- **Cancelled orders vanish on their own.** The owner required an ACK so a cook does
  not finish a cancelled order.
- **ACKs kept only in browser memory.** A reload would drop un-ACKed cancellations.
- **The filter set by the owner on the outlet page.** The owner chose the tablet.
- **The filter in browser storage.** Silent loss (D6).
- **Select on `orders` for kitchen shifts.** Exposes customer phone numbers to a
  hand-crafted request (D4).
- **Showing pay-now sales.** The kitchen is a subset of the rail, and the rail has
  never shown them (owner).
- **The kitchen shows only its business day.** Proposed to hide an unpaid order
  left overnight, a counter syncing yesterday late, and an order stranded on a till
  not in use today; the owner judged all three rare and declined, keeping only the
  expiry of un-ACKed cancellations.
- **Special requests and item notes.** Deferred by the owner.

## Risks

- **D3 written too wide.** Mitigated by the enumeration and per-reach refusals.
- **Autoplay policies vary by browser and tablet.** D9's sound alert makes the
  failure visible; the walkthrough on real hardware, when tablets exist, is the
  last check and is listed as a 🧍 task.
- **Wake Lock unsupported on the hardware.** Then the tablet's own display settings
  must keep the screen on; `docs/OPERATIONS.md` says so.
- **Two kitchens configured so an item falls in neither.** With one tablet on *Only*
  and the other on *Everything except* the same list, nothing can; two *Only* lists
  can. The header makes each tablet's filter readable at a glance, and
  `docs/OPERATIONS.md` recommends the *Only* / *Everything except* pairing.
