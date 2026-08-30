# Proposal: Extended Offline Billing

> **Model**: Opus · **Wave**: D · **Depends on**: #10 · **Gate**: after one online daily sign-in, the enrolled counter can reload and continue billing through an extended backend outage until cutoff; cached menu/order state is visibly offline, 20 accepted commands survive restart, block sign-off until reconciled, and later land exactly once; the next business day still requires online reauthentication.

## Why

Billing V1 protects accepted work from brief connection drops but intentionally
requires online access to start or resume after a reload. Once V1 is stable,
this change completes the North Star by letting the single outlet counter keep
working through an extended outage without weakening daily reauthentication.

## What Changes

- Persist the minimum verified device, daily-grant, menu, customer lookup result,
  open-order, and delivery state required to reconstruct the counter offline.
- Allow the enrolled app to restart offline and resume only while its previously
  verified grant remains within the current outlet business day.
- Keep billing, unpaid-order edit/pay/cancel, and direct payment locally usable
  through an extended outage using captured menu and order versions.
- Mark all cached reads and provisional outcomes clearly; never represent cached
  menu/customer/order data as current server truth.
- Reconcile delayed dependency chains and optimistic conflicts on reconnect,
  preserving the existing correction, quarantine, and recovery contracts.
- Stop new billing at cutoff and require online credential verification plus
  fresh server state before another business day begins.
- Require the device to reconnect, drain/reconcile, and create its current
  device-day seal before that business date can be signed off.

## Capabilities

### New Capabilities

- `offline-billing-resumption`: Safe offline bootstrap, persisted grant/menu/order
  state, freshness disclosure, cutoff enforcement, and reconnect reconciliation.

### Modified Capabilities

- `billing-delivery`: V1 transient-drop delivery expands to intentional restart
  and extended-outage operation within the current verified grant.
- `menu-management`: A persisted verified menu snapshot may bootstrap billing
  offline with explicit provenance and freshness.
- `app-shell`: An enrolled device may enter a constrained offline counter shell
  after restart when its last verified daily grant is still valid.
  While editing this capability, carry the correction described in
  [`openspec/todos/pipeline-rename-left-two-sentences-behind.md`](../../todos/pipeline-rename-left-two-sentences-behind.md):
  its Counter-workspace paragraph still says the activity column holds **this
  tablet's open orders**, which the preparation pipeline (#45) made
  outlet-wide, and still names the resizable pair the current-bill and activity
  columns where `counter-billing` now says middle and activity. The app already
  behaves the corrected way; only the sentence is behind.

## Impact

Persisted counter bootstrap state, Dexie schema, service worker navigation,
adapter cache hydration, grant/cutoff checks, offline status UI, reconciliation,
and extended-outage browser tests change. The transaction/RLS contracts do not.

## Non-goals

- Beginning a new business day or authenticating a new operator offline.
- Extending a grant past cutoff or bypassing device revocation once learned.
- Multiple active devices at one outlet; #35 follows this change.
- Browsing the global customer directory offline; only previously resolved
  exact-phone results may be reused with an explicit cached label.
- Emergency personal-device billing, partial payments, refunds, or printing.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`,
`docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/SECURITY_AND_PRIVACY.md`, and
`docs/LIMITATIONS.md`.
