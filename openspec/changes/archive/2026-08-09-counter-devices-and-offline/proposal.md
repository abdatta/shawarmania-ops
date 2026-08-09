# Proposal: Counter Tablet And Local Durability

> **Model**: Opus · **Wave**: D · **Depends on**: #4, #21, #22, #24, #26, #27, #30, #38 · **Gate**: each outlet sets up exactly one billing tablet without a password ever being typed on it; a shift opens only when the named person enters the tablet's code on their own phone, and can be ended from that phone; removing a tablet stops it at once; and the tablet records an expense attributed to whoever is on shift.

## Why

The counter needs a trusted outlet machine that is not somebody's personal login
left lying on a shared tablet all evening. And it needs the person taking money
to be named, so a short drawer has somebody to ask.

## What Changes

- Let an FA set up the current device for their outlet and an SA set one up for
  any outlet, using a one-time setup code the admin generates on their own phone.
  Enforce at most one active billing tablet per outlet.
- Establish a long-lived device session and a billing-only shell on the tablet.
  No personal session is ever created there, at setup or afterwards.
- Replace counter PINs with a **two-device shift handshake**: the tablet asks for
  a username and displays a four-digit code, and the named person enters that code
  on their own phone before the shift opens. No password is ever typed on the
  tablet, and nobody who cannot see the tablet can open a counter.
- Let the tablet cancel its own pending request, and let the named person reject
  one outright without the code.
- Deliver a waiting request to the person's phone live, and surface it on the home
  screen of whichever shell they use, badged through the attention mechanism that
  already exists.
- Let a person end their own shift remotely from that same home screen, and have
  the tablet stop taking work at its next request.
- Preserve one assignment per person per outlet while making `biller` include the
  Employee attendance capabilities on personal devices.
- Permit outlet Billers, that outlet's FA, and any SA to hold a shift. Ordinary
  Employees cannot.
- Expire the shift at cutover and require a fresh handshake. Tablet setup persists
  until the tablet is removed.
- Let the tablet record a manual-ledger expense, attributed to the person holding
  the current shift, without widening anything else the device session can reach.
- Add tablet status, last-seen and unsent-count telemetry, and immediate removal.

## Capabilities

### New Capabilities

- `counter-device-sessions`: Tablet setup, device sessions, the two-device shift
  handshake, remote shift ending, one-tablet-per-outlet enforcement, and removal.

### Modified Capabilities

- `identity-and-access`: Biller becomes an Employee-capable assignment, and a
  shift is opened by an approved request rather than by credentials on the tablet.
- `app-shell`: A set-up tablet renders only its billing context whatever the
  operator's personal role, and every personal shell's home surfaces a waiting
  approval and any shift the reader currently holds.
- `outlet-tenancy`: Device sessions, shift requests and shifts are outlet-bound,
  and removal is enforced at the database boundary.
- `counter-billing`: A shift is opened by the two-device handshake instead of a
  PIN, and belongs to one tablet and one business day.
- `manual-ledger`: An expense may be recorded by a device session holding a live
  shift, attributed to that shift's operator.

## Impact

Auth and session adapters, role capability helpers, setup/shift/removal
functions, tablet and shift schema, shift-request schema and its realtime
channel, RLS helpers, `manual_ledger_expenses` policies, Counter shell routing,
the Tablets management surface, the three personal home surfaces, attention
sources, generated types, seeds, and auth, RLS and E2E tests change.

## Non-goals

- Real order or bill persistence, or live menu and customer adapters.
- More than one active billing tablet per outlet.
- **The durable local operation store.** Moved to #33 on 2026-08-09: the queue's
  envelope, canonical hash and idempotency key are the same design as the command
  contract, and building it here meant building it against a payload shape that
  did not exist yet.
- Deliberate offline restart or prolonged offline trading. Roadmap change #34
  adds that after Billing V1.
- **Any fallback approver for a shift request.** The named person approves it or
  nobody does, by explicit decision, and the consequence is written down in
  `docs/LIMITATIONS.md` rather than designed around.
- Push notifications to a closed app, attendance from the tablet, inactivity
  auto-lock, or emergency billing from a personal device.

## Docs to update before archive

`docs/ARCHITECTURE.md`, `docs/ROLES_AND_PERMISSIONS.md`,
`docs/OFFLINE_AND_SYNC.md`, `docs/OPERATIONS.md`, `docs/SCREENS.md`,
`docs/SECURITY_AND_PRIVACY.md`, `docs/GLOSSARY.md`, and `docs/LIMITATIONS.md`.
