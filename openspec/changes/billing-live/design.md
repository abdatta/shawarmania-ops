## Context

The tablet boundary, customer directory, transaction contract and the complete
lifecycle UI land before this change. Billing Live is the integration and rollout
boundary: real adapters replace demo adapters and the counter starts taking money
at both outlets.

Connectivity at both shops is good with brief drops, so V1 provides durable local
commit and retry without claiming full offline operation. An already-open counter
with a loaded menu survives a transient outage. Opening or resuming after a reload
still requires the backend, because a shift needs the operator's phone to approve
it. #34 expands that boundary; #35 then adds several tablets per outlet.

Two things arrive here that the original plan under-scoped. **The menu is not
real yet**: the manager's menu surface is demo-gated, and a counter with no menu
sells nothing, so making it a real editable record is part of this change. And
**the manual ledger is live and in nightly use**, so the day an outlet starts
billing is the day its counter revenue must stop being typed in by hand.

## Goals / Non-Goals

**Goals:**

- Make the menu a real record a manager maintains, with no SQL anywhere.
- Wire every #31 surface to the real #9, #32 and #33 contracts.
- Acknowledge counter writes only after a durable IndexedDB commit, then deliver
  them exactly once without making the operator wait.
- Give immediate and on-handover payments the same five-minute, tender-only edit
  path while keeping the paid bill and its original allocation append-only.
- Keep every V1 discount at zero with no discount control.
- Preserve unsent work through the shift ending, cutover, restart and app update.
- Hand counter revenue over from the ledger to the app, once, per outlet.
- Promote the billing gates to live while keeping the coherent demo.

**Non-Goals:**

- Starting or resuming billing offline after a reload.
- Several tablets at one outlet, or emergency billing from a personal device.
- Order transfer or any recovery path.
- Retiring the manual ledger, which #12 owns.
- Attendance, discounts, partial payments, refunds, GST, printing or digital
  sharing. Exact Cash/UPI split tender remains in scope.
- Manager-side billing, automatic re-ring handoff or prefill, and manager mutation
  of a tablet's local delivery queue.
- Editing paid items, quantities, customer facts, totals, clocks or business dates.
- Rearranging the payment dialog to fill the space left by withdrawn aggregator
  methods; only Cash's false default-selection treatment changes here.

## Decisions

### The menu becomes real here, and the owner enters it

`admin-menu` is promoted from `demo` to `live` with full create, rename, reprice,
reorder, availability and retirement, prices in integer paise. The owner then
enters both outlets' real menus through it before either counter opens.

Seeding the menu by migration was rejected and is worth stating plainly: the
roadmap's standing rule is that a gate must be reachable from an empty database,
and #14's whole thesis is that a third outlet can be brought up with zero code
changes. A menu that arrives by SQL fails both. This is also why the menu editor
cannot wait for a later change: without it there is nothing to sell.

### Local commit is the V1 acknowledgement boundary

Every mutating adapter builds the envelope defined by #33, hashed by the shared
canonical function #33 publishes, and commits it to Dexie before reporting success
or clearing the form. **The store itself is this change's**, moved on from #33 on
2026-08-09 because its adapters, its screens and its dependency ordering all live
here.

Network delivery starts afterwards. A payment is not held for its five-minute edit
window: the appends that correct its tender are separate commands, so manager
visibility, server numbering and revenue do not wait five minutes. If durable
storage fails, the UI stays populated and reports that the action was not saved.

Waiting for the server before clearing was rejected because a brief outage would
stop the counter. Clearing before the local commit was rejected because a tab
crash would erase a transaction the operator believed was recorded. Holding every
payment for five minutes was rejected because it would delay bill numbers,
management visibility, shift totals and finish-day readiness for an interaction
most bills never need.

### One ordered drain leader delivers dependency chains

One visible page becomes drain leader through Web Locks, with a short IndexedDB
lease fallback where Web Locks is unavailable. Commands are first-in-first-out
within a chain: create precedes revise, revise precedes pay or cancel, and a
correction follows the command it replaces. Independent commands proceed while a blocked chain waits. Retries use
bounded exponential backoff with jitter, resuming on foreground, on connectivity
evidence, and on periodic leader ticks.

Sending from every tab was rejected because it amplifies retries and races local
status. Strict global ordering was rejected because one blocked order would freeze
every unrelated payment.

### Actual request evidence, not `navigator.onLine`, defines delivery state

A response, or a successful health or read request, marks the backend reachable.
Network exceptions, timeouts and missing responses mark it unreachable and show
the persistent offline banner. Authentication, validation, tenancy and identity
responses are server responses and are never relabelled as offline.

