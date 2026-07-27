# Shawarmania Ops Roadmap — Change Sequencing & Dependency Chart

> Written 2026-07-25. Governing strategy: **make the tenancy contract right → get attendance into real use → make the whole experience demonstrable → then make each surface real.**
>
> Each change below has a proposal-level seed at `openspec/changes/<name>/proposal.md`. Expand a change with `/opsx:propose` when its turn comes; seeds for later waves are deliberately lighter so earlier gates can inform them.
>
> **Ask `/next-change`** at any time for the current recommendation: which change to do next, which model to use, and the pre-flight checklist — derived live from this file and each change folder's actual state.

## This Roadmap Is Deliberately Small

Fourteen changes is a **starting position, not a forecast.** Real work surfaces as you build: a gate fails and reveals a missing capability, a demo exposes a screen nobody thought about, a real franchisee asks for something. Planning that work now would mean deciding it with the least information anyone will ever have about it.

So this roadmap plans the spine and leaves the branches to be discovered. Expect it to grow — probably to twice this size before the app is finished. That growth is the system working, not the plan failing.

**How work enters:** a discovered need goes into [`openspec/todos/`](../todos/README.md) as a behaviour-focused note. When it is ready and its trigger has fired, `/opsx:propose` graduates it into a change folder and it gets a row here — with a number, a model, dependencies, and a gate like everything else. Nothing is sequenced before it earns a place.

## Delivery Strategy

Three commitments shape the order below.

**Attendance goes live first.** It is what the business wants running immediately, and it is the simplest complete slice through auth, deployment and live data — a low-stakes shakedown of all three before billing depends on them.

**Every other screen is built before it is real.** Each `ui-*` change builds complete, interactive surfaces against a **mock data adapter**, behind a feature gate, so the full four-role experience is demonstrable long before the backend exists. Each later `*-live` change swaps the adapter and removes the gate. **A `*-live` change makes a screen real; it does not redesign it.** If it finds itself rebuilding UI, the mock was wrong and that is the bug to fix.

