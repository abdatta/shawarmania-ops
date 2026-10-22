# Design: Waiters Take Orders On Their Phones

## The owner's words, 2026-10-21

> We would like to enable the servers, the waiters, the people who are taking
> the orders at the tables, to use their phones to place orders directly … once
> it's placed, it goes into the counter.

> When a server places an order from their phone, it is basically a shortcut to
> automatically fill everything up at the counter that the counter would have
> otherwise individually clicked … instead of them pressing the order button,
> they would see a pre-filled thing and they would just have to press the
> accept button.

> The outlet may not have a kitchen setup or may have a partial kitchen setup …
> for the other kitchen, we still send a person … silent edit update is
> dangerous.

> They should be within the location to take an order. Even if they have checked
> in and then go somewhere away and do it, I don't want that to be allowed.

> Checking a GPS also adds a bit of latency … it should not happen that they take
> an order from the customer and then when they are trying to place, that's when
> there's a flash … it should be an async thing happening a little ahead of the
> time.

> Today, sometimes when a tablet stops working … the orders in that tablet get
> stuck … maybe we can just relax it and let any counter edit any order.

The decisions of that conversation, in the order they were taken. Each is the
owner's unless it says otherwise. This file records them because the
conversation does not survive it.

1. **A new role, called Waiter.** *Server* was the first word, and was dropped
   because the docs already use *the server* for the backend.
2. **On the person's own phone, as a navigation tab.** No setup code, no shift
   handshake.
3. **Checked in today**, and **inside the outlet** at every point that matters.
4. **No counter on shift means nobody sends.**
5. **Accept is the counter's Order button**, pressed on a composer the waiter
   filled. It is not a kitchen step: the kitchen sees what it sees today, once
   the order exists.
6. **A waiter's change to a live order waits for Accept too.** A silent change
   cannot reach a kitchen that has no tablet.
7. **The order number is allocated at Accept.**
8. **A waiter takes back only their own request, and only while it waits.**
9. **A paid order stays closed.** More food for a paid table is a new order.
10. **Made food cannot be taken off**, as at the counter.
11. **A waiter changes** dishes, quantities, notes, table, dine-in or takeaway
    and label; **never** discount, points, payment, preparation, or
    cancellation after Accept.
12. **Waiters see every live order.** Acceptable because they must be inside
    the outlet to do anything.
13. **Online only.**
14. **Waiting requests stop Finish Day.**
15. **Location is checked ahead of time** (the light, D3), valid for 15
    minutes, re-checked every few minutes while the app is open, with
    **Retry**, and a warning before the block.
16. **Drafting always works**; on 🔴 the draft is shown to the counter.
17. **No counter code.** Proposed by the agent, then judged by the owner to add
    too little: a waiter at the counter can show the draft (rejected
    alternatives).
18. **One waiting change per order**, and **Reject asks no reason** (the agent's
    picks, accepted).
19. **Any counter acts on any open order**, in this same change.
20. **No customer details from a waiter** (owner, 2026-10-21, after reading the
    proposal). A waiter neither enters nor reads a customer's phone or name. The
    customer gives their number at the counter when they pay, as today. The
    **label** is the waiter's way to mark an order, and may hold the customer's
    name if the waiter chooses.
21. **Distance and accuracy are kept; coordinates are not** (owner,
    2026-10-21). Kept for debugging a phone that never goes 🟢, the way a staff
    check-in once failed because precise location was off.
22. **Waiter is a real staff role**, written into which role includes which,
    built first as its own change, `staff-roles-include-other-roles` (owner,
    2026-10-21 and 22). Replaces the first design, which stored a Waiter as an
    Employee with a grant beside it.

## D1. A Waiter is a staff role that includes an Employee

`staff-roles-include-other-roles` makes every check of what a staff member may
do ask which role includes which, `staff_role_includes`, instead of naming
roles. This change adds the Waiter to it:

- **`alter type public.app_role add value 'waiter'`**, in its own migration
  before the one that uses it (Postgres will not use a new enum value in the
  transaction that adds it).
