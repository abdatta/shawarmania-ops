# Screens

> The four role shells exist, and all four roles now sign in and reach their own (#4): phone shells with bottom-tab navigation for Super Admin, Franchise Admin and Employee, the fixed-chrome tablet shell for the Biller, each with a thin home overview. Sign in, Set your password, People, Access, Outlets, Staff, Attendance and My attendance are built, and the setup chain from an empty database through to a working check-in runs entirely in the app (#5, #15). Activation is one tap and one password — the code travels in a link, and the address is shown for confirmation rather than typed (#16). Every other *feature* screen below is still to come — its shell, gate entry and layout primitives are waiting for it.

One bundle serves all four roles. After sign-in the shell reads the role claim and mounts a different navigation and route set; in demo mode the same shells mount from the URL (`/demo/owner`, `/demo/admin`, `/demo/biller`, `/demo/staff` — the stable role path segments). Every screen below is additionally protected by Row-Level Security — hiding a route is convenience, not access control.

**Every screen here is built twice over, in a sense**: first against mocked data behind a feature gate, so the whole experience is demonstrable early, and later wired to real data by a `*-live` change that swaps one adapter and promotes the gate — without redesigning anything. Gates live in `src/gates/registry.ts`; a screen in the `hidden` state is genuinely absent — no navigation entry, no reachable route — not greyed out. Shared layout primitives (page header, data table, empty state, form sheet, confirm dialog) live in `src/components/layout/` and every surface below composes them. See [Demo Mode](DEMO_MODE.md).

## Shared

**Sign in** — email + password. One field pair, nothing else. A wrong address and a wrong password get the same sentence, deliberately: telling them apart would confirm which addresses have accounts. There is no "forgot password" link, because there is no self-service reset — the honest instruction is the activation link.

**Set your password** — the first-run screen, and the whole of password reset. Ordinarily reached by opening the activation link an admin sent, which carries the code, so **the only thing typed is a password** — entered twice, because it is typed blind with no way back: a typo sets a password nobody knows and spends the code proving it. It opens by showing the address the account will sign in with and asking, with two equally prominent answers, whether that is you — never a passive Continue, because catching a mistyped address is the entire reason the step exists. Saying it is not yours sends you to your manager, who can correct it. A dead link says so on arrival, before anything has been typed. Somebody handed only the code, with no link, gets one field asking for it and then the same confirmation. A separate screen rather than a sign-in field clever enough to guess whether you typed a password or a code — guessing would be wrong occasionally and confusing always, on somebody's first day.

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

**Attendance kiosk** — the secondary check-in path. An employee taps their name and PIN on the tablet to clock in or out. Exists so that a dead phone or a failed GPS fix never leaves someone unable to record their attendance. *(Not built — it needs enrolled devices. Until then the manager override is the only escape hatch, which is workable but costs an approval.)*

## Franchise Admin — one outlet, on a phone

**Outlet dashboard** — today at a glance: sales so far split by payment method, cash position, low-stock items, open alerts, who is checked in. The screen a manager opens twenty times a day, so it answers questions without navigation.

**Menu** — list, add, edit, and disable items and categories. Price changes and the availability toggle are the frequent actions and sit closest to the thumb. Editing a price warns that it applies to future bills only.

**Inventory** — items with current quantity and a clear low-stock treatment. Recording a movement (added / used / wasted / correction) is the primary action. Each item opens to its movement ledger, so "why does it say 4kg?" is always answerable.

**Expenses** — the day's expenses, and a fast add form: category, amount, payment method, description. Cash expenses are visually distinct because they alone affect the drawer.

**Daily cash** — the reconciliation screen. Opening float, cash sales (derived), cash expenses (derived), withdrawals, expected closing, and a field for the actual counted amount. The difference is shown prominently the moment it is entered, because that number is the entire point of the screen. Closing the day snapshots the figures.

**Attendance** — the outlet's staff by day: who checked in, when, from where, how accurate the reading was, and any geofence flags. **Every active roster member appears, including those with nothing recorded** — a day view that listed only the rows that exist would quietly hide the people who never arrived. A check-in the fence could not vouch for is marked as waiting for a decision and counted absent until it is approved; approving it records the approver and a reason that cannot be blank.

**Staff** — the outlet roster. Add and edit people, set role, joining date, and employment status; someone who has left stays on the record and drops off the attendance day. *(Pay is not on this screen: the roster shipped with attendance is the attendance-facing one, and salary is the most sensitive column on the table.)*

Having a login and being on the payroll are different facts about a person, and either can be true without the other — so **this screen is also where the two are joined**. Every row says whether an app account is linked and whether it is active, which makes *"why can this person not check in?"* answerable by looking at the screen rather than at the database; that question gets asked by phone, mid-shift. Adding or editing someone offers the unlinked accounts at this outlet, and **Unlink** separates them again, stating first that the person stops being able to check in and that every day already recorded stays on the roster, because those days were worked.

**Access** — app accounts for this outlet: create a Biller or an Employee, issue a one-time code and its activation link, deactivate and reactivate. The same screen as the owner's **People**, seen through one outlet's authority — including the failed-activation notice, which a manager is not shown at all — no outlet column, no role beyond Biller and Employee, and the privileged function refuses anything wider whatever the form sends.

Provisioning an **Employee** also asks about the staff list, in three explicit answers: add them to it with a staff code, link them to somebody already on it, or leave them off. It never writes a roster row as a side effect — that would assert that every Employee account is a payroll employee, which the schema deliberately says is not true. An incomplete answer — "add them" with no staff code, "link them" without saying to whom — creates nothing at all, because provisioning first and failing second would leave an admin holding a code for a half-configured person. The account and the roster row are still two separate writes, so if the second one fails for any other reason the code is shown anyway, the failure is reported as an unfinished link rather than a failed provisioning, and the state is repairable on **Staff**.

**Profit and loss** — outlet-level estimate for a chosen period, with the **cash-basis / consumption-basis toggle stated plainly on screen**, because the two answer different questions and mixing them is the classic error. See [Data Model](DATA_MODEL.md#two-modelling-traps-in-this-domain).

**Alerts** — raise an issue to the owner (category, priority, message) and track responses.

**Devices** — enrolled counter tablets, last seen, and revoke.

## Super Admin — all outlets, on a phone

**Owner dashboard** — every outlet side by side: today's sales, cash position, open alerts, anything needing attention. Designed to be read in ten seconds while doing something else.

**Outlet switcher** — pick an outlet and drop into the full Franchise Admin view of it, read-only for operational records. This is how the owner inspects a specific shop without a parallel set of screens.

**Outlets** — where each outlet is, and how far staff may be when they check in. **Position is captured on site, from the device standing at the counter**, never typed in or picked off a map: the screen takes a reading over a few seconds, keeps the tightest sample, and shows its accuracy before anything is saved. A fix looser than ±50 m is refused outright, and one between ±25 m and ±50 m saves with a warning — this reading is judged once and then judges every future check-in, so it deserves a stricter bar than a check-in does. The accuracy and the capture time are stored with the position, so an outlet carrying placeholder coordinates is visible as such rather than indistinguishable from a surveyed one. Only the Super Admin may write it: a manager already holds the override, but an override is recorded with who and why, while moving the fence is silent and applies to everyone from then on.

The same screen creates and edits an outlet: code, name, location label, address, phone, and the business-day cutover. A **Find the address** search sits above the address block: type a landmark, street or shop, pick a suggestion, and the street line, second line, city and PIN fill in one action — with the District following from the PIN, because no geocoder answers the Indian revenue district correctly and India Post does. It fills the location label only when that field is still empty, never overwriting the owner's own wording. Everything it writes stays editable, and the block is exactly as typeable as it was: an outlet must be creatable when the lookup finds nothing or the phone has no signal, so a failed search says nothing at all and a search with no matches simply says so. **The address search never gives an outlet its position** — the coordinates that come back are discarded, because the geofence is captured on site and a rooftop centroid would mark somebody absent at their own counter. **Its empty state is the important one** — it is the first screen an owner sees on a new installation, and it says what to do rather than reporting no data, because nothing else in the product is reachable until an outlet exists. Editing the cutover is safe at any time: business dates are stored as explicit columns and never derived from a timestamp at read time, so a new cutover applies to the next day resolved and moves nothing already recorded.

An outlet can also be **marked closed**. That means the shop is not trading: it disappears from the lists accounts are assigned from, and check-ins there are refused — while a check-out is never refused, so anyone mid-shift can still close their day. Nothing cascades. Accounts, roster rows and recorded attendance are untouched, no login is revoked, and reopening is one tap; the confirmation says all of that, because an owner expecting it to cut off access would be dangerously wrong.

**Staff** — the same roster screen a Franchise Admin uses, with an outlet picker in front of it. The Super Admin belongs to no outlet by schema constraint, so without this the one person who can create an outlet could not then put anybody on its staff list.

**People** — every account across all outlets. Create an account of any role in any outlet, issue a fresh one-time code, correct a wrong email address, deactivate and reactivate. Each row carries the address that account signs in with — visible only to admins who manage it, and never to the counter tablet. A newly issued code is handed over **once**, and **as a link only**: a QR for handing a phone across a counter — tap it to fill the screen, since the panel has no room to draw it at a size another camera reads reliably — the link itself, and one button to copy it. The raw code is deliberately not printed beside it — one way to hand access over rather than a choice between three, and it kept the panel wordy for a handover nobody should be using. The URL carries no address. The panel states plainly that it cannot be looked up again — because only its hash is stored, and no client can read that. Above it, the owner alone sees a notice when failed activations across the whole endpoint are unusually high, which is the only signal a targeted guessing attempt gives off. Your own row offers no actions: nobody manages their own account. *(Reassigning roles is not built yet; the database already cancels any outstanding code when someone is moved.)*

**Comparison** — outlets side by side over a period: sales, expenses, estimated profit, cash differences. The screen that justifies the whole system for a multi-outlet owner.

**Alerts inbox** — everything raised across outlets, by priority and status. Respond and resolve.

## Employee — a phone, and almost nothing else

**Home** — one large check-in or check-out button, today's status, and the outlet they are assigned to.

If the geofence blocks them, this screen says how far outside the limit they were, what the limit is, and how accurate their phone's reading was, then offers to ask a manager to approve it. **A refused check-in records nothing** until they choose to ask — walking away leaves no row and does not consume the one record that day allows. If the phone cannot supply a position at all, the screen names which of permission, signal, or timeout failed, and offers the same route through.

**My attendance** — own history: dates, times, status, and for each day the same distance, accuracy, source, and override detail — including the approver's name and their reason — that the manager's view shows. Own records only, enforced in the database. The symmetry is deliberate and is built by sharing the components: asymmetric visibility in a monitoring feature is how it becomes something staff resent.

## Cross-cutting

- **Every screen is responsive.** Manager and employee screens are phone-first; billing is tablet-first; everything is usable on a desktop browser.
- **The app is installable** and launches full-screen from the home screen.
- **Rupees everywhere**, Indian digit grouping, tabular figures.
- **Asia/Kolkata everywhere.** Business dates display as dates, never as timestamps.