The classic way UI-first fails is designing screens the data model cannot serve. Two rules prevent it: `data-model-and-tenancy` (#2) lands before any UI, and every mock is typed from the generated schema types, so a mock that drifts fails to compile.

Note that **attendance (#5) is not split this way**. The demo-first split exists to make *undeliverable* features demonstrable; for a feature shipping immediately it would be pure ceremony.

**Feature gating has three states**, tracked in one registry:

| State | Real users see | Demo mode shows |
|---|---|---|
| `hidden` | nothing | nothing — not built yet |
| `demo` | nothing | the full mocked surface |
| `live` | the real feature | the real feature, with demo data |

Promoting a surface from `demo` to `live` is the visible outcome of every `*-live` change.

## Change Inventory

|  | # | Change | Model | Status | Hard dependencies | Checkpoint (gate) |
|---|---|--------|-------|--------|-------------------|-------------------|
| ✅ | 1 | `project-foundations` | Opus | **archived 2026-07-26** | — | fresh clone → install, test, lint, typecheck, build all green; contrast validator passes in **both** themes; the empty app installs on a real Android phone and loads its shell with the network off; a push to `main` deploys |
| ✅ | 2 | `data-model-and-tenancy` | **Fable** | **archived 2026-07-26** | #1 | isolation suite passes for **every** outlet-scoped table; a Franchise Admin session provably cannot read the other outlet's rows even with a hand-crafted request; both outlets seeded; TypeScript types generated |
| ✅ | 3 | `demo-mode-and-app-shell` | **Fable** | **archived 2026-07-27** | #1, #2 | all four role shells navigable in demo mode with a working role switcher; **a demo session provably cannot write to Supabase**; a real signed-in user cannot silently enter demo mode; the demo banner is never dismissible; a mock that drifts from schema types fails to compile |
|  | 4 | `auth-and-roles` | Opus | seeded | #2, #3 | all four roles sign in and land on their own shell; an admin provisions a staff account end-to-end with a one-time code; deactivating an account blocks access without waiting for token expiry |
|  | 5 | `attendance` | Opus | seeded | #3, #4 | **real staff check in and out on their own phones in production**; in-fence succeeds, out-of-fence blocks then clears via manager override recorded with who and why; an Employee sees only their own records |
|  | 6 | `ui-billing-counter` | Opus | seeded | #3 | a full order can be rung and settled in demo mode on a tablet viewport; whole menu visible without scrolling; optional customer fields never block settling |
|  | 7 | `ui-outlet-operations` | Opus | seeded | #3 | menu, inventory, expenses and a full day-close all walkable in demo mode — including a low-stock warning and a deliberate cash mismatch |
|  | 8 | `ui-owner-console-and-demo` | Opus | seeded | #5, #6, #7 | **a single uninterrupted walkthrough of all four roles** on a deployed URL, with internally consistent mock data — a busy trading day whose bills, stock movements, cash close and alert all reconcile with each other |
|  | 9 | `counter-devices-and-offline` | **Fable** | seeded | #4, #5 | an enrolled tablet reaches only its own outlet and revoke is immediate; offline → 20 bills → online → exactly 20 rows, zero duplicates; queue survives restart; a replayed UUID inserts once; an employee with no GPS fix checks in on the tablet |
|  | 10 | `billing-live` | **Fable** | seeded | #6, #7, #9 | a real order settles online and offline; totals match the domain tests; per-outlet bill numbers server-assigned with no gaps or collisions across two devices; a 00:20 bill carries the previous business date; a void never mutates the original |
|  | 11 | `expenses-and-inventory-live` | Opus | seeded | #4, #7 | a cash expense moves the day's cash figures and a UPI expense does not; the movements ledger reconciles exactly to current quantity; a correction is a movement with a note; low-stock fires at threshold |
|  | 12 | `daily-cash-live` | **Fable** | seeded | #10, #11 | expected closing matches the invariant from snapshotted inputs; the difference shows with the correct sign; **a bill syncing after close raises a reconciliation exception instead of rewriting a signed-off day** |
|  | 13 | `owner-console-live` | Opus | seeded | #8, #10, #11, #12 | both P&L modes compute on real data and **a test proves raw materials are not double-counted**; the owner compares two real outlets; the outlet switcher never leaks a third; reports reconcile exactly to on-screen figures |
|  | 14 | `outlet-onboarding` | Opus | seeded | #13 | a third outlet is created, staffed, tablet-enrolled and verified isolated **entirely through the UI, with zero code changes**; the runbook in `docs/OPERATIONS.md` matches what actually happened |

**Model column** — the Claude model recommended to drive each change's `/opsx:propose` and implementation session. **Opus is the default.**

**Fable** for the four changes where irreversible design judgment concentrates and a wrong call means a rewrite rather than a fix — plus billing, which every future transaction inherits:

- **#2** — the schema and RLS model is the system's foundation; every table, policy and query inherits it, and getting tenancy wrong is a security incident.
- **#3** — the adapter seam and gating contract are inherited by every remaining change, so a bad seam means rewriting every screen twice.
- **#9** — exactly-once semantics under partial failure are subtle to get right and brutal to retrofit onto a shipped queue.
- **#10** — the billing contract: snapshots, totals, numbering, business-date resolution. Every bill the business ever rings inherits it.
- **#12** — cash reconciliation invariants and the "never silently rewrite a signed-off number" rule.

**Opus** drives the other nine. Since consolidation, no change is small enough to be purely mechanical: each bundles enough scope that real judgment is involved, which is why **no change is assigned Sonnet**. If a change turns out to be trivial once expanded, that is worth noticing — it may belong merged into a neighbour.

**Status icon (leading column) & Status column** — a human-readable projection of each change's lifecycle, shown twice: a glyph in the unlabeled leading column that reads like a to-do list filling in left to right, and the same state as a word in the Status column. The four states progress from `seeded` (blank cell — proposal seed only) → `📝 proposed` (`tasks.md` present) → `🔄 active` (a task checked) → `✅ **archived YYYY-MM-DD**` (folder under `archive/`). The **source of truth is the openspec files and folders**, never these cells; both are *derived*. Every lifecycle skill runs the shared reconciler `npm run roadmap:sync` (`openspec/tools/sync-roadmap-status.mjs`), which writes the icon and the word from one derivation so they cannot drift. It self-corrects manual drift and works identically from Claude, Codex, or a plain shell.

**Definition of done for this roadmap**: every folder under `openspec/changes/` is archived, and no surface remains in the `demo` gate state.

## Dependency Graph

```mermaid
graph TD
    C1[1 project-foundations] --> C2[2 data-model-and-tenancy]
    C1 --> C3[3 demo-mode-and-app-shell]
    C2 --> C3
    C2 --> C4[4 auth-and-roles]
    C3 --> C4
    C3 --> C5[5 attendance]
    C4 --> C5
    C3 --> C6[6 ui-billing-counter]
    C3 --> C7[7 ui-outlet-operations]
    C5 --> C8[8 ui-owner-console-and-demo]
    C6 --> C8
    C7 --> C8
    C4 --> C9[9 counter-devices-and-offline]
    C5 --> C9
    C6 --> C10[10 billing-live]
    C7 --> C10
    C9 --> C10
    C4 --> C11[11 expenses-and-inventory-live]
    C7 --> C11
    C10 --> C12[12 daily-cash-live]
    C11 --> C12
    C8 --> C13[13 owner-console-live]
    C10 --> C13
    C11 --> C13
    C12 --> C13
    C13 --> C14[14 outlet-onboarding]
```

## Execution Waves

Changes within a wave can run in any order or in parallel; a wave starts when its members' dependencies are met.

- **Wave A — foundations (#1–#3)**: `project-foundations`, `data-model-and-tenancy`, `demo-mode-and-app-shell`. **Two keystones here.** #2 is the write contract every query inherits. #3 is the delivery contract every screen inherits — and it must come after #2 so mocks are typed from the real schema and cannot drift from it. Soft start: #2 needs only #1's *scaffold* half (repo, test harness, Supabase local), not the theme or PWA work — it may begin as soon as those tasks are checked.

- **Wave B — attendance goes live (#4–#5)**: `auth-and-roles`, then `attendance`. **This wave ends with real staff checking in on their own phones in production** — the first genuine business value the project delivers, and a shakedown of auth, deployment and live data before billing depends on all three. #5 also registers its demo fixtures, because the Employee role's whole demo experience *is* attendance — see the note in Wave C.

- **Wave C — the full experience, demo-gated (#6–#8)**: `ui-billing-counter` and `ui-outlet-operations` are **fully parallel** — each builds on the shell from #3 and touches no shared state, and since they depend only on #3 they **may run alongside Wave B** if bandwidth allows. `ui-owner-console-and-demo` follows, because the scenario dataset it builds must reconcile across every surface. Its dependency on #5 is about the attendance *surfaces and fixtures*, not the production rollout — #8 may start while #5's only open items are the 🧍 live-verification gates. **This wave ends with the demo milestone**: a deployed URL where the entire four-role experience walks through coherently.

- **Wave D — the counter takes money (#9–#10)**: `counter-devices-and-offline`, then `billing-live`. #9 must land first: billing is offline-first by specification, so building settlement online-first and retrofitting a queue would mean rewriting the path the whole product depends on. #9 depends on #5 because it adds the attendance kiosk — the tablet path only makes sense once attendance itself exists.

- **Wave E — operations and insight go live (#11–#13)**: `expenses-and-inventory-live`, `daily-cash-live`, `owner-console-live`. **#12 is the payoff of the whole billing chain** — the screen that answers "is the drawer right?" — and needs both real bills and real cash expenses to mean anything. #11 depends only on #4 and #7, so it **may start alongside Wave D**.

- **Wave F — growth (#14)**: `outlet-onboarding`. **The change that proves the franchise thesis**, with a deliberately harsh gate — if a third outlet cannot be onboarded without a code change, the multi-outlet design has a defect far cheaper to find now than when a real franchisee is waiting.

## Standing Principles

- **No code change without a change folder.** Proposal → design → tasks → spec deltas → implementation → archive.
- **A change is not done until its docs are updated.** When a change archives, its spec delta merges into `openspec/specs/` and every affected page in `docs/` updates in the same change.
- **Every `ui-*` change ships behind the gate, against mocks typed from the schema.** A UI change that reaches for the Supabase client has broken the seam.
- **Every `*-live` change swaps an adapter and promotes a gate — it does not redesign the screen.** If it has to rebuild UI, the mock was wrong; fix the mock and record why.
- **Demo mode never writes to real data**, and a real signed-in user can never enter it silently.
- **Every outlet-scoped table ships its RLS policy and its isolation test case in the change that creates it.** Never as a follow-up.
- **Money correctness beats convenience, every time.** Integer paise, snapshotted prices, append-only bills, explicit business dates.
- **The counter never blocks.** Any change touching the billing path must leave settlement non-awaiting.
- **Report gates honestly.** A checkpoint that was not run is not passed.
- **New work goes to `todos/` first.** Discovering scope mid-change is normal; absorbing it silently is not.

## Deferred & Demand-Gated (not seeded)

Identified future work deliberately **not** in the inventory. Nothing is sequenced or budgeted on it until the business says it is worth doing. Seed each via `/opsx:propose` only when its trigger fires.

- **`bill-thermal-printing`, `bill-gst-breakup`, `bill-digital-share`** — the three anticipated billing extensions. The schema already carries `pricing_mode`, `tax_paise`, per-outlet `bill_number`, line-item snapshots and `customer_phone` specifically so none of these needs a historical migration. **Triggers**: a customer or regulator asks for a printed or GST bill; or the owner wants digital receipts. Tracked in [`openspec/todos/`](../todos/README.md). Deps when seeded: #10.
- **`aggregator-settlement`** — Swiggy/Zomato revenue is recorded at order value, not net of commission, making it the largest known inaccuracy in the P&L. **Trigger**: aggregator volume grows enough to distort a decision. Deps: #13.
- **`shared-menu-catalogue`** — a brand-wide master menu that outlets inherit and override. **Trigger**: enough franchises that per-outlet menu drift becomes a consistency problem; the business markets lab-tested consistency, so this carries real brand weight. Deps: #10, #14.
- **`cross-outlet-customer-identity`** — unify a customer who visits both outlets. Deliberately parked: it requires reading across the isolation boundary the security model exists to enforce. **Trigger**: a loyalty or repeat-customer feature with real business value behind it.
- **`audit-log`** — an immutable trail beyond the `voided_by` / `override_by` / `recorded_by` columns already on the rows. **Trigger**: the first franchise dispute, or headcount where "a small trusted team" stops being accurate.
- **`data-retention-policy`** — customer PII and attendance location data currently accumulate indefinitely. **Trigger**: meaningful customer volume, or a franchise agreement specifying retention.
- **`self-service-password-reset`** — needs an SMS or WhatsApp channel. **Trigger**: enough staff across enough outlets that admin-initiated resets become a bottleneck.