The browser hint is useful only to trigger an attempt. Treating it as truth was
rejected because captive portals and reachable Wi-Fi with an unreachable backend
produce both false positives and false negatives.

### V1 caches only the active shift's context

While reachable, billing always fetches the latest menu, customer and order state.
The live shift retains its last successful menu snapshot. If the backend drops
while that screen stays active, the operator continues from that snapshot and
local commands until cutover, with the offline banner up. A reload, a closed app,
no live shift, or a new business day requires the backend and a fresh approved
shift before new work starts. The background drain may still deliver old work.

This gives short-drop protection without presenting V1 as an offline product.

### The counter re-reads on foreground, and realtime is only a nudge

"While reachable, billing always fetches the latest menu" is a promise about
freshness that nothing in the current counter keeps. The billing screen resolves
its menu once, in an effect whose dependencies never change for the life of the
screen, and then never asks again. A tablet that has been sitting on the counter
since morning is working from a photograph of the morning's menu.

That is not a display fault, it is the wrong money. Adding a line snapshots the
item's name and price at the moment of the tap, deliberately, so that a price
edited mid-order cannot rewrite what a customer was already quoted. The same
snapshot means a stale grid is quoted and charged as though it were current, and
an item the manager marked unavailable at 7pm is still sellable at 9pm.

So freshness is two independent triggers, and the counter needs both:

**Read again when the screen comes back.** `useOnForeground` in
`src/features/attention/attention.ts` already does exactly this for badge counts,
and the billing screen re-reads its menu and its rail on the same signal, as well
as on mount. A counter tablet is picked up, woken, and switched between screens
many times an evening, so this alone covers most of the gap.

**Let the server say something moved.** A Supabase realtime channel over that
outlet's `menu_categories` and `menu_items` fires a nudge carrying no data, only
"read again", and the counter re-reads. This covers the case foreground cannot:
the tablet nobody has touched for two hours, which at a counter mid-evening is
the ordinary state rather than the exception.

**Neither one may be load-bearing on its own.** The nudge is the thorough trigger
and the fragile one: `subscribeToOwnHandshake` in the counter adapter carries a
note about a day lost to a server-side filter on a column granted to nobody, where
the channel went silent without ever erroring. A silent channel is the worst
failure available here, because everything looks correct and only the numbers are
old. The foreground read is therefore the floor underneath it, and the guaranteed
worst case is "come back to the screen and it is right" rather than "wrong prices
all evening".

Polling was rejected: an interval short enough to matter is a request every few
seconds, all evening, for a menu that changes a few times a month. The
no-subscription reasoning behind the attention badges (design D4 there) was
considered and does not carry: that decision is about a phone in an apron paying
battery continuously for a number nobody is looking at, while this is a
mains-powered tablet fixed on one screen where the cost of being stale is money.

**A refresh never disturbs work in progress.** Only the menu grid and the rail's
lists are replaced. Lines already on the panel keep their captured snapshots, an
order under edit stays under edit, and a suspended draft is untouched.

The same two triggers are what make the rail honest about work changed elsewhere.
The rail reloads today only on this tablet's own saves, so a manager voiding a
paid bill or cancelling a stranded order from their own phone (both V1 paths this
change delivers) leaves the tablet showing an order that no longer exists. Several
tablets billing at one outlet stays out of scope for #35; one tablet plus one
manager's phone is V1, and it is enough to need this.

### Server outcomes map to explicit local terminal states

Accepted and exact-replay responses mark the command sent and retain its server
references. Retryable transport or server failures stay unsent. An order that is
no longer open, reuse of a UUID with different content, an invalid historical
shift, or any other correctable permanent refusal moves to needs attention.
Correction creates a new linked UUID; discard writes an attributed tombstone.
Neither mutates the refused envelope. Both actions exist only on the originating
tablet for an operator holding its live shift. Manager diagnostics expose only
non-identifying metadata and are read-only, because the payload and the queue do
not leave that tablet.

Treating every conflict as success was rejected because different money could hide
behind UUID reuse. Retrying a deterministic refusal forever was rejected because
it conceals action somebody must take.

### A five-minute payment edit is an append-only correction, not a bill update

Both immediate payments and saved orders paid on handover enter Bills this shift
as soon as the local payment envelope is durable. The expanded bill card offers
tender editing only on the originating tablet and only until five minutes after
the original stored `paid_at`. Its action label is relative: `Edit for 5 min`
through `Edit for 1 min`, rounding minutes up, then `Edit for 59 sec` through
`Edit for 1 sec`. The action disappears at expiry and leaves no permanent expired
message. The displayed countdown is guidance; the command RPC decides eligibility.

