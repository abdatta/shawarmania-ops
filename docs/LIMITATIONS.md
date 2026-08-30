# Limitations

Known edges, deliberate non-features, and honest gaps. Everything here is a decision, not an oversight — and each one names what would change if it stopped being acceptable.

## A multi-outlet person with no position cannot check in

Somebody assigned to two outlets checks in from one action and the geofence
decides which shop they are at. When the phone can supply **no position at
all** — permission refused, no fix — there is nothing to decide it with, and
the app refuses rather than guessing: a day recorded at the wrong shop is worse
than a day recorded late. They are told to ask an admin, who records it as a
manual entry exactly as for any other phone that cannot check in.

Somebody assigned to **one** outlet is unaffected: their row is written with no
coordinates, the fence declines to judge it, and a manager clears it — which is
what has always happened.

## The owner reaches every drawer, and where they stood is recorded

**This section previously recorded the opposite bound, and
`cash-is-counted-not-closed` (#11) settled the question the other way.** The
history is kept because the reasoning is the point.

The old rule refused a Super Admin the cash path at an outlet they held no
assignment at, on the premise that a cash count is a claim by whoever counted the
cash. That premise is intact; **the inference was wrong.** The person who counts
the cash at these outlets *is* the owner, and requiring them to hold a Franchise
Admin assignment to record what they counted described paperwork rather than
accountability. Both Super Admins additionally had their Franchise Admin rows
*deleted* rather than ended on 2026-08-01, so the old rule left no account able to
count a drawer at either outlet — verified against production on 2026-08-26 and
again on 2026-08-27.

So a Super Admin now records a count, a collection, a spend and an adjustment at
**any** outlet, and a Franchise Admin at the outlets their live assignment names.
A Biller and an Employee are refused every drawer read and write at every outlet,
including their own, by the absence of a policy branch.

**What that costs, and it is a real cost:** every drawer record carries whether
the account was inside that outlet's geofence, evaluated by the same distance rule
attendance uses, with a reason required and stored where it was not. **Nothing is
refused for being elsewhere.** A collector who enters every count from home shows
up as a column of reasons, which is oversight a refusal would not have
produced — and which the refusal would have converted into a phone call nobody
records.

## The app records no cash movement outside a count, and the record still carries both

`the-drawer-explains-its-figures` deleted **Only Collect** and **Other Spend**
from the Cash drawer. The application therefore has no way to record a collection
on its own, and no way to record a **spend** at all.

**Neither had ever been used.** Measured on production 2026-08-29,
`drawer_cash_out` holds two rows at both outlets combined: both collections, both
attached to an observation, no standalone movement and no spend of either kind.

*Other Spend* existed for one case — drawer cash buying capital, the ₹40,000
fridge that has to reconcile the drawer without polluting a cash-basis operating
month. The owner has ruled that case out: major spending is always online, and
only small amounts are ever cash [owner, 2026-08-29]. With no case to serve it
was a control that widened the model for nobody.

**What removing them bought is not tidiness.** `In the drawer now` is four terms
— opening, plus receipts, less expenses, less cash out — and the strip beneath it
shows three. Cash out had no tile, so ₹5,000 taken between counts dropped the
headline by ₹5,000 with nothing on the card accounting for it. With no way to
create a movement outside a count, every movement belongs to one and is folded
into **Last Left** — so the three figures account for the headline *by
construction* rather than by adding a fourth tile for a term that is now always
nought.

**The record is untouched, and that is the limitation.** `drawer_cash_out` keeps
its `kind`, its positive-spend constraint, its reason requirement, its policies
and its grants; `record_drawer_cash_out` keeps its grant and its adapter method,
which nothing under `src/` calls. So a spend reaching the table by any other path
is still bound by every rule it always was, the two production rows keep reading,
and re-offering a spend when a real case turns up is a matter of adding a control
rather than writing a migration. The Ledger's month `spends` card is likewise
left in place, guarded by `spends.length > 0`: it will simply never fire, and a
card that renders nothing costs nothing while a historical spend must stay
readable.

**A collection cannot be amended, only re-counted.** `edit_drawer_observation`
corrects an observation — its counted total, its note and its counted instant.
The movement written beside it is a row on `drawer_cash_out` with no command to
amend it, so an amount collected that was typed wrong is corrected by recording
another count rather than by editing the movement. The Last Left reading says so
in words instead of offering a field that would do nothing.

## In demo mode the drawer's expense breakdown lists fewer rows than it totals

The Cash Expenses breakdown lists rows from the notebook — the table every live
Expenses surface writes — while its totals come from `effective_expenses`, the
union of that notebook and `public.expenses`. **In production the two agree
exactly**, because `public.expenses` has never held a row (measured 2026-08-28,
and the reason `effective_expenses` exists at all).

The demo store populates *both* arrays, so a demo group can state a subtotal
larger than the rows it lists. That is a fixture fact rather than a surface one:
it predates this change — the demo's own Expenses tab has never been able to show
those rows either, while the drawer's expected balance has always subtracted
them. `retire-the-manual-ledger` (#12) carries the notebook rows across and
collapses the union, after which the question disappears rather than being
answered.

## The manual ledger is a stopgap with a stated exit

Billing records Cash and UPI at each counter, and `cash-is-counted-not-closed`
(#11) gives the drawer a live record, but until `retire-the-manual-ledger` (#12)
lands, the notebook still holds the trading period before each outlet's tablet
existed. The
**Ledger** surface (#36) therefore remains the place for aggregator trade,
expenses and drawer facts. Each outlet changes over on an explicit future-only
`billing_live_from`: from that day its Cash and UPI values are read from settled
bills once, while earlier dates and an unpromoted outlet remain hand-typed. It is
deliberately small: two tables, no workflow, no sign-off and no correction
history.

It is no longer owner-only. `the-ledger-opens-to-the-outlet` gave the **day
record** to managers at the outlets they are assigned to, and the **expense
record** to everyone at the outlet, because the person who spends the money was
the one person who could not write it down. What that opened, and what it
deliberately did not, is in
[Roles and permissions](ROLES_AND_PERMISSIONS.md).

Seven bounds worth knowing, because each is a decision:

- **The month's figure is a cash-basis _operating_ estimate.** Capital spending
  is not recorded here at all, by owner decision, so nothing in it accounts for
  equipment. It answers whether trading covered running costs, not where every
  rupee went. Where equipment was paid for out of the drawer it is recorded as
  cash taken out with its reason, which keeps that day's count reconciling
  without entering the month's expenses.
- **Opening cash is stored per day**, offered from the previous recorded day and
  editable. Correcting an old day therefore changes only that day. The price is
  that the chain can break — a day's stored opening may disagree with the previous
  day's count — and the surface reports that
  without repairing it, because a figure somebody counted is evidence and a
  recomputed one is not.
- **No consumption-basis profit**, because no stock is valued here. Raw materials
  are taken as zero on hand at the start of tracking, by owner decision.
- **It grants the owner no authority that survives it.** They may type cash
  figures into this notebook only because no real drawer record exists yet to
  corrupt. #11 decided its own boundary on its own merits, and decided it the
  other way, so nothing here became precedent — it decides its own boundary on its own merits. That an outlet
  staff role may record a drawer expense here is likewise no precedent for the
  live expense record, whose grants are `outlet-expenses`' own to decide.
- **A worked shift's own takings are not treated as confidential; history and
  aggregates are.** Owner decision, 2026-08-08, and it extends no further than
  that sentence. A staff member stands where the sales happen: the counter tablet
  is signed in and physically present, and anyone who wanted the evening's figure
  could tally the orders. So no test, wording or later feature may rest on the
  premise that the shift somebody worked is a secret this app keeps. **Any past
  day, any month's total, the other outlet and every figure net of commission
  remain confidential**, because none of them can be observed from behind a
  counter and a running total across weeks is not the same information as one
  evening's cash. The policy nevertheless refuses staff every day row, with no
  roster check: the concession is a limit on what the system may *claim*, not an
  instruction to open a hole. A later change showing staff their own shift's
  sales is therefore a product question; one showing them the month is not.
- **A fabricated cash expense is not caught by the drawer count.** An invented
  expense lowers expected cash, so the count still matches. The count catches a
  *missing* entry, never an invented one. That is inherent in granting cash
  expenses at all, so no further restriction on staff would buy anything: the
  controls are visible attribution and the withdrawal trace, and no screen should
  imply the nightly count is a check on it.
- **A credit purchase cannot be recorded at all.** Buying on terms has no
  representation here: `is_cash` is a boolean, there is no pending state and no
  settlement. This is today's behaviour rather than a regression — such a
  purchase is unrecorded now and stays unrecorded — but it means the month
  understates in the month goods arrive and overstates in the month they are paid
  for. Its own change if the owner starts buying on terms.
- **"Your own rows" means "this shift's rows" on a counter tablet, and that is
  now settled.** A staff member may correct or withdraw only expenses they
  recorded, which Row-Level Security enforces against `auth.uid()`. A tablet has
  no `auth.uid()` belonging to a person, so `counter-devices-and-offline`
  resolved the question the previous version of this entry left open: an expense
  recorded from a tablet is attributed to **the operator named on the live
  shift**, taken from the shift row and never from the request body, and the rule
  therefore means "expenses recorded while you held this counter". That is
  stronger than the arrangement this entry used to anticipate, because the shift
  names a person who confirmed it from their own phone rather than one whose name
  was picked off a grid at the counter.

**Its exit belongs to `retire-the-manual-ledger` (#12)**, and is that change's
whole purpose: it must first carry every recorded day and expense row into the
live records, asserting inside the migration that the carried data reproduces
totals established before it ran. The rows are
the value here; the surface is not. Dropping the tables without the carry-over
does not satisfy the removal, and the `manual-ledger` capability spec says so as
a testable requirement.

## Expense double-counting is warned about, not prevented

Typing an expense category that means aggregator commission, cash banked or an
owner drawing raises a dismissible warning. Commission already belongs in net
aggregator revenue; banking or drawing cash belongs in the day's cash movement.
The warning does not block the save because categories are deliberately free
text and a phrase cannot prove the accounting meaning of a real transaction.
Making this a guarantee would require structured transaction kinds and a single
ledger across expenses, settlements and cash movements; until those live
records exist, a hard refusal would reject legitimate entries as confidently as
it stops mistakes.

## A remembered outlet is per device and per browser profile

The outlet an outlet-scoped screen opens on is remembered for the signed-in
person, on that device, in that browser profile. It does not follow them to
another phone, does not survive clearing site data, and is deliberately not
stored server-side — it is a filter on a screen, not a setting. A browser that
refuses local storage simply defaults every time, which is what the app did
before it was remembered at all.

## A non-staff person's attendance row is reachable by day, not by person

An outlet's attendance day lists its staff, plus anybody who already carries a
record on the day shown — so a manager's own recorded arrival stays visible and
approvable where it happened. The by-person view offers **staff only**, so those
records cannot be read as a range. It is the honest trade: a pattern of days for
somebody whose days are not tracked is a pattern of nothing, and the day view is
where anybody settling one is already standing.

## Only a Super Admin may assign themselves

Self-assignment is refused for everyone except a Super Admin placing themselves
at an outlet — and nobody at all may grant themselves the owner role. The
carve-out is deliberate, on the owner's principle that **a Super Admin should
be able to do everything standalone** (2026-07-29): needing a second owner
present to perform an act is a dependency the business does not want, however
many owners exist.

It cannot widen anything — an outlet role confers less than the owner role
already does, and the last live Super Admin assignment stays unremovable — so
the worst it permits is an owner giving themselves a narrower hat than the one
they already wear.

## Deliberately deferred from v1

### Bills are record-only

**No receipt printing, no GST computation, no digital receipts.** A bill is stored in the app and nothing more.

This keeps the billing screen minimal and ships the counter faster. All three extensions are anticipated in the schema so that adding them later does **not** require migrating historical bills:

- **`pricing_mode` is written on every bill** (`no_tax` in v1). When GST is enabled, old bills stay unambiguous instead of being silently reinterpreted under new rules.
- **`tax_paise` exists and is zero.** The column arrives before it is needed, not after.
- **Line items snapshot name and unit price**, so any later reprint or recomputation reflects what was actually charged.
- **Per-outlet sequential `bill_number` from day one.** A sequence cannot be retrofitted over existing rows — printing and GST both need it, and this is the one that would genuinely hurt to add late.
- **`customer_phone` is captured**, so digital receipts work later with no backfill.

Tracked as three backlog items: `bill-thermal-printing`, `bill-gst-breakup`, `bill-digital-share` in [`openspec/todos/`](../openspec/todos/README.md).

### No discounts or partial payment in billing v1

The schema retains integer-paise discount fields for a later pricing-policy change, but the counter exposes no discount control and writes zero. Orders and bills must be paid in full, but that full total may be split across exact tender allocations such as Cash and UPI. There are no deposits, partially paid orders or manager-side payment shortcuts. A later discount change must update both the UI contract and `billing-live` command construction together so the demo and live adapter do not drift.

### Counter billing accepts Cash and UPI only

Billing and live expenses accept Cash or UPI. Card, Other, Swiggy and Zomato are
absent from the database payment enum. The enum was narrowed only after a
read-only production audit proved there was no aggregator history to reinterpret;
the guarded forward migration aborts rather than relabel an unexpected row. A
future payment category is added explicitly when the business adopts it.

### Paid-bill editing is tender-only for five minutes

The originating tablet may replace only a settled bill's Cash/UPI allocation,
under its still-live shift, for five minutes from the original `paid_at`. Each
change is an append-only revision under the same bill identity; editing never
restarts the deadline. Items, quantities, customer facts, totals, dates and
clocks cannot be edited. After expiry—or for any non-tender mistake—the V1 path
is an attributed manager void followed by a manual re-ring on the counter. There
is no personal-device payment command.

### Profit and loss is an estimate, not accounting

This is not a filing-grade financial report and must not be used as one. Specifically it does not model depreciation, opening and closing stock valuation properly, accruals, aggregator commission, or taxes. It answers "is this shop making money this month?" — a genuinely useful question, and a different one from what an accountant needs.

The cash-basis / consumption-basis distinction is real and the UI always states which is shown. See [Data Model](DATA_MODEL.md#two-modelling-traps-in-this-domain).

### Bills are not complete revenue in v1

Swiggy and Zomato orders are **not rung as bills**. Zomato's revenue and
commission are read from its daily order history and weekly settlement; Swiggy's
provisional stated gross is read from timestamped Finance order detail and its
final figures from the payout annexure. Both are reconciled against operator
evidence and neither is typed. Any figure quoted from `bills` as "total sales"
understates the outlet: bills cover only Cash and UPI counter trade.

Hyperpure supply expenses are likewise read from Hyperpure's own statement, one
per order, and can no longer be typed. What remains not automated is a supply
purchase paid **directly** rather than through a Zomato payout — the supplier
alone knows of it, and it is entered by hand until a supplier-portal reader is
built (`openspec/todos/supply-bills-paid-outside-the-payout.md`).

#12 owns retiring the remaining drawer/manual-day path and #13 owns the complete
reporting view. Until those changes deliberately integrate aggregator trade,
neither bill history nor an item-level bill report is a complete revenue record.

### Payroll is out of scope

There is no salary data anywhere in the schema or the UI — `staff-as-accounts` (#21) removed the roster's `salary_paise` rather than migrating it, by owner decision. Attendance feeds whatever payroll process the business runs outside the app, and wages actually paid are recorded as ordinary expenses under a free-text category such as `Staff wages`. If payroll ever becomes in-scope, salary fields return by migration onto the person's account record — nothing else has to move.

### The counter does not show an item's description

Retiring the Biller's read-only Menu screen took the one thing the Counter's menu column does not carry: an item's description line — *Bestseller*, *Saaj / pita style*, *25.8g protein per 100g*. Names, prices, veg markers and availability are all on the tiles, so the question that screen existed to answer is still answered; a biller asked what is in something now asks the kitchen, as they did before the app.

This is a deliberate trade rather than an oversight: a description on a tile costs the height that keeps the whole menu on one screen, which is a stated commitment. If it turns out to matter, the honest place for it is on the bill line or a tap on the tile, not a second page.

### Menu is per-outlet, with no shared catalogue

Each outlet owns its menu. Two outlets selling the same item means two rows. For two outlets this is fine and keeps isolation simple; at ten franchises, brand-wide menu consistency will want a master catalogue that outlets inherit from and override. Deferred until the franchise count makes it worth the complexity.

### One customer identity, and deliberately nothing built on it

Customers are business-wide since `global-customer-identity` (#32): one normalized phone is one person at either outlet. What that change deliberately did **not** build is anything that reads across outlets *about* them. There is no visit count, no spend total, no cross-outlet history, no loyalty, no marketing and no export — a counter that could see any of those could see the other outlet's trade through a customer both shops serve. See [`openspec/todos/customer-loyalty-and-cross-outlet-insights.md`](../openspec/todos/customer-loyalty-and-cross-outlet-insights.md), which is where that work waits for a real decision to justify it.

The billing composer currently requires either a customer name or phone before Order or Mark Paid enables. That is an operating trial in the UI only: both bill snapshots remain nullable in the database, so the rule can be relaxed without rewriting historical data or adding a migration.

Three consequences worth stating plainly:

- **A phone is the identity.** Somebody who gives a different number is a different customer, and a reassigned number carries the old identity with it. No merge, split or reassignment flow exists; the first real case is what should design one.
- **Several people sharing one phone are one customer.** A household ordering on one number is normal, and at launch it reads as a single identity.
- **No screen edits a customer.** The owner can read the directory; nobody can rename or delete a profile from the app. Correction is a deliberate future flow, not something to smuggle into billing.

**A shared directory is a franchise fact, not a technical detail.** Both outlets are owned today, so one directory is uncontroversial. Before `outlet-onboarding` (#14) puts a third-party franchisee on this schema, the franchise agreement must say that customer identity is shared brand-wide while every transaction stays the outlet's own.

## Real-world edges

### A continuously busy device defers a new build until its next launch

The app takes a new build by reloading itself, and only from a state where a
reload costs nothing. A counter tablet that is composing an order, holding
typed work, saving, or offline for the whole of a shift never reaches that
state, so it keeps the **Update** action and takes the build when it is next
launched.

This is not a regression — waiting for the next launch is exactly what every
device did before this behaviour existed — but it does mean **a fix cannot be
guaranteed to reach a busy counter within a shift**. Where that matters, the
tablet has to be reloaded deliberately, which the Update action is there to make
a one-tap job rather than a browser-menu one.

### Connectivity is the browser's opinion, not a reachable backend

The decision to reload asks the browser whether it is online. That reliably
catches airplane mode and a dead adapter, which are the cases that matter for a
tablet on outlet wifi, but a captive portal or a reachable router with no route
onward reports as online. The cost of being wrong is bounded: a reload that
lands without a backend, which a biller recovers from by reconnecting, rather
than anything written or lost.

### Browser geolocation is spoofable

Attendance location can be faked with browser devtools or a mock-location app. This **raises the bar; it is not proof.** It is stated here rather than assumed away because the consequence matters: a location flag must never be treated as evidence in a dispute about someone's pay.

The planned counter-tablet check-in path would be substantially stronger — the
device is physically in the shop — but it is not built yet. Today the fallback
is a manager-entered arrival, which is explicitly an attestation and stores no
invented GPS evidence.

GPS accuracy indoors also drifts 20–100m routinely, which is why the geofence refuses nothing at all: it is evidence a manager reads, and the manager's approval is what counts a day. That approval carries the manager's own position for the same reason it carries the employee's, and it is subject to the same limitation — an approval recorded as on-site raises the bar that the manager was there, and does not prove it.

**Accuracy is recorded and displayed, and gates nothing.** A reading accurate to kilometres that happens to land inside a fence reads as on site, for a check-in and for an approval alike. Since a manager can settle a selected set in one action, one such reading now carries several approvals rather than one, which is a real amplification of an existing weakness and is accepted rather than hidden: the accuracy is stored on every decision the action wrote, so a reviewer can see it. A threshold would also change employee check-in — refusing arrivals from people standing at their own counter with a poor fix — so it belongs in its own change rather than arriving as a side effect of batching.

### One arrival deadline cannot describe two shifts

An outlet carries **one** arrival deadline, and lateness is judged against it for
everybody. A shop running a morning and an evening shift has two arrival times
and one rule to describe them, so whichever shift starts later reads as late — or
the deadline is set late enough for the evening and stops measuring the morning
at all, which is the same problem facing the other way.

This is visible in the local seed: Kanchrapara's deadline is 20:00 rather than
something tighter, so an evening arrival there does not read as late. That is a
workaround, not a design. (It now earns its keep twice over: a combined roll-call
puts two outlets' rows in one list, and a deadline that differs between them is
what proves each row is judged by its own outlet's clock.)

The fix is the same one as below — a roster knows which shift somebody was
expected on, and the deadline follows from that rather than from the outlet. Both
are recorded together in `openspec/todos/rostering-and-weekly-offs.md`.

### A day cannot be split across two outlets

A person holds **at most one attendance row per business date**, across every
outlet, enforced by a unique constraint (`attendance-one-day-per-person`, #29).
So somebody who genuinely worked a morning at Kalyani and an evening at
Kanchrapara on the same date cannot have both recorded — not from their phone,
and not by an admin typing it in either. The second write is refused by the
database, and the manual-entry sheet does not offer it.

This is deliberate rather than an oversight. The owner's account of the real case
is that a person staffed at two shops works at **one of them** on any given day
and the month is a mix; #22 had assumed otherwise, and the cost of that
assumption was a phantom absence at the other shop on every day somebody worked,
which made a month unusable for the one thing it is read for. Production had
never produced a split day.

If it is ever wanted, the way back is two migration statements (swap
`attendance_one_per_person_day` for `attendance_one_per_person_outlet_day`) plus
one module, `src/features/attendance/attendance-record.ts`, whose header records
what reversing costs. Rows written under the current rule already satisfy the old
one, so nothing needs repairing.

### A genuine day off reads as absent

Nothing in this app knows a roster. A person holding a live assignment at an outlet reads as **absent** on every surface once that outlet's arrival deadline passes with nothing recorded for them — and a weekly off is exactly that shape. The counts on the person view include it.

The answer today is for the manager to **mark the day as leave**, which a stored row always wins over the derived reading. That is a real cost: somebody has to remember, once a week, per person.

Fixing it properly is rostering — expected working days per person, which the absent reading would then be bounded by, the same way it is already bounded by the assignment window so that days before somebody joined are not painted at all. That is its own change and is deliberately not this one; adding a half-guess (assume Sundays off, assume six-day weeks) would be wrong for some outlet within a month and harder to remove than to add. Recorded in `openspec/todos/`.

### Attendance does not know the expected outlet

Assignments say where a person **may** work, not where they were scheduled today.
For multi-outlet staff the app therefore cannot recognise a wrong-outlet
check-in automatically or tell that outlet's manager it was wrong. The manager
may deny it with a reason, leave retry open (the default), or reopen a prevented
retry through an audited correction; the employee can then check in at another
live assigned outlet while that outlet still has the same business date open.

That recovery is intentionally not a scheduling system. If managers need the
app to know which outlet was expected, that belongs with the roster and shift
model, not as a second outlet flag on attendance. Until then, a denial remains
absent while the newer attempt waits, and a manager may manually correct the day
to present even though no newer employee location exists.

### A check-in that cannot be sent is reported, never queued

Attendance has no outbox. The counter has one because a biller cannot wait for
the network with a customer in front of them; an arrival is one tap on the way
in, and a queue behind it would mean a screen saying "recorded" over a row that
may never exist. So a command either reaches the database or it does not, and
when it does not the person is told which: a refusal states the rule, a lost
connection says so, and a request this app could not send at all asks them to
report it, because that last one is a defect rather than a condition of the day.

The cost is real. Where there is no signal at all, the arrival waits on the
person retrying, or on their manager recording it for them — and a manual entry
carries the manager's name rather than the employee's evidence. Whether that is
worth an offline attendance queue is its own decision, and it has not been made.

### A self check-in records database receipt, not the physical tap

For a phone self-check-in, the recorded arrival is when the database receives
the command, not the time shown by the handset or emitted by its GPS reading.
That removes a bad phone clock as a reason to refuse, future-date or backdate an
arrival, but it cannot prove when somebody physically tapped the button: a slow
location lookup or network path can make receipt later than the gesture. The
manager manual-entry and correction paths remain the deliberate attestation
escape hatch when that distinction matters.

### A brand-new order can be missing from one refresh

The counter builds each pipeline read from two sources taken a moment apart: the
tablet's outbox, then the server. That ordering is deliberate and it is what
stops a just-accepted payment falling between them, but it leaves a smaller gap
the other way. A command created *after* the outbox is read and *before* the
server answers is in neither, so a brand-new order can be absent from that one
render.

Three things keep this tolerable. The operator's own action is never in the gap,
because a command is written to the outbox before the refresh that follows it is
started; only a second tab on the same tablet can produce one. It heals on the
next read, and every mutation triggers one. And the two failures are not
equivalent: missing a new order for one frame shows less than the truth, while
the ordering it replaced showed a paid order as unpaid, which is false, and
actionable, and cost a customer a second payment on 2026-08-25.

Closing it properly means not deleting an accepted envelope until the server
read is known to carry it, which is an outbox schema change with a pruning
policy attached rather than a correction.

### A diagnostics row cannot be cleared, only outgrown

A refused command is a permanent row in the manager's Status view. Resolving it
on the originating tablet — correcting it, or discarding it with a reason —
writes a tombstone in that tablet's own storage and sends nothing, so the
manager's view has no way to learn it was handled. The row leaves only by
falling out of the hundred most recent commands for that outlet, which at
current volume is about one trading day.

The consequence is that the count is a record of what happened rather than a
list of what is outstanding, and it cannot be acknowledged. Giving refusals a
resolution the manager can see means an acknowledgement the server records,
which is a migration and a policy, not a display change.

### A badge is not a notification, and its count can be stale

The count on the Attendance tab reaches only somebody already holding the app. Nothing pushes: a manager who does not open it does not find out, and the person whose day it is finds out when they query their pay. Reaching somebody who is not looking needs a service-worker subscription, a server to hold it and a key pair to sign with, none of which exists; it is tracked in `openspec/todos/pending-approval-notification.md`.

The count is also **read on arrival rather than kept live**. It is correct when a screen is opened and again when the app is brought back to the foreground, and it may lag work that arrives while a screen sits open. That is a deliberate trade against battery on a phone that spends its day in an apron: a timer waking the radio for a number nobody is looking at is a cost paid continuously for a benefit taken occasionally. A read that fails leaves the last known number on screen rather than blanking it, because a badge that vanishes says the work is done.

The billing counter is the deliberate exception. It is a mains-powered tablet
fixed on one screen, and stale price, availability, void or cancellation state is
charged to a customer. It re-reads on foreground and also listens for Realtime
nudges, with neither path trusted as the only one and no timer polling the radio.

The manager's **Tablets** view is not another exception. It reads the counter
once on open and when **Re-read** is pressed, states that server reading time,
and then stays still. The owner may therefore be looking at a counter that has
moved since the displayed moment. That is deliberate: this is an occasional
oversight screen on a phone, not the fixed mains-powered counter where staleness
changes what a customer is charged.

### Recorded check-out history is gone

Check-out was removed in #26 (owner decision, 2026-07-31) with the cost stated: the check-out times and locations already recorded in production were dropped by the migration. A full production dump was taken and verified beforehand and lives outside the repo under the snapshot procedure, so the data exists — but no screen can show it again, and there is no down migration. Nobody had used the feature, and unused monitoring data is the kind [Security And Privacy](SECURITY_AND_PRIVACY.md) says not to keep; that is the trade, not an accident.

### An unsent billing command exists only on its tablet

The live counter stores immutable command envelopes in IndexedDB and drains them
in dependency order with one leader tab. An unacknowledged command nevertheless
exists only on its tablet. There is no
order transfer and no privileged recovery upload. A manager cancels a stranded
open order with a reason and the counter re-rings it; a destroyed tablet's
unsent pay-now sale has no recovery path.

Remote **Leave counter** has one deliberately bounded exception to the ordinary
live-shift rule: an offline tablet that has not learned of the leave can still
deliver work created afterward until another shift opens or the business day
cuts over. The bill is not guessed onto the incoming operator; it remains under
the old shift with an immutable after-departure flag and needs human manager
review if the actual operator matters. That review can qualify attribution but
cannot rewrite the bill. The system cannot infer who physically touched an
offline shared tablet, and presents `operator unknown` as the honest outcome.

### Late bills against a closed day

A bill accepted after its payment business date was closed leaves the signed
cash snapshot unchanged. Its explicit payment clock makes the mismatch
detectable, but the exception flag, reconciliation UI, and any reopen or recovery
workflow are not built. Deliberate: a number a human signed off must never change
by itself.

### Clock skew on the counter tablet

Both client and server timestamps are stored. A badly wrong tablet clock can produce a wrong `business_date`, since the business date is resolved on the device at settlement. Material disagreement between the two clocks should be surfaced as a signal. There is no automatic correction — repairing a business date automatically could move revenue between days, which is worse than flagging it.

### One active tablet per outlet at launch

The database enforces one active tablet per outlet. Multiple counters are
deferred to `multiple-billing-devices` (#35); command execution is already
concurrency-safe, but setup and operations are not yet a multi-tablet product.

## Operational gaps

### Sign-in and activation require a connection

There is no offline password validation or cached sign-in. Opening a new
session and activating a one-time code both require a reachable authentication
backend. When no backend response arrives, the app names the connection problem
and asks the person to check the device's internet connection; it does not
mislabel that failure as a wrong username or password. A backend refusal still
uses one indistinguishable credential message.

### Forgotten-password recovery requires an administrator

Every role, including Super Admin, intentionally has no self-service email
recovery yet. An associated email is already an alternate sign-in, but an
authorized Franchise Admin or Super Admin still regenerates a one-time link and
hands it over. One Super Admin can help another. If all owners are locked out,
the operator break-glass runbook restores one existing account. Automated email
recovery is deferred to
[Super Admin Email Recovery](../openspec/todos/super-admin-email-recovery.md).

There is also **no screen for changing a password one still knows, requesting
a username change, or changing one's own Super Admin account email**. Those
belong to [Self-Service Account Settings](../openspec/todos/self-service-account-settings.md);
until then another authorized admin performs supported corrections.

### Opening a counter needs your own phone, and nobody can do it for you

A shift opens only when the person named on the request types the tablet's four
digits **on their own device**. There is no fallback approver: not the outlet's
manager holding the correct code, not the owner. So a phone with a flat battery,
a phone left at home, or a phone with no mobile data means **that person cannot
open the counter**, and somebody else has to.

This was chosen deliberately over an override, and the cost is real rather than
theoretical: at 8pm on a Saturday with a queue, "my phone is dead" is not a rare
sentence. It is stated here rather than softened because whoever operates this
shop should meet it in a document rather than at the counter.

**The approval is one factor, not two.** It proves possession of that person's
phone and nothing else — no password is entered anywhere in the handshake. That
is stronger than what it replaces, because an observer behind the counter can no
longer collect a password by watching somebody type it forty times an evening,
but it is not two-factor and is not written up as though it were. A stolen,
unlocked phone can approve a shift.

**The code can be read out over the phone, and that is the documented way out of
a flat battery.** Somebody at the counter types the owner's username, telephones
them, reads the four digits aloud, and the owner taps them in from wherever they
are. Nothing secret changes hands: the code lives on the tablet's screen, belongs
to that one request, and dies with it. What it costs is that **every bill that
evening is attributed to the owner**, which is visible in the records and
correct.

This is written down as a property rather than left to be discovered, because
staff will otherwise find it during a rush and assume it is a loophole. It is
not. The code was never meant to stop a person who deliberately decides to open a
counter in their own name after a conversation; it stops the thing that actually
goes wrong, which is a card appearing on a phone and being tapped through out of
habit.

**Recovery when a phone is genuinely lost** is the path that already exists: an
admin deactivates the account, which ends every session it holds, and issues a
fresh activation link.

### A tablet setup that fails at the last step needs an admin, not a retry

Setting a tablet up is two acts that cannot share one transaction: a machine
identity is created in Auth, then the setup code is redeemed in Postgres, and
only then does the tablet sign in. The first boundary is handled — if redemption
is refused for any reason, the identity is deleted again, the code is not
consumed, and the same code still works.

**The second boundary is not, and this is the honest statement of it.** Once
redemption succeeds the code is spent and the tablet row exists, holding that
outlet's one active slot. If the response is then lost, or the sign-in fails, the
tablet has no session and there is nothing on the device to retry with. The
screen says so plainly rather than blaming the code, and the recovery is manual:
an admin removes that tablet under Tablets and generates another code.

That is two taps and a walk, on a failure that needs a network interruption
inside a window of a few hundred milliseconds. The alternative is a pending
device state that does not hold the one-tablet slot until the browser proves it
signed in, which is a schema change to the invariant that everything else about
tablets rests on. It was judged not worth making that invariant more complicated
for this; if setup ever fails in practice, that is the fix. It is tracked in
[A tablet setup that fails at the last step takes the outlet's slot](../openspec/todos/tablet-setup-consumes-its-slot-before-it-is-proven.md),
whose trigger is `multiple-billing-devices` (#35) — that change reshapes the same
index, so the two belong in one migration rather than two on the same invariant.

### No automated data retention

Nothing is deleted automatically. Customer PII has no defined retention period, and attendance location data accumulates indefinitely. Both should get a retention policy before headcount or customer volume grows meaningfully. Noted in [Security And Privacy](SECURITY_AND_PRIVACY.md).

### An outlet that was ever staffed cannot be deleted

An outlet is deletable only while nothing references it. Assignments are retained as dated history when somebody leaves, so even an ended assignment still holds its foreign-key reference to the outlet. Deactivation is independent and changes nothing about those rows.

The consequence is narrow but real: staffing an outlet once makes that outlet permanently ineligible for deletion. This is deliberate. Deleting the assignment would erase where the person worked, while teaching outlet deletion to ignore ended assignments would allow the outlet row those records name to disappear. An outlet created by mistake and never staffed deletes cleanly; one that was staffed should be marked closed instead.

### No audit log

Who changed a price, voided a bill, or approved an attendance day is recorded on the affected row (`voided_by`, `approved_by`, `recorded_by`), but there is no separate immutable audit trail. Sufficient for a small trusted team; insufficient if a franchise dispute ever turns adversarial.

### Single Supabase project, single region

All outlets share one project. Fine for West Bengal. A backup and restore procedure is documented in [Operations](OPERATIONS.md), but there is no tested disaster-recovery drill until the roadmap's operations work lands.

## Not planned

- Customer-facing ordering or loyalty
- Table management or KOT — this is a counter format, not a dine-in restaurant
- Supplier and purchase-order workflows
- Multi-currency or multi-language (₹ and English only; revisit if franchises want Bengali)
- Native mobile apps — the PWA is the delivery mechanism

## A drawer boundary is only as good as a tablet's clock (#11)

The drawer's intervals are bounded by payment instants rather than business dates,
so `bills.paid_at` — a **device-claimed** timestamp — decides which side of a
22:00 count a bill falls on. It is checked only against the same device's own
command time, within 300 seconds, so a badly skewed tablet could in principle
place a payment on the wrong side of that line. A 04:00 boundary was less exposed
to this, because almost nothing is rung near it.

**Measured, the exposure is negligible.** Across all 684 settled bills in
production (2026-08-27): median `synced_at − paid_at` of 1.2 to 1.3 seconds, 95th
percentile 2.4 to 3.2 seconds, and 28 bills whose device clock ran *ahead* of the
server by at most 0.9 seconds. A boundary placed to the minute is far outside
that.

This is therefore **a stated bound rather than a guard to build**. The worst
observed lag, 14.9 hours at Kanchrapara, is delivery rather than skew — an offline
queue draining later — and that case is already handled: it raises a
reconciliation exception against the observation whose interval it fell in.
Revisit only if a future device shows minute-scale drift.

## The derived ledger month is measured, not assumed (#11)

A month view assembles thirty-one days from five sources with no stored row, which
is deliberate: a stored day row can disagree with its sources, and this one cannot.
The read cost is the trade, and it is **measured rather than assumed**: a whole
month reads in 285 to 389 ms, and a single day in 51 to 87 ms, through the real
adapter against a seeded August.
`supabase/tests/rest/zz-ledger-month-timing.test.ts` runs as its own `test:rls`
phase so that stays true.

If it ever stops holding, **the remedy is a materialised read model, never a
stored day row.** The whole point of the derived reading is that it cannot be
wrong about itself.