- **`insert into public.staff_roles (role) values ('waiter')`**, and two rows:
  **Waiter includes Employee** and **Biller includes Waiter**. The existing
  *Biller includes Employee* row stays, as migrations change no existing rows,
  and is now also reached through the Waiter. Every check that needs an
  Employee admits a Waiter: check-in, expenses, Team's staff rules. Every check
  that needs a Biller does not: no counter shift, no menu reads as a biller.
- **`app_may_take_orders_at(outlet)`** is `app_acts_as('waiter', outlet)` plus
  the check-in of D2. A Biller passes it, since a Biller includes a Waiter.
- **`src/data-access/role-includes.ts`** gains `waiter: ['employee']`, and
  `biller` includes `'waiter'`, with the Waiter's shell order, Team label and
  path segment.
- **Team offers Waiter** beside Employee and Biller, as one of the alternatives
  for a person at an outlet. It is written through the existing assignment path,
  which asks the includes rows.

**No Waiter is made before that change's cleanup.** Until its contract rewrites
`expense_guard`, the old guard names Employee and Biller and would refuse a
Waiter's expense (`staff-roles-include-other-roles`, D4). Team's Waiter choice
is behind `waiter-orders`, and `waiter-orders` is not turned on before the
cleanup has run (tasks 0.25).

## D2. Checked in today

`app_may_take_orders_at(outlet)` also requires an attendance check-in by the
caller at that outlet on the outlet's current business date, as the database
reckons it, that has not been **denied**. A pending check-in counts: approval
can come hours later, and the waiter is working now. Attendance has no
check-out, so a check-in lasts the business day. Presence (D3) is what stops a
checked-in waiter from sending once they leave.

## D3. The location light

### What is checked

**`waiter_check_presence(outlet, lat, lng, accuracy_m, captured_at)`**, an RPC
from the Orders tab. The database computes the verdict exactly as attendance
does: its distance function against the outlet's position and radius, and its
accuracy rule. A reading too coarse to decide is **unverifiable**, which is not
inside. The verdict, never the client's, is what counts.

**`waiter_presence`** keeps **one row per person per outlet**, overwritten by
each check: `checked_at`, `verdict` (`inside` | `outside` | `unverifiable`),
`distance_m`, `accuracy_m`, `last_inside_at`. **No coordinates are stored.**
Attendance keeps a position because a disputed day needs evidence. This keeps
what the next send needs, plus the distance and accuracy that explain a phone
stuck on 🔴, because a position every three minutes through a shift is
monitoring the job does not require (`AGENTS.md` → Data protection). The owner
reads the row when debugging a waiter's phone (decision 21).

A person may check at most once every 20 seconds. A faster call returns the
current row unchanged, so a stuck Retry cannot hammer the database.

### What the phone does

- Checks on opening the tab, on returning to the foreground, every **three
  minutes** while the tab is visible, and on **Retry**. Nothing while the page
  is hidden: the browser gives no location to a hidden page, and asking would
  only fail.
- 🟢 when `last_inside_at` is under 15 minutes old and the latest verdict is
  `inside`.
- 🟡 when `last_inside_at` is under 15 minutes old and the latest verdict is not
  `inside`, or when it is under 3 minutes from expiring with no newer check. The
  line names the time left: *Location not confirming · 9 min left*.
- 🔴 when `last_inside_at` is null or 15 minutes old.
- Permission denied by the browser is 🔴 with *Allow location for this app* and
  the browser's own way to change it, not a Retry that cannot work.
- **A coarse reading says so.** When the latest reading's accuracy is wider than
  the outlet's radius, 🟡 and 🔴 add *Your phone's location is approximate
  (±1.2 km). Turn on precise location.* That is the commonest cause of a phone
  that never goes 🟢, and the waiter can fix it without anyone else.

### What the database enforces

Every send (D5) and every take-back requires `last_inside_at` within **15
minutes of the database clock**. The phone's light is a forecast of that rule,
computed from the same row, so 🟢 never lies about a send.