The existing tender dialog opens with the bill's effective Cash/UPI allocations
prefilled. Only those allocations are editable; item and customer snapshots,
totals, `paid_at`, both business dates and the bill number stay locked. Saving an
unchanged allocation is disabled. A successful correction does not restart the
five-minute deadline.

The database does not update `bills` or the original `bill_payments`. It appends
one outlet-scoped `bill_payment_corrections` row per accepted command and the exact
replacement allocation set beneath it, attributed to the command, tablet, shift,
operator and immutable client creation time. Revisions are sequential per bill;
the payload names the effective revision it replaces, and a stale revision is a
classified refusal rather than last-write-wins. The original allocation is
revision zero. A shared effective-allocation view or function selects the latest
accepted revision, and every shift, drawer, ledger, history and report read uses
that boundary instead of reading raw original allocations as current truth.

Both new tables carry `outlet_id`, enable RLS in the creating migration and ship
with isolation tests. Select scope follows the bill a session may already read;
authenticated roles receive no direct insert, update or delete privilege. The
security-definer command re-derives the device, shift, actor and outlet from the
authenticated tablet context, never from trusted-looking payload fields. Managers
may read the audit where their bill-history scope permits, but cannot append one.

The correction RPC locks the bill and enforces all of these facts transactionally:
the bill is still settled; it belongs to the authenticated tablet and its current
shift view; the replacement is one or more unique positive integer-paise Cash/UPI
allocations summing exactly to the unchanged total; its immutable command creation
time is not before `paid_at` and is strictly within `paid_at + 5 minutes`; and the
expected revision is current. That comparison is against the bill facts stored by
the database, not the browser's rendered timer. Historical command validity keeps
a correction created during a brief outage deliverable later; the outbox chains it
behind the payment command that creates the bill.

The tablet applies a durably accepted correction to its local bill and shift totals
immediately and marks the adjustment not sent yet until delivery. A permanent
refusal becomes needs attention with the immutable evidence retained. This
payment-edit path is distinct from correcting a refused delivery envelope: one
changes the effective tender of an accepted paid bill, the other replaces a
command that never became an accepted sale.

Mutating `bill_payments` in place was rejected because the original tender and the
person who changed it would disappear. Voiding and re-ringing every wrong Cash/UPI
tap was rejected inside the short window because it changes the bill number and
sale identity for a correction that does not change what was sold or how much was
taken. Reusing the old six-second Undo was rejected because it exists only before
delivery, applies only to direct payment, and keeps the correction hidden in a
temporary confirmation instead of beside the paid bill it concerns.

### Correction authority stays on the device that holds the facts

After the five-minute tender window, a manager voids a paid bill from their
personal history surface, but does not create its replacement there. The corrected
sale is manually rung on the enrolled counter tablet as a new bill. There is no
manager payment command, cross-device draft or automatic prefill. Managers cannot
extend or bypass the tablet's payment-edit deadline.

Manager bill history filters on the revenue `business_date`. Detail separately
shows `paid_at` and `payment_business_date` when the payment crossed the outlet
cutover. Delivery diagnostics on the same phone are read-only. A needs-attention
command can be corrected or discarded only on its originating tablet, where the
immutable payload and local evidence actually exist.

### Dormant discount columns do not create a discount feature

The transactional contract retains `discount_paise` for arithmetic and future
compatibility, but Billing V1 always submits zero and renders no discount control.
Adding discounts later requires an explicit pricing and authority decision rather
than exposing a schema field by accident.

### A removed tablet stops, and nothing uploads from it

Draining stops when the tablet is removed. Unsent envelopes stay on the device.
There is no privileged upload path: the recovery contract was cut in #9 along with
order transfer, and the operational answer is that the Tablets surface warns
before removing a tablet with unsent work. This is recorded in
`docs/LIMITATIONS.md` rather than papered over.

### Finishing the day writes a server confirmation, not a local promise

The tablet offers "Finish billing for the day" only while online and after the
last paid bill's five-minute edit window has ended. It first drains every command
for the business date and requires nothing unsent or needing attention. One server
transaction ends the shift and records the end-of-day confirmation from #33. The
counter then accepts no new work for that date unless a fresh shift is approved,
which invalidates the confirmation. After #12 signs the day off, no shift can
reopen that date.

A local "queue looks empty" indicator was rejected as a close gate because the
person signing off is on another device and a stale report is bypassable. Sealing
automatically when a shift ends was rejected because a shift can end with work
unresolved and does not express an end-of-day decision. Ending while an edit action
is still promised was rejected because it would silently shorten the five-minute
window or permit drawer figures to change after confirmation.

