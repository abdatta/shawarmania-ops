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

One mutable dataset is built per demo session (`src/data-access/mock/store.ts`) and shared by every mock adapter, so the figures on one screen are the rows behind another: the cash screen's takings *are* the bills the counter rang, a stock item's quantity *is* the sum of the ledger it links to, and the owner console's sales *are* those same bills summed. It is constructed per session rather than as a module singleton, so **demo state resets** and every walkthrough starts from the same place.

Nothing in it is authored as a total. Every figure the owner sees is derived at read time from bills, expenses, movements and closed cash records — which is why two screens cannot disagree, and why a fixture that contradicts its own ledger **throws at construction** instead of shipping a demo that cannot answer "why does it say 4 kg?".

Worth knowing before running one:

- **Both outlets trade, and deliberately not identically.** Kalyani is busier and carries every awkward state; Kanchrapara turns over roughly half as much, is short of nothing, and closed yesterday exactly. Two outlets of the same shape would make the comparison screen unreadable — a difference is only legible against something that is not different.
- **Each outlet numbers its own bills from 1**, mirroring the per-outlet sequence the database enforces.
- **Every demo person has one canonical username.** People creation, correction
  and activation handover use the same namespace and validation as live mode,
  but the mock adapter never calls Auth, a mail provider or any real endpoint.
- **A shift is already open** for Demo Biller at Kalyani, so a walkthrough lands on the counter able to ring a bill. The shift screen is still fully walkable — close it, hand it over, open another. Kanchrapara's shift is closed; no persona stands at that counter.
- **Alerts point at things you can go and look at.** The open high-priority one is about the pita bread that is genuinely below its threshold; the acknowledged one is about the drawer that genuinely came up short. An alert about a problem that exists nowhere else in the data is a sentence somebody typed.
- **Start again** in the demo banner puts everything back. It states what it discards first, and it keeps you on the role you are looking at.
- **The counter handshake is walkable from both ends in one demo session.** Open the Biller shell, ask for a shift naming a persona by name, then read the four digits and switch roles to type them in — the request, the code and the shift are session state, so they survive the role switch. An unrecognised name behaves exactly like a recognised one: same code, same wait, same timeout, and no card on anybody's phone. Three wrong codes destroy the request, as they do for real.
- **The demo counter still has a PIN screen, and it is a remnant.** `counter-shift-unlock` is a `demo`-gated surface from the pre-`counter-devices-and-offline` model, where a PIN selected attribution and protected nothing. It is not how a shift opens any more, in demo mode or anywhere else, and #10 removes it with the rest of that storyline. Nothing else in the product mentions a PIN.
- **Business dates are relative to today**, resolved through the outlet's own cutover. **Four days traded at each outlet**: the three before today are counted and signed off, and today is open and can be closed during a walkthrough. Four days rather than one is what gives a period report and a comparison something to be a period *of*.
- **Five things have deliberately gone wrong**, all at Kalyani, because a demo where nothing does demonstrates nothing: one stock item is below its threshold, yesterday's drawer was ₹240 short, a bill for yesterday arrived after that day had been signed off — which the cash screen reports as a reconciliation exception rather than quietly absorbing — arrivals are recorded and waiting for a manager — one of them taken well outside the geofence — and an alert is open at high priority.
- **Stock consumed corresponds to what the bills sold**, at a food cost of roughly a third of takings. That is what lets the P&L's consumption basis produce a believable figure — a ledger invented independently of the bills makes a shawarma shop appear to lose money on every wrap, which is what it did until the owner console made it visible.
- **Today carries a bulk delivery**, bought and mostly unused. It is the reason the P&L's basis toggle has something to show: cash basis charges the whole purchase to this period, consumption basis charges only what the kitchen used, and the two figures differ by about ₹1,400. A control whose effect nobody can see teaches nothing.
- **Every current menu item is non-vegetarian**, because every item the business sells is built on chicken. The vegetarian marker has no live example rather than a fabricated one; create an item from the menu form to see it.
- **The offline states are reached the way a real tablet reaches them.** There is no "pretend to be offline" control: put the device in aeroplane mode (or use DevTools) and ring bills — the indicator counts up, escalates at five waiting, and drains when the connection returns.

## Running a walkthrough