## D4. A request

**`order_requests`**: `id` (client UUID), `outlet_id`, `business_date`,
`kind` (`new` | `change`), `order_id` (null for `new`), `base_version` (the
order's version the change was written against, null for `new`), `content`
(jsonb, below), `summary` (jsonb, the dish names and quantities the Waiting card
prints, snapshotted by the server so the card needs no menu join), `status`
(`waiting` | `accepted` | `rejected` | `withdrawn`), `sent_by`, `sent_at`,
`answered_at`, `answered_by_device`, `answered_by_person`, `accepted_order_id`.

**`content` for a new order** is an order a counter could ring: `serviceType`,
`tableNumber`, `label`, and `lines` of `menuItemId`, `quantity` and `note`.
No prices and no customer. The counter prices it at Accept from its own menu,
the way it prices a tap, so menu discounts apply as they do to anything rung
there.

**`content` for a change** is the waiter's edits, not the whole order, because
the counter may have edited the order in between and a whole-order replacement
would silently undo that:

```json
{
  "add":   [{ "menuItemId": "…", "quantity": 1, "note": "no onion" }],
  "less":  [{ "lineId": "…", "quantity": 1 }],
  "notes": [{ "lineId": "…", "note": "extra spicy" }],
  "set":   { "tableNumber": 6, "serviceType": "dine_in", "label": "Priya" }
}
```

`less` reduces a line's food **not yet made**, and never below what is made.
`set` carries only the fields that changed.

**Expired is derived, never written.** A request whose `business_date` is
earlier than the outlet's current business date and whose status is `waiting`
reads as **expired**. No job writes it.

**A request carries no customer.** The content validator refuses any customer
key, so no customer detail reaches a request row or a waiter's phone (decision
20). An order's customer stays wholly the counter's.

## D5. Sending and taking back

**`waiter_send_request(id, outlet, kind, order_id, base_version, content)`**,
security definer, `search_path = ''`. It is idempotent by `id`: an exact replay
returns the stored result, and changed content under the same `id` is a
conflict. It is not an outbox command, and the phone sends it only online.

It refuses, each with its own code the phone turns into one sentence:

| Code | When |
|---|---|
| `not_a_waiter` | not at least Waiter at the outlet |
| `not_checked_in` | D2 |
| `not_inside` | D3, no inside check in 15 minutes |
| `counter_closed` | no live counter shift at the outlet |
| `order_not_open` | a change to an order paid or cancelled |
| `change_waiting` | a change to an order that already has one waiting |
| `made_food` | a `less` that would take off made food |
| `malformed` | anything the content validator refuses, including an item not on this outlet's menu or unavailable, a quantity under 1, a note or label over its limit |

**`waiter_take_back(id)`**: the sender, a waiting request, presence fresh.
Status becomes `withdrawn`.

**Why not the outbox.** The outbox exists so a tablet never stops taking money.
A waiter is not taking money, and a phone that queued an order nobody can see
would be worse than one that says *Not sent*.

## D6. What a waiter reads

**`waiter_board_v1(outlet)`**, security definer, admitting only
`app_may_take_orders_at(outlet)` plus a presence row for that outlet with a
check in the last 15 minutes, whatever its verdict. Reading needs the waiter to
have been checking, not to be inside. A 🔴 phone still reads the board so it can
draft. It returns:

- `counterOpen`: whether a counter shift is live.
- Every live order: the orders the counter's rail shows (open, or paid and not
  prepared), with number, table or service type, label, paid or unpaid,
  total, and lines with quantity, note, made quantity and Ready quantity. **No
  customer name, phone or gold mark**, no bill, no tender, no discount detail,
  no points.
- Each order's waiting change, if any, with its sender's name.
- The caller's own requests of the current business date, with status and, once
  accepted, the order number.

