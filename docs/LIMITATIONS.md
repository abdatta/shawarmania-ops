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

There is no salary data anywhere in the schema or the UI — `staff-as-accounts` (#21) removed the roster's `salary_paise` rather than migrating it, by owner decision. Attendance feeds whatever payroll process the business runs outside the app, and wages actually paid are recorded as ordinary expenses under the `salaries` category. If payroll ever becomes in-scope, salary fields return by migration onto the person's account record — nothing else has to move.

### Menu is per-outlet, with no shared catalogue

Each outlet owns its menu. Two outlets selling the same item means two rows. For two outlets this is fine and keeps isolation simple; at ten franchises, brand-wide menu consistency will want a master catalogue that outlets inherit from and override. Deferred until the franchise count makes it worth the complexity.

### Customers are per-outlet

The same person visiting both outlets is two customer records. Unifying them would mean reading across the isolation boundary — the exact thing the security model is built to prevent — for modest business value. Revisit only with a deliberate design for cross-outlet identity.

## Real-world edges

### Browser geolocation is spoofable

Attendance location can be faked with browser devtools or a mock-location app. This **raises the bar; it is not proof.** It is stated here rather than assumed away because the consequence matters: a location flag must never be treated as evidence in a dispute about someone's pay.

The counter-tablet check-in path is substantially stronger — the device is physically in the shop — and is available as an alternative wherever assurance matters more than convenience.

GPS accuracy indoors also drifts 20–100m routinely, which is why the geofence has a manager override and a tablet fallback rather than being a hard wall.

### An unsynced bill exists in exactly one place

Between settling a bill offline and syncing it, the only copy is in that tablet's IndexedDB. **A destroyed or wiped tablet loses those bills.**

Mitigated by draining aggressively, keeping the pending count always visible, and escalating a growing backlog to a warning. Not eliminated — that would need a second local device, which is out of proportion to the risk at this scale. See [Offline And Sync](OFFLINE_AND_SYNC.md).

### Late bills against a closed day

A bill synced after its business date was reconciled becomes a **reconciliation exception**, not a silent recalculation. The manager decides whether to reopen and re-close the day or accept the discrepancy with a note. Deliberate: a number a human signed off must never change by itself.

### Clock skew on the counter tablet

Both client and server timestamps are stored. A badly wrong tablet clock can produce a wrong `business_date`, since the business date is resolved on the device at settlement. Material disagreement between the two clocks should be surfaced as a signal. There is no automatic correction — repairing a business date automatically could move revenue between days, which is worse than flagging it.

### Two tablets at one outlet

Supported, but shift overlaps are flagged for a human rather than resolved automatically, because the right answer depends on what actually happened in the shop.

## Operational gaps

### Staff recovery still requires an administrator

Franchise Admins, Billers and Employees intentionally have no self-service
email recovery. An associated email may become an alternate sign-in later, but
an authorized Admin or Super Admin still regenerates a one-time link and hands
it over. Only a Super Admin can self-recover by private email, because locking out
the only business-wide administrator cannot depend on another administrator
being reachable.

There is also **no screen for changing a password one still knows, requesting
a username change, or changing one's own Super Admin account email**. Those
belong to [Self-Service Account Settings](../openspec/todos/self-service-account-settings.md);
until then another authorized admin performs supported corrections.

### Billers use a personal username session, for now

The counter tablet is meant to hold a *device* credential with a shift PIN
selecting attribution — that design is in
[Roles And Permissions](ROLES_AND_PERMISSIONS.md) and arrives with
`counter-devices-and-offline`. Until it does, a Biller signs in on the tablet
with their personal username and password.

This is exactly the arrangement that document argues against: a shared device holding a personal credential gets left signed in, and the password gets typed on a greasy counter screen in front of whoever is standing there. It is accepted deliberately and briefly, because the alternative was to leave one of the four roles unable to sign in at all. The exposure is bounded by RLS to that one outlet's billing surfaces, which is the same scope enrolment will give the device anyway.

### No automated data retention

Nothing is deleted automatically. Customer PII has no defined retention period, and attendance location data accumulates indefinitely. Both should get a retention policy before headcount or customer volume grows meaningfully. Noted in [Security And Privacy](SECURITY_AND_PRIVACY.md).

### An outlet that was ever staffed cannot be deleted

An outlet is deletable only while nothing references it. Assignments are retained as dated history when somebody leaves, so even an ended assignment still holds its foreign-key reference to the outlet. Deactivation is independent and changes nothing about those rows.

The consequence is narrow but real: staffing an outlet once makes that outlet permanently ineligible for deletion. This is deliberate. Deleting the assignment would erase where the person worked, while teaching outlet deletion to ignore ended assignments would allow the outlet row those records name to disappear. An outlet created by mistake and never staffed deletes cleanly; one that was staffed should be marked closed instead.

### No audit log

Who changed a price, voided a bill, or overrode a geofence is recorded on the affected row (`voided_by`, `override_by`, `recorded_by`), but there is no separate immutable audit trail. Sufficient for a small trusted team; insufficient if a franchise dispute ever turns adversarial.

### Single Supabase project, single region

All outlets share one project. Fine for West Bengal. A backup and restore procedure is documented in [Operations](OPERATIONS.md), but there is no tested disaster-recovery drill until the roadmap's operations work lands.

## Not planned

- Customer-facing ordering or loyalty
- Table management or KOT — this is a counter format, not a dine-in restaurant
- Supplier and purchase-order workflows
- Multi-currency or multi-language (₹ and English only; revisit if franchises want Bengali)
- Native mobile apps — the PWA is the delivery mechanism
