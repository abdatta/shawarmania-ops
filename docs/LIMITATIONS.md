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

## The owner's remote entries are non-cash, and that is a bound not a warning

The Super Admin can record a non-cash expense and a stock correction at any
outlet. They cannot record a cash expense, a withdrawal or a day close there,
and the refusal is the database's rather than a form's — so nothing recorded
remotely can move a drawer somebody else is responsible for counting. An owner
who genuinely needs the cash path takes an assignment as that outlet's manager,
which is a visible, recorded act.

The bound survived the owner gaining every outlet's manager screens without an
assignment (#28): they reach the cash screen at any outlet, read the whole day
there, and are offered neither of the two writes. Whether an outlet with no
dedicated manager should hand its drawer to the owner is an open design question
in `daily-cash-live` (#12).

## The manual ledger is a stopgap with a stated exit

August 2026 is trading while billing (#10), expenses and inventory (#11) and
daily cash (#12) are still proposals, so nothing records what the outlets sold,
spent, or held in the drawer. The **Ledger** surface (#36) is where the owner
writes that down by hand until those surfaces land. It is deliberately small: two
tables, no workflow, no sign-off and no correction history.

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
- **Opening cash and both commission rates are stored per day**, offered from the
  previous recorded day and editable. Correcting an old day therefore changes
  only that day. The price is that the chain can break — a day's stored opening
  may disagree with the previous day's count — and the surface reports that
  without repairing it, because a figure somebody counted is evidence and a
  recomputed one is not.
- **No consumption-basis profit**, because no stock is valued here. Raw materials
  are taken as zero on hand at the start of tracking, by owner decision.
- **It grants the owner no authority that survives it.** They may type cash
  figures into this notebook only because no real drawer record exists yet to
  corrupt. The bound in the section above is untouched, and #12 must not inherit
  this permission — it decides its own boundary on its own merits. That an outlet
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

**Its exit belongs to #12**, and is recorded in that change's proposal as
inherited scope: the change that removes this capability must first carry every
recorded day and expense row into the live cash and expense records. The rows are
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

### Profit and loss is an estimate, not accounting

This is not a filing-grade financial report and must not be used as one. Specifically it does not model depreciation, opening and closing stock valuation properly, accruals, aggregator commission, or taxes. It answers "is this shop making money this month?" — a genuinely useful question, and a different one from what an accountant needs.

The cash-basis / consumption-basis distinction is real and the UI always states which is shown. See [Data Model](DATA_MODEL.md#two-modelling-traps-in-this-domain).

### No aggregator reconciliation

Swiggy and Zomato orders are recorded as bills so revenue and item-level sales stay complete. But **the recorded amount is the order value, not what Shawarmania actually receives** — aggregators settle later, net of commission. Aggregator revenue in this system is therefore systematically overstated relative to cash in the bank.

This is the single largest known inaccuracy in the P&L. Worth fixing when aggregator volume matters enough to distort decisions; fixing it means either manual settlement entry or an aggregator integration.

### Payroll is out of scope

There is no salary data anywhere in the schema or the UI — `staff-as-accounts` (#21) removed the roster's `salary_paise` rather than migrating it, by owner decision. Attendance feeds whatever payroll process the business runs outside the app, and wages actually paid are recorded as ordinary expenses under a free-text category such as `Staff wages`. If payroll ever becomes in-scope, salary fields return by migration onto the person's account record — nothing else has to move.

### Menu is per-outlet, with no shared catalogue

Each outlet owns its menu. Two outlets selling the same item means two rows. For two outlets this is fine and keeps isolation simple; at ten franchises, brand-wide menu consistency will want a master catalogue that outlets inherit from and override. Deferred until the franchise count makes it worth the complexity.

### One customer identity, and deliberately nothing built on it

Customers are business-wide since `global-customer-identity` (#32): one normalized phone is one person at either outlet. What that change deliberately did **not** build is anything that reads across outlets *about* them. There is no visit count, no spend total, no cross-outlet history, no loyalty, no marketing and no export — a counter that could see any of those could see the other outlet's trade through a customer both shops serve. See [`openspec/todos/customer-loyalty-and-cross-outlet-insights.md`](../openspec/todos/customer-loyalty-and-cross-outlet-insights.md), which is where that work waits for a real decision to justify it.

Three consequences worth stating plainly:

- **A phone is the identity.** Somebody who gives a different number is a different customer, and a reassigned number carries the old identity with it. No merge, split or reassignment flow exists; the first real case is what should design one.
- **Several people sharing one phone are one customer.** A household ordering on one number is normal, and at launch it reads as a single identity.
- **No screen edits a customer.** The owner can read the directory; nobody can rename or delete a profile from the app. Correction is a deliberate future flow, not something to smuggle into billing.

**A shared directory is a franchise fact, not a technical detail.** Both outlets are owned today, so one directory is uncontroversial. Before `outlet-onboarding` (#14) puts a third-party franchisee on this schema, the franchise agreement must say that customer identity is shared brand-wide while every transaction stays the outlet's own.

## Real-world edges

### Browser geolocation is spoofable

Attendance location can be faked with browser devtools or a mock-location app. This **raises the bar; it is not proof.** It is stated here rather than assumed away because the consequence matters: a location flag must never be treated as evidence in a dispute about someone's pay.

The planned counter-tablet check-in path would be substantially stronger — the
device is physically in the shop — but it is not built yet. Today the fallback
is a manager-entered arrival, which is explicitly an attestation and stores no
invented GPS evidence.

GPS accuracy indoors also drifts 20–100m routinely, which is why the geofence refuses nothing at all: it is evidence a manager reads, and the manager's approval is what counts a day. That approval carries the manager's own position for the same reason it carries the employee's, and it is subject to the same limitation — an approval recorded as on-site raises the bar that the manager was there, and does not prove it.

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

### A badge is not a notification, and its count can be stale

The count on the Attendance tab reaches only somebody already holding the app. Nothing pushes: a manager who does not open it does not find out, and the person whose day it is finds out when they query their pay. Reaching somebody who is not looking needs a service-worker subscription, a server to hold it and a key pair to sign with, none of which exists; it is tracked in `openspec/todos/pending-approval-notification.md`.

The count is also **read on arrival rather than kept live**. It is correct when a screen is opened and again when the app is brought back to the foreground, and it may lag work that arrives while a screen sits open. That is a deliberate trade against battery on a phone that spends its day in an apron: a timer waking the radio for a number nobody is looking at is a cost paid continuously for a benefit taken occasionally. A read that fails leaves the last known number on screen rather than blanking it, because a badge that vanishes says the work is done.

### Recorded check-out history is gone

Check-out was removed in #26 (owner decision, 2026-07-31) with the cost stated: the check-out times and locations already recorded in production were dropped by the migration. A full production dump was taken and verified beforehand and lives outside the repo under the snapshot procedure, so the data exists — but no screen can show it again, and there is no down migration. Nobody had used the feature, and unused monitoring data is the kind [Security And Privacy](SECURITY_AND_PRIVACY.md) says not to keep; that is the trade, not an accident.

### The durable billing queue arrives with billing-live

The server accepts immutable, exactly replayable command envelopes now, but no
live screen stores them yet: billing remains demo-gated. `billing-live` (#10)
adds the IndexedDB queue, dependency-ordered draining and visible backlog.

Once live, an unacknowledged envelope exists only on its tablet. There is no
order transfer and no privileged recovery upload. A manager cancels a stranded
open order with a reason and the counter re-rings it; a destroyed tablet's
unsent pay-now sale has no recovery path.

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
