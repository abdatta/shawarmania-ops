# Screens

> The four role shells exist, and all four roles now sign in and reach their own (#4): phone shells with bottom-tab navigation for Super Admin, Franchise Admin and Employee, the fixed-chrome tablet shell for the Biller, each with a thin home overview. Sign in, Set your password, People, Access, Outlets, Staff, Attendance and My attendance are built, and the setup chain from an empty database through to a working check-in runs entirely in the app (#5, #15) — **walked in production**: an outlet created and surveyed on site, a phone check-in at 5.1 m from its fence, and a check-out. Activation is one tap and one password — the code travels in a link, and the address is shown for confirmation rather than typed (#16).
>
> **The counter and the manager's operational surfaces are built and demo-gated** (#6, #7): the billing counter with its shift screens and sync indicator, and Menu, Stock, Expenses and Daily cash — all walkable at `/demo/*` against mocked data, none of them connected to real data yet. They become real one at a time in #10, #11 and #12. Everything else below is still to come.

One bundle serves all four roles. After sign-in the shell reads the role claim and mounts a different navigation and route set; in demo mode the same shells mount from the URL (`/demo/owner`, `/demo/admin`, `/demo/biller`, `/demo/staff` — the stable role path segments). Every screen below is additionally protected by Row-Level Security — hiding a route is convenience, not access control.

**Every screen here is built twice over, in a sense**: first against mocked data behind a feature gate, so the whole experience is demonstrable early, and later wired to real data by a `*-live` change that swaps one adapter and promotes the gate — without redesigning anything. Gates live in `src/gates/registry.ts`; a screen in the `hidden` state is genuinely absent — no navigation entry, no reachable route — not greyed out. Shared layout primitives (page header, data table, empty state, form sheet, confirm dialog) live in `src/components/layout/` and every surface below composes them. See [Demo Mode](DEMO_MODE.md).

## Shared

**Sign in** — email + password. One field pair, nothing else. A wrong address and a wrong password get the same sentence, deliberately: telling them apart would confirm which addresses have accounts. There is no "forgot password" link, because there is no self-service reset — the honest instruction is the activation link.

**Set your password** — the first-run screen, and the whole of password reset. Ordinarily reached by opening the activation link an admin sent, which carries the code, so **the only thing typed is a password** — entered twice, because it is typed blind with no way back: a typo sets a password nobody knows and spends the code proving it. It opens by showing the address the account will sign in with and asking, with two equally prominent answers, whether that is you — never a passive Continue, because catching a mistyped address is the entire reason the step exists. Saying it is not yours sends you to your manager, who can correct it. A dead link says so on arrival, before anything has been typed. Somebody handed only the code, with no link, gets one field asking for it and then the same confirmation. A separate screen rather than a sign-in field clever enough to guess whether you typed a password or a code — guessing would be wrong occasionally and confusing always, on somebody's first day.

**Account menu** — in every shell's chrome: who you are, your role, your outlet, and sign out. Demo shells do not have one; there is no session to end.

**Profile** — own name, phone, role, assigned outlet. Change password. Sign out. *(Not built. Sign-out lives in the account menu; changing a password you still know is [deferred by decision](../openspec/todos/signed-in-password-change.md).)*

## Biller — the counter tablet

The only role that gets a purpose-built layout. Landscape tablet, fixed chrome, nothing that scrolls unexpectedly.

The tablet's navigation is in its fixed header — Counter, Shift, Menu — derived from the same gate registry the phone shells read, so a surface this role has no entry for is absent rather than greyed out.

**Shift unlock** — a grid of the outlet's billers by name; tap yours, enter your PIN, shift opens on the fourth digit. Big targets, no keyboard, and no extra confirm tap after the last digit. Also where a shift is handed over: the outgoing biller closes it — with the consequence stated plainly, because nothing already rung is affected — and the incoming one opens theirs. **A wrong PIN and an unknown biller get one identical sentence**: this tablet sits on a counter anybody can reach across, and telling the two apart would confirm which names are real. The PIN selects attribution and is not the security boundary; the device's own enrolled session is, and that arrives with #9.

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

- **The whole menu fits on one screen.** Seven items today, and unlikely to exceed twenty. A search box or category tabs would be slower than looking. A test compares the grid's content height with its visible height at the smallest supported tablet size, so a menu that outgrows the screen fails a build rather than a shift.
- **Tap to add, tap again to increment.** The tile *only* adds: a −/+ pair on it would halve the target at exactly the moment speed matters, and a mis-tap would then quietly decrement an order rather than visibly miss it. The count rides on the tile as feedback. Quantity is adjusted on the bill line instead, where the thumb already is.
- **An item that is off the menu stays on the grid and refuses to be sold.** A tile that vanished when the kitchen ran out would read as a bug to whoever was looking straight at it.
- **Customer name and phone are optional and never block settling.** At peak they will be skipped, and a required field would just get filled with junk. Free text for now; the field is shaped so select-from-history can be added later without relayout, and whether the counter may read the customer list at all is a decision for #10 — customer phone numbers are PII on a shared device.
- **Payment method is one tap, then settle.** Two taps from a complete order to a cleared screen. **Cash is distinguished by size and position as well as colour** — it is the only method on its own full-width row, labelled as the one that reaches the drawer.
- **Settling is instant.** The bill goes to the queue; nothing is awaited. The screen clears for the next customer in the same tick.
- **Sync state is a small persistent indicator**, never a dialog — synced, *N* pending, or an escalated warning once five are waiting or the oldest has waited two minutes.

**Bill confirmation** — a brief summary after settling: the total, the bill's provisional reference, and **Undo**. It clears itself; a queue does not wait for an acknowledgement.

A queued bill is identified as `Queued · A3F9` and never as an integer, because **bill numbers are the server's** — assigned per outlet and sequentially at insert — and showing a plausible-looking number before the bill has landed would be the worst possible lie to tell a biller or a customer. The number appears when it syncs.

**Undo cancels an unsent queue entry; it never edits a bill.** It is offered for the few seconds the confirmation is on screen, which is exactly the window during which the bill cannot yet have been sent — so an Undo that is visible is always an Undo that works. Once the bill has gone, the only correction is a void, and that ships with #10.

**Menu (read-only)** — the same screen a manager edits, seen from the counter: what is on, what is off, and what everything costs, so *"is that still available?"* does not need a walk to the kitchen. No editing affordances, and a sentence saying a manager makes the changes — but the boundary is the data layer's refusal, not the missing button.

**My shift** — bills created during this biller's current shift, with a running total by payment method. Read-only. Not the outlet's whole history — reviewing the day is a manager's job, and a shared tablet should not display the outlet's takings to whoever is standing at it. *(Not built — it is bill history, and that ships with #10.)*

**Attendance kiosk** — the secondary check-in path. An employee taps their name and PIN on the tablet to clock in or out. Exists so that a dead phone or a failed GPS fix never leaves someone unable to record their attendance. *(Not built — it needs enrolled devices. Until then the manager override is the only escape hatch, which is workable but costs an approval.)*

## Franchise Admin — one outlet, on a phone

**Outlet dashboard** — today at a glance: sales so far split by payment method, cash position, low-stock items, open alerts, who is checked in. The screen a manager opens twenty times a day, so it answers questions without navigation. *(Still a placeholder. It is a `live` surface, so it may not render mock figures; it gets its real summary when the figures behind it become real — #11, #13.)*

**Menu** — categories and their items, each with its price, its availability, and a vegetarian marker that carries **shape as well as colour**, because the familiar square-and-dot mark is a colour-only distinction. Two frequent actions, deliberately different sizes of thing: **availability is one tap on the row**, because it happens mid-service when the kitchen runs out, and it changes the row in place without opening anything; **a price change is a form**, because it is rare and consequential and deserves the sentence saying it applies to future bills only. An item turned off stays on the list, labelled — a row that vanished would leave a manager nowhere to turn it back on. Bills already recorded keep the price they were charged at, because their line items snapshot it.

**Inventory** — items with current quantity and unit, and a low-stock treatment that is **an icon and the words "Low stock"**, never a colour alone. Recording a movement (added / used / wasted / correction) is the primary action and sits on the row. **The sign comes from the kind of movement, not from the person**: somebody counting stock types how much was used, and a stray minus on a "used" entry would silently add stock that does not exist. A correction is the exception — its direction is the point — and it requires a note.

Each item opens to its own **movement ledger** at its own address, so *"why does it say 4 kg?"* can be settled by sending a link, which is how that question actually gets asked. The ledger shows each movement's signed change and the quantity it left behind, and **nothing on it can be edited or removed**: a mistake is corrected by recording a correction, and both rows stay. The quantity on the list is the sum of that ledger rather than a number stored beside it, so the two cannot drift.

**Expenses** — one business day at a time, with the day selectable and shown as a date. Each row carries its category, amount, method and description, and **cash rows are marked in words** — they alone come out of the drawer, and at close somebody has to find them by eye. The add form is four fields and no more: category, amount in rupees, payment method, description. The day's total is split into what was spent and how much of it was cash.

**Daily cash** — the reconciliation screen, and the one this business was commissioned to get right. Opening float, cash sales (derived from settled cash bills), cash expenses (derived from cash expenses), withdrawals, and therefore the expected closing — everything above the single input is worked out, and each derived figure says so. **Only cash moves any of it**: a UPI sale is revenue and not drawer.

A manager supplies one number, what they counted, and **the difference appears the moment it is typed** — with its direction in words as well as by sign, because a minus is the first thing a small screen loses and *"₹240 short"* is not a sentence anyone misreads. Closing snapshots the figures and states, first, that the day cannot be closed again.

**A bill that arrives after a day has been closed does not change it.** The closed figures are what somebody counted and signed off; the late arrival is reported on this screen as a *reconciliation exception* naming the bill, its amount, when it was rung and when it landed. Silently folding it in is the failure this whole chain exists to prevent.

**Attendance** — the outlet's staff by day: who checked in, when, from where, how accurate the reading was, and any geofence flags. **Every active roster member appears, including those with nothing recorded** — a day view that listed only the rows that exist would quietly hide the people who never arrived. A check-in the fence could not vouch for is marked as waiting for a decision and counted absent until it is approved; approving it records the approver and a reason that cannot be blank.

**Staff** — the outlet roster. Add and edit people, set role, joining date, and employment status. **Adding somebody is name-and-done**: no staff code is asked for, because nobody here has one to copy in — the app issues `KAL-7KQ2` from the outlet's prefix. The code appears on the edit form, editable by the owner and visibly inert for a manager with a sentence saying who can change it, rather than hidden; someone who has left stays on the record and drops off the attendance day. *(Pay is not on this screen: the roster shipped with attendance is the attendance-facing one, and salary is the most sensitive column on the table.)*

Having a login and being on the payroll are different facts about a person, and either can be true without the other — so **this screen is also where the two are joined**. Every row says whether an app account is linked and whether it is active, which makes *"why can this person not check in?"* answerable by looking at the screen rather than at the database; that question gets asked by phone, mid-shift. Adding or editing someone offers the unlinked accounts at this outlet, and **Unlink** separates them again, stating first that the person stops being able to check in and that every day already recorded stays on the roster, because those days were worked.

**Access** — app accounts for this outlet: create a Biller or an Employee, issue a one-time code and its activation link, deactivate and reactivate. The same screen as the owner's **People**, seen through one outlet's authority — including the failed-activation notice, which a manager is not shown at all — no outlet column, no role beyond Biller and Employee, and the privileged function refuses anything wider whatever the form sends.

Provisioning an **Employee** also asks about the staff list, in three explicit answers: add them to it, link them to somebody already on it, or leave them off. It never writes a roster row as a side effect — that would assert that every Employee account is a payroll employee, which the schema deliberately says is not true. An incomplete answer — "add them" with no staff code, "link them" without saying to whom — creates nothing at all, because provisioning first and failing second would leave an admin holding a code for a half-configured person. The account and the roster row are still two separate writes, so if the second one fails for any other reason the code is shown anyway, the failure is reported as an unfinished link rather than a failed provisioning, and the state is repairable on **Staff**.

**Profit and loss** — outlet-level estimate for a chosen period, with the **cash-basis / consumption-basis toggle stated plainly on screen**, because the two answer different questions and mixing them is the classic error. See [Data Model](DATA_MODEL.md#two-modelling-traps-in-this-domain).

**Alerts** — raise an issue to the owner (category, priority, message) and track responses.

**Devices** — enrolled counter tablets, last seen, and revoke.

## Super Admin — all outlets, on a phone

**Owner dashboard** — every outlet side by side: today's sales, cash position, open alerts, anything needing attention. Designed to be read in ten seconds while doing something else.

**Outlet switcher** — pick an outlet and drop into the full Franchise Admin view of it, read-only for operational records. This is how the owner inspects a specific shop without a parallel set of screens.

**Outlets** — where each outlet is, and how far staff may be when they check in. The form also carries the **staff code prefix**, three characters that begin every staff code at this outlet; it fills itself in from the short code as that is typed and can be corrected, and it stops being editable once any code has been issued from it — with the reason on screen rather than discovered by being refused. **Position is captured on site, from the device standing at the counter**, never typed in or picked off a map: the screen takes a reading over a few seconds, keeps the tightest sample, and shows its accuracy before anything is saved. A fix looser than ±50 m is refused outright, and one between ±25 m and ±50 m saves with a warning — this reading is judged once and then judges every future check-in, so it deserves a stricter bar than a check-in does. The accuracy and the capture time are stored with the position, so an outlet carrying placeholder coordinates is visible as such rather than indistinguishable from a surveyed one. Only the Super Admin may write it: a manager already holds the override, but an override is recorded with who and why, while moving the fence is silent and applies to everyone from then on. **An outlet that should never have existed can be deleted, and only then** — the action appears once the outlet is marked closed, never on one that is trading, so the reversible step always precedes the irreversible one. The confirmation says what deletion does that closing does not: the row is removed rather than hidden, and there is no undo. It succeeds only while nothing at all is attached, and a refusal names what is still there — *staff on the roster — 3*, *app accounts — 1* — rather than reporting a database error. Nothing is typed to confirm: the outlet this most exists for was created with the placeholders still showing and has neither a name nor a code to type, so it shows as *Outlet created without a name* and is acted on like any other. **The form now refuses to create that outlet in the first place** — name, short code and location label are each checked for blankness on submit, on the edit path as well as create, and the refusal names the field rather than saying a required field is missing. The submit button stays enabled while they are empty, because four required fields behind a greyed-out button say nothing about which one is wanted. The sample placeholders read `e.g. Shawarmania Kalyani` for the same reason the nameless outlet existed: an unprefixed one looked like a name already filled in.

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