**The menu** comes from **`waiter_menu_v1(outlet)`**, under the same admission:
the outlet's categories, items with price and availability, and the menu
discounts the composer shows on a tile. The menu policies admit anyone who acts
as a Biller (`staff-roles-include-other-roles`), and a Waiter does not, so the
phone reads the menu through this function rather than a widened policy. It is
read once on opening the tab and again when the outlet's menu changes, as the
counter's menu is under `fewer-requests`.

**Freshness** follows the counter's rule: realtime is a nudge, never the data.
The phone re-reads on the foreground, on a change to `order_requests` for the
outlet, and on the outlet's `kitchen_pulses` row moving (every order command
already bumps it). The waiter reads that row through a **new permissive policy
gated on `app_change_gate('waiter-orders')`**, which is the lint's prescribed
form for a policy on an existing table.

## D7. The counter's Waiting card

- Waiting requests for the outlet sit **at the top of the rail**, oldest first,
  in a card that is visibly not an order: dashed edge, no number, *Waiting ·
  Rahul · Table 4*, and the dishes from `summary`. A change reads its edits:
  *#106 · +1 Chicken Burger · −1 Coke · Table 4 → 6*.
- **It rings once** when it arrives, through the counter's existing sound path.
  The owner picks the sound by ear from the tune lab during the demo round
  (`kitchen-sounds-loud-and-chosen-by-ear`).
- The counter reads requests with **`counter_waiting_requests_v1()`** under its
  shift, and learns of new ones from a second table on its **existing** outlet
  channel (`subscribe` in `supabase-adapters/counter.ts`). No timer is added.
- **Tapping a new request** opens the composer over the rail's left half,
  holding the request's lines, notes, table and label, with *From
  Rahul* where the order number would be. **Order** reads **Accept**, and
  **Reject** sits beside it. Anything may be changed first. An item that has
  become unavailable since is shown dashed and is not added, and the composer
  says so.
- **Tapping a change** opens that order in the edit composer with the edits
  applied: an added line is marked *+ Rahul*, a reduced one shows its old
  quantity struck through, a changed table or label shows the old value struck
  through. **Save** reads **Accept**. If the order's version is no longer the
  request's `base_version`, a line above the composer says *This order changed
  after Rahul sent this. Check it before accepting.* Edits that can no longer
  apply (a line removed, food made since) are listed and not applied.
- **A draft in progress is never disturbed.** Opening a request while a new
  order is half-written stores that draft and restores it afterwards, as the
  edit composer already does.
- **Reject** is one tap and needs a connection.

## D8. Accept is an ordinary create or revise

**Accepting a new request** sends `create_order` with variant `versioned` to
**`create_billing_order_v3`**, whose payload is v2's plus `requestId`. In the
order's transaction the function marks the request `accepted`, stamps the
answering tablet and operator and the order, and nulls the request's phone. If
the request is no longer `waiting` (taken back, rejected, accepted elsewhere,
expired), the create is refused `request_not_waiting` and **no order is
created**.

**Accepting a change** sends `revise_order` with variant `versioned` to
**`revise_billing_order_v3`**, whose payload is v2's (the whole order, as every
revision states it) plus `requestId` and `baseVersion`, the version the counter
had open. The request is marked in the same transaction, under the same
`request_not_waiting` rule.

**Accept and Reject are offered only online.** Accept travels through the outbox
like any create or revise, so a lost acknowledgement is replayed exactly. But it
answers something that only exists on the server, and a tablet offline cannot
know the request is still waiting. Accept goes grey with *Needs a connection*,
as Upgrade to Gold does. If the connection drops between the tap and the
delivery, the command waits in the outbox like any other, and a refusal
`request_not_waiting` is terminal: discard is offered and nothing was created.

**The attribution is the counter's.** The order's creator is the accepting
tablet and operator, as for anything they ring. The request row says which
waiter sent it, and the order's history reads *From Rahul's phone* beside its
creation.

## D9. Any counter acts on any open order

### Why the rule existed

