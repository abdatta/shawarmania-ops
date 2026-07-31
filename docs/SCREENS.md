# Screens

> The four role shells exist, and all four roles sign in by username (or by an
> associated email when present) and reach
> their own assignment-derived shell: phone navigation for Super Admin,
> Franchise Admin and Employee, and fixed tablet chrome for Biller. Sign in,
> activation/reset, People, Outlets, Attendance and My
> attendance are built. Activation shows the current username and requires it
> plus the same new password twice. `staff-as-accounts` (#21) collapsed the
> former Staff and Access screens into People; `multi-outlet-hiring` (#23)
> creates every starting assignment before the one handover; #24 removes
> ordinary staff email.
>
> **The counter and the manager's operational surfaces are built and demo-gated** (#6, #7): the billing counter with its shift screens and sync indicator, and Menu, Stock, Expenses and Daily cash — all walkable at `/demo/*` against mocked data, none of them connected to real data yet. They become real one at a time in #10, #11 and #12.
>
> **The owner console completes the set** (#8): the cross-outlet dashboard, the outlet switcher and its read-only outlet view, Compare, Profit and loss, Reports and Alerts — all demo-gated, over a scenario spanning **both** outlets where every figure is derived from the rows another screen shows. The whole four-role experience now walks through coherently; [Demo Mode](DEMO_MODE.md) has the route. #13 makes the owner's figures real.

One bundle serves all four roles. After sign-in the shell reads live
assignments and mounts the matching navigation and route set; in demo mode the
same shells mount from the URL (`/demo/owner`, `/demo/admin`, `/demo/biller`,
`/demo/staff` — the stable role path segments). Every screen below is
additionally protected by Row-Level Security — hiding a route is convenience,
not access control.

**Every screen here is built twice over, in a sense**: first against mocked data behind a feature gate, so the whole experience is demonstrable early, and later wired to real data by a `*-live` change that swaps one adapter and promotes the gate — without redesigning anything. Gates live in `src/gates/registry.ts`; a screen in the `hidden` state is genuinely absent — no navigation entry, no reachable route — not greyed out. Shared layout primitives (page header, data table, empty state, form sheet, confirm dialog) live in `src/components/layout/` and every surface below composes them. See [Demo Mode](DEMO_MODE.md).

## Shared

**Sign in** — username or associated email + password, with stable field names and
`autocomplete="username"` / `"current-password"`. Unknown username and wrong
password receive the same sentence as unknown/unassociated email. An
`@username` is refused with direct guidance because usernames are handle-shaped
but typed without it. Anyone who forgot a password is told to ask a Franchise
Admin or Super Admin for a new one-time link.

**Set your password** — both first activation and an admin-issued reset.
Opening the handover link previews **“Your username is …”** and presents one
real form: type that username, a new password, and the same password again.
The username and both password fields carry password-manager semantics.
Mismatch remains on the form and consumes nothing; a dead or spent link says
so before password fields appear. Someone handed only the code types it first
and reaches the same form. Success sets the password, signs in through the
ordinary username path, and navigates to the assigned shell.

**Install app** — the public header and every real role shell expose one 44px
install action when the browser has an installation path. Chromium-family
browsers get their native prompt; iOS Safari gets the manual Share → Add to
Home Screen instructions. The action is absent when the app is already
installed, when the browser offers no path, and throughout demo mode so a
fabricated scenario never promotes itself as the operational app. Its label
opens briefly once per tab to teach the download icon, while reduced-motion
users get the stable full label. A prompt captured before sign-in remains
available after the real phone or counter shell mounts.

**Account menu** — in every shell's chrome: who you are, your role, your outlet, and sign out. Demo shells do not have one; there is no session to end.

It is also **the first thing in that chrome that is not the same for all four roles**: the Super Admin's carries the demo, with a **copy-link** action beside it, so the one person who pitches franchisees can produce the URL without typing it from memory. Nobody else sees the entry — a manager showing the demo to a walk-in lead is plausible enough, and no harm follows since the link is public either way, but there is no reason to widen an affordance ahead of wanting it. It links and copies `/demo` rather than a role path, because the banner's role switcher is right there and a recipient should not be pinned to whichever role the owner was looking at. **Following it while signed in still lands on the "you are signed in — this is the demo" gate**, deliberately and with no special case: somebody ringing up fake bills in a tab they thought was real is a genuine operational problem, and an owner is no less capable of losing track of a tab than a biller is.

**Profile / Settings** — own name, phone, role, assigned outlets, account
settings, sign out. *(Not built. Sign-out lives in the account menu; requesting
a username change or changing a password you still know is
[deferred by decision](../openspec/todos/self-service-account-settings.md).)*

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

**There is no attendance kiosk on the tablet** — considered and rejected by the owner (2026-07-28): one shared device, usually busy billing, is the wrong place for everyone's check-in queue. The escape hatch for a dead phone or a failed GPS fix is the manager entering the check-in from their own Attendance screen, recorded as entered by them (#21) — see the Franchise Admin's Attendance below.

## Franchise Admin — one outlet, on a phone

**Outlet dashboard** — today at a glance: sales so far split by payment method, cash position, low-stock items, open alerts, who is checked in. The screen a manager opens twenty times a day, so it answers questions without navigation. *(Still a placeholder. It is a `live` surface, so it may not render mock figures; it gets its real summary when the figures behind it become real — #11, #13.)*

**Menu** — categories and their items, each with its price, its availability, and a vegetarian marker that carries **shape as well as colour**, because the familiar square-and-dot mark is a colour-only distinction. Two frequent actions, deliberately different sizes of thing: **availability is one tap on the row**, because it happens mid-service when the kitchen runs out, and it changes the row in place without opening anything; **a price change is a form**, because it is rare and consequential and deserves the sentence saying it applies to future bills only. An item turned off stays on the list, labelled — a row that vanished would leave a manager nowhere to turn it back on. Bills already recorded keep the price they were charged at, because their line items snapshot it.

**Inventory** — items with current quantity and unit, and a low-stock treatment that is **an icon and the words "Low stock"**, never a colour alone. Recording a movement (added / used / wasted / correction) is the primary action and sits on the row. **The sign comes from the kind of movement, not from the person**: somebody counting stock types how much was used, and a stray minus on a "used" entry would silently add stock that does not exist. A correction is the exception — its direction is the point — and it requires a note.

Each item opens to its own **movement ledger** at its own address, so *"why does it say 4 kg?"* can be settled by sending a link, which is how that question actually gets asked. The ledger shows each movement's signed change and the quantity it left behind, and **nothing on it can be edited or removed**: a mistake is corrected by recording a correction, and both rows stay. The quantity on the list is the sum of that ledger rather than a number stored beside it, so the two cannot drift.

**Expenses** — one business day at a time, with the day selectable and shown as a date. Each row carries its category, amount, method and description, and **cash rows are marked in words** — they alone come out of the drawer, and at close somebody has to find them by eye. The add form is four fields and no more: category, amount in rupees, payment method, description. The day's total is split into what was spent and how much of it was cash.

The **owner recording into an outlet they do not run** reaches it here rather than on a screen of its own: the outlet selector in the header offers them every outlet, and at one they do not manage the form narrows to what the database will accept — no cash, because a non-cash row is mathematically incapable of moving that outlet's drawer — with the reason said rather than discovered by being refused. The stock surface does the same, offering only a correction. The cash surface shows the day and offers neither the close nor a withdrawal: the drawer is that outlet's manager's, always.

**Daily cash** — the reconciliation screen, and the one this business was commissioned to get right. Opening float, cash sales (derived from settled cash bills), cash expenses (derived from cash expenses), withdrawals, and therefore the expected closing — everything above the single input is worked out, and each derived figure says so. **Only cash moves any of it**: a UPI sale is revenue and not drawer.

A manager supplies one number, what they counted, and **the difference appears the moment it is typed** — with its direction in words as well as by sign, because a minus is the first thing a small screen loses and *"₹240 short"* is not a sentence anyone misreads. Closing snapshots the figures and states, first, that the day cannot be closed again.

**A bill that arrives after a day has been closed does not change it.** The closed figures are what somebody counted and signed off; the late arrival is reported on this screen as a *reconciliation exception* naming the bill, its amount, when it was rung and when it landed. Silently folding it in is the failure this whole chain exists to prevent.

**Attendance** — read along two axes, because a roll-call and a pattern are different questions.

**By day** is the outlet's staff for one business date: who arrived, when, from where, how accurate the reading was, whether they were late, and which days are still waiting. **Everyone currently on the outlet's staff appears, including those with nothing recorded** — a day view that listed only the rows that exist would quietly hide the people who never arrived. A departed person drops off the day; a deactivated one still appears with the deactivation noted, because access and working there are different facts.

**Every arrival waits for approval, in the fence or not.** A check-in records where a phone was; only a manager saying so records that somebody worked. Waiting days are distinguished on the row and counted above the list, and **Approve all** settles the morning in one action. The approval reads the manager's own position: **inside the fence, on the row's own business day, it is one tap with no reason at all** — and anywhere or any day else it asks for one first, which is stored on the day and readable by the person it is about. Nothing is refused for being elsewhere. A manager who approves from home every morning shows up as a column of reasons, which is oversight a refusal would not have produced.

**Somebody with no arrival still reads as something**: *not yet arrived* before the outlet's deadline, *absent* after it and on every past day. No row is written for those days — the reading is derived when the day is read.

A manager can also **enter an arrival on someone's behalf** — past times only, on today's business day — for the person whose phone cannot; the event carries `manual` as its source, reads *entered by* that manager wherever it is shown, and is settled by the recording rather than queued for its own author to approve.

**By person** is one staff member over a range of dates, defaulting to this month, with the counts: present, late, absent and waiting. The arrows move a month at a time and the two date fields make it any range at all. It reads **that outlet's days only** — somebody who works at two shops has days at each, and the other outlet's days are the other outlet's data. The read names its outlet rather than resolving it from the session, so a hand-crafted request cannot widen it either.

The owner also sees, without opening each outlet in turn, **how many days are waiting at each** — a day nobody settles is otherwise invisible until somebody queries their pay.

**People** — everyone at this outlet, in one place. **Adding somebody is one
step**: required name, username, role and one or more managed outlets; optional
phone, title and joining date. No ordinary-email field or placeholder-account
state exists. The account and every selected assignment commit before the
one-time-code panel appears. A manager with one outlet sees it preselected; a
multi-outlet manager chooses only among outlets they manage. The list names
every live outlet/role for the person. Assigning or ending placement preserves
everything else and replaces a still-pending activation link transactionally.
An activated person gets no unsolicited reset code. A person with no live
assignment reads **Not assigned to any outlet**. Managers can correct another
person's username and issue a fresh reset link within their authority; they
cannot manage themselves or create privileged roles.

**Profit and loss** — outlet-level estimate for a chosen period, with the **cash-basis / consumption-basis toggle stated plainly on screen**, because the two answer different questions and mixing them is the classic error. See [Data Model](DATA_MODEL.md#two-modelling-traps-in-this-domain).

The basis is never merely selected — it is **named in words beside the figure**, with the working underneath: sales, what was subtracted, and on the consumption basis the stock used at cost. Raw-material spending is listed like any other expense and labelled *not subtracted on this basis*, because the reader most likely to mistrust the number is the one who can see a ₹1,500 chicken bill and no sign of it. A manager sees their own outlet and is offered no outlet control; the owner picks, because they belong to none.

**Alerts** — raise an issue to the owner (category, priority, message) and track responses. Four fields and no more: what it is about, how urgent, a subject, and what happened — the last two refused if blank, by name. An alert is always raised **open**; acknowledging it is somebody else's action, and raising something pre-acknowledged would be acknowledging it on their behalf.

**Devices** — enrolled counter tablets, last seen, and revoke.

## Super Admin — all outlets, on a phone

**Owner dashboard** — every outlet side by side: today's sales split by payment method, what should be in the drawer, and a line naming what needs attention — open alerts, items at their threshold, and **yesterday's drawer if it did not balance**. Today's difference is null until somebody counts, so a console that only ever showed today would make an owner open each outlet in turn to find out whether last night came out right. Designed to be read in ten seconds while doing something else.

Every figure on it is **summed from the rows another screen shows** — the bills the counter rang, the expenses the manager typed, the movements in the stock ledger — so the console and the counter cannot contradict each other. A day that has been closed contributes what was counted and signed off, never a recomputation of it.

**An outlet whose figures cannot be resolved is still listed, with the absence stated.** That is what a signed-in owner sees today: the outlets are real, the trading data is not there yet, and a fabricated `₹0` would read as *you took nothing today*. The numbers appear when billing does (#13), without the screen changing.

**Outlet switcher** — a control on the console: all outlets, or one. Choosing one scopes the console, and each outlet opens to a read-only view of its day at its own address — sales by method, the cash position and whether the day is closed, low stock, open alerts, who is checked in. **Read-only is stated on the screen**, not implied by absent buttons, because a screen that merely lacks controls says nothing about whether you were allowed to use them; the refusal behind it is the database's. The switcher offers exactly the outlets the data layer returned and can never name one it did not.

**Outlets** — where each outlet is, and how far staff may be when they check in. **Position is captured on site, from the device standing at the counter**, never typed in or picked off a map: the screen takes a reading over a few seconds, keeps the tightest sample, and shows its accuracy before anything is saved. A fix looser than ±50 m is refused outright, and one between ±25 m and ±50 m saves with a warning — this reading is judged once and then judges every future check-in, so it deserves a stricter bar than a check-in does. The accuracy and the capture time are stored with the position, so an outlet carrying placeholder coordinates is visible as such rather than indistinguishable from a surveyed one. Only the Super Admin may write it, and the arrival deadline beside it for the same reason: a manager already holds the approval, which is recorded with who, when and where they were, while moving the fence or the deadline is silent and applies to everyone from then on. **An outlet that should never have existed can be deleted, and only then** — the action appears once the outlet is marked closed, never on one that is trading, so the reversible step always precedes the irreversible one. The confirmation says what deletion does that closing does not: the row is removed rather than hidden, and there is no undo. It succeeds only while nothing at all is attached, and a refusal names what is still there — *people — 2* — rather than reporting a database error. Nothing is typed to confirm: the outlet this most exists for was created with the placeholders still showing and has neither a name nor a code to type, so it shows as *Outlet created without a name* and is acted on like any other. **The form now refuses to create that outlet in the first place** — name, short code and location label are each checked for blankness on submit, on the edit path as well as create, and the refusal names the field rather than saying a required field is missing. The submit button stays enabled while they are empty, because four required fields behind a greyed-out button say nothing about which one is wanted. The sample placeholders read `e.g. Shawarmania Kalyani` for the same reason the nameless outlet existed: an unprefixed one looked like a name already filled in.

The same screen creates and edits an outlet: code, name, location label, address, phone, and the business-day cutover. A **Find the address** search sits above the address block: type a landmark, street or shop, pick a suggestion, and the street line, second line, city and PIN fill in one action — with the District following from the PIN, because no geocoder answers the Indian revenue district correctly and India Post does. It fills the location label only when that field is still empty, never overwriting the owner's own wording. Everything it writes stays editable, and the block is exactly as typeable as it was: an outlet must be creatable when the lookup finds nothing or the phone has no signal, so a failed search says nothing at all and a search with no matches simply says so. **The address search never gives an outlet its position** — the coordinates that come back are discarded, because the geofence is captured on site and a rooftop centroid would mark somebody absent at their own counter. **Its empty state is the important one** — it is the first screen an owner sees on a new installation, and it says what to do rather than reporting no data, because nothing else in the product is reachable until an outlet exists. Editing the cutover is safe at any time: business dates are stored as explicit columns and never derived from a timestamp at read time, so a new cutover applies to the next day resolved and moves nothing already recorded. **The cutover field argues its own case.** It is labelled *The day rolls over at* rather than as a start time, says outright that it is not the opening time, and carries a live panel that resolves one whole trading session — prep, afternoon, evening rush, the last bill after midnight — against whatever is currently typed, naming the business day each moment would be filed under. When they do not all agree it warns that one night's trading would be split across two business days. The old copy explained the rule as *after midnight but before this time*, which only reads correctly to someone who has already chosen an early-morning value and goes silent for exactly the person who typed an opening time — which is what happened at both outlets.

An outlet can also be **marked closed**. That means the shop is not trading: it disappears from the lists accounts are assigned from, and check-ins there are refused — while an approval is never refused for that reason, so a day worked before the shop closed can still be settled afterwards. Nothing cascades. Accounts and recorded attendance are untouched, no login is revoked, and reopening is one tap; the confirmation says all of that, because an owner expecting it to cut off access would be dangerously wrong.

**People** — every person across all outlets. Create one account at one or
several outlets, issue a fresh one-time code, correct another person's
username, deactivate/reactivate, and manage assignments. Selecting Super Admin
hides outlets and requires that owner's real account email; every other role
omits email entirely. Only an authorized Super Admin can see another Super
Admin's account email or correct it, and one's own remains read-only here. The
same email is an alternate sign-in identifier and a foundation for future
recovery or security features.

The account, profile, role-required Super Admin account email, and every starting
assignment exist before the single code is issued. A handover is shown once:
username, QR/link containing only the code, and copy action. The URL carries
neither username nor email and the code cannot be looked up again. Granting or
ending an assignment while it is outstanding replaces the link
transactionally; an activated account receives nothing unless an admin
explicitly chooses **New code**. The owner alone sees the global failed-
activation notice. One's own row offers no actions.

**Comparison** — outlets side by side over a period: sales, expenses, estimated profit, cash differences. The screen that justifies the whole system for a multi-outlet owner. The **period and the profit basis are both stated on screen**, because two outlets compared on different bases, or over a range the reader has to remember, mislead more reliably than no comparison at all.

**Reports** — a period summarised for one outlet: sales by payment method, expenses by category, profit on the stated basis, and the drawer day by day. **Nothing here produces a file, and that is deliberate while the figures are demonstration data**: a download of invented revenue is far easier to forward than a screenshot, and it arrives detached from the banner that says what it is. The absence is explained on screen rather than greyed out, and it makes exporting fabricated figures impossible by construction rather than by discipline. Exporting arrives when the figures do.

Reports and P&L have **no navigation entries**. Six tabs is as much as a bottom bar holds on a phone, and both answer a question somebody asks while looking at today's figures — so they are reached from the console, which is where that question gets asked.

**Alerts inbox** — everything raised across outlets, ordered so that what has not been read comes first and priority decides within that. Each row names its outlet, because acting on the right alert for the wrong shop is the mistake a cross-outlet list invites. **Priority is a word and a distinct glyph, never a colour alone.**

An alert moves **one step at a time** — open → acknowledged → resolved → closed, with reopening from anything unfinished — and the step it cannot skip is acknowledgement, which is the step that tells a manager somebody has seen what they raised. **Closed is final**: if it comes back, a new alert keeps the history of both readable. Replying is a separate action from moving the status, because reading something is not the same as acting on it, and a screen that folded them together would take away the reader's ability to say which they did.

## Employee — a phone, and almost nothing else

**Home** — one large check-in button, today's status, and the outlet they are assigned to. A recorded arrival says plainly that it is **waiting for a manager to approve it**, never that the day is done: it counts for nothing until somebody vouches for it, and a screen implying otherwise would be the misunderstanding this design exists to remove. An arrival after the outlet's deadline reads as late.

If the geofence blocks them, this screen says how far outside the limit they were, what the limit is, and how accurate their phone's reading was, then offers to ask a manager to approve it. **A refused check-in records nothing** until they choose to ask — walking away leaves no row and does not consume the one record that day allows. If the phone cannot supply a position at all, the screen names which of permission, signal, or timeout failed, and offers the same route through.

**My attendance** — own history over a range, with the same month-at-a-time control the manager's person view has, and the same counts. For each day: the time, the status, the distance, the accuracy, the source, the late tag, and the approval — **including whether the approver was standing at the outlet when they gave it**, and any reason they typed. Days with nothing recorded read as absent here too, per outlet. Own records only, enforced in the database, and spanning every outlet they work at with each day naming its own. The symmetry is deliberate and is built by sharing the components: asymmetric visibility in a monitoring feature is how it becomes something staff resent.

## Cross-cutting

- **Every screen is responsive.** Manager and employee screens are phone-first; billing is tablet-first; everything is usable on a desktop browser.
- **The app is installable** and launches full-screen from the home screen.
- **Rupees everywhere**, Indian digit grouping, tabular figures.
- **Asia/Kolkata everywhere.** Business dates display as dates, never as timestamps.
