# Proposal: Hyperpure Delivery Cutover

> **Model**: Opus · **Wave**: D maintenance · **Depends on**: #43 · **Gate**:
> every Hyperpure order invoiced through 15 September 2026 remains booked once
> at Kanchrapara, every order invoiced from 16 September 2026 is booked once at
> Kalyani, order `ZHPWB27-OR-0030242357` (17 September, ₹1,101.29) is corrected
> to Kalyani, replaying the overlapping 28-day statement creates no duplicate
> anywhere, a manual upload and the scheduled reader resolve the same outlet,
> every client role is refused route writes and every non-owner role is refused
> route reads, and verification neither invokes nor changes a login or OTP path.

## Why

Hyperpure deliveries moved from Kanchrapara to Kalyani after trading ended at
Kanchrapara on 15 September 2026. The supplier app may take longer to reflect
that operational move, but the physical fact is settled: the delivery invoiced
on 17 September arrived at Kalyani.

Ops cannot express that fact today. One permanent boolean on `outlets` names a
single Hyperpure delivery outlet for all time, and production still names
Kanchrapara. The parser consequently stamps the whole account-level statement
with Kanchrapara before the database sees any order.

Changing that boolean alone would be worse than leaving it stale. The reader
replays a 28-day statement and the current uniqueness key includes `outlet_id`,
so the same supplier order could coexist once at Kanchrapara and once at
Kalyani. At the time of investigation, that overlap contained 26 orders worth
₹97,434.16. The cutover therefore needs dated routing and outlet-independent
Hyperpure identity in the same change.

## What Changes

- Hyperpure delivery routing becomes an effective-dated database fact. The
  initial route names Kanchrapara through 15 September 2026 and the next route
  names Kalyani from 16 September 2026.
- Each Hyperpure order is routed by its own invoice date inside the database.
  A statement spanning the cutover may therefore write older orders to
  Kanchrapara and newer orders to Kalyani in one ingest.
- Hyperpure order identity becomes global to the supplier source and order
  number, not scoped by outlet. Re-reading or re-uploading an order after a
  route change can never create a second expense.
- The migration corrects every Hyperpure row dated from 16 September 2026 that
  still sits at Kanchrapara, including any genuine deliveries that arrive while
  the change is being built. It uses order `ZHPWB27-OR-0030242357`, invoiced on
  17 September for 110,129 paise, as an exact anchor; snapshots the bounded
  row count and paise before moving anything; and asserts the same identities,
  count and money at Kalyani afterwards.
- The current-outlet compatibility marker moves to Kalyani for older deployed
  parsers, while the dated route becomes the authority. Removing that legacy
  column is deferred until no deployed parser reads it.
- Hyperpure run health is configured against Kalyani after deployment. This is
  observability attribution only; it does not decide where an expense lands.
- The existing Hyperpure API outlet id remains unchanged unless Hyperpure later
  supplies a proved replacement. The statement is account-level and accounting
  routing no longer depends on that provider metadata.

## Capabilities

### Modified Capabilities

- `supply-statements`: supplier order identity is global across outlets, and a
  delivery route may change on an explicit effective date without rewriting
  earlier delivery history or duplicating an overlapping statement.

## Impact

- **Database**: one effective-dated supplier-route table with RLS, a global
  Hyperpure source-identity constraint, a rewritten supply ingest, and one
  bounded, asserted production correction set.
- **Edge boundary**: the Hyperpure parser stops being the authority for outlet
  assignment; both automation and upload continue through the same ingest.
- **Generated types and fixtures**: the route table is generated and the
  legacy current-outlet marker is updated to Kalyani while retained for rollout
  compatibility.
- **Private sync repository**: no authentication code change. Deployment
  configuration moves Hyperpure run health to Kalyani; the working provider API
  outlet id and capture card remain unchanged.
- **Production operations**: pause the scheduled Hyperpure reader only for the
  migration window, deploy, run a no-write statement rehearsal, perform one
  live replay, prove the global identity and outlet totals, then resume it.

## Non-goals

- No Hyperpure or Zomato login, reconnect, session capture, credential deletion,
  OTP request, OTP submission, or change to any OTP/authentication code path.
- No change to the Zomato picker card. Kanchrapara's card may remain the SSO
  doorway because that doorway is independent of delivery accounting.
- No change to Hyperpure's app-side delivery address and no reliance on when
  Hyperpure updates it.
- No change to `HYPERPURE_DELIVERY_OUTLET_ID` (`1719650`) without separate live
  evidence that Hyperpure assigned Kalyani a replacement provider outlet id.
- No movement of an order invoiced on or before 15 September 2026.
- No retrospective split or reallocation of earlier shared costs.
- No change to Kanchrapara's active/inactive operational status.
- No UI redesign, gate change, billing path, drawer arithmetic or offline
  semantics.

## Docs to update before archiving

- `docs/DATA_MODEL.md`: effective-dated supplier routing, global Hyperpure
  identity and the compatibility status of `hyperpure_delivery`.
- `docs/OPERATIONS.md`: changing a physical delivery outlet, the rollout order,
  the no-OTP verification boundary and the run-health configuration.
- `docs/BUSINESS_CONTEXT.md`: Hyperpure deliveries move to Kalyani from
  16 September 2026 while earlier purchases remain Kanchrapara history.
