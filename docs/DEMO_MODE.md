# Demo Mode

> Describes the design. Not built yet — it lands with `demo-mode-and-app-shell` (#3).

Demo mode renders the **entire** four-role experience with mocked data, so the product can be shown — to an investor, a prospective franchisee, or the staff who will use it — long before the backend behind it exists.

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

Every surface is in exactly one state, declared in a single registry:

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

**A screen that reaches for the Supabase client directly has broken the seam.** That is a review failure, not a style preference.

## Safety rules

Demo mode ships to production, because it has to be showable from a deployed URL. That makes these load-bearing rather than nice-to-have:

- **A demo session is structurally incapable of writing to real data.** Not discouraged — incapable, with a test that fails if a write escapes.
- **A real signed-in user can never enter demo mode silently.** A biller who wandered into a demo and rang up fake bills would be a genuine operational problem.
- **The demo indicator is always visible and cannot be dismissed.** This protects the business more than the viewer: a screenshot of invented revenue circulating as real trading data is a serious problem in a franchise sales conversation.
- **Mock data is obviously synthetic.** Invented staff, invented customers, plausible-but-fabricated figures. The two real outlets and the real menu are fine — those are public business facts — but no real people.

## Running a demo

Once `ui-owner-console-and-demo` (#8) lands, the mock dataset is internally consistent across every feature: the bills sum to the sales figure on the owner dashboard, the stock movements match what those bills consumed, the cash close reconciles against the cash bills, and the P&L follows from all of it. Independently-mocked screens are enough to review one surface and nowhere near enough to demonstrate a business — anyone looking at two screens in a row will notice figures that do not correspond.

The scenario deliberately includes states where something has gone wrong — a low-stock warning, a cash mismatch, an open high-priority alert, a blocked check-in awaiting override, a pending sync backlog. A demo of a system where nothing ever goes wrong demonstrates nothing.

A documented walkthrough route ships with it, so a demo can be run by someone who did not build the product. Demo state resets, so every walkthrough starts from the same place.

## Extending it

When a new surface is added:

1. Build it against the mock adapter, behind the gate, in a `ui-*` change.
2. Add its fixtures to the scenario dataset so the numbers still reconcile with everything else.
3. Later, swap the adapter and promote the gate in a `*-live` change — **without redesigning the screen**. If that turns out to be impossible, the mock was the wrong shape; fix the mock's shape and record why in the change.
