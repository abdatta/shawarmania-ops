# Screens

> The four role shells exist, and all four roles now sign in and reach their own (#4): phone shells with bottom-tab navigation for Super Admin, Franchise Admin and Employee, the fixed-chrome tablet shell for the Biller, each with a thin home overview. Sign in, Set your password, People and Access are built. Every other *feature* screen below is still to come — its shell, gate entry and layout primitives are waiting for it.

One bundle serves all four roles. After sign-in the shell reads the role claim and mounts a different navigation and route set; in demo mode the same shells mount from the URL (`/demo/owner`, `/demo/admin`, `/demo/biller`, `/demo/staff` — the stable role path segments). Every screen below is additionally protected by Row-Level Security — hiding a route is convenience, not access control.

**Every screen here is built twice over, in a sense**: first against mocked data behind a feature gate, so the whole experience is demonstrable early, and later wired to real data by a `*-live` change that swaps one adapter and promotes the gate — without redesigning anything. Gates live in `src/gates/registry.ts`; a screen in the `hidden` state is genuinely absent — no navigation entry, no reachable route — not greyed out. Shared layout primitives (page header, data table, empty state, form sheet, confirm dialog) live in `src/components/layout/` and every surface below composes them. See [Demo Mode](DEMO_MODE.md).

## Shared

**Sign in** — email + password. One field pair, nothing else. A wrong address and a wrong password get the same sentence, deliberately: telling them apart would confirm which addresses have accounts. There is no "forgot password" link, because there is no self-service reset — the honest instruction is the activation link.

**Set your password** — the first-run screen, and the whole of password reset. Email, the one-time code an admin handed over, and a new password; on success it signs you straight in. A separate screen rather than a sign-in field clever enough to guess whether you typed a password or a code — guessing would be wrong occasionally and confusing always, on somebody's first day.

**Account menu** — in every shell's chrome: who you are, your role, your outlet, and sign out. Demo shells do not have one; there is no session to end.

**Profile** — own name, phone, role, assigned outlet. Change password. Sign out. *(Not built. Sign-out lives in the account menu; changing a password you still know is [deferred by decision](../openspec/todos/signed-in-password-change.md).)*

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

**Employees** — the outlet roster. Add and edit staff, set employment status, joining date, salary. *(Not built.)* Giving someone an app login is a separate screen — see **Access** — because having a login and being on the payroll are different facts about a person, and either can be true without the other. The roster will link across to it.

**Access** — app accounts for this outlet: create a Biller or an Employee, issue a one-time code, deactivate and reactivate. The same screen as the owner's **People**, seen through one outlet's authority — no outlet column, no role beyond Biller and Employee, and the privileged function refuses anything wider whatever the form sends.

**Profit and loss** — outlet-level estimate for a chosen period, with the **cash-basis / consumption-basis toggle stated plainly on screen**, because the two answer different questions and mixing them is the classic error. See [Data Model](DATA_MODEL.md#two-modelling-traps-in-this-domain).

**Alerts** — raise an issue to the owner (category, priority, message) and track responses.

**Devices** — enrolled counter tablets, last seen, and revoke.

## Super Admin — all outlets, on a phone

**Owner dashboard** — every outlet side by side: today's sales, cash position, open alerts, anything needing attention. Designed to be read in ten seconds while doing something else.

**Outlet switcher** — pick an outlet and drop into the full Franchise Admin view of it, read-only for operational records. This is how the owner inspects a specific shop without a parallel set of screens.

**Outlets** — create, edit, activate and deactivate outlets. Setting coordinates, geofence radius and business-day cutover happens here. Onboarding a new franchise starts here.

**People** — every account across all outlets. Create an account of any role in any outlet, issue a fresh one-time code, deactivate and reactivate. A newly issued code is shown **once**, with a plain statement that it cannot be looked up again — because only its hash is stored, and no client can read that. Your own row offers no actions: nobody manages their own account. *(Reassigning roles is not built yet; the database already cancels any outstanding code when someone is moved.)*

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