### An outlet's go-live is a date on the outlet, and it turns at a cutover

`outlets.billing_live_from date NULL` — null until that outlet is promoted, set by
the Super Admin on the night it goes live. Everything about the handover then reads
as a date comparison against a business date the app already resolves.

Deriving it from the earliest paid bill was rejected: task 7.7 deliberately rings
**shadow smoke-test bills before any customer money**, so a derived boundary would
move itself backwards onto a day whose revenue had already been typed, and blank a
figure the owner entered by hand. A separate rollout table was rejected as a table
and an RLS policy for one date per outlet. An explicit column is also what makes
the stated rollback executable: "restore the typed field for dates after the
reversal" needs a date it can actually move.

**Go-live turns at a cutover, never mid-day.** The handover is by business date, so
a day that starts hand-typed and ends sourced from bills is exactly the
double-count task 5.3 exists to catch. `billing_live_from` is therefore set to a
business date that has not started yet, and an outlet already trading today goes
live at its next cutover at the earliest.

### A category is created by appending, and reordered on purpose

Once a category is only ever created as a side effect of adding an item, nothing is
left to set `menu_categories.sort_order` — and the counter's grouping order is a
decision the business makes, not an accident of typing. A new category therefore
takes `max(sort_order) + 1`, and the manager's menu screen gains an explicit
reorder action.

This is the promise already in this change's menu-management delta being kept
rather than a feature being added: it says a manager may "create, rename, reprice,
reorder, mark unavailable and retire". Alphabetical order was rejected because it
puts Burgers before Shawarma on the screen that matters most, and creation order
with no control was rejected because the only way to fix a wrong order would be to
retype the items.

### V1 billing takes Cash and UPI only, and the enum is what enforces it

**Owner decision, 2026-08-11: Swiggy and Zomato are withdrawn as tender methods.**
The counter takes Cash and UPI, and an aggregator order is not rung at the counter
at all. Integrating aggregator trade into billing stays available as a later
change and is out of scope here.

The withdrawal is a migration on `public.payment_method`, not a shorter list of
buttons. Aggregator revenue remains a typed ledger figure, so a bill allocated to
Swiggy would be that money recorded twice, and this repo puts money boundaries in
the database rather than in the interface. The migration follows the pattern
`20260811000002_remove_unsupported_payment_methods.sql` established one day
earlier: audit production first, refuse to run if any `swiggy` or `zomato` bill or
expense exists, move both columns through text, replace the type with
`cash | upi`, restore the typed columns and the one policy whose expression
depends on the type.

Re-adding a value later is a single `alter type ... add value`, which is the cheap
direction. Removing one is the expensive direction, and it is being paid now while
both tables are empty rather than after a month of real bills.

This also settles half of the open `expense-payment-method-inherits-the-bill-enum`
note for free: an expense "paid by Swiggy" becomes impossible at the type level
rather than merely absent from the form. What remains open there is the question
that note actually cares about, whether the expense record should adopt the
ledger's smaller model instead of the bill enum.

The payment dialog preserves its existing geometry. Cash keeps its banknote icon
so drawer-touching tender is not conveyed by colour alone, but both Cash and UPI
use the same neutral treatment when a new dialog has no allocation. The previous
hard-coded primary treatment for Cash was rejected because it looked like a
selection the operator had not made. Filling the gap left by the withdrawn Swiggy
and Zomato buttons is deferred; it is harmless space and unrelated to correction
integrity.

### Cash and UPI leave the ledger on the day the outlet goes live, and the aggregators do not

From an outlet's `billing_live_from` date, the ledger reads that outlet's **cash
and UPI** revenue from paid bills, labels each as coming from the counter, and
removes the fields that invited them to be typed. Earlier dates keep their typed
figures untouched, and the other outlet keeps typing until its own date is set.

**Zomato and Swiggy revenue stays typed at every outlet, on every date.** There
are no aggregator bills to read, so removing those fields on go-live would delete
the only record of that trade rather than move it. Their per-day commission rates
and computed net are unchanged, and the day now reads as two figures from the
counter beside two entered by hand.

Everything else in the ledger keeps working by hand: aggregator commission, cash
in and out, expenses, and the counted drawer.

The consequence to keep in view is that bills are no longer a complete record of
an outlet's revenue. Anything reading bills as total sales, including #13's
reports, must say that aggregator trade is absent from them and lives in the
ledger. `openspec/todos/aggregator-settlement.md` was written on the opposite
assumption and has been corrected.

