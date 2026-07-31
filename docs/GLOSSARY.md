# Glossary

Domain terms, defined once. When code, specs, or UI copy use these words, they mean exactly this.

### Outlet

One physical Shawarmania counter — currently Kalyani or Kanchrapara. The unit of data isolation: nearly every table carries `outlet_id`, and nearly every permission question reduces to "which outlet?". A franchise is an outlet with an external owner; the software makes no structural distinction.

### Assignment

**Where a person works, and as what.** One row per person per role per outlet —
the thing that replaced a role-and-outlet pair on the account when
`multi-outlet-people` (#22) landed, because a person may work at more than one
place and a pair cannot say so.

A *live* assignment is one with no end date. Every permission question in the
database reduces to membership in this set: *does this person hold the right
assignment at this row's outlet?* Nothing about an assignment is carried in a
sign-in token, so granting or ending one takes effect at the very next request.

Ending an assignment is recording an end date, never deleting the row. Somebody
who has left **one** outlet still works at the others; somebody who holds no
live assignment anywhere has left the business, which is derived rather than
stored.

### Business date

**The trading day a record belongs to — not the calendar date of its timestamp.**

Each outlet has a `business_day_cutover` time (default 04:00 IST). A bill rung at 00:20 on the 12th belongs to business date the 11th, because it is part of the 11th's evening trade and will be counted in the 11th's drawer.

**The cutover is the seam between two trading days, not the outlet's opening time.** It belongs in the hours the counter is shut — later than the latest close, earlier than the earliest open — which for Shawarmania is roughly 01:00 to 06:00. An opening time entered here would file the morning's prep under the previous day and split one night's trading across two business dates. That is not hypothetical: both production outlets were first set up with their opening time in this field, so the outlet form now resolves a whole session against whatever is typed and shows where each moment would land.

Stored as an explicit `date` column on every operational record. **Never computed from `created_at` at read time** — that would silently reassign records if the cutover ever changed, and would break every historical total. If you find yourself writing `DATE(created_at)`, you have introduced a bug.

### Paise

The unit money is stored in. ₹139 is stored as `13900`. Always an integer, never a float or decimal string. Converted to rupees only for display, and only at the display edge.

### Bill

A settled customer transaction. Append-only: once settled, a bill's totals never change. A mistake is corrected by voiding the bill and creating a new one, so the history of what actually happened at the counter survives.

### Bill number

A per-outlet sequential identifier, human-readable and never reused. Distinct from the bill's `id`, which is a client-generated UUID. Two outlets each have a bill #1; that's fine, because bill numbers are only ever meaningful within an outlet.

### Line item snapshot

The copy of `item_name` and `unit_price_paise` stored on a bill line at the moment of sale. A bill is never joined to the live menu to determine what it cost — raising a price must not retroactively change last month's revenue, and deleting a menu item must not corrupt old bills.

### Counter device

The tablet enrolled to one outlet. It holds a long-lived session scoped by Row-Level Security to that outlet alone. The device — not the biller's PIN — is the security boundary for the billing surface.

### Shift

A biller's working session on a counter device, opened with a PIN and closed explicitly or by day rollover. Determines which biller a bill is attributed to. A shift never spans two business dates.

### Cash sales

The sum of settled bills with `payment_method = 'cash'` for an outlet on a business date. **The only sales figure that affects the cash drawer.** UPI, card, Swiggy and Zomato sales are revenue but not cash.

### Expected closing cash

```
opening_cash + cash_sales − cash_expenses − cash_withdrawn
```

What should be in the drawer at close, computed by the system.

### Actual closing cash

What the manager counted. Entered by a human at close.

### Cash difference

`actual_closing − expected_closing`. Negative means short, positive means over. Both are worth investigating; a consistently non-zero difference is a signal, which is why it is stored rather than just displayed.

### Cash withdrawal

Money removed from the drawer during or at the end of a day — banked, handed to the owner, or taken for a purchase. Reduces expected closing cash. Distinct from an expense: a withdrawal moves cash, an expense consumes it.

### Stock movement

A single change to an inventory item's quantity, one of: `added`, `used`, `wasted`, `correction`. The movements ledger is the truth; an item's current quantity is derived from it. This makes stock auditable — you can always answer "why does the system think we have 4kg?".

### Low-stock threshold

The quantity at or below which an inventory item is flagged as running low. Per item, per outlet.

### Food cost (estimated)

The cost of inventory consumed in a period, computed from `used` and `wasted` movements at their purchase cost. An estimate: it does not account for yield, portioning variance, or price changes between purchase lots.

### Alert

A message raised by a Franchise Admin for the Super Admin about an operational problem — inventory shortage, equipment failure, cash mismatch, employee or supplier issue. Carries a priority and a status, and can receive a response.

### Badge

A small count attached to the thing it is about — a navigation entry, a day, a control — meaning **this many items are waiting for you to act**. It clears by the work being done rather than by being dismissed, and a count of nought is drawn as nothing at all. Distinct from an **alert**, which is a message one person raises for another and which carries a priority, a status and a reply; a badge carries no content, names no sender, and is read by whoever happens to be holding the app. A badge is also not a notification: it reaches nobody who is not already looking. See [Design System](DESIGN_SYSTEM.md) and [Limitations](LIMITATIONS.md).

### Geofence

The radius around an outlet's stored coordinates within which a reading counts as on-site. It judges two things and refuses neither: an employee's check-in, which is recorded whatever its distance, and a manager's approval, which is recorded whatever its distance but costs a written reason from outside. See [Roles And Permissions](ROLES_AND_PERMISSIONS.md) for the approval rule and [Limitations](LIMITATIONS.md) for what geolocation can and cannot prove.

### Approval

The recorded human decision that makes an attendance day count. Only a Super Admin, or a Franchise Admin holding a live assignment at the row's own outlet, can record one; it carries the approver's identity, the time, their own position, and a reason where the rule asks for one. It replaced the **override** in #26, which was the exception path for a check-in the fence refused — once every day goes through it, the word describes nothing.

### On-site approval

An approval whose recorded position is inside the outlet's radius. Derived from the stored coordinates rather than claimed, and the one case that needs no reason — together with the requirement that it be given on the row's own business day.

### Arrival deadline

The per-outlet time by which staff are expected to have arrived, defaulting to 13:00 and set by the owner beside the business-day cutover. Stamped onto each attendance row when its arrival lands, so a later edit never changes how a recorded day reads.

### Late

An arrival after the deadline stamped on its own row. A tag shown wherever attendance is read, never a status: an approved late day is present *and* late, and whether that costs half a day stays a manager's decision recorded in the status.

### Outbox

The client-side queue of counter writes that have not yet reached the server. Lives in IndexedDB, survives reload and device restart, drains when connectivity returns. See [Offline And Sync](OFFLINE_AND_SYNC.md).

### Brand token / semantic token

Two layers of the theme. **Brand tokens** (`--brand-flame-orange`) hold Shawarmania's actual colours. **Semantic tokens** (`--color-primary`, `--color-surface`) describe roles. Components only ever read semantic tokens, so re-skinning for a franchise is a one-file change. See [Design System](DESIGN_SYSTEM.md).