Twelve minutes, four roles, no preparation. **Start by getting the link** — see [Where the link comes from](#where-the-link-comes-from); it is in the Super Admin's account menu and nowhere else. Open it, and if you are signed in, tap **Continue to demo**.

Press **Start again** in the banner first if anybody has used this tab before you.

**1 — The owner, and why any of this exists** (`/demo/owner`)

Both outlets are on one screen. Read the two sales figures aloud: they are different, because the two shops are. Point at Kalyani's attention line — *open alerts*, *items low on stock*, *drawer ₹240 short* — and say that none of it was typed anywhere; each is a count of rows the audience is about to see.

Tap **Compare outlets**, switch the basis from cash to consumption, and note that the profit changes by about ₹1,400 and that the screen says which basis it is on. The gap is a bulk chicken delivery bought this morning and mostly still in the cold room: cash basis charges the lot to today, consumption basis charges only what was cooked. That control is the difference between "did more money come in than went out" and "did we make money on what we sold", and mixing them is the mistake this business would otherwise make on a spreadsheet.

Go back and open **Alerts**. The high-priority one is about pita bread. Leave it open — you are coming back to it.

Then open **Attendance** from the owner's own navigation — no appointment, no switching, and the address stays inside the owner's shell. Use the outlet selector to move to **Kanchrapara**, the shop this owner holds no assignment at: one arrival is waiting there, and they settle it. The demo's emulated position is at Kalyani, so the rule asks for a reason first and records that the approver was not on site — the same rule the outlet's own manager answers to. Note who is *not* on that roll-call: the owner and the manager are not staff there, so nobody is pretending to record their arrival. Then open **Cash** at the same outlet: the day is all there, and the close and the withdrawal are not, because the drawer comes from the assignment. Switch the selector back to Kalyani, where the owner *is* the manager, and the same screen offers both — which is the whole boundary in one gesture. The outlet you last picked is where the next screen opens, so nobody answers that question twice.

**2 — The manager, where the numbers come from** (Admin in the banner)

**Stock** — pita bread is marked *Low stock*, in words and with an icon. Open its ledger: the quantity on the list is the sum of that ledger, including a packet dropped on the floor last night. This is the row behind the alert you just read.

**Expenses** — today's spending, with the cash rows marked. Only those reach the drawer.

**Cash** — everything above the one input is worked out. Type a figure a couple of hundred short of the expected closing and watch the difference appear *as you type*, in words as well as sign. Then switch the day picker to yesterday: that day is closed, it was ₹240 short, and **a bill arrived after it was signed off** — reported as a reconciliation exception, with the closed figures untouched. That is the single most important thing this app does.

**P&L** — switch the basis. The raw-materials expense is listed and labelled *not subtracted on this basis*, because the stock it bought is subtracted instead.

**3 — The counter, which never blocks** (Biller)

A shift is already open. Ring an order — tap tiles, adjust a quantity on the bill line, tap **Cash**, tap **Settle**. The screen clears in the same tick; nothing was awaited.

**Now do the part that convinces people.** Put the device into aeroplane mode (or throttle to offline in DevTools) and ring three more bills. The sync indicator counts up and escalates. Come back online and watch it drain, with the bill numbers appearing only as each bill lands — never before, because bill numbers are the server's. Nothing about this is simulated; there is no "pretend to be offline" control, and that is why it is worth showing.

Try to sell the Stuffed Lebanese Shawarma: it is on the grid and refuses to be sold, because the kitchen has run out. A tile that vanished would read as a bug to whoever was looking straight at it.

**4 — The employee, and the geofence** (Staff)

One big button. Today has not been started, so press it — and read what comes back: the arrival is recorded and **waiting for the manager to approve it**, which is the whole point of the design and the thing a walkthrough should land on rather than explain.

Then look at **My attendance**, which shows a month rather than a run of good days: a day approved by a manager standing at the counter with no reason asked for; one approved from elsewhere, showing that the approver was not at the outlet and the reason that cost them; a day still waiting; a late arrival against the outlet's 13:00 deadline; and days with nothing recorded at all, which read as absent without any row existing. The employee sees every one of those facts exactly as the manager does. Asymmetric visibility in a monitoring feature is how it becomes something staff resent.

As the **Franchise Admin**, the same days are approvable from the attendance day. Standing at the counter — which is where the demo's emulated position puts you — approving is one tap and asks nothing. Move the browser's position away from Kalyani and the same action asks for a reason first, then records it on the day for the employee to read. **By person** then shows one staff member's month with the counts, which is the second axis the day view cannot give you.

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
4. If the invariant is worth relying on, assert it in `createDemoStore()`. The two there now — a stock quantity equals its own ledger, and each outlet's bill numbers are gapless from 1 — both exist because getting them wrong would be invisible until somebody read two screens in a row.
5. Later, swap the adapter and promote the gate in a `*-live` change — **without redesigning the screen**. If that turns out to be impossible, the mock was the wrong shape; fix the mock's shape and record why in the change.