A revision states the whole order (`revise_billing_order_v2`: *a revision states
the whole order, not a difference from it*), and carries no record of the
version it was made from. With one writer per order that is safe: the tablet's
outbox delivers its own edits in order. With two writers, the second to arrive
silently replaces the first. The owning-tablet rule made that impossible by
allowing one writer.

### What replaces it

**Every `_v3` ordinary command names the version it was made against**, as
`baseVersion`, the order's existing version (`changed_at`, else `created_at`,
the same value `kitchen_order_version` returns). Revisions move it. Payment,
cancellation and ticks do not.

| Command | `_v3` function | Refused when |
|---|---|---|
| revise | `revise_billing_order_v3` | `baseVersion` is not current: `order_changed` |
| pay | `pay_billing_order_v2` | `baseVersion` is not current: `order_changed` |
| cancel | `cancel_billing_order_v2` | `baseVersion` is not current: `order_changed` |
| tick | `prepare_order_lines_v3` | never for version; line by line as today |

Ticks name no version because a tick is about one line, already judged line by
line (a tick for a removed line is accepted and changes nothing).

**The owner check** in each `_v3` function applies unless
`app_change_gate('any-counter-acts')` is on, in which case any tablet holding a
live counter shift at the order's outlet passes. The check is read when the
command is applied, so a command queued while the gate was on and delivered
after it was turned off is refused `not_owner`, which is terminal and offers
discard. It changes no row.

### Offline

- **A tablet's own orders work offline exactly as today.** Its commands carry
  `baseVersion` too. If nothing else touched the order, they land.
- **Another tablet's order needs a connection.** Offline, the tablet cannot know
  the version is current, so edit, pay, cancel and tick are greyed with *Needs a
  connection* on an order it did not take. This is the only new offline
  refusal, and it applies only to orders the tablet could not touch at all
  before.
- **A stale own command is refused, never merged.** If another device edited the
  order while this tablet was offline, the tablet's queued edit is refused
  `order_changed`. The tablet says *This order changed on another counter.
  Reopen it.*, and the order on its rail shows the server's version. The durable
  refusal offers **discard** only: a resend carries the same stale
  `baseVersion` and would be refused again, which is the existing rule for a
  terminal refusal (`docs/OFFLINE_AND_SYNC.md` → *A correction is only offered
  where a resend could land differently*).
- **A stale payment is refused, and the order stays open to be paid again.**
  This is the one case with money in it: a tablet offline takes cash for an
  order that another device changed meanwhile. The payment is refused
  `order_changed`, as a payment racing a manager's cancellation is refused today
  (`order_not_open`). The tablet shows the refusal on the bill it had drawn, and
  the order is still on the rail at its new total, to be paid with whatever
  difference that leaves. A payment that "wins" by forcing the payer's content
  back over the other device's edit was considered and rejected below.

### Discounts

A discount is applied, edited or removed by any counter that may act on the
order, attributed to the tablet, shift and operator that did it. With the gate
off, only the owning tablet, as today.

### Corrections stay with the payer

`correct_bill_payment` and `unpay_billing_order` act on a **payment**, not an
open order, and stay with the tablet that took it. The owner did not ask for
them, and the five-minute windows exist for the person who just took the money.

## D10. Totals, discounts, gold and points

Nothing a waiter sends carries money. The counter computes every figure at
Accept with `billTotals()` over integer paise, as for a tap. Menu discounts
attach to new lines at Accept. A request names no customer, so the gold
packaging waiver and points arrive only when the counter identifies the
customer, at Accept or at payment, as today.

## D11. The day's end

- **Finish Day** on a counter, with `waiter-orders` on, names the outlet's
  waiting requests of that business date and does not proceed until each is
  accepted or rejected. This is a client step only. The database needs no
  guard, because a request is not an order: left waiting, it holds no number,
  no money and no kitchen work, it reads as expired from the next business
  date, and Accept requires a live counter shift.
- **After cutover** a waiting request is expired (D4), the waiter's card says
  *Expired, not sent to the kitchen*, and Accept refuses it.

