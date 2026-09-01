# Demo Mode

> The machinery described here is **built** (`demo-mode-and-app-shell`, #3): the adapter seam, the gate registry, the demo session with its role switcher, and the safety rails all exist and are tested. The billing counter (#6), the manager's operational surfaces (#7) and the owner console (#8) are built on it and are all walkable now, over one scenario spanning both outlets. [Running a walkthrough](#running-a-walkthrough) is the route through it.

Demo mode renders the **entire** four-role experience with mocked data, so the product can be shown — to an investor, a prospective franchisee, or the staff who will use it — long before the backend behind it exists.

Demo mode lives at a dedicated route prefix: **`/demo/owner`, `/demo/admin`, `/demo/biller`, `/demo/staff`** — one shareable URL per role. The role lives in the URL, so a deep link or a reload reconstructs the whole demo session with no stored state, and the role switcher is nothing more than navigation between prefixes. The prefix is also the safety structure: the demo route tree has its own provider stack, built only from mock adapters, so mixing demo and real data is unrepresentable rather than merely guarded against.

## Where the link comes from

**The demo is not advertised on anything an unauthenticated visitor reaches**, and has not been since #8. It became something the owner distributes rather than something a visitor stumbles into, so:

- **the Super Admin's account menu** carries a **View Demo** entry;
- where it goes is `/demo` — the demo root, not a role path, because the banner's role switcher is right there and a recipient should not be pinned to whichever role the owner was looking at. Sending it to somebody is the browser's own share or address bar: a copy button that the clipboard may refuse (it does, over plain http on a phone) needs a fallback explaining itself, and that is a lot of menu for something the platform already does;
- **the link is still public.** Anybody it is sent to can open it with no account, because a shared link that demanded a login would not be a demo. What changed is who *finds* it, not who may open it.

Franchise Admins do not have the entry. That is a decision to revisit when somebody asks rather than an oversight — the link is public either way, so nothing is protected by the omission; there is simply no reason to widen an affordance ahead of wanting it.

**If you have been asked to run a demo and have no link, ask the owner for it from that menu.** There is no other route in, which is the point and is also the trap: keeping it out of the way in makes the demo undiscoverable to everyone else.

**Leaving the demo returns to the application root, and the root resolves.** Since the-root-resolves-instead-of-greeting there is no card there to land on, so a visitor with no session continues to sign in. That is the intended destination rather than a rough edge: the exit exists for the owner who was demonstrating, and somebody sent a demo link has no reason to use it. What demo mode owes is that leaving leaves, which the exit's own tests assert.

One consequence to expect rather than report as a bug: **following the link while signed in lands on the "you are signed in — this is the demo" gate**, for the owner exactly as for anybody else. It is not special-cased, deliberately. Continuing is one tap and is held per tab.

It is not a testing convenience bolted on the side. It is the delivery strategy: every screen is built in demo first, then made real one at a time.

## Why the app is built this way

The whole UI ships before any of it is wired up. Three things follow:

- **The product is demonstrable from very early on**, which matters to a business actively selling franchises.
- **Screens get designed against the awkward states** — a failed geofence, a cash mismatch, a sync backlog — which are tedious to reproduce against a real backend and trivial to stage against mocks.
- **Feature work becomes narrow.** A `*-live` change swaps one adapter and promotes one gate. It is not also a design exercise.

The classic failure of UI-first is designing screens the real data model cannot serve. Two rules prevent it:

1. **The schema lands before any UI** (`data-model-and-tenancy`, #2).
2. **Every mock is typed from the generated schema types**, so a fixture that drifts from reality is a compile error rather than a demo that quietly lies about what the system can do.

## The three gate states

Every surface is in exactly one state, declared in a single registry — `src/gates/registry.ts`, a typed build-time constant. Navigation and routing derive from it; promoting a surface is a one-line reviewed diff made by the change that earns it, never a runtime toggle:

| State | Real users see | Demo mode shows |
|---|---|---|
| `hidden` | nothing | nothing — not built yet |
| `demo` | nothing | the full mocked surface |
| `live` | the real feature | the real feature, with demo data |

A `hidden` surface is **absent**, not greyed out. A half-visible product looks unfinished in a way an absent one does not.

Promoting a surface from `demo` to `live` is the visible outcome of every `*-live` change. The roadmap is done when no surface is left in `demo`.

**`hidden` also means "was here and is not any more", and that matters for revert
stories.** `cash-is-counted-not-closed` (#11) set `admin-daily-cash` to `hidden`
rather than deleting it: that change drops and renames nothing, so the old
day-close screen and its tables stay in place, dead, and a revert is one edit to
this file plus a deploy. `hidden` rather than `demo`, because the four-role
walkthrough must no longer offer a day close — the model it demonstrated does not
exist any more, and a demo of it would teach the wrong thing to the one audience
that has not seen the new surface.

**A surface the business decides it will never build is deleted, not hidden**
(#51). `hidden` is for one whose route still resolves in principle and whose
return is plausible; these are not coming back, and carrying seven dead screens
through every future refactor costs more than the one-line reversal is worth.
Deletion takes the **gate, the route, the component and the tests together**, so
no half of a withdrawn surface survives the other.

**It does not take the tables.** `inventory_movements`, `outlet_alerts` and
`alert_responses` keep their schema, their policies and their isolation
coverage. Dropping a live table is irreversible in a way removing a screen is
not, so withdrawing a screen stays a decision about the application. A later
change may retire them once the rows have been confirmed worthless, and it will
carry a down-migration when it does; until then they are recorded in
[Limitations](LIMITATIONS.md) so a reader finds a decision rather than an
apparent oversight.

The seven were `owner-comparison`, `owner-pnl`, `admin-pnl`, `owner-reports`,
`owner-alerts`, `admin-alerts` and `admin-inventory` with its movement ledger.
All had been `demo` since the day they landed, so **no real user ever saw a
navigation entry or a reachable route for any of them.**

**Two `live` surfaces may deliberately answer the same question at once, for as
long as one is being proved against the other.** During #11's overlap the derived
**Ledger** (`owner-ledger-statement`) and the manual **Ledger** form
(`owner-manual-ledger`) were both `live` and both genuinely worked — the manual
one simply had no navigation entry. That was honest, and better than a switch:
**the fallback was a tab, not a runtime toggle**, so the owner could open one
business date in each and compare them, which is the two-day acceptance test they
asked for with no engineering behind it. `retire-the-manual-ledger` (#12) ended
the overlap once that comparison had been made on real trading days: the manual
entry is gone from the registry entirely, not set to `hidden`, because its route
and its surface are gone too.

The owner Swiggy sync tab is live because its browser-free production reader
has completed a no-write rehearsal and a successful scheduled write from the
captured session. A money-reporting surface does not become visible merely
because its mock is complete.

Billing is now a worked example of that promotion without composition drift.
Real personal accounts receive manager history or staff phone surfaces; the
enrolled `/counter` branch constructs the Dexie-backed live adapter. `/demo`
still constructs only the shared mutable mock store, so ringing, undoing or
paying a demo order opens no IndexedDB delivery queue and no Supabase request.

## The adapter seam

```
        screens & features
                │  depend only on the interface
                ▼
    ┌───────────────────────┐
    │  Data adapter (typed) │
    └───────┬───────────────┘
            │
    ┌───────┴────────┐
    ▼                ▼
SupabaseAdapter   MockAdapter
 (real data)      (fixtures, typed from the schema)
```

The session provider is split the same way: a real Supabase session, or a demo session with an instant **role switcher**. Flipping between Super Admin, Franchise Admin, Biller and Employee without signing out is what makes a walkthrough compelling — and it is why demo mode needs no authentication at all, which in turn is why the demo can exist before auth does.

Concretely: interfaces live in `src/data-access/adapters.ts` (one per domain area, added by the `ui-*` change that needs them — `outlets` is the exemplar), mock implementations and their fixtures under `src/data-access/mock/`, real ones under `src/data-access/supabase-adapters/`. Screens read the seam through `useAdapters()` and the session through `useSession()`; the demo tree provides both from `src/demo/`, parsing the role from the URL.

**A screen that reaches for the Supabase client directly has broken the seam.** That is a review failure, not a style preference — and lint enforces it, twice over: no file outside `src/data-access/` may import the client, and nothing under `src/data-access/mock/` or `src/demo/` may import the client *or* the real adapters.

## Safety rules

Demo mode ships to production, because it has to be showable from a deployed URL. That makes these load-bearing rather than nice-to-have:

- **A demo session is structurally incapable of writing to real data.** Not discouraged — incapable, in four layers: the demo route tree only ever constructs mock adapters; lint forbids its modules from importing the client or the real adapters; a runtime tripwire makes `getSupabaseClient()` throw while the demo tree is mounted; and two tests fail if a write escapes anyway — a unit test that walks the demo tree with a spied `fetch`, and a Playwright spec that fails on *any* request leaving the app's own origin.
- **A real signed-in user can never enter demo mode silently.** With a persisted session present, every `/demo/*` URL renders an interstitial naming the signed-in state; continuing is an explicit choice held per-tab (sessionStorage), so it dies with the tab rather than sticking to the account. A biller who wandered into a demo and rang up fake bills would be a genuine operational problem.
- **The demo indicator is always visible and cannot be dismissed.** The banner strip — "Demo — fabricated data", with the role switcher beside it — is chrome, not state: rendered unconditionally by every demo shell, with no close affordance and no prop that hides it. Leaving `/demo` is the only way to remove it. This protects the business more than the viewer: a screenshot of invented revenue circulating as real trading data is a serious problem in a franchise sales conversation.
- **And the banner is how you leave.** **Exit demo** returns to the app root. Leaving is not dismissing, so the invariant above is untouched: the banner goes only because the fabricated data it warns about has gone with it. Every control in the strip either stays inside `/demo` or leaves it entirely, and none of them hides fabricated data still on screen. Before this, somebody handed the link had no way out but the address bar.
- **Mock data is obviously synthetic.** Invented staff (the four demo personas
  are literally named Demo Owner, Demo Manager, Demo Biller, Demo Staff),
  invented usernames, invented customers, plausible-but-fabricated figures.
  Ordinary demo accounts carry no associated email; only the invented Demo
  Owner has an invented account email in the mock's
  privileged account view. The two real outlets and real menu are public
  business facts, but no real people or phone numbers appear. Every fixture is
  typed from generated schema-derived types, so a shape the database could not
  serve fails to compile.

## What the demo dataset starts with

One mutable dataset is built per demo session (`src/data-access/mock/store.ts`) and shared by every mock adapter, so the figures on one screen are the rows behind another: the drawer's takings *are* the bills the counter rang, the Ledger's revenue *is* those same bills plus the recorded channel figures, and the owner console's sales *are* the bills summed. It is constructed per session rather than as a module singleton, so **demo state resets** and every walkthrough starts from the same place.

Nothing in it is authored as a total. Every figure the owner sees is derived at read time from bills, expenses, movements and closed cash records — which is why two screens cannot disagree, and why a fixture that contradicts its own ledger **throws at construction** instead of shipping a demo that cannot answer "why does it say 4 kg?".

Worth knowing before running one:

- **Both outlets trade, and deliberately not identically.** Kalyani is busier and carries every awkward state; Kanchrapara turns over roughly half as much, is short of nothing, and closed yesterday exactly. Two outlets of the same shape would make the comparison screen unreadable — a difference is only legible against something that is not different.
- **Each outlet numbers its own bills from 1**, mirroring the per-outlet sequence the database enforces.
- **Every demo person has one canonical username.** People creation, correction
  and activation handover use the same namespace and validation as live mode,
  but the mock adapter never calls Auth, a mail provider or any real endpoint.
- **A shift is already open** for Demo Biller at Kalyani, so a walkthrough lands on the counter able to ring a bill. The whole shift lifecycle is walkable from there: **Hand over** on the tablet, **Leave counter** from the holder's phone, and **Finish day** with its readiness sheet — each ending the shift for a recorded reason, and each leaving the tablet on the request screen a real counter shows overnight. **Start again** puts the open shift back. Kanchrapara's shift has ended; no persona stands at that counter.
- **The full billing day is already coherent.** It includes direct Mark Paid tender capture, a Cash + UPI split, an order paid on handover, a reasoned cancellation, one open order, one payment not sent yet, one command needing attention and a repeat customer found only after their complete phone is entered. Aggregator trade remains in the demo ledger rather than masquerading as a counter tender. The paid examples reuse the same bills counted by Cash and the owner console, so adding lifecycle context does not invent revenue.
- **Start again** in the demo banner puts everything back. It states what it discards first, and it keeps you on the role you are looking at.
- **The counter handshake is walkable from both ends in one demo session.** Hand over on the tablet, ask for a shift naming a persona by name, then read the four digits and switch roles to type them in — the request, the code and the shift are session state, so they survive the role switch. The shift that opens is the one bills are then attributed to, so the next sale is rung under whoever just approved it. An unrecognised name behaves exactly like a recognised one: same code, same wait, same timeout, and no card on anybody's phone. Three wrong codes destroy the request, as they do for real.
- **Tablets agrees with that same counter.** Kalyani's card names the demo shift
  holder and derives bills, effective Cash/UPI, waiting orders and drawer Cash
  from the shared demo store. Kanchrapara states that nobody is at its counter.
  The reading time and all figures move together only when the surface is opened
  or **Re-read** is pressed, matching the live no-subscription contract.
- **The old counter PIN surface is hidden.** The walkthrough uses the same
  tablet↔phone handshake story as production; no personal password or PIN is
  typed on the tablet.
- **The Biller walkthrough is the enrolled tablet's own screen, not a copy of
  it.** `/demo/biller` mounts the same shell `/counter` mounts, so it has no
  navigation, no account menu and no sign-out, and expenses sit as a panel
  beneath the till rather than behind a tab. It is a leaf address: nothing
  resolves beneath it, exactly as nothing resolves beneath `/counter`. The demo
  banner is pinned above it, because that page scrolls and the banner may not.
- **One sale carries an after-departure attribution exception.** The morning
  operator left from their phone at 11:00; the tablet, offline, took ₹417 more at
  11:45 before it learned. That bill stays in the day's takings, keeps the
  departed operator as flagged last-known context, never appears in the incoming
  operator's shift, and waits in Admin → Billing for a manager to confirm the
  operator, name another, or record that it cannot be established.
- **Business dates are relative to today**, resolved through the outlet's own cutover. **Four days traded at each outlet**: the three before today are counted and signed off, and today is open and can be closed during a walkthrough. Four days rather than one is what gives a period report and a comparison something to be a period *of*.
- **Things have deliberately gone wrong**, all at Kalyani, because a demo where nothing does demonstrates nothing: yesterday's drawer was ₹240 short, a bill for yesterday arrived after that day had been signed off — which the cash screen reports as a reconciliation exception rather than quietly absorbing — arrivals are recorded and waiting for a manager, one of them taken well outside the geofence, the aggregator sync has work needing the owner, and a counter tablet is holding bills it has not managed to send.
- **Today carries a bulk delivery**, bought and mostly unused, so the Ledger reads like a shop rather than like a spreadsheet of identical days. It was here to give the P&L's basis toggle something to show; #12 withdrew the toggle and #51 withdrew the P&L, and it earns its place on the Ledger alone.
- **Every current menu item is non-vegetarian**, because every item the business sells is built on chicken. The vegetarian marker has no live example rather than a fabricated one; create an item from the menu form to see it.
- **The offline states are reached the way a real tablet reaches them.** There is no "pretend to be offline" control: put the device in aeroplane mode (or use DevTools) and ring bills — the indicator counts up, escalates at five waiting, and drains when the connection returns.

## Running a walkthrough

Twelve minutes, four roles, no preparation. **Start by getting the link** — see [Where the link comes from](#where-the-link-comes-from); it is in the Super Admin's account menu and nowhere else. Open it, and if you are signed in, tap **Continue to demo**.

Press **Start again** in the banner first if anybody has used this tab before you.

**1 — The owner, and why any of this exists** (`/demo/owner`)

Both outlets are on one screen. Read the two sales figures aloud: they are different, because the two shops are. Point at Kalyani's attention line — *arrivals waiting for approval*, *drawer ₹240 short* — and say that none of it was typed anywhere; each is a count of rows the audience is about to see.

**Show the bar itself while you are here.** Four entries, all of them reachable with a thumb. Tap **Setup**: a card opens above the bar with a tail pointing at the tab that opened it, and the count that was sitting on Setup moves onto Delivery inside it. That is the rule worth naming out loud — folding a screen behind a heading must never fold what it is waiting on out of sight, so a shut group carries the sum and an open one shows the parts, and the two are never both on screen.

Then open **Outlets** from inside Setup. Each card says what that shop is raising in words — a tablet holding bills it has not sent, a counter with no tablet at all — and carries a **Tablets** button that opens *that* outlet's tablet administration rather than a picker.

Then open **Attendance** from the owner's own navigation — no appointment, no switching, and the address stays inside the owner's shell. Use the outlet selector to move to **Kanchrapara**, the shop this owner holds no assignment at: one arrival is waiting there, and they settle it. The demo's emulated position is at Kalyani, so the rule asks for a reason first and records that the approver was not on site — the same rule the outlet's own manager answers to. Note who is *not* on that roll-call: the owner and the manager are not staff there, so nobody is pretending to record their arrival. Then open **Cash** at the same outlet: the day is all there, and the close and the withdrawal are not, because the drawer comes from the assignment. Switch the selector back to Kalyani, where the owner *is* the manager, and the same screen offers both — which is the whole boundary in one gesture. The outlet you last picked is where the next screen opens, so nobody answers that question twice.

**2 — The manager, where the numbers come from** (Admin in the banner)

**Overview** — the same page the owner just read, under the same name, and say so out loud: the manager did not get a lesser screen, they got the same one with the database answering it differently. One card instead of two, because `outlets_select` hands them the outlet their assignment names and nothing else. The page is titled for that shop rather than "All outlets", and there is no **Open** button — that leads to a Super Admin surface, and a button that ends in a not-found is worse than no button.

**Expenses** — today's spending, with the cash rows marked. Only those reach the drawer.

**Cash** — everything above the one input is worked out. Type a figure a couple of hundred short of the expected closing and watch the difference appear *as you type*, in words as well as sign. Then switch the day picker to yesterday: that day is closed, it was ₹240 short, and **a bill arrived after it was signed off** — reported as a reconciliation exception, with the closed figures untouched. That is the single most important thing this app does.

**Outlets** — the manager reads the one shop they run, and nothing else. There is no Add, no Edit and no Delete, and that is the database's answer rather than the screen's. The **Tablets** button is the point of the surface: it is the only route to a counter setup code, so this is where a manager whose tablet died starts.

**3 — The counter, which never blocks** (Biller)

**This is the enrolled tablet, not a demo of one.** The same file runs here and
on the hardware at Kalyani: one screen, no tabs, no way out except the demo
banner pinned above it. The header names the *device* rather than a person,
because a tablet is set up rather than signed in.

A shift is already open. Ring a direct sale—tap tiles, enter either a customer name or phone, tap **Mark Paid**, then **Cash**, then confirm **Mark Paid**. Cash and UPI both begin neutral. The screen clears after local acceptance; expand the new row under **Bills this shift** and use its relative five-minute action to reopen the prefilled tender dialog without changing the bill. The action counts in minutes, switches to seconds below one minute and disappears at expiry; the adjacent demo controls jump to 59 seconds or expiry without a five-minute wait. Repeat from an order paid on handover. For split tender, key `100`, tap Cash, tap UPI for the ₹39 remainder, then Mark Paid.

Ring another item, enter a customer name or phone and choose the primary **Order** action. It appears directly in the Counter's compact **Open orders** rail—there is no separate one-slot latest-order card. Its complete preparation lines and amounts, optional customer and total lead the card; `Order #xyz` is only a small reference, today's timestamp is relative, and the current biller's name is not repeated. Mark it paid, or cancel after a preset fills the editable reason field; the paid bill moves below the divider into **Bills this shift**, where Cash and UPI totals remain visible at zero, rows read **Today** with the time, and each bill expands to immutable details. Enter `9000000101` to see exact-phone autofill; enter `12345` and tab away to see a number that is not one refused rather than silently dropped. Swiggy, Zomato, Card and Other never appear as payment categories; aggregator trade is demonstrated in the Ledger instead.

**Edit an order, and watch what the workspace does about it.** Tap the pencil. The composer takes the accent outline and names the order; that order leaves the list and its own card slides left to meet the composer's edge, so the two read as one piece of work. The composer's footer—total, customer fields, Save changes and Cancel edit—**moves onto the card**, leaving the composer as the items alone; there is never a second copy of either. Scroll the rail through this shift's bills: the card holds its place until scrolling would lose it, pins at the edge, and comes back. Add an item, change the customer, save, and see the draft you had in progress restored exactly.

**Narrow the window** until three columns no longer fit. Nothing rearranges and nothing becomes a tab—the workspace scrolls sideways, each column about a phone's width. That is why there is no Open orders, My shift or Menu entry in this shell: all three are columns that never leave the screen. On a busy evening the middle column scrolls **beneath** its Cash and UPI totals, which stay pinned, and anything needing attention sits above the bills rather than under all of them.

**Then end the day, which is the part that used to refuse without explaining.** Tap **Finish day**. The sheet sends what is ready, asks the server, and then names each thing genuinely in the way — the refused payment and the open orders — with the action that clears it. A still-editable recent payment is advice rather than a blocker: you may review it, keep billing, or finish anyway. Clear both blockers and finish, and the tablet drops to the screen a real counter shows overnight: **ask for a shift, read four digits, and switch roles to approve them**. Three wrong codes destroy the request, as they do for real. An unrecognised name behaves exactly like a recognised one.

**Or leave from the phone instead.** As the persona holding the shift, open their home and use **Leave counter**. The confirmation says authority ends immediately and recommends Hand over for an ordinary change — and warns that an offline tablet may record later sales under your name as flagged context. Which is exactly what the demo's 11:45 bill is.

Switch to **Admin → Billing**. **Bill 18 is marked *After operator left*.** Open it: it explains that the tablet recorded the sale after the morning operator's shift had ended, that the money is included in the takings regardless, and that the operator is preserved as last-known context rather than reassigned. Confirm them, name somebody else, or record that it cannot be established — whichever you choose is *appended*, and the original flag and attribution stay. Then filter the bills by revenue date and open one detail, void it with a reason, then follow the instruction to ring the corrected sale manually on the enrolled tablet. In Open orders, cancel the stranded order with a reason. Delivery shows the same problem as read-only metadata and never exposes its contents or customer.

**Now do the part that convinces people.** Put the device into aeroplane mode (or throttle to offline in DevTools) and ring three more bills. The sync indicator counts up and escalates. Come back online and watch it drain, with the bill numbers appearing only as each bill lands — never before, because bill numbers are the server's. Nothing about this is simulated; there is no "pretend to be offline" control, and that is why it is worth showing.

Try to sell the Stuffed Lebanese Shawarma: it is on the grid and refuses to be sold, because the kitchen has run out. A tile that vanished would read as a bug to whoever was looking straight at it. It shows **Off** where the others show a price, and no price at all — a figure nobody can sell is a figure a biller might quote by mistake.

**4 — The employee, and the geofence** (Staff)

One big button. Today has not been started, so press it — and read what comes back: the arrival is recorded and **waiting for the manager to approve it**, which is the whole point of the design and the thing a walkthrough should land on rather than explain.

Then look at **My attendance**, which shows a month rather than a run of good days: a day approved by a manager standing at the counter with no reason asked for; one approved from elsewhere, showing that the approver was not at the outlet and the reason that cost them; a day still waiting; a late arrival against the outlet's 13:00 deadline; and days with nothing recorded at all, which read as absent without any row existing. The employee sees every one of those facts exactly as the manager does. Asymmetric visibility in a monitoring feature is how it becomes something staff resent.

As the **Franchise Admin**, the same days are approvable from the attendance day. Standing at the counter — which is where the demo's emulated position puts you — approving is one tap and asks nothing. Move the browser's position away from Kalyani and the same action asks for a reason first, then records it on the day for the employee to read. Each waiting row also carries a small box ahead of its Approve and Deny: press it on one person and then another — there is no Select all to show, deliberately — and the day picker at the top is replaced by a bar stating the count and offering Approve, Deny and Clear, with the per-row buttons standing down while it is up. Emptying the set puts everything back. Approving names everybody selected before anything is written, one person included. With both outlets on screen the same one reading is inside Kalyani's fence and outside Kanchrapara's, so the sheet says which rows are normal and which need the reason, and afterwards only the far outlet's rows carry it. **By person** then shows one staff member's month with the counts, which is the second axis the day view cannot give you.

The same Kalyani roll-call also demonstrates denial without turning the screen
into an audit console. Deny the runner's outside attempt: the sheet contains an
editable *Not at outlet* reason and one unchecked *Prevent another check-in
today* box, and it never reads the manager's position. Leave it open to show a
staff retry, or check it and then reopen the settled row's single *Correct
attendance* action to allow another check-in with a reason.

The two-outlet person's older day is the wrong-outlet recovery story in one
coherent record: their Kalyani attempt was denied, the absent outcome remains,
and a newer unverifiable Kanchrapara attempt is waiting. Their employee/owner
history names both outlets and every decision; the former outlet manager sees
only the evidence and decision within their own scope. The retry-prevented
runner day and the employee's audited present correction cover the other compact
correction states without inventing a separate scenario.

**5 — Close the loop** (Admin, then Owner)

As the manager, **raise an alert** — four fields. Flip to the owner: it is in the inbox, naming its outlet. Reply to it, and point out that the status did not move — replying and acting are separate. Then **Acknowledge**, **Resolve**, **Close**, and note that the sequence cannot be skipped and that closed is final.

Finish on the owner console. The alert count has changed, because it was always a count of the rows you just wrote.

**Afterwards:** press **Start again** so the next walkthrough begins where this one did.

## Extending it

When a new surface is added:

1. Build it against the mock adapter, behind the gate, in a `ui-*` change.
2. Add its fixtures to the scenario dataset so the numbers still reconcile with everything else. **Give every seed an outlet** — the dataset spans both, and a seed that assumes one is a screen that will be empty for the other.
3. If the surface shows a derived figure, derive it in the mock from rows already in the store rather than adding a total to a fixture. A fixture that may state its own total is a demo that can show a number the system could not produce.
4. If the invariant is worth relying on, assert it in `createDemoStore()`. The one there now — each outlet's bill numbers are gapless from 1 — exists because getting it wrong would be invisible until somebody read two screens in a row. A second, that a stock quantity equalled its own ledger, went with the stock surfaces in #51.
5. Later, swap the adapter and promote the gate in a `*-live` change — **without redesigning the screen**. If that turns out to be impossible, the mock was the wrong shape; fix the mock's shape and record why in the change.
