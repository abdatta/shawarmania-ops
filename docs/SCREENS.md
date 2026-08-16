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

**The root** — `/` renders nothing of its own. It resolves the session and sends
you on: to your own shell if you have one, to sign in if you demonstrably do not,
behind the shell-shaped placeholder while the answer is still coming, and to
"could not confirm it" with a retry if a session probably exists and the app
could not check. **Not knowing is not the same as being signed out**, and only a
confirmed absence reaches sign in, because being asked to retype a password for a
session you still hold is the one thing a lost network must never cause. There
used to be a card here describing the product; the product is described at
`shawarmania.in`, which is separately hosted, so on the operations origin it was
a step in front of everybody who already knew what they had come for. It also
redirected on a resolved session only, which is why signing in used to flash it.

**Sign in** — username or associated email + password, with stable field names and
`autocomplete="username"` / `"current-password"`. Unknown username and wrong
password receive the same sentence as unknown/unassociated email. An
`@username` is refused with direct guidance because usernames are handle-shaped
but typed without it. **It is also the app's front door**, since the root resolves
straight here for anybody signed out, so it is centred as a screen in its own
right. One sentence covers everybody without a working password, first-timers and
forgetters alike: ask a Franchise Admin or Super Admin for a one-time link. There
is deliberately **no route to activation from here**, because activation without a
code could only offer a form asking for one, and an admin is never shown a code to
give out.

**Set your password** — both first activation and an admin-issued reset.
Opening the handover link previews **“Your username is …”** and presents one
real form: type that username, a new password, and the same password again.
The username and both password fields carry password-manager semantics.
Mismatch remains on the form and consumes nothing; a dead or spent link says
so before password fields appear. Success clears any superseded human state,
sets the password, signs in through the ordinary username path, verifies that
replacement session with Auth, and navigates only after the shared holder
reflects it. If that final sign-in cannot be established, the page says the
password changed and directs the person to ordinary sign-in without showing a
stale protected shell.

**The code is never typed, and there is nowhere to type one.** The handover is a
link and a QR; the issuing panel prints no raw code, so a form asking for one
asked for a value nobody is given. An address arriving without its code is told
it is **incomplete** — a different fact from a link that will not work, and one
the person can act on by opening the whole link or asking for another.

**Install app** — the public header and every real role shell expose one 44px
install action when the browser has an installation path. Chromium-family
browsers get their native prompt; iOS Safari gets the manual Share → Add to
Home Screen instructions. The action is absent when the app is already
installed, when the browser offers no path, and throughout demo mode so a
fabricated scenario never promotes itself as the operational app. Its label
opens briefly once per tab to teach the download icon, while reduced-motion
users get the stable full label. A prompt captured before sign-in remains
available after the real phone or counter shell mounts.

**Update app** — the same header slot, and the same 44px control, shows an
**Update** action when a new build is waiting and the app has decided the page
is too busy to reload by itself. **Install takes the slot when both apply**:
somebody who has not installed the app gains more from installing it, and
nothing is lost by the wait, because the update applies itself the moment the
page frees up. Unlike the install action, which teaches its label once per tab
and then goes quiet, this one keeps expanding and collapsing for as long as it
is unapplied — it is the app declaring that it is holding a build back, on a
counter tablet nobody is studying, where a single reveal five minutes ago has
not been seen. Reduced motion leaves the label up without the cycle, and the
accessible name never changes. Demo shells render neither action, and still
take an update automatically when their page is idle.

**Account menu** — in every shell's chrome: who you are, your role, your outlet, and sign out. Demo shells do not have one; there is no session to end.

It is also **the first thing in that chrome that is not the same for all four roles**: the Super Admin's carries the demo, with a **copy-link** action beside it, so the one person who pitches franchisees can produce the URL without typing it from memory. Nobody else sees the entry — a manager showing the demo to a walk-in lead is plausible enough, and no harm follows since the link is public either way, but there is no reason to widen an affordance ahead of wanting it. It links and copies `/demo` rather than a role path, because the banner's role switcher is right there and a recipient should not be pinned to whichever role the owner was looking at. **Following it while signed in still lands on the "you are signed in — this is the demo" gate**, deliberately and with no special case: somebody ringing up fake bills in a tab they thought was real is a genuine operational problem, and an owner is no less capable of losing track of a tab than a biller is.

**Profile / Settings** — own name, phone, role, assigned outlets, account
settings, sign out. *(Not built. Sign-out lives in the account menu; requesting
a username change or changing a password you still know is
[deferred by decision](../openspec/todos/self-service-account-settings.md).)*

## Biller — the counter tablet

The only role that gets a purpose-built layout. Landscape tablet, fixed chrome, nothing that scrolls unexpectedly.

The tablet's own tree has **no navigation, no account menu and no sign-out** since `counter-devices-and-offline`. A tablet is not signed in, it is set up; the way out is an admin removing it, and a sign-out control would offer whoever is standing at the counter a way to strand the hardware.

**Set up this tablet** — one field, and it is not a password. An unconfigured tablet reaches it from the signed-out front door's **Set up this tablet** link; an admin generates a setup code on their own phone and types it here. Nothing personal is entered on a tablet at setup, and nothing personal is entered on it afterwards either.

**Ask to open the counter** — what a set-up tablet shows when nobody is on it. Type the username of the person taking the counter, and the tablet displays a **four-digit confirmation code**, rendered as large as the screen allows because the person approving is standing on the other side reading it off. That is the entire property the code buys: approval is impossible unless you can see the tablet. The tablet holds no secret belonging to that person and learns nothing about them from the response — **an unknown username produces the same code, the same wait and the same two-minute timeout as a real one**, so a counter anybody can reach across cannot be used to discover who works here. One open request per tablet, and the tablet can withdraw its own for the ordinary case of a mistyped name, which takes the card off the person's phone rather than leaving it there to be puzzled over.

**Open the counter?** — the card on the *person's own phone*, on whichever home surface they land on. It names the outlet, the tablet and how long it has been waiting, takes the four digits, and offers a rejection that **needs no code at all**: saying "that was not me" is not an act anybody should have to walk to a counter to take. Three wrong codes destroy the request, so a typo loop ends in a fresh start rather than an indefinite retry. Once confirmed, the same place shows the shift they now hold and one action that ends it — from their phone, not from the tablet.

**Tablets** (manager and owner) — the hardware and counter standing at each outlet. Heartbeat time and unsent count remain explicitly **last reported**: a tablet that is off, offline or broken stops moving them and is marked out of touch. Beneath that telemetry, a coherent read names the live operator and opening time; if no shift is open it says **Nobody is at this counter**. Billing figures do not appear here: managers read the outlet-day Cash and UPI totals in **Billing → Totals**, while Bills and Open orders already carry their own counts. **Re-read** refreshes the tablet and counter state — there is no subscription or timer on the manager's phone. Setting one up is offered only where there is room for one, because one active tablet per outlet is a database invariant. Removing one is permanent, ends any live shift immediately, and the confirmation names what the tablet last reported it had not sent.

**Billing counter** — the heart of the product, and the screen most worth getting right.

```
┌──────────────────────┬────────────────────┬────────────────────────┐
│ MENU                 │ CURRENT BILL       │ ORDERS & BILLS         │
│ Classic       ₹139   │ Classic ×2   ₹278 │ OPEN ORDERS            │
│ Mayo          ₹159   │ Mayo    ×1   ₹159 │ Order 31 · ₹437        │
│ Double        ₹179   │                    │ Order 32 · ₹318        │
│ Mozzarella    ₹199   │ Total        ₹437 │ ────────────────────── │
│ Salad         ₹219   │ Customer · Phone   │ BILLS THIS SHIFT       │
│ Stuffed       ₹238   │ Cash               │ Bill 28 · cash · ₹318 │
│ Burger        ₹250   │ UPI                │ Bill 27 · UPI  · ₹139 │
│                      │                    │ each expands to items, │
│ tap tiles to add     │ Order · Mark Paid  │ prices and payment     │
└──────────────────────┴────────────────────┴────────────────────────┘
```