## D12. Screens

### The waiter's Orders tab (phone)

```
┌──────────────────────────────────┐
│ ● Inside · checked 1 min ago     │  🟢 / 🟡 Location not confirming · 9 min left  [Retry]
│                                  │  🔴 Turn on location and step inside  [Retry]
├──────────────────────────────────┤
│ YOUR REQUESTS                    │
│ ◌ Table 4 · 3 dishes · Waiting   │  [Take back]
│ ✕ Table 9 · Rejected by counter  │  [Dismiss]
├──────────────────────────────────┤
│ LIVE ORDERS                      │
│ #106  TABLE 4          Unpaid    │
│ 2 Chicken Shawarma   1 made      │
│ 1 Peri Peri Fries    Ready       │
│ Priya                   ₹420     │
│ ─ change from Rahul waiting ─    │
│ #107  TAKEAWAY          Paid     │
│ …                                │
├──────────────────────────────────┤
│            [ + New order ]       │
└──────────────────────────────────┘
```

- **New order** and tapping an order open the composer: the counter's searched
  menu and tiles, full width; the order as a bottom sheet that expands, with the
  same line controls, notes, table picker, dine-in or takeaway and label, and
  no customer row (decision 20). The sheet's button is **Send to counter**,
  or **Send change** on an existing order, greyed with its reason on 🔴 or when
  the counter is closed.
- **Show to counter** on a 🔴 draft: dishes, quantities and notes in large type,
  the table at the top, nothing else.
- **Counter is closed** replaces the New order button when no shift is live.
- One tab, **Orders**, in the phone shell's navigation. A second tab was
  discussed and not needed: the requests sit above the list.

The words are the counter's words: the table tag, *Takeaway*, the label, the
made and Ready marks, the gold star, *Order #*. Nothing is renamed for the
phone (`mirror-the-existing-surface-first`).

### The counter

The Waiting card at the top of the rail, and the composer in its Accept form
(D7). The kitchen, Bills this shift and Expenses are unchanged.

## D13. The gates

Two gates in one change, so the owner can pull either alone. Neither depends on
the other.

**`waiter-orders`** (*WO*), toggle points: the surface registry entry for the
Orders tab (`hidden` → `demo` → `live`, and shown only with the gate on); the
Waiter choice on Team; the counter's Waiting cards, its subscription filter and
the Accept composer; Finish Day's request step. With the gate off, the phone
shell shows no Orders tab, Team offers Employee and Biller as today, and the
counter neither reads nor subscribes to requests. Every function D5–D8 adds
refuses with `gate_off` while it is off, so a hand-crafted request does nothing
either.

**`any-counter-acts`** (*AC*), toggle points: the counter's local refusal of
another tablet's order (lifted when on) and the `versioned` variant stamped on its
ordinary commands; and the database owner check (D9).

`retireBy` for each: about eight weeks after it is first turned on.

**Round trips, tested.**

- `@cg-round-trip:waiter-orders`: with the gate on, a waiter sends a new order
  and a change, and the counter accepts the first. Turn the gate off: the
  accepted order is an ordinary order on the rail; the waiting change is unread,
  there is no Orders tab, and the counter rings and edits as today. Turn it on:
  the waiting change is back on the rail and Accept works.
- `@cg-round-trip:any-counter-acts`: with the gate on, tablet B edits tablet A's
  order. Turn the gate off: B's controls on A's orders are refused locally again,
  and A edits its order, which carries B's edit. Turn it on: B acts again.

## Version skew

- **`'waiter'` in `app_role`** is an added value, which the lint admits. A build
  that predates this change ignores a role it does not know
  (`staff-roles-include-other-roles`, D6); none can meet one before
  `waiter-orders` is on, since only that gate's Team offers it, and turning a
  gate reloads every client onto the build that turned it.
- **The `staff_roles` row and the two `staff_role_includes` rows** are new data
  in tables only builds from `staff-roles-include-other-roles` on read.
- **`order_requests`, `waiter_presence`** are new. No published build reads
  them.
