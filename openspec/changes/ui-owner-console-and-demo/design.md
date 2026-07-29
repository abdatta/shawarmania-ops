# Design: ui-owner-console-and-demo

## Context

The last `ui-*` change on the roadmap, and the only one whose job is partly to make the *other* changes agree with each other. Three things land together:

1. **The owner-facing surfaces** — the cross-outlet dashboard, the outlet switcher, two-outlet comparison, P&L with its basis toggle, period reports, and alerts across both roles.
2. **One scenario dataset** spanning both outlets, where every figure is derived from rows rather than authored — so the counter, the stock ledger, the cash close and the owner dashboard cannot disagree.
3. **The demo's handover** — it stops advertising itself on the public landing card and becomes something the Super Admin distributes from their own account menu.

Everything here is built against mock adapters behind the gate. `owner-console-live` (#13) swaps the adapters and promotes the gates; per the roadmap's standing principle it must not have to redesign a screen.

What this change inherits and does not revisit:

- **The adapter seam and the gate registry** (#3) — one file says what state each surface is in; screens read `useAdapters()` and `useSession()` and never learn which mode they are in.
- **The shared demo store** (#7, design D1) — `createDemoStore()` builds one mutable per-session dataset that every mock adapter shares. This change extends it to two outlets rather than replacing it.
- **The schema** — `alerts` and `alert_responses` already exist in `database.types.ts` with their categories, priorities and statuses. No table is created here, so no RLS policy or isolation test is owed.
- **The money and date rules** — integer paise, `business_date` as an explicit column, IST at the display edge only.
- **The demo safety rails** — non-dismissible banner, the signed-in interstitial, the scope tripwire, no request beyond the app origin.

### The dataset is the hard part, not the screens

Each earlier `ui-*` change shipped fixtures for its own surfaces, all of them for Kalyani alone. That is enough to review one screen and nowhere near enough to demonstrate a business: an owner dashboard needs a *second* outlet to sit beside the first, and anybody who reads the dashboard and then opens the counter will notice within seconds if the two do not correspond.

So the centre of gravity of this change is `src/data-access/mock/` — generalising every fixture to carry an outlet, materialising a second outlet's trading day, and making every owner-facing figure a **read over those rows** rather than a number somebody typed into a fixture.

## Goals / Non-Goals

**Goals:**

- A single uninterrupted walkthrough of all four roles on a deployed URL, with figures that reconcile across every surface.
- Owner console: outlets side by side, an outlet switcher, comparison over a period, P&L with the basis stated on screen, period reports.
- Alerts end to end: a manager raises one, the owner sees it in a cross-outlet inbox, responds, and moves it through open → acknowledged → resolved → closed.
- The scenario passes through the awkward states on purpose — low stock, a cash mismatch, a reconciliation exception, an open high-priority alert, a blocked check-in awaiting override.
- P&L arithmetic lands in `src/domain/` as pure tested functions, including the proof that raw materials are not double-counted, so #13 inherits an invariant instead of rewriting one.
- The demo link moves from the public landing card to the Super Admin's account menu, with a copy-link action beside it.
- A documented walkthrough route that someone who did not build the product can run, and a demo reset so every run starts from the same state.

**Non-Goals:**

- No real figures and no Supabase queries — #13.
- **No export files.** See D7; this is a narrowing with a reason, not an omission.
- No outlet or user CRUD from the owner console — it exists already on Outlets and People, and creating things against mocks is meaningless.
- No real-time chat, attachments, push notifications, or alert assignment/routing. An alert is a subject, a message, a priority and a thread of responses.
- No aggregator commission modelling. Swiggy and Zomato revenue is recorded at order value; that inaccuracy is [`aggregator-settlement`](../../todos/aggregator-settlement.md) and belongs after #13.
- No P&L for a period that crosses a closed/open boundary differently from how #13 will. The domain functions take the rows they are given; period selection is the surface's business.

## Decisions

### D1 — The demo store becomes multi-outlet, by giving every seed an outlet rather than by duplicating the file

`createDemoStore()` today hard-codes `OUTLET_KALYANI_ID` into bills, movements, expenses, withdrawals and the closed cash record. Every seed type gains an `outletId`, and the store materialises each outlet's rows through the **same** functions it already uses — `billTotals`, `movementDelta`, `expectedClosingPaise`. Kanchrapara gets its own menu (the same items, its own rows, because menus are per-outlet in this schema), its own stock, its own trading day and its own drawer.

Two properties follow, and both are asserted at construction the way the ledger assertion already is:

- **Bill numbers are per-outlet sequences.** Kalyani's bills and Kanchrapara's number independently from 1, which is what `(outlet_id, bill_number)` unique means. A single global counter would demo a product this one is not.
- **Every outlet's stock quantity equals the sum of its own ledger**, extending the existing check per outlet.

*Alternative rejected*: a second fixture file duplicating the first with different constants. It doubles every future edit and guarantees the two drift — and the drift would land exactly where the demo is most watched.

*Alternative rejected*: leaving Kanchrapara as an outlet with no trade, and showing the owner dashboard with one populated card. It demonstrates nothing about a multi-outlet business, and it is the one screen the proposal says justifies the whole system.

### D2 — Kanchrapara is the quieter, tidier outlet, and Kalyani is the one with problems

Not decoration. The comparison screen exists to answer "which shop is doing better, and why", and two outlets with identical shapes make that screen unreadable. So Kanchrapara trades at roughly half Kalyani's volume, is not short of anything, and closed yesterday **exactly** — which is what makes Kalyani's ₹240 shortfall legible as a difference rather than as how the app always looks.

Every awkward state stays at Kalyani, where the manager, biller and employee personas already live, so a walkthrough meets them all in one place.

### D3 — The owner dashboard stays `live` and gets its figures from a new adapter that is honestly empty in real mode

`owner-dashboard` is already `live` — the Super Admin needs a home when signed in for real, and demoting it would take that away. It may therefore not render mock figures in real mode, which is the same constraint that keeps `admin-dashboard` a placeholder.

The seam resolves this without a mode branch. A new **`InsightsAdapter`** answers the derived questions the console asks — today's figures per outlet, a period summary, a P&L, a comparison. The console renders outlet cards from `outlets.listOutlets()` (real in both modes, exactly as today) and asks `insights` for each card's figures:

- **In demo mode** the mock returns the scenario, and the card is the full console.
- **In real mode** the Supabase implementation returns `null` — the honest answer, since no real bill exists yet — and the card shows the outlet with a sentence saying today's figures arrive with #13.

The component never asks what mode it is in; it renders figures if it has them. #13 replaces one adapter and the same screen lights up, which is the property every `*-live` change depends on.

*Alternative rejected*: demote `owner-dashboard` to `demo` and build the console there. A signed-in owner would then have no index surface at all, and the roadmap has no change that gives it back before #13.

*Alternative rejected*: a second Super Admin surface, `owner-today`, gated `demo` beside the `live` dashboard. Two dashboards in one navigation, one of which is invisible to the person who owns the product — an easy build and an incoherent screen.

### D4 — Every owner figure is a read over rows, and the adapter interface says so

`InsightsAdapter` returns derived shapes — `OutletDaySummary`, `PeriodSummary`, `ProfitAndLoss`, `OutletComparison` — and **takes no figures as input**. The mock computes them from `store.bills`, `store.expenses`, `store.inventoryMovements` and `store.dailyCashRecords` at read time, through the same domain functions the operational screens use.

This is the same rule the daily-cash mock already follows ("every derived figure is computed here, never supplied by the caller"), for the same reason: the moment a fixture may state a total directly, the demo can show a number the system could not produce, and #13 inherits an interface that lets it keep doing so.

A closed day contributes its **snapshotted** figures, never a recomputation. That is `docs/DATA_MODEL.md`'s second trap, and the demo must not model it the wrong way round.

### D5 — P&L is two named bases, one component, and a domain function per basis

`src/domain/pnl.ts`:

```
cashBasisProfit        = sales − allExpenses
consumptionBasisProfit = sales − nonRawMaterialExpenses − inventoryConsumedAtCost
```

`inventoryConsumedAtCost` values `used` and `wasted` movements at the item's `purchase_cost_paise` and ignores `added` and `correction` — a correction is a counting fix, not consumption. Integer paise throughout; the functions throw on a non-integer, like every other money path in this repo.

The surface **always states which basis is on screen**, in words, above the number — the proposal is explicit that this is not a formatting choice. Switching basis re-states it rather than moving a toggle and leaving the reader to remember.

The unit test that matters is the one #13's gate names: **a period containing both a `raw_materials` expense and the `used` movements it paid for produces a consumption-basis profit that counts the food once.** It is written here, against the domain function, so #13 inherits it.

*Alternative rejected*: a single "profit" figure with a footnote. It is the exact mistake `docs/DATA_MODEL.md` documents, and a franchise conversation is the worst possible place to discover it.

### D6 — One outlet switcher, and it is a scope control rather than a second app

The owner console carries an outlet control: **All outlets**, or one of them. Choosing one scopes the console, the comparison and the P&L to that outlet, and offers a link into `owner/outlet/:outletId` — a read-only view of that outlet's day in depth: sales by payment method, the cash position and whether the day is closed, low stock, open alerts, who is checked in.

Read-only is stated on the screen, not implied by absent buttons, and the mock refuses a write to another outlet's rows the way the RLS policies will. The owner's route into *editing* an outlet's operations stays where it already is; a parallel writable copy of four manager surfaces is how two implementations of one screen start.

The switcher lists only outlets the adapter returned. #13's gate ("the outlet switcher never leaks a third") is a tenancy assertion about the real adapter; here the mock lists what `listOutlets()` gave it and nothing else, so the shape #13 tests is the shape that exists.

### D7 — Reports summarise on screen, and no file leaves the demo

The reports surface shows a period summary — sales by payment method, expenses by category, profit on the stated basis, cash differences by day — over a selectable period, for one outlet or all.

**There is deliberately no export file in this change**, and the reason is stronger than "it is #13's work". The proposal's central worry is that mock figures must never be presentable as real trading data: *"a screenshot of invented revenue circulating as fact is a genuine problem in a franchise sales conversation."* A downloadable file of invented revenue is more circulable than a screenshot, and it arrives detached from the non-dismissible banner that is the whole reason a screenshot is survivable.

So the surface states, where the export action will be, that exporting arrives when the figures are real. That is an absent affordance with a reason on screen — the same treatment a `hidden` surface gets — rather than a greyed-out button, and it makes exporting fabricated figures impossible by construction rather than by discipline.

*Alternative rejected*: a client-side CSV watermarked as demo data. It makes no network request and it is thirty lines, but a watermark in row one of a CSV survives exactly one paste into a spreadsheet.

### D8 — Alerts are small, and their state machine lives in the domain

Adapter: `listAlerts` (the owner's cross-outlet inbox, or one outlet's), `raiseAlert`, `respond`, `setStatus`. `src/domain/alerts.ts` holds the permitted transitions:

```
open → acknowledged → resolved → closed
```

with reopening from `acknowledged` or `resolved` back to `open`, and `closed` terminal. The mock refuses anything else with an `AlertActionError` naming the transition, rather than accepting it silently — a demo that let an alert jump from open to closed would teach a product with no acknowledgement step.

Who may do what mirrors the policies #13 will rely on: a Franchise Admin raises and responds within their own outlet and cannot read another's; the Super Admin reads and acts across all of them. The mock enforces both from the persona's role, exactly as the menu and employees mocks already do.

Priority is conveyed by **a word and an icon**, never by colour alone — the same rule the low-stock treatment follows, for the same reason.

### D9 — The demo's front door moves, and the interstitial is not special-cased

Three edits:

- `Landing` loses **View the demo**. The public root then offers sign-in and activation only.
- `AccountMenu` gains a demo entry **for the Super Admin only**, with a copy-link action beside it. It links and copies `/demo` — not a role path — because the banner's role switcher is right there and a recipient should not be pinned to whichever role the owner was looking at.
- Nothing else changes. Following the link while signed in lands on the existing `/demo` interstitial, deliberately: the proposal is explicit that this must not be smoothed for the person who owns the menu it now sits in. An owner is no less capable of losing track of a tab than a biller is.

Copying uses the async clipboard API with a visible confirmation, and falls back to showing the URL as selectable text where it is unavailable or refused — a copy button that silently does nothing is worse than no copy button.

The account menu is the first thing in that chrome that differs by role, which is why `docs/SCREENS.md` gets a line about it.

### D10 — Demo reset remounts the tree; it does not un-edit the store

`createDemoStore()` already runs per demo tree mount, so a reset is a remount. `DemoRoot` keeps a reset counter in state, keys the provider stack on it, and the reset control increments it — every mock adapter and the store beneath them are rebuilt, and the walkthrough starts from the same place.

It sits in the demo banner, beside the role switcher, because that is the one piece of chrome present on every demo screen and a reset reachable from only one surface is a reset nobody finds mid-walkthrough. It states what it does before doing it: a walkthrough that has just rung six bills should not lose them to a mis-tap.

*Alternative rejected*: an `undo`/snapshot mechanism in the store. Far more machinery to demonstrate the same thing, and it would have to be maintained by every future `ui-*` change.

### D11 — The walkthrough is a document, and it opens with where the link comes from

`docs/DEMO_MODE.md` gains **Running a walkthrough**: a numbered route through all four roles with what to point at on each screen and which awkward state to reach for.

It opens by saying where the link is found — the Super Admin's account menu — because removing it from the landing card makes the demo undiscoverable to everyone else, which is the point and is also a trap. Someone asked to run a demo who cannot find one will not get past step zero.

### D12 — The sync backlog is reached the way a real tablet reaches it, and the walkthrough says so

The proposal lists "a pending sync backlog" among the deliberately interesting states. `ui-billing-counter` decided against a "pretend to be offline" control, on the grounds that it would be UI that ships and then has to be removed, and would reach the escalated state differently from how a real tablet reaches it. That decision stands.

So this state is **staged by the operator, not by a fixture**: the walkthrough's counter step says to switch the device to aeroplane mode (or throttle in DevTools), ring three bills, watch the indicator count and escalate, then come back online and watch it drain. It is the most convincing thing in the whole demo precisely because nothing about it is simulated.

### D13 — Real adapters exist and refuse, rather than not existing

`DataAdapters` is a total bag, so `createSupabaseAdapters()` must supply `insights` and `alerts` today. Both are small modules whose reads resolve empty or `null` and whose writes reject with `DataActionError('not_live', …)`, carrying a comment naming #13 as the change that replaces them. The surfaces are `demo`-gated so nothing calls them, and the compile-level parity — the real adapter must satisfy the same interface the screens use — is the same proof #3 and #7 relied on.

`insights` is the one exception to "nothing calls them": `owner-dashboard` is `live`, so its real implementation *is* called and returns `null` by design (D3). That is a real answer, not a stub throwing.

### D14 — Gate and route changes

| Surface | Role | Path | From | To |
|---|---|---|---|---|
| `owner-dashboard` | Super Admin | `` | `live` | `live` (unchanged; new content via D3) |
| `owner-comparison` | Super Admin | `comparison` | `hidden` | `demo` |
| `owner-alerts` | Super Admin | `alerts` | `hidden` | `demo` |
| `owner-outlet-view` | Super Admin | `outlet/:outletId` | `hidden` | `demo` |
| `owner-pnl` *(new)* | Super Admin | `pnl` | — | `demo` |
| `owner-reports` *(new)* | Super Admin | `reports` | — | `demo` |
| `admin-pnl` | Franchise Admin | `pnl` | `hidden` | `demo` |
| `admin-alerts` | Franchise Admin | `alerts` | `hidden` | `demo` |

`owner-pnl` and `admin-pnl` mount the same component, and `owner-alerts` and `admin-alerts` do too — the pattern `admin-menu` / `counter-menu` established, where one path serves two roles with two authorities and `GatedSurface` resolves it against the session's own role. `owner-outlet-view` carries a route parameter, which is a first for this registry: its `path` is the pattern, and the registry's lookup is by the surface's declared path, so the route table declares `outlet/:outletId` and the surface entry matches it.

Six navigation entries for the Super Admin (Overview, Outlets, People, Staff, Compare, P&L, Reports, Alerts) is more than a bottom tab bar holds comfortably on a phone. The Super Admin's phone shell already scrolls its rail on wide screens and shows tabs on narrow ones; **Reports and P&L are reached from the console rather than from navigation**, so the tab bar keeps six entries and the two period surfaces sit where somebody looking at today's figures would ask for them.

## Risks / Trade-offs

- **The scenario dataset is now the largest single thing a future `ui-*` change has to keep true.** → It is one store with one construction-time assertion set, and every figure is derived rather than authored, so an inconsistency is a thrown error at mount rather than a wrong number on screen. `docs/DEMO_MODE.md`'s "Extending it" section already names adding fixtures to the scenario as step 2 of adding a surface.
- **Two outlets doubles the fixture surface, and the second outlet has no persona living in it.** → Deliberate (D2): Kanchrapara exists to be compared against, not to be walked. Its roster already has one row from #15's fixtures, so it is not empty in the screens that list people.
- **`owner-dashboard` renders real-mode content that is mostly a sentence about #13.** → It is a strict superset of what it shows today, and the alternative (demoting it) leaves a signed-in owner with no home. Recorded rather than solved.
- **The P&L domain functions are written against mock rows and will meet real ones in #13.** → They take plain arrays of amounts and movements, not adapter shapes, and their tests are pure. The risk that survives is a *period selection* mismatch, which is why period boundaries stay in the surface rather than in the domain.
- **Removing the landing link makes the demo undiscoverable to everyone but the owner.** → That is the intent; the mitigation is D11, and the walkthrough opening with where the link lives is a required part of this change rather than a documentation nicety.
- **A demo reset that remounts the tree also resets the URL's role.** → It does not: the role lives in the URL and the reset keys only the provider stack, so a reset on `/demo/admin` returns to `/demo/admin` with fresh data. Tested, because the obvious implementation gets this wrong.
- **Alerts are the one feature here whose real policies nobody has exercised yet.** → No table is created, so no isolation test is owed by this change; but the mock's refusals are written beside comments naming the policy each mirrors, so #13 has a list to verify against rather than a memory.
- **Eight owner surfaces is a lot of screen for one change.** → They share one shape and one set of primitives, and splitting them would mean a comparison screen built before the dataset it compares exists. The dataset is the coupling, and it is why the proposal bundles them.