Design commitments:

- **Three columns, at every width, and nothing folds away.** The current bill and activity rail each start at a phone-width 22rem and have their own named divider that can be dragged or adjusted with the keyboard. The counter browser remembers those widths; the shared menu column never falls below 22rem. Below the width the three columns need, the workspace scrolls sideways, rather than rearranging, and no column becomes a tab, a route or a disclosure. Only the workspace scrolls horizontally; the page never does. Menu tiles are laid out against their own column's width, not the viewport's.
- **An item's name is never truncated**, on a tile, on a bill line or in a closed bill — the end of the name is what tells two items on this menu apart, and an ellipsis takes exactly that part. Tiles grow to fit and every tile in a row keeps the same height. A tile's price sits at its top right in the same place whatever the name above it does, and an item that is off shows that **instead of** its price: the price of something nobody can sell is the one figure here that a biller might quote before noticing the tile is dashed.
- **The whole menu fits on one screen.** Seven items today, and unlikely to exceed twenty. A search box or category tabs would be slower than looking. A test compares the grid's content height with its visible height at the smallest supported tablet size, so a menu that outgrows the screen fails a build rather than a shift.
- **Tap to add, tap again to increment.** The tile *only* adds: a −/+ pair on it would halve the target at exactly the moment speed matters, and a mis-tap would then quietly decrement an order rather than visibly miss it. The count rides on the tile as feedback. Quantity is adjusted on the bill line instead, where the thumb already is.
- **An item that is off the menu stays on the grid and refuses to be sold.** A tile that vanished when the kitchen ran out would read as a bug to whoever was looking straight at it.
- **A phone is a phone or it is refused.** What is typed is canonicalised by the same `shared/phone` rule the database uses, and an incomplete or malformed number blocks both Order and Mark Paid, reported under the field once the biller leaves it rather than while they are still typing. Left empty it is fine — name or phone satisfies the identity requirement. Without this a bad number reached the bill as PII written wrong while the customer record quietly declined to save, and nothing said so.
- **Either customer name or phone is required by the composer UI.** This is a reversible operating trial, not a database invariant: both snapshots remain nullable. **Whether the counter may read the customer list is settled, and the answer is no** (`global-customer-identity`, #32): a complete phone resolves to one business-wide customer and fills the name in, and there is no browse, no prefix search and no list — not on the screen and not in the database behind it. A number that matches nobody, a lookup that is refused, and a lookup that is rate-limited all read the same to a biller: carry on with the bill. The autofilled name stays editable, and what is typed is what the bill snapshots; the saved profile is never rewritten from a till. The surface for all of this is built by #31 and made real by #10 — customer phone numbers are PII on a shared device, and the boundary landed before the screen that uses it.
- **Order is the primary composer action.** It records the ordinary food-first sequence; **Mark Paid** is secondary for the rarer upfront payment and opens tap-first tender capture. With no amount keyed, one method takes the whole remaining balance. A touch keypad supports exact splits such as ₹100 Cash + ₹39 UPI; allocations must equal the bill total before Mark Paid enables. Cash and UPI begin in the same neutral treatment, with Cash's banknote icon as its non-colour cue; neither is preselected. **Cash and UPI are the only counter tenders.** Swiggy and Zomato orders stay outside billing and are typed in the temporary ledger; Card and Other are absent.
- **Mark Paid is instant after durable local confirmation.** The screen clears only after IndexedDB accepts the command, never after a network response. A storage failure leaves the complete composer intact.
- **Sync state is a small persistent indicator**, never a dialog — synced, *N* pending, or an escalated warning once five are waiting or the oldest has waited two minutes.
- **A counter left open stays fresh.** Returning to it from the background re-reads the menu and activity rail. Menu, order and bill Realtime events are nudges to perform the same reads, never trusted as row data, and neither trigger is the only path. A refresh changes the grid and rail lists without changing captured lines, the order under edit or its suspended draft.

**Bill confirmation** — a brief summary after Mark Paid: the total, a short local reference and the plain words **not sent yet**. It clears itself quickly; payment delivery begins immediately and correction lives with the paid bill rather than in this transient state.

A queued bill is identified as `Queued · A3F9` and never as an integer, because **bill numbers are the server's** — assigned per outlet and sequentially at insert — and showing a plausible-looking number before the bill has landed would be the worst possible lie to tell a biller or a customer. The number appears when it syncs.

**Tender correction is append-only.** An immediate or on-handover payment appears in Bills this shift at local acceptance. While it remains editable, its collapsed row carries a pencil indicator; expanding it on the originating tablet offers `Edit (N min)`, then `Edit (N sec)` below one minute, until the original five-minute deadline. The same dialog opens prefilled and locks every sale fact; Save payment enables only for a changed, exact Cash/UPI replacement. At expiry the indicator and action simply disappear. Other mistakes, and all later corrections, use attributed manager void plus a manual counter re-ring.

**Open orders** — only this tablet's unfinished orders, as compact preparation cards. Every quantity, item name and line amount stays readable without expansion; an available customer name and the total are prominent, while `Order #xyz` is only a small reference. Mark Paid, edit and cancel are grouped below that information, with edit and cancel as touch-sized icon actions. Mark Paid opens the same exact tender dialog as a direct bill. Today's order shows a relative age; older orders show outlet-local date and time. The creator appears only when different from the current shift holder. Edit hands the order to the full composer, including menu tiles and customer fields, while preserving any new-order draft. Cancellation reason tiles fill one always-editable field. Saving adds the order directly here—there is no separate latest-order card that can go stale after rapid orders.

**Editing is a mode, and the workspace shows it.** Editing outlines the current bill in the accent colour and the order under edit leaves this list — its own card, unchanged in appearance, travels left out of the rail's margin to meet the composer's edge, flat and borderless on that side, so the two read as one accent-outlined piece of work. The rail around it stays neutral: the accent marks what is being edited, not the column it came from. The card keeps its place in the rail's scroll and is sticky rather than fixed, pinning at the edge only while scrolling would take it out of view.

**The composer's footer moves onto that card** for the duration of the edit — total, customer fields, Save changes and Cancel edit — leaving the composer as the items alone. There is only ever one footer, and the card shows no second copy of anything the composer is editing: no item list, no second total.

**There is no Menu screen in the Biller's shell**, and there was one. It showed what is on, what is off and what everything costs, so *"is that still available?"* did not need a walk to the kitchen — but the Counter's own menu column now answers that permanently, next to the bill, with prices and an Off marker on anything the kitchen has run out of. A second page carrying the same facts is a second place to look. **The boundary was never the missing button and is not the missing page**: a Biller's menu write meets `menu_items_write`, exactly as it did when the read-only screen existed.

**My shift** — paid bills created during this tablet's current shift. Every bill is collapsed by default and expands to its immutable item names, quantities, captured prices, line totals, payment facts, total and optional customer name. This list sits below Open orders in the Counter's continuous right rail at every width, which is why neither it nor Open orders carries a navigation entry any more — a tab leading to a second copy of a column already on screen is a second door into one room. Both routes still resolve, so a link into either one still works. Bills name **Today** with the time rather than repeating the date on every row, saying Yesterday for a shift that has crossed midnight and the full date only once it is neither. It also holds the originating tablet's needs-attention work: correct by creating a linked command with a new identity, or discard with a reason, while retaining the refused trace. It is not the outlet's whole history — reviewing the day is a manager's job, and a shared tablet should not display the outlet's takings to whoever is standing at it.

**Finish day** is online and final for the tablet shift. It first waits until no
paid bill has a five-minute edit window, then drains the local date and refuses while any command needs delivery or
attention, or a server order remains open, then ends the shift and writes one
server confirmation under the same outlet/date lock. **Hand over** remains the
operator-change path and keeps the outgoing shift live until the incoming person
approves on their own phone.

Personal Biller accounts never mount this counter. On a phone their Biller
assignment opens the Employee/staff shell for attendance and expenses; only the
enrolled `/counter` device principal can show billing.

**Expenses** — *temporary (#36), and it goes with the Ledger.* The manual ledger's expense list, mounted alone, for the people who spend the money. It opens on the **two most recent business days** at the chosen outlet, resolved through that outlet's own cutover so something bought at 00:30 belongs to the trading day still running. That window is where the screen opens rather than a boundary: no policy carries a date predicate on reads, and hiding an old expense row protects nothing, since it is not a revenue figure.

Every row at the outlet is listed, whoever recorded it, each naming its recorder. **Nothing the day record holds appears here** — no revenue by any channel, no opening or counted cash, no cash movements, no commission rate, no difference and no monthly figure. Two separate reasons hold that line and they are worth keeping apart. The drawer figures are refused by the *database*, not hidden by this screen: an account that could set the counted cash could make any drawer reconcile. The day's own takings are left off for a *usability* reason instead — the system does not claim a worked shift's takings are a secret (see [Limitations](LIMITATIONS.md)); they are absent because a screen showing four kinds of financial truth is a screen nobody reads.

Recording is against **today only**, because a purchase noticed the next morning is the manager's or the owner's to add and they can reach any date. Correcting and withdrawing are limited to **your own rows, while their day is still running**; a row that outlives its business date is frozen to its author and stays fixable by a manager or the owner. Every one of those limits is the database's, so the screen hides an action rather than offering one that will fail. A failed submit with no connection keeps everything typed and says so — there is no queue here, and the real one arrives with #9.

A staff member assigned at more than one outlet chooses which outlet this screen is about, through the same switcher every other outlet-scoped screen uses; a single-outlet person gets no control. That choice confers no authority — the database decides every read and write from the assignment.

**There is no attendance kiosk on the tablet** — considered and rejected by the owner (2026-07-28): one shared device, usually busy billing, is the wrong place for everyone's check-in queue. The escape hatch for a dead phone or a failed GPS fix is the manager entering the check-in from their own Attendance screen, recorded as entered by them (#21) — see the Franchise Admin's Attendance below.

## Franchise Admin — one outlet, on a phone

**Outlet dashboard** — today at a glance: sales so far split by payment method, cash position, low-stock items, open alerts, who is checked in. The screen a manager opens twenty times a day, so it answers questions without navigation. *(Still a placeholder. It is a `live` surface, so it may not render mock figures; it gets its real summary when the figures behind it become real — #11, #13.)*

**Billing history** — a phone-first outlet record for Franchise Admin and Super Admin. The outlet, business-date, status and payment filters form a compact two-column grid on a phone and a single row on wide screens. The date always defaults to the outlet's current business day and reads **Today**. Tapping it opens the platform calendar; a past choice reads in the app's format, for example `12 Aug 2026`, rather than an ambiguous browser placeholder. Every collapsed row is a scannable Paid/Cancelled summary with amount, tender, an outlet-local Today/Yesterday time where applicable and the biller name; selecting it expands that bill directly beneath the row, with only one open at once. Expansion uses the ordinary surface border, not an accent outline, and a short height/opacity transition; changing to a lower bill holds the tapped summary in place while the prior detail closes. The order items are followed by a green outlined **Paid by** payment banner and right-aligned total; when a bill is cancelled, its equivalent red, attributed cancellation banner appears before the items and the retained paid banner uses a quieter green outline. **Customer details** and **Bill timeline** are separate two-column nested disclosures, closed by default so optional customer and audit facts do not consume the phone viewport. Missing optional customer facts are said rather than silently omitted, while customer phone remains out of summaries and diagnostics. Cancellation is an exceptional action: **Cancel this bill** opens a neutral dialog that requires a reason and final confirmation; the original remains visible as a compact, attributed cancellation row, calling the signed-in actor **You**, with no duplicate success message. **Open orders** shows each stranded order's captured items, total, customer details, creator and time before showing a single **Cancel this order** action; that action opens the same neutral, reason-required dialog pattern, with editable common reasons and a concise final confirmation. **Sync status** replaces the former receipt-by-receipt Delivery feed: it says whether recent tablet activity has a problem, groups routine successful activity by business action, and reveals non-identifying short references/result metadata only inside **Show technical details** — never customer details, command contents or tablet correction controls.

**Totals** — a fourth Billing-history view, opened deliberately beside Bills, Open orders and Sync status. It shows large Cash and UPI cards for settled bills at the selected outlet and business day — the same tender breakdown previously shown on the tablet. The totals deliberately ignore the detail list's status and tender filters, so a manager can narrow the list without changing the day-level payment read.

**Menu** — categories and their items, each with its price, its availability, and a vegetarian marker that carries **shape as well as colour**, because the familiar square-and-dot mark is a colour-only distinction. Two frequent actions, deliberately different sizes of thing: **availability is one tap on the row**, because it happens mid-service when the kitchen runs out, and it changes the row in place without opening anything; **a price change is a form**, because it is rare and consequential and deserves the sentence saying it applies to future bills only. An item turned off stays on the list, labelled — a row that vanished would leave a manager nowhere to turn it back on. Bills already recorded keep the price they were charged at, because their line items snapshot it.

The category is a field on the item, never a thing created on its own, and a category the outlet does not have is **compared before it is created**. The comparison ignores case, accents, punctuation and spacing, then looks for a plural, a transposition, a dropped or added letter, and one name sitting inside another — so "Shwarma" finds "Shawarma" and "Burger" finds "Burgers". What it finds is offered **as choices inside the confirmation**, and picking one files the item under that category with its existing spelling: the correction belongs where the mistake was caught, not behind a cancel and a retype. Creating the typed name anyway is the last choice in the same list. **Picking and committing are two acts** — a row that filed the item the instant it was touched would turn a fat thumb into an item under the wrong heading, which is the fault the dialog exists to prevent — so one button commits whichever option is chosen, named for what it will do. Where nothing resembles it, nothing is asked and the category is created — a confirmation that fires on every new category is read by nobody by the fourth item, and an outlet's whole menu is entered in one sitting.

**Inventory** — items with current quantity and unit, and a low-stock treatment that is **an icon and the words "Low stock"**, never a colour alone. Recording a movement (added / used / wasted / correction) is the primary action and sits on the row. **The sign comes from the kind of movement, not from the person**: somebody counting stock types how much was used, and a stray minus on a "used" entry would silently add stock that does not exist. A correction is the exception — its direction is the point — and it requires a note.

Each item opens to its own **movement ledger** at its own address, so *"why does it say 4 kg?"* can be settled by sending a link, which is how that question actually gets asked. The ledger shows each movement's signed change and the quantity it left behind, and **nothing on it can be edited or removed**: a mistake is corrected by recording a correction, and both rows stay. The quantity on the list is the sum of that ledger rather than a number stored beside it, so the two cannot drift.

**Expenses** — one business day at a time, with the day selectable and shown as a date. Each row carries its stored category, amount, method and optional note, and **cash rows are marked in words** — they alone come out of the drawer, and at close somebody has to find them by eye. The mark is the single word *Cash* against a note icon, with *— from the drawer* carried in the badge for a screen reader only: on a phone the badge shares one line with a category and an amount, and the full phrase pushed both onto lines of their own. Category is a text field that offers the business-wide suggestions on focus, filters them while somebody types, and accepts a new value; typing a category once makes it available at both outlets. The add form is category, amount in rupees, payment method and an optional note. The day's total is split into what was spent and how much of it was cash.

The **owner recording into an outlet they do not run** reaches it here rather than on a screen of its own: the outlet selector in the header offers them every outlet, and at one they do not manage the form narrows to what the database will accept — no cash, because a non-cash row is mathematically incapable of moving that outlet's drawer — with the reason said rather than discovered by being refused. The stock surface does the same, offering only a correction. The cash surface shows the day and offers neither the close nor a withdrawal: the drawer is that outlet's manager's, always.

**The owner needs no assignment to be here at all** (#28). These outlet-level screens are in their own navigation, addressed inside their own shell, and the outlet selector is how they choose which shop — the assignment they hold, or do not, decides only what each screen then offers. Before that they had to appoint themselves manager of a shop to see its attendance, which was authority they already had.

**The outlet in the selector is remembered.** One choice per signed-in person, shared by every outlet-scoped screen and surviving a reload, so an owner who moves between Attendance, Expenses, Stock and Cash answers the question once rather than on each. It is checked before it is used: an outlet they may no longer see is dropped rather than shown, and signing out forgets it, because these are phones that get handed over. It remains a filter that confers nothing — the database decides every write from the assignment.

**The switcher is a chip per outlet, in both of its modes.** A screen that reads several outlets at once toggles them; a screen that reads one replaces the choice. The chip, the selected treatment and the rule below are identical either way, so the control does not change shape as an owner walks from Attendance to Cash to Ledger. It was a dropdown in the single-outlet case, and that was worse than it looked: a select's options are floored at 16px so a phone does not zoom on focus, which left it towering over the small "Outlet" caption printed beside it — and the caption was carrying nothing the outlet's own name did not already say. The chips carry the name; `aria-label` carries the word.

**A screen that can read several outlets at once lets you select several** (#29). Attendance is the first — a native multiple-select needs ctrl-click and is close to unusable on a phone. The result is one combined list with each entry naming its outlet, never one list per shop. **The current selection cannot be cleared** — an empty selection is a blank screen asking a question nobody asked — so that chip is disabled rather than swallowing the press, which is also what makes the single-outlet case read correctly: the outlet you are on is the one you cannot press. Somebody who may see one outlet is offered no selector at all. Selecting several widens nobody's reach: the database returns only what their assignments allow, and the selection is intersected with that.

**Changing the selection clears what was read under the old one first.** Until #29 the previous outlet's rows stayed on screen under the new outlet's name until the fetch landed, which is a screen telling you something untrue for a second or two. Now the old data is dropped before anything renders and a placeholder holds the layout — see [Design System](DESIGN_SYSTEM.md).

**Daily cash** — the reconciliation screen, and the one this business was commissioned to get right. Opening float, cash sales (derived from settled cash bills), cash expenses (derived from cash expenses), withdrawals, and therefore the expected closing — everything above the single input is worked out, and each derived figure says so. **Only cash moves any of it**: a UPI sale is revenue and not drawer.

A manager supplies one number, what they counted, and **the difference appears the moment it is typed** — with its direction in words as well as by sign, because a minus is the first thing a small screen loses and *"₹240 short"* is not a sentence anyone misreads. Closing snapshots the figures and states, first, that the day cannot be closed again.

**A bill that arrives after a day has been closed does not change it.** The closed figures are what somebody counted and signed off; the late arrival is reported on this screen as a *reconciliation exception* naming the bill, its amount, when it was rung and when it landed. Silently folding it in is the failure this whole chain exists to prevent.

**Attendance** — read along two axes, because a roll-call and a pattern are different questions. **The outlet chips sit in the header above the axis, apply to both, and never move** — the same place and the same shape the Ledger uses, because it is the same reader asking about the same shops. Beneath them, one segmented control chooses **By day** or **By staff**.

The chips scope who is read, not how a person's history is assembled. **The by-staff read still names no outlet**, so what comes back is resolved in the database from the reader's own live assignments — selecting a shop narrows *who is offered* in the person picker and nothing else, and a person who moved between two outlets mid-month still reads as one continuous month. Dropping the outlet of the person currently on screen moves the view to somebody the picker is still naming, rather than leaving days under a name the control no longer offers.

This reverses half of #29, which cut the outlet choice out of the by-staff axis entirely. The half that mattered stands: the axis is still chosen freely, and the read still names no outlet, so the owner's actual question — *how many days did this person work in August* — never starts by naming one shop. What changed is that a control sitting above both axes now means what its position claims.

**By day** is the staff of the selected outlets for one business date: who arrived, when, from where, how accurate the reading was, whether they were late, and which days are still waiting. **Everyone currently on the outlet's staff appears, including those with nothing recorded** — a day view that listed only the rows that exist would quietly hide the people who never arrived. A departed person drops off the day; a deactivated one still appears with the deactivation noted, because access and working there are different facts.

**Staff means staff.** A manager or the owner appears here only when they also hold an Employee assignment at the outlet; nobody records a manager's arrival, and listing them was a row to read past (#28). The one exception is somebody who **already carries a record on the day shown** — they stay listed whatever they hold, marked *not on this outlet's staff list*, and can be approved, because the waiting counts are computed from rows and a row inside a count and outside the screen would be a badge nobody could clear. They are offered no *Record arrival*: they already have one.

**Every arrival waits for approval, in the fence or not.** A check-in records where a phone was; only a manager saying so records that somebody worked. Waiting days are distinguished on the row, **counted by a badge on the day picker**, and **sorted to the top of the roll-call**, since they are the only rows carrying somebody else's request for attention. That order is fixed while the page is open and recomputed next time it is opened, so settling one day never slides the next person's Approve button under a moving thumb. Each row keeps its own Approve and Deny, which is the ordinary path on a morning with one or two arrivals. The approval reads the manager's own position **once, for that action, and never carries it over to a later one**: **inside the fence, on the row's own business day, it is one tap with no reason at all** — and anywhere or any day else it asks for one first, which is stored on the day and readable by the person it is about. Nothing is refused for being elsewhere. A manager who approves from home every morning shows up as a column of reasons, which is oversight a refusal would not have produced.

**Several people can be decided in one action, but every one of them joins that action by a tap of its own.** Each waiting row carries a small box, leftmost in its own row of actions ahead of `Approve` and `Deny`. Pressing it adds that person; pressing it again takes them out. It carries no word, because an empty box and a checked box say add and added, and a label on every waiting row would cost the width the two real actions need; its spoken name states the person, so eight waiting rows are eight distinct controls rather than eight buttons called *Select*. There is no Select all and no shortcut of any kind that adds more than one person: not by outlet, not by lateness, not select-the-rest, no range drag, no press-and-hold sweep. Ten people is ten taps to select and one tap to act, and **the saving is in the acting, never in the selecting** — which is what stops an arrival nobody saw being counted. `Clear` is the one control that touches several at once, and it is safe because it only ever removes people from an action.

**The set is the mode.** Selection is on exactly when somebody is in it: the first press enters it, taking the last person out leaves it, and so does `Clear`, a refusal that drops every row, or the day reloading with every selected row settled by somebody else. There is no standing control announcing selection before anybody has chosen anybody, and no bar counting nought.

**While a set exists its bar takes the day picker's place**, stating the exact count with `Approve`, `Deny` and `Clear`, and the slot is pinned to the top of the scroll. Occupying the picker's slot rather than appearing under the list means the first press moves no row out from under the thumb that made it, which is the same stillness the fixed sort order keeps. The per-row `Approve` and `Deny` stand down on every waiting row while it is up, because two ways to act on one row is the ambiguity this least needs; *Record arrival* and *Correct attendance* stay, since they appear only on rows that can never be in a set. Changing the day is not offered while a set is open, which is honest, because leaving the day empties it.

**A waiting row cannot be closed.** Every control that decides it lives behind the chevron, so a closed one is a row a manager can neither act on nor tell apart from one already in the set. Its chevron stays on screen and goes inert rather than disappearing, so nothing shifts when the row settles and the chevron becomes live again. On every other row, tapping the body opens and closes it exactly as it does outside selection, so a manager can read somebody's evidence before deciding about them without disturbing the set they have built.

**Anything decided from the set's bar is named back before it is written** — every person, with their outlet, and their business date where the set spans dates. A set of one is no exception: building a set is a deliberate act, and the point of the gate is that the manager reads who they picked. It is always the last step: where the rule wants a reason, the reason is collected first and the confirmation follows it, so the names are read in the light of the sentence just written. The per-row `Approve` and `Deny` confirm nothing, because that row is already the thing being looked at. Cancelling writes nothing and keeps the selection.

**And it shows the whole of what the decision will say, not only who it is about.** The reason is quoted back in the manager's own words; an approval states where its one position reading left it; a denial states the retry choice **whichever way it was left**, because letting somebody put their own day right is a decision about that day too. Naming the people and hiding the sentence being recorded against them would confirm half an act. Each of those is said once and in as few words as it takes: the sheet before this one is where a choice is explained, and repeating the explanation here in different words made the last screen unreadable.

**A refusal costs the action, not the selection.** The whole set is settled or none of it is. If somebody retried or another manager decided one of the rows, nothing is recorded, the day is read again, the people who moved are named and dropped, and everybody still waiting stays selected so the rest settles in one more tap.

**Deny sits beside Approve on the one current waiting attempt, and takes a set on the same terms.** Its sheet has
exactly two manager inputs: a required editable reason and a retry-prevention
checkbox naming the business date it applies to, always unchecked when the sheet
opens. Where a set is being denied it says so — one reason and one retry choice
for everybody selected, each on their own business date — and where the selected
attempts carry mixed evidence the reason starts blank rather than prefilling a
sentence that would be false about part of the set. A measured outside attempt is
prefilled as *Not at outlet* and an attempt with no usable fix says that its
location could not be verified; the manager may edit either before submitting.
Denial never asks for or stores the manager's position. It immediately makes
the outcome absent and clears the waiting item. Checking the optional box locks
all employee retries for that person/date across outlets.

**Corrections stay inside expanded settled details.** One quiet *Correct
attendance* entry offers only actions meaningful for the current state: mark
present, mark absent, allow another check-in, mark absent and allow one, or
**change check-in time**. Choosing the time correction reveals one required time
field in the same sheet; the reason remains required. It is available only on a
settled row, including historical days. Every
correction requires a reason and is appended to the decision history. Correcting
to present reuses the manager-position flow while retaining the employee's
attempt evidence; absent and retry-policy corrections read no manager position.
This is also how a manager reopens a prevented wrong-outlet denial so the person
can check in at the outlet where they were meant to work. A time correction
changes the effective arrival and therefore the late tag everywhere, while
History keeps the original attempt and shows each old-to-new time, actor and
reason. Future times and times outside that outlet business date are refused.


**The day controls say where the rest of the work is.** The badge on the day picker counts only the day on screen, so the earlier-days and later-days arrows carry a dot when **this outlet** holds unapproved arrivals before or after it. The dot is scoped to the outlet in scope and to nothing else: another shop's backlog never marks these arrows, and switching outlets changes what they say. A count of nought is never drawn — the absence of a badge always means there is nothing waiting.

**The outlet chips carry their own backlogs.** Each chip in the outlet selector shows how many days are waiting at that outlet, so the count sits on the control that reaches it and noticing a backlog and acting on it are one gesture. There used to be a second row of chips above the selector, shown to the owner alone, naming the same outlets in the same shape without any way to press them; one row of outlets is enough, and it no longer changes shape with the state of the database. Selecting a chip **adds** that outlet rather than replacing what is already being read. The counts cover exactly the outlets the reader may see — a Franchise Admin running two shops gets their two, because the count is scoped by the attendance policies and carries no owner branch. Somebody with one outlet has no selector and so no chip, and loses nothing: the day badge and the arrows already say everything a per-outlet count could. An outlet holding nothing carries no count, so an absent one always means the same thing. That count spans every business day, which is why it is deliberately not the same number as the day's own badge: a shop can hold nothing today and a week behind it.

**A row is a headline until it is opened.** Each row shows who it is about and what the day counts as; the time, the evidence, the approval and the actions are behind a chevron. A roll-call of eight people rendering everything puts the two rows a manager came to decide somewhere down a scroll. **A row waiting for approval opens by default**, because it is the one row asking for something and putting *Approve* behind a tap would be a tap in front of the only thing this screen exists for. Opening is the reader's own state, so settling a day leaves the row open showing what just happened rather than folding away under the thumb that pressed it. A row with genuinely nothing beneath it — *working at another outlet*, whose whole content is that one line — gets no chevron at all, because a chevron that opens onto nothing is worse than none.
**Somebody with no arrival still reads as something**: *not yet arrived* before the deadline of any outlet that could still see them arrive, *absent* after it and on every past day, and **working at another outlet** on a day they were accounted for somewhere out of scope. No row is written for those days — the reading is derived when the day is read.

**A verdict somebody may dispute carries its cause.** Every absent day opens onto one short sentence saying why: *No check-in by 01:00 pm*, *Priya denied the check-in*, *Priya changed this from present to absent*, or — for a day no decision accounts for — *Recorded absent, with no manager decision explaining it*. It names neither the day nor the person, because the card's own heading is both, and it names the deadline rather than describing it, because "the deadline for arriving has passed" makes the reader ask which deadline. Where somebody works at two outlets with different deadlines, the time shown is the later of the ones **the reader may see** — the same scope the absent verdict was derived from — so the owner reading Kanchrapara's 08:00 pm and a Kalyani admin reading 01:00 pm are each shown the deadline that justified the verdict in front of them. A denial and a correction are told apart by what the day counted as beforehand rather than by wording, since two similar sentences are not a distinction. The manager's own reason is quoted beneath, never reworded, and the database requires one for every denial and every correction. No icon: the verdict directly above already carries the mark that means absent.

**The cause is the decision that made the day absent, not the last one to touch it.** Reopening a retry, and closing one on a day already absent, both record `absent` as the new status while deciding nothing about the outcome. Treating either as the cause means the newest wins and the denial stops being shown — so somebody asking why they are absent is told a manager kept it absent, which answers nothing. Both are adjustments, and both remain in the History list beneath with their reasons.

**And it is addressed to whoever is reading it.** The person the day belongs to is spoken to directly — *You did not check in, and the deadline for arriving has passed* — and a manager reading their own decision back is named in the second person rather than having their own name repeated at them: *You denied the check-in for this day*. A reader who is neither gets neither, because "you did not check in" shown to a manager scanning somebody else's row is a false statement about that person's pay, made to the person deciding it. Both substitutions come from the reader's own id measured against the day's subject and the decision's actor — never from a per-surface voice setting, which is a thing a call site can pass wrongly. English past tense does not inflect for person, so this is two substitutions rather than two sets of sentences. It is behind the chevron rather than on the headline, so the roll-call stays scannable, and it is the reason a derived absence has a chevron at all when the other derived readings do not. The words are the same on the manager's roll-call, the person view and the employee's own history, because one component renders all three. Note that this is about a day that **is** an absence: an unapproved check-in is stored `absent` and is not one, so a row still waiting for its first decision says it is waiting and claims nothing about the day counting against anybody.

**A person is never absent at one shop on a day they worked at another** (#29). A day belongs to the person, so somebody staffed at two outlets holds one row wherever they went. The outlet they did not attend reads *working at another outlet today*, **without naming where**, and with no time, distance or approval — that is the entire fact the database discloses across an outlet boundary, and it exists because a Franchise Admin cannot see the other outlet's row and would otherwise be told a lie about somebody's pay. Select both outlets and the line disappears: their real row is on the list instead, once, naming the shop they went to.

**Each row is judged by its own outlet's clock and fence.** With two outlets on screen a manager's single position reading can be inside one fence and outside the other, so approving is decided per row. One reading covering rows at both shops is one truthful statement about where the manager stood, measured against each outlet's own fixed point — not a claim to have been at both — and the sheet says which rows are being approved normally and which need the reason, naming the outlets and the counts. The reason is then stored only on the rows that needed it. Lateness and the arrival deadline are likewise each row's own outlet's.

A manager can also **enter an arrival on someone's behalf** — past times only, on today's business day — for the person whose phone cannot; the event carries `manual` as its source, reads *entered by* that manager wherever it is shown, and is settled by the recording rather than queued for its own author to approve. Where several outlets are selected and the person is staff at more than one of them, the sheet asks which; where the outlet is unambiguous, nothing is asked. It is not offered at all for somebody already accounted for elsewhere that day: their day is taken, and the database would refuse a second.

**By staff** is one person over **one calendar month**, defaulting to this one, with the counts: present, late, absent and waiting. It exists so somebody can work out pay by hand, which is why **each business date counts once** whatever shop it was worked at. It offers **staff only** — a range of days for somebody whose days are not tracked would be a pattern of nothing, so a non-staff person's record is read on the day it belongs to, which is where anybody settling one is already standing. Its days collapse to their headlines like the roll-call's rows.

**A month, and no second way to say what the period is.** The arrows move a month at a time and cannot reach one that has not begun. The two loose date fields that used to sit under them are gone: pay is monthly, so a tally over eleven arbitrary days is a number with nowhere to go, and every absence in the list is derived from the period's bounds — so an arbitrary span produces an arbitrary absence count that reads exactly like a meaningful one.

**There is no outlet picker on this axis, on purpose** (#29). The read names no outlet at all, so what comes back is every outlet the reader may see, resolved in the database from their own live assignments: one shop for a single-outlet Franchise Admin, their own for a multi-outlet one, all of them for the owner. That is the intended meaning, so naming a set client-side could only duplicate the policy or contradict it — and a hand-crafted request cannot widen it either, because the policy is what decides. This reverses #22's decision to pin an explicit outlet here, which was right while the intended meaning was one outlet.

**And the by-outlet selection does not narrow it either.** Who is offered here, and which outlets a person's month is assembled against, is everybody and everything the reader may see, whatever the chips on the other axis say. The surface used to hand this axis the list already filtered by the selection, so deselecting a shop emptied a picker that has nothing to do with shops — which is exactly the confusion separating the axes was meant to end.

**People** — everyone the caller may manage, in one place. **Adding somebody is
one step**: required name, username, role and one or more managed outlets;
optional phone, title and joining date. No ordinary-email field or
placeholder-account state exists. The account and every selected assignment
commit before the one-time handover appears. A manager with one outlet sees it
preselected; a multi-outlet manager chooses only among outlets they manage.

Editing presents the ordinary one-outlet/one-role case first and discloses
**Works at multiple outlets** for zero, several, or mixed-role placements. One
save changes permitted personal facts and the complete live assignment set;
promotion, transfer and additions preserve account access and assignment
history. It is never a departure control. **Mark as left** is separate,
destructive, and confirmed: it ends every live assignment and deactivates the
account together. A person with no live placement reads **Not assigned to any
outlet**.

The list derives status from active state, successful sign-in history, live
placements, and a live unexpired handover: **Needs setup**, **Set-up link
issued**, **Active**, **Active · password reset issued**, **Deactivated**, or
**Not assigned**. Its actions use the same truth: a never-signed-in person gets
**Set up account** and an established person gets **Reset password**. The
one-time handover names its purpose, highlights the username, has QR and copy
actions, states one use and expiry, and cannot be retrieved later. Managers can
correct another person's username and issue a handover within their authority;
they cannot manage themselves or create privileged roles.

**Profit and loss** — outlet-level estimate for a chosen period, with the **cash-basis / consumption-basis toggle stated plainly on screen**, because the two answer different questions and mixing them is the classic error. See [Data Model](DATA_MODEL.md#two-modelling-traps-in-this-domain).

The basis is never merely selected — it is **named in words beside the figure**, with the working underneath: sales, what was subtracted, and on the consumption basis the stock used at cost. Raw-material spending is listed like any other expense and labelled *not subtracted on this basis*, because the reader most likely to mistrust the number is the one who can see a ₹1,500 chicken bill and no sign of it. A manager sees their own outlet and is offered no outlet control; the owner picks, because they belong to none.

**Alerts** — raise an issue to the owner (category, priority, message) and track responses. Four fields and no more: what it is about, how urgent, a subject, and what happened — the last two refused if blank, by name. An alert is always raised **open**; acknowledging it is somebody else's action, and raising something pre-acknowledged would be acknowledging it on their behalf.

**Tablets** — the counter tablets set up at this outlet, what each last reported,
and one timestamped view of the live counter's operator and effective shift
figures with an explicit re-read. A setup code appears where there is room for
one, and removal remains permanent. Described in full under
[Biller](#biller--the-counter-tablet).

## Super Admin — all outlets, on a phone

**Owner dashboard** — every outlet side by side: today's sales split by payment method, what should be in the drawer, and a line naming what needs attention — open alerts, items at their threshold, and **yesterday's drawer if it did not balance**. Today's difference is null until somebody counts, so a console that only ever showed today would make an owner open each outlet in turn to find out whether last night came out right. Designed to be read in ten seconds while doing something else.

Every figure on it is **summed from the rows another screen shows** — the bills the counter rang, the expenses the manager typed, the movements in the stock ledger — so the console and the counter cannot contradict each other. A day that has been closed contributes what was counted and signed off, never a recomputation of it.

**An outlet whose figures cannot be resolved is still listed, with the absence stated.** That is what a signed-in owner sees today: the outlets are real, the trading data is not there yet, and a fabricated `₹0` would read as *you took nothing today*. The numbers appear when billing does (#13), without the screen changing.

**Outlet switcher** — a control on the console: all outlets, or one. Choosing one scopes the console, and each outlet opens to a read-only view of its day at its own address — sales by method, the cash position and whether the day is closed, low stock, open alerts, who is checked in. **Read-only is stated on the screen**, not implied by absent buttons, because a screen that merely lacks controls says nothing about whether you were allowed to use them; the refusal behind it is the database's. The switcher offers exactly the outlets the data layer returned and can never name one it did not.

**Outlets** — where each outlet is, and how far staff may be when they check in. **Position is captured on site, from the device standing at the counter**, never typed in or picked off a map: the screen takes a reading over a few seconds, keeps the tightest sample, and shows its accuracy before anything is saved. A fix looser than ±50 m is refused outright, and one between ±25 m and ±50 m saves with a warning — this reading is judged once and then judges every future check-in, so it deserves a stricter bar than a check-in does. The accuracy and the capture time are stored with the position, so an outlet carrying placeholder coordinates is visible as such rather than indistinguishable from a surveyed one. Only the Super Admin may write it, and the arrival deadline beside it for the same reason: a manager already holds the approval, which is recorded with who, when and where they were, while moving the fence or the deadline is silent and applies to everyone from then on. **An outlet that should never have existed can be deleted, and only then** — the action appears once the outlet is marked closed, never on one that is trading, so the reversible step always precedes the irreversible one. The confirmation says what deletion does that closing does not: the row is removed rather than hidden, and there is no undo. It succeeds only while nothing at all is attached, and a refusal names what is still there — *people — 2* — rather than reporting a database error. Nothing is typed to confirm: the outlet this most exists for was created with the placeholders still showing and has neither a name nor a code to type, so it shows as *Outlet created without a name* and is acted on like any other. **The form now refuses to create that outlet in the first place** — name, short code and location label are each checked for blankness on submit, on the edit path as well as create, and the refusal names the field rather than saying a required field is missing. The submit button stays enabled while they are empty, because four required fields behind a greyed-out button say nothing about which one is wanted. The sample placeholders read `e.g. Shawarmania Kalyani` for the same reason the nameless outlet existed: an unprefixed one looked like a name already filled in.

The same screen creates and edits an outlet: code, name, location label, address, phone, the business-day cutover and the future date on which counter billing begins feeding its ledger. That billing date is owner-controlled, nullable until rollout, and locked once its business day starts. A **Find the address** search sits above the address block: type a landmark, street or shop, pick a suggestion, and the street line, second line, city and PIN fill in one action — with the District following from the PIN, because no geocoder answers the Indian revenue district correctly and India Post does. It fills the location label only when that field is still empty, never overwriting the owner's own wording. Everything it writes stays editable, and the block is exactly as typeable as it was: an outlet must be creatable when the lookup finds nothing or the phone has no signal, so a failed search says nothing at all and a search with no matches simply says so. **The address search never gives an outlet its position** — the coordinates that come back are discarded, because the geofence is captured on site and a rooftop centroid would mark somebody absent at their own counter. **Its empty state is the important one** — it is the first screen an owner sees on a new installation, and it says what to do rather than reporting no data, because nothing else in the product is reachable until an outlet exists. Editing the cutover is safe at any time: business dates are stored as explicit columns and never derived from a timestamp at read time, so a new cutover applies to the next day resolved and moves nothing already recorded. **The cutover field argues its own case.** It is labelled *The day rolls over at* rather than as a start time, says outright that it is not the opening time, and carries a live panel that resolves one whole trading session — prep, afternoon, evening rush, the last bill after midnight — against whatever is currently typed, naming the business day each moment would be filed under. When they do not all agree it warns that one night's trading would be split across two business days. The old copy explained the rule as *after midnight but before this time*, which only reads correctly to someone who has already chosen an early-morning value and goes silent for exactly the person who typed an opening time — which is what happened at both outlets.

An outlet can also be **marked closed**. That means the shop is not trading: it disappears from the lists accounts are assigned from, and check-ins there are refused — while an approval is never refused for that reason, so a day worked before the shop closed can still be settled afterwards. Nothing cascades. Accounts and recorded attendance are untouched, no login is revoked, and reopening is one tap; the confirmation says all of that, because an owner expecting it to cut off access would be dangerously wrong.

**People** — every person across all outlets. Create one account at one or
several outlets, issue a fresh one-time code, correct another person's
username, deactivate/reactivate, and manage assignments. Selecting Super Admin
hides outlets and requires that owner's real account email; every other role
omits email entirely. Only an authorized Super Admin can see another Super
Admin's account email or correct it, and one's own remains read-only here. The
same email is an alternate sign-in identifier and a foundation for future
recovery or security features.

The account, profile, role-required Super Admin account email, and every
starting assignment exist before the one-time handover is issued. A handover is
shown once: its purpose, username, QR/link containing only the code, and copy
action. The URL carries neither username nor email and the code cannot be
looked up again. An atomic edit replaces a live activation handover only after
the final assignment set exists; it preserves a live reset handover and never
issues an unsolicited reset. The owner alone sees the global failed-activation
notice. One's own row offers no actions.

**Ledger** — *temporary (#36), and the whole surface goes when #12 carries its rows across.* Where the owner writes down expenses, aggregator trade and drawer facts that do not yet have their final live records. Each outlet has an explicit future-only **Counter billing starts on** date on the Outlets screen. Before it, Cash and UPI remain typed exactly as before. From it onward those two inputs disappear and the values are labelled **from counter**, derived once from settled bill allocations; Zomato and Swiggy revenue and their daily commission rates remain typed. Two views sit behind one toggle, one outlet at a time through the same switcher every other outlet-scoped screen uses. It sits **ahead of People** in the navigation, because it is opened every night and People is opened when somebody joins or leaves.

**A Franchise Admin gets the same screen**, at the outlets they are assigned to, where it sits directly after Attendance and ahead of People for the same reason. The capability was owner-only because production had two Super Admins and no live Franchise Admin at either outlet — the entry recorded that accident rather than a decision, and a manager who counts the drawer nightly but cannot read whether the month covered its costs is running half a shop. Outlet staff reach the expense list and nothing else, on their own screen; see **Expenses** under the Biller below.

Which day or month is a **stepper in the same shape the attendance range picker uses** — a bordered strip with a step at each end — because they answer the same question and a second idiom for it would be a second thing to learn. Forward stops at the outlet's own today, since a business date in the future is refused by the database and a control that offers one is offering a failure. The day itself reads `Today`, or `03 Aug 2026` as every other screen writes a day, and it is **not typable**: pressing it opens the platform calendar, and the two steps do the rest. A bare `input type="date"` was the first attempt and lost on three counts — it prints the browser's locale format, it carries its own calendar glyph beside two arrows that already say what the control does, and a date half-typed into a control that reloads a day on every change is a reload per keystroke.

**One day** is built like the real cash screen rather than like a form: the figures are typed into one card and **the difference appears as they are typed**, through the same module the month reading uses. A save button that had to be pressed before the drawer's difference could be seen would make the one number this screen exists for the hardest one to reach.

The entry card is laid out for the device it is used on. Before an outlet's billing handover, money fields sit **two to a row** with the unit inside the box, so `Cash` and `UPI` read as words instead of `Cash (₹)` down a column of full-width inputs. From the handover date those two boxes become read-only **from counter** values. Each aggregator remains **one outlined typed block** holding its stated figure, the rate that applies to that day and, computed as you type, **what actually arrived** — the only one of the three that is money received, and previously nowhere on the screen. The rules the ledger runs on are behind a marked control beside each section title rather than printed under the fields: they are read once and then known, while the form is opened nightly, and left on screen they cost more height than the fields do. Labels are short and the hidden half of each one carries the rest, so `As stated` announces itself as "As stated for Zomato, in rupees" — an outlined block means nothing to somebody who cannot see it.

Once a day is recorded it **stops being a form**: the entry card becomes a dense reading of what was stored, and the inputs go behind an Edit button that gives every figure back exactly as it was. Twelve inputs holding figures nobody intends to retype are twelve chances to change one by accident, and on a phone they push the two readings the screen exists for below the fold. The read card carries the **revenue side** — UPI, and each aggregator's stated revenue with the rate stored against that day and the amount actually received — because the drawer's figures are all on the card below it, and repeating them would put two answers to one question a thumb's width apart. Each **cash movement's reason sits beside the amount it explains** on that drawer card, since the field that captured it is no longer standing open and `Cash added ₹2,000` accounts for nothing by month end. Cancelling an edit writes nothing.

Opening cash and both aggregator commission rates arrive **inherited from the previous recorded day** and stay editable, because they are stored per day and correcting one day must not disturb another; on an outlet's first tracked day nothing is inherited and the screen says so rather than defaulting to zero. **One set of words for cash throughout**: *Cash from sales*, *Cash added*, *Cash expenses*, *Cash withdrawn*. The drawer reading used to say *Cash taken* for sales and *Cash taken out* for a withdrawal, which are the same three words for two opposite movements. Cash added and cash withdrawn each **require a reason**, and the screen says outright that equipment bought with drawer cash belongs in Cash withdrawn rather than in expenses — that is what keeps the count reconciling while the month's expenses stay clean. Where a day's stored opening disagrees with the previous day's count the screen **reports the gap and repairs nothing**, because a figure somebody counted is evidence and quietly replacing it would hide the very break it just found. Each expense requires a free-text category and may carry an optional note; suggestions open on focus, while typing a new category grows the business-wide list.

**The expense list and its form are one component this screen and the staff Expenses screen both mount.** The alternative — this screen opened to staff with revenue and drawer stripped by role — was the intuitive shape and is more work, not less: it reads the day row for almost everything it draws, so an account holding no day row means a role check in front of every figure on a 1,400-line component, each one a place a figure leaks later.

Every expense **names who recorded it**, which is what makes “your own rows” legible rather than remembered, and an expense that both comes from the drawer and was recorded by somebody holding no assignment at that outlet is additionally marked **recorded from away** — expected cash moved and nobody standing in the shop spent it, which is what whoever counts tonight needs to know. A non-cash entry from away carries no such marker, because it moves no drawer and the recorder's name is the whole story. Recorder, timestamps, and the withdrawal's actor and reason live behind an **expandable card** rather than an info icon: the detail is more than a tooltip holds, and a tooltip is a hover idiom on a screen used entirely with thumbs.

**An expense is withdrawn, never deleted.** It stays on the list, struck through and dimmed together — a strike alone is a hairline on a phone in daylight, and colour alone is not a signal every reader receives — and it stops counting toward the day's expected cash, the day's total and every figure in the month including the category breakdown. A reason is **optional**: the moment and the account answer what the trace exists for, and demanding a sentence on the fastest correction path would collect a column of “mistake”. Where the two differ, a day's reading names both the account that recorded it and the account that last corrected it, so a day the owner recorded and a manager later fixed does not read as though the owner entered the figures now on screen.

**The month** shows revenue by all four channels with each aggregator **netted by the rate stored against each day** — so a rate renegotiated mid-month is right on both sides of the change — expenses grouped by their normalised stored category with every line and its optional note behind the total, and an estimated profit that states in words that it is a **cash-basis operating estimate**. Operating, and it says why: capital spending is deliberately not recorded here, so the figure answers whether trading covered running costs rather than where every rupee went. A month nobody has written in says so instead of showing `₹0`, because zero is a measurement and an empty month is not one.

Beside that breakdown, **Manage categories** opens an owner-only curation surface
without taking a navigation slot. It shows each suggestion with separate manual
ledger and live-expense usage counts. Rename may leave history as written or
rewrite it deliberately; merge always moves every historical row; retire removes
only the suggestion. Rename and merge show both row counts and the absence of an
undo before they run, and the operation log on the same screen explains any
historical month that changed.

The day surface belongs to the owner and the outlet's Franchise Admin, and the refusal is the database's. Biller and Employee accounts receive only the shared expense list, never revenue, drawer or month figures.

**Comparison** — outlets side by side over a period: sales, expenses, estimated profit, cash differences. The screen that justifies the whole system for a multi-outlet owner. The **period and the profit basis are both stated on screen**, because two outlets compared on different bases, or over a range the reader has to remember, mislead more reliably than no comparison at all.

**Reports** — a period summarised for one outlet: sales by payment method, expenses by category, profit on the stated basis, and the drawer day by day. **Nothing here produces a file, and that is deliberate while the figures are demonstration data**: a download of invented revenue is far easier to forward than a screenshot, and it arrives detached from the banner that says what it is. The absence is explained on screen rather than greyed out, and it makes exporting fabricated figures impossible by construction rather than by discipline. Exporting arrives when the figures do.

Reports and P&L have **no navigation entries**. Six tabs is as much as a bottom bar holds on a phone, and both answer a question somebody asks while looking at today's figures — so they are reached from the console, which is where that question gets asked. Ledger takes the sixth tab and is the reason that limit is now reached rather than approached: it is opened nightly, from a standing start, by somebody who is not already looking at a figure — which is exactly the case a tab is for, and exactly the case Reports and P&L are not. It vacates the slot when the capability is retired.

**Alerts inbox** — everything raised across outlets, ordered so that what has not been read comes first and priority decides within that. Each row names its outlet, because acting on the right alert for the wrong shop is the mistake a cross-outlet list invites. **Priority is a word and a distinct glyph, never a colour alone.**

An alert moves **one step at a time** — open → acknowledged → resolved → closed, with reopening from anything unfinished — and the step it cannot skip is acknowledgement, which is the step that tells a manager somebody has seen what they raised. **Closed is final**: if it comes back, a new alert keeps the history of both readable. Replying is a separate action from moving the status, because reading something is not the same as acting on it, and a screen that folded them together would take away the reader's ability to say which they did.

## Employee — a phone, and almost nothing else

**Home** — one large check-in button, today's status, and the outlet they are assigned to. A recorded arrival says plainly that it is **waiting for a manager to approve it**, never that the day is done: it counts for nothing until somebody vouches for it, and a screen implying otherwise would be the misunderstanding this design exists to remove. An arrival after the outlet's deadline reads as late.

An outside or unverifiable check-in is still recorded and waits for a manager.
The employee may retry only while the newest attempt is outside/unverifiable or
after an open denial; an inside pending attempt and every approved, manual,
leave, half-day or retry-prevented day are locked. A retry can resolve to any
live outlet where that person has an Employee assignment, but only while that
outlet still reckons the same explicit business date as current. Being absent at
one outlet does not create a second person/day at another.

Before writing, a retry shows one confirmation whenever it would change the
outlet, on-time/late classification, or inside/outside/unverifiable evidence.
It lists every before→after change together. *Keep existing check-in* writes
nothing; *Use new check-in* appends the attempt. A denied day remains visibly
**Absent — new check-in awaiting manager review** until that newer attempt is
approved. Repeated weak readings remain possible so a staff member can recover
from GPS drift, but no retry erases prior evidence.

**Expenses** — the same screen the Biller gets, described under the counter tablet above. The owner asked for “all staff”, and an Employee who goes to the market for vegetables is exactly the person the change exists for. One surface, mounted in two shells, because a surface belongs to one role's shell here — the same reason the manager's Menu and the counter's Menu are separate entries reaching one component.

**My attendance** — own history a month at a time, with the same control the manager's person view has, and the same counts. Each day is a headline that opens onto its detail, exactly as the manager's rows are. For each day: every ordered attempt and decision, the outlet, time, status, distance, accuracy, source, late tag, denial/correction reasons, and approvals — **including whether the approver was standing at the outlet when they gave it**. Days with nothing recorded read as absent here too, and every absent day says why it is one — the same facts the manager reads, addressed to the person rather than narrated about them. Own records only, enforced in the database, and spanning every outlet they work at with each day naming its complete sequence. The symmetry is deliberate and is built by sharing the components: asymmetric visibility in a monitoring feature is how it becomes something staff resent.

## Cross-cutting

- **Every screen is responsive.** Manager and employee screens are phone-first; billing is tablet-first; everything is usable on a desktop browser.
- **The app is installable** and launches full-screen from the home screen.
- **Rupees everywhere**, Indian digit grouping, tabular figures.
- **Asia/Kolkata everywhere.** Business dates display as dates, never as timestamps.