**The owner reversed this on 2026-08-10 and will keep the written ledger in
parallel** for the settling-in period. It was previously rejected, and the cost of
rejecting it was that a billing bug on night one would show up as a wrong figure
with no hand-typed twin to compare against. That cost is now bought back: for the
first days there is a twin, and a disagreement between the paper and the app is a
finding rather than a mystery.

One outlet at a time still holds, for the different reason that Kanchrapara's
tablet has not arrived.

### A trial run needs no go-live and leaves nothing to clean up

Two switches, and they are independent. Promoting the billing gates decides whether
the tablet can ring a bill at all. `billing_live_from` decides whether the ledger
stops asking for that outlet's revenue to be typed. **Gates on with the date unset
is a live trial**: real bills are written on the enrolled tablet, and the ledger
keeps reading the typed figure, because the handover boundary is the recorded date
and not the presence of bills.

Marking the outlet live and deleting the trial rows afterwards was considered and
rejected. Bills are append-only, so the sanctioned way to neutralise one is a void
rather than a delete; and `bill_number_counters` holds `last_number` per outlet, so
deleting trial bills leaves the next real bill starting mid-sequence unless that row
is also reset by hand. Two manual production edits, on the night with the least
capacity to check them, to reach a state the unset date already gives for free.

### Live and demo remain separate adapter compositions

Real tablet context receives Supabase-backed reads and local-first command
adapters. `/demo` keeps the #31 synthetic adapters and never opens the live Dexie
queue or writes to Supabase. Gate promotion changes visibility, not the demo
dataset or route semantics.

### Rollout is one outlet, then the other

The gates promote for both outlets at once, but only one outlet's tablet is set up
and only one outlet's ledger hands over on the first night. The second follows
once the first has closed a full day cleanly. This is the only compensating
control available given no hand-typed twin, and it costs nothing to honour.

## Risks / Trade-offs

- **The owner reloads during an outage and cannot resume billing in V1** → explain
  the online-resume boundary on screen and deliver #34 next.
- **A shift needs the operator's phone and there is no fallback** → inherited from
  #9 by decision; rollout day one should have two eligible people present.
- **IndexedDB is unavailable or quota-constrained** → refuse to acknowledge the
  command, keep the form intact, and show a blocking storage diagnostic.
- **A chain blocks** → block only its descendants and show exactly what needs
  correcting or discarding.
- **The UI countdown and command eligibility disagree at the boundary** → derive
  the label from the stored `paid_at`, remove it at zero, and still let the RPC's
  timestamp comparison be authoritative.
- **A correction is made offline before its payment has reached the server** →
  chain it behind that payment identity and validate its immutable creation time
  when replayed, never rewrite the ancestor envelope.
- **A stale correction overwrites a newer one** → require the expected effective
  revision under a bill lock and append a new sequential revision only on match.
- **An app update changes envelope code** → version envelopes and keep readers and
  senders for every locally supported pending version through the rollout window.
- **The ledger handover double-counts or loses a day** → the handover is by outlet
  and by business date, earlier dates are untouched, and one test asserts a live
  outlet's day shows counter revenue exactly once.
- **The tablet is offline or blocked at closing time** → sign-off stays blocked
  until it reconnects and confirms; there is no local bypass.

## Migration Plan

1. Promote the menu editor, and have the owner enter both outlets' real menus.
2. Ship Dexie schema, append-only payment-correction tables and RLS, effective
   allocation reads, command RPC, readers and local-first adapters while the gates
   stay demo.
3. Exercise pay-now, order edit, pay, five-minute payment correction, expiry,
   cancel, needs-attention handling, and the finish-day path against local Supabase
   with forced transport failures and browser restarts.
4. Set up one tablet at the first outlet, load its live menu, and run shadow smoke
   tests before any customer money.
5. Promote the billing gates, hand the ledger over for that outlet, and trade one
   full day, closing it cleanly.
6. Repeat 4 and 5 for the second outlet.
7. Observe unsent and needs-attention counts without logging payloads or phones.

Rollback may demote gates while leaving compatible queue code installed so accepted
local commands keep draining. Never roll back by clearing IndexedDB or deleting
command receipts. A ledger handover is reversed by restoring the typed field for
dates after the reversal, never by editing a date already sourced from bills.

## Open Questions

**Which outlet goes live first: settled as Kalyani**, which is the outlet that has
a tablet. Kanchrapara's hardware is on its way, so the one-at-a-time rollout this
change already required is the shape the hardware was going to force anyway.

**When: not decided here, and not decidable by this change.** Go-live turns at a
cutover, and nothing in this change is built yet, so the date is whatever the first
cutover after task 7.7 turns out to be. Recorded in `docs/OPERATIONS.md` on the
night rather than fixed in advance.