- **`waiter_check_presence`, `waiter_send_request`, `waiter_take_back`,
  `waiter_board_v1`, `waiter_menu_v1`, `counter_waiting_requests_v1`,
  `counter_reject_request`, `app_may_take_orders_at`** are new.
- **`create_billing_order_v3`, `revise_billing_order_v3`,
  `pay_billing_order_v2`, `cancel_billing_order_v2`, `prepare_order_lines_v3`**
  are new. The `_v2` (and unversioned pay and cancel) functions are untouched
  and keep serving every published build and every queued envelope without the
  new variant. **A command keeps its variant for its whole life**, so work queued
  before the gate turned keeps going where it was written for.
- **`assignments` and the account transitions** are untouched. They ask the
  includes rows once `staff-roles-include-other-roles` is cleaned up, so a
  Waiter is admitted wherever an Employee is.
- **`kitchen_pulses`** gains one permissive select policy, gated on
  `waiter-orders` (D6). It admits nothing while the gate is off.
- **The `change_gates` rows** are inserted off, one per migration, each migration
  declaring its own gate.
- **Turning `waiter-orders` off** leaves Waiters, requests and presence rows in
  place. A Waiter is still at least an Employee and keeps checking in and
  recording expenses, without an Orders tab. Accepted orders are ordinary orders.
- **Turning `any-counter-acts` off** leaves no row behind. A queued `_v3` command
  from a non-owning tablet is refused `not_owner` and offers discard, which is
  terminal and loses nothing: the order is untouched.
- **Reverting the build** leaves the two tables unread and every accepted order
  ordinary. `_v3` envelopes still queued on a tablet are delivered by the
  functions they name, which stay published. The revert is clean in the
  AGENTS.md sense, but it is not available to `any-counter-acts`, which reaches
  the counter. That is why it has a gate.

## RLS and authority

- **`order_requests`**: select for the outlet's waiters and billers holding
  `app_may_take_orders_at`, the outlet's live counter shifts, the owner and the
  outlet's Franchise Admins. **No direct insert, update or delete for any client
  role.** Only D5 and D8's functions write.
- **`waiter_presence`**: select for the person themselves only (and the owner,
  for support). Written only by `waiter_check_presence`. A manager does not read
  a waiter's location row. It is a send precondition, not an attendance record.
- **A kitchen shift reads neither.** It sees an accepted order on its
  board as any other.

pgTAP and `test:rls` prove, by hand-crafted request, for every table and
function: another outlet's waiter, biller, counter and manager are refused; an
Employee is refused every waiter function; a waiter whose
assignment has ended, who has not checked in, whose check-in was denied, or
whose last inside check is 16 minutes old is refused a send; a waiter cannot
call any `_v3` billing command, `pay`, `prepare`, a discount or points; a
counter shift cannot accept a request from another outlet; a kitchen shift reads
no request; with `any-counter-acts` off a neighbouring tablet's `_v3` revise,
pay and cancel are refused `not_owner`; with it on they land, and a stale one is
refused `order_changed` and changes nothing.

## Offline

- **Waiter phones**: none. Every waiter call is online, and a failed send keeps
  the draft on the phone in memory and in `localStorage`, so a reload does not
  lose it.
- **Counter**: Accept and Reject are online only (D8). Acting on another
  tablet's order is online only (D9). Everything a tablet could do offline
  before, it still does offline, with one new refusal: its queued edit or
  payment is refused when another device changed that order first. Before this
  change no other device could.

## Request budget

- **Counter, idle**: unchanged. The request table rides the existing channel and
  is read only when it fires. `e2e-auth/request-budget.spec.ts` gains an idle run
  with `waiter-orders` on, against the same number.
- **Counter, one accept**: one create or revise, one request re-read.
- **Waiter phone, idle and visible**: one presence write every three minutes and
  one board read per order change at the outlet. A new budget case records an
  idle waiter for a measured minute.

## Demo

