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
- Preserve Mark Paid's guaranteed six-second Undo before its command becomes
  deliverable, and keep every V1 discount at zero with no discount control.
- Preserve unsent work through the shift ending, cutover, restart and app update.
- Hand counter revenue over from the ledger to the app, once, per outlet.
- Promote the billing gates to live while keeping the coherent demo.

**Non-Goals:**

- Starting or resuming billing offline after a reload.
- Several tablets at one outlet, or emergency billing from a personal device.
- Order transfer or any recovery path.
- Retiring the manual ledger, which #12 owns.
- Attendance, discounts, partial or split payments, refunds, GST, printing or
  digital sharing.
- Manager-side billing, automatic re-ring handoff or prefill, and manager mutation
  of a tablet's local delivery queue.

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

Network delivery starts afterwards, except that a direct-payment envelope remains
ineligible for delivery during the existing six-second Undo window. Undo removes
that still-unsent envelope and restores the composer; after the window, the
ordinary drain rules apply. If durable storage fails, the UI stays populated and
reports that the action was not saved.

Waiting for the server before clearing was rejected because a brief outage would
stop the counter. Clearing before the local commit was rejected because a tab
crash would erase a transaction the operator believed was recorded.

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

### Correction authority stays on the device that holds the facts

A manager voids a paid bill from their personal history surface, but does not
create its replacement there. The corrected sale is manually rung on the enrolled
counter tablet as a new bill. There is no manager payment command, cross-device
draft or automatic prefill.

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

The tablet offers "Finish billing for the day" only while online. It first drains
every command for the business date and requires nothing unsent or needing
attention. One server transaction ends the shift and records the end-of-day
confirmation from #33. The counter then accepts no new work for that date unless a
fresh shift is approved, which invalidates the confirmation. After #12 signs the
day off, no shift can reopen that date.

A local "queue looks empty" indicator was rejected as a close gate because the
person signing off is on another device and a stale report is bypassable. Sealing
automatically when a shift ends was rejected because a shift can end with work
unresolved and does not express an end-of-day decision.

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

### Counter revenue leaves the ledger on the day the outlet goes live

From an outlet's `billing_live_from` date, the ledger reads that outlet's counter
revenue from paid bills, labels it as coming from the counter, and removes the
field that invited it to be typed. Earlier dates keep their typed figures
untouched, and the other outlet keeps typing until its own date is set.

Everything else in the ledger keeps working by hand: aggregator commission, cash
in and out, expenses, and the counted drawer. Aggregator revenue itself now
arrives through bills, because aggregator orders are rung at the counter, but the
commission that platform keeps is still a ledger figure until #13.

Running both by hand for a settling-in period was considered and rejected by the
owner. The cost of that decision is that a billing bug on night one shows up as a
wrong figure with no hand-typed twin to compare against, which is why rollout is
one outlet at a time.

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
- **An app update changes envelope code** → version envelopes and keep readers and
  senders for every locally supported pending version through the rollout window.
- **The ledger handover double-counts or loses a day** → the handover is by outlet
  and by business date, earlier dates are untouched, and one test asserts a live
  outlet's day shows counter revenue exactly once.
- **The tablet is offline or blocked at closing time** → sign-off stays blocked
  until it reconnects and confirms; there is no local bypass.

## Migration Plan

1. Promote the menu editor, and have the owner enter both outlets' real menus.
2. Ship Dexie schema, readers and local-first adapters while the gates stay demo.
3. Exercise pay-now, order edit, pay and cancel, needs-attention handling, and the
   finish-day path against local Supabase with forced transport failures and
   browser restarts.
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
