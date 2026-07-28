# Demo Mode

> The machinery described here is **built** (`demo-mode-and-app-shell`, #3): the adapter seam, the gate registry, the demo session with its role switcher, and the safety rails all exist and are tested. The billing counter (#6) and the manager's operational surfaces (#7) are built on it and are walkable now; the owner console and the full scenario walkthrough arrive with `ui-owner-console-and-demo` (#8).

Demo mode renders the **entire** four-role experience with mocked data, so the product can be shown — to an investor, a prospective franchisee, or the staff who will use it — long before the backend behind it exists.

Demo mode lives at a dedicated route prefix: **`/demo/owner`, `/demo/admin`, `/demo/biller`, `/demo/staff`** — one shareable URL per role. The role lives in the URL, so a deep link or a reload reconstructs the whole demo session with no stored state, and the role switcher is nothing more than navigation between prefixes. The prefix is also the safety structure: the demo route tree has its own provider stack, built only from mock adapters, so mixing demo and real data is unrepresentable rather than merely guarded against.

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
- **Mock data is obviously synthetic.** Invented staff (the four demo personas are literally named Demo Owner, Demo Manager, Demo Biller, Demo Staff), invented customers, plausible-but-fabricated figures. The two real outlets and the real menu are fine — those are public business facts — but no real people, and fixtures carry no phone numbers at all. Every fixture is typed from the generated schema types, so a fixture the database could not serve fails to compile.

## What the demo dataset starts with

One mutable dataset is built per demo session (`src/data-access/mock/store.ts`) and shared by every mock adapter, so the figures on one screen are the rows behind another: the cash screen's takings *are* the bills the counter rang, and a stock item's quantity *is* the sum of the ledger it links to. It is constructed per session rather than as a module singleton, so **demo state resets** and every walkthrough starts from the same place.

Worth knowing before running one:

- **A shift is already open** for Demo Biller, so a walkthrough lands on the counter able to ring a bill. The shift screen is still fully walkable — close it, hand it over, open another.
- **Every demo biller's PIN is `1234`.** It selects attribution and protects nothing; the real one arrives with `counter-devices-and-offline` (#9) as a hash with a real refusal path behind it. It exists here so the unlock and handover screens have something to refuse — a PIN pad that accepts anything demonstrates a product where it does.
- **Business dates are relative to today**, resolved through the outlet's own cutover. Yesterday is a closed trading day; today is open and can be closed during a walkthrough.
- **Three things have deliberately gone wrong**, because a demo where nothing does demonstrates nothing: one stock item is at its threshold, yesterday's drawer was ₹240 short, and a bill for yesterday arrived after that day had been signed off — which the cash screen reports as a reconciliation exception rather than quietly absorbing.
- **Every current menu item is non-vegetarian**, because every item the business sells is built on chicken. The vegetarian marker has no live example rather than a fabricated one; create an item from the menu form to see it.
- **The offline states are reached the way a real tablet reaches them.** There is no "pretend to be offline" control: put the device in aeroplane mode (or use DevTools) and ring bills — the indicator counts up, escalates at five waiting, and drains when the connection returns.

## Running a demo

Once `ui-owner-console-and-demo` (#8) lands, the mock dataset is internally consistent across every feature: the bills sum to the sales figure on the owner dashboard, the stock movements match what those bills consumed, the cash close reconciles against the cash bills, and the P&L follows from all of it. Independently-mocked screens are enough to review one surface and nowhere near enough to demonstrate a business — anyone looking at two screens in a row will notice figures that do not correspond.

The scenario deliberately includes states where something has gone wrong — a low-stock warning, a cash mismatch, an open high-priority alert, a blocked check-in awaiting override, a pending sync backlog. A demo of a system where nothing ever goes wrong demonstrates nothing.

A documented walkthrough route ships with it, so a demo can be run by someone who did not build the product. Demo state resets, so every walkthrough starts from the same place.

## Extending it

When a new surface is added:

1. Build it against the mock adapter, behind the gate, in a `ui-*` change.
2. Add its fixtures to the scenario dataset so the numbers still reconcile with everything else.
3. Later, swap the adapter and promote the gate in a `*-live` change — **without redesigning the screen**. If that turns out to be impossible, the mock was the wrong shape; fix the mock's shape and record why in the change.
