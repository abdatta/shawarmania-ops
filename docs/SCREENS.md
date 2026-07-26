# Screens

> Describes the intended surface. Nothing is built yet.

One bundle serves all four roles. After sign-in the shell reads the role claim and mounts a different navigation and route set. Every screen below is additionally protected by Row-Level Security — hiding a route is convenience, not access control.

**Every screen here is built twice over, in a sense**: first against mocked data behind a feature gate, so the whole experience is demonstrable early, and later wired to real data by a `*-live` change that swaps one adapter and promotes the gate — without redesigning anything. A screen in the `hidden` state is genuinely absent from navigation, not greyed out. See [Demo Mode](DEMO_MODE.md).

## Shared

**Sign in** — phone number + password. One field pair, a large keypad-friendly phone input, nothing else. First-time users arrive with a one-time code instead of a password and are walked through setting one.

**Profile** — own name, phone, role, assigned outlet. Change password. Sign out.

## Biller — the counter tablet

The only role that gets a purpose-built layout. Landscape tablet, fixed chrome, nothing that scrolls unexpectedly.

**Shift unlock** — a grid of the outlet's billers by name; tap yours, enter your PIN, shift opens. Big targets, no keyboard. Also where a shift is handed over: the outgoing biller closes, the incoming one opens.

**Billing counter** — the heart of the product, and the screen most worth getting right.

```
┌──────────────────────────────────────┬─────────────────────────┐
│  MENU GRID                           │  CURRENT BILL           │
│  ┌────────┐ ┌────────┐ ┌────────┐    │  Classic Shawarma ×2    │
│  │Classic │ │Mayo    │ │Double  │    │  Mozzarella       ×1    │
│  │ ₹139   │ │ ₹159   │ │ ₹179   │    │                         │
│  └────────┘ └────────┘ └────────┘    │  ─────────────────────  │
│  ┌────────┐ ┌────────┐ ┌────────┐    │  TOTAL      ₹477        │
│  │Mozzare.│ │Salad   │ │Stuffed │    │                         │
│  │ ₹199   │ │ ₹219   │ │ ₹238   │    │  Customer (optional)    │
│  └────────┘ └────────┘ └────────┘    │  ┌───────────────────┐  │
│                                      │  │ CASH │ UPI │ CARD │  │
│  Whole menu visible — no search,     │  │ SWIGGY │ ZOMATO   │  │
│  no category drilling               │  └───────────────────┘  │
│                                      │  ┌───────────────────┐  │
│  [● synced]                          │  │     SETTLE        │  │
└──────────────────────────────────────┴──┴───────────────────┴──┘
```

Design commitments:

- **The whole menu fits on one screen.** Seven items today, and unlikely to exceed twenty. A search box or category tabs would be slower than looking.
- **Tap to add, tap again to increment.** Quantity adjustment is available but rarely needed for a 1–3 item order.
- **Customer name and phone are optional and never block settling.** At peak they will be skipped, and a required field would just get filled with junk.
- **Payment method is one tap, then settle.** Two taps from a complete order to a cleared screen.
- **Settling is instant.** The bill goes to the outbox; nothing is awaited. The screen clears for the next customer.
- **Sync state is a small persistent indicator**, never a dialog.

**Bill confirmation** — a brief, dismissible summary after settling, showing the total and the bill reference. Auto-clears; a queue does not wait for an acknowledgement.

**My shift** — bills created during this biller's current shift, with a running total by payment method. Read-only. Not the outlet's whole history — reviewing the day is a manager's job, and a shared tablet should not display the outlet's takings to whoever is standing at it.

**Attendance kiosk** — the secondary check-in path. An employee taps their name and PIN on the tablet to clock in or out. Exists so that a dead phone or a failed GPS fix never leaves someone unable to record their attendance.

## Franchise Admin — one outlet, on a phone

**Outlet dashboard** — today at a glance: sales so far split by payment method, cash position, low-stock items, open alerts, who is checked in. The screen a manager opens twenty times a day, so it answers questions without navigation.

**Menu** — list, add, edit, and disable items and categories. Price changes and the availability toggle are the frequent actions and sit closest to the thumb. Editing a price warns that it applies to future bills only.

**Inventory** — items with current quantity and a clear low-stock treatment. Recording a movement (added / used / wasted / correction) is the primary action. Each item opens to its movement ledger, so "why does it say 4kg?" is always answerable.

**Expenses** — the day's expenses, and a fast add form: category, amount, payment method, description. Cash expenses are visually distinct because they alone affect the drawer.

**Daily cash** — the reconciliation screen. Opening float, cash sales (derived), cash expenses (derived), withdrawals, expected closing, and a field for the actual counted amount. The difference is shown prominently the moment it is entered, because that number is the entire point of the screen. Closing the day snapshots the figures.

**Attendance** — the outlet's staff by day: who checked in, when, from where, and any geofence flags. Approving an override request happens here.

**Employees** — the outlet roster. Add and edit staff, set employment status, issue app access.

**Profit and loss** — outlet-level estimate for a chosen period, with the **cash-basis / consumption-basis toggle stated plainly on screen**, because the two answer different questions and mixing them is the classic error. See [Data Model](DATA_MODEL.md#two-modelling-traps-in-this-domain).

**Alerts** — raise an issue to the owner (category, priority, message) and track responses.

**Devices** — enrolled counter tablets, last seen, and revoke.

## Super Admin — all outlets, on a phone

**Owner dashboard** — every outlet side by side: today's sales, cash position, open alerts, anything needing attention. Designed to be read in ten seconds while doing something else.

**Outlet switcher** — pick an outlet and drop into the full Franchise Admin view of it, read-only for operational records. This is how the owner inspects a specific shop without a parallel set of screens.

**Outlets** — create, edit, activate and deactivate outlets. Setting coordinates, geofence radius and business-day cutover happens here. Onboarding a new franchise starts here.

**People** — all users across outlets. Create Franchise Admins, reassign roles, deactivate accounts.

**Comparison** — outlets side by side over a period: sales, expenses, estimated profit, cash differences. The screen that justifies the whole system for a multi-outlet owner.

**Alerts inbox** — everything raised across outlets, by priority and status. Respond and resolve.

## Employee — a phone, and almost nothing else

**Home** — one large check-in or check-out button, today's status, and the outlet they are assigned to. If the geofence blocks them, this screen explains why and offers to request a manager override.

**My attendance** — own history: dates, hours, status. Own records only, enforced in the database.

## Cross-cutting

- **Every screen is responsive.** Manager and employee screens are phone-first; billing is tablet-first; everything is usable on a desktop browser.
- **The app is installable** and launches full-screen from the home screen.
- **Rupees everywhere**, Indian digit grouping, tabular figures.
- **Asia/Kolkata everywhere.** Business dates display as dates, never as timestamps.