- A **Waiter** in the demo's role switcher, on a phone shell, working the demo
  outlet: checked in, 🟢, with a **location** control in the demo banner on this
  walkthrough alone (*Inside*, *Weak signal*, *Outside for 15 minutes*), the way
  the counter has its connectivity control.
- The demo counter carries one waiting new order and one waiting change when it
  opens, so the Waiting card and both Accept composers show without setup.
- Sending from the demo Waiter puts the request on the demo counter, and
  accepting it on the counter puts the order on the Waiter's list, through the
  shared mock store, so the round trip can be walked by switching roles.
- A second demo tablet's order on the rail shows `any-counter-acts`: with the
  gate on it opens for edit; with it off it is refused, as today.

## Rejected alternatives

- **A Waiter as an Employee with an order-taking grant beside it.** This
  change's first design, chosen because 19 database objects named Employee and
  Biller and a new role would have had to be added to each. It worked, but
  stored a role that read as something else and left the smell for the next
  role. Refused by the owner, who chose a real role (decision 22).
- **`'waiter'` added beside `'employee'` in every check**, as
  `a-biller-is-staff` did for Biller. The smell, a third time.
- **The waiter's phone as a third tablet kind**, with a setup code and the shift
  handshake. Refused by the owner: a personal phone needs no shared-device
  ceremony.
- **Sending straight to the kitchen** with the counter only notified. Refused by
  the owner: an outlet's kitchens are not all on tablets, and a change nobody at
  the counter sees reaches no one at the burger station.
- **A waiter's change written into the order immediately**, with the counter
  told afterwards. Same reason, and it would need a waiter-side revise command
  carrying no money yet able to remove food.
- **A change stored as the whole order the waiter wants.** If the counter edited
  the order in between, applying it would silently undo the counter's edit.
  Edits are stored as edits (D4).
- **Allocating the order number at send.** A rejected or taken-back request
  would burn a number, and *has a number* should mean *the counter knows*.
- **GPS checked at the moment of sending.** Refused by the owner: a refusal in
  front of the customer is the worst time to learn the GPS is off.
- **A rotating code on the counter tablet as a location fallback.** A 🔴 waiter
  at the counter types four digits and is 🟢 for 15 minutes. Left out by the
  owner, since a waiter already at the counter can show the draft, and the code
  needs a secret per tablet, a new verification function and a hidden counter
  menu. **Bring it back if real use shows waiters on 🔴 inside the outlet
  often**: `waiter_presence` holds the verdicts that would show it.
- **Bluetooth, NFC, nearby-device or Wi-Fi proof.** Web Bluetooth cannot scan
  for nearby devices on ordinary phones. Web NFC is Android Chrome only, and a
  static tag can be copied. No web API exposes nearby-device discovery or the
  Wi-Fi network name, and Indian broadband addresses change too often to
  identify an outlet.
- **Storing every presence reading.** Monitoring the job does not need (D3).
- **Customer phone and name on the waiter's phone**, entered with an exact-number
  lookup and shown as the last four digits. Written into the first proposal and
  dropped by the owner on reading it (decision 20): the customer gives their
  number at the counter, and the label covers what the waiter needs.
- **An outbox on the waiter's phone.** A queued order nobody can see is worse
  than *Not sent* (D5).
- **Payment wins over a stale order.** On `order_changed` the payment would apply
  the payer's content over the other device's edit and bill what was charged.
  It would undo another device's work without anyone seeing it, and could take
  off food the kitchen had made. Refusing, with the order still open at its new
  total, is the rule the app already follows for a payment racing a manager's
  cancellation.
- **Claiming ownership** (another tablet takes an order over, then only it acts).
  It still strands a payment the first tablet took offline, adds a transfer
  step nobody wants mid-service, and keeps two kinds of order on one rail.
  Versioned commands remove the reason ownership existed.
- **A database guard on Finish Day for waiting requests.** A request holds no
  money, number or kitchen work, and the expiry and the shift rule already make
  a forgotten one harmless (D11).
