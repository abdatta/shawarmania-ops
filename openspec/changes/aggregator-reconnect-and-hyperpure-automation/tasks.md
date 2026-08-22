## 1. Sync repo — capture rewrite

- [x] 1.1 Rewrite `captureHyperpure` in `src/auth.mjs` to drive the verified route: navigate `/partners/onlineordering/hyperPure/`, click the outlet card for the configured delivery outlet, press its `Start buying` button, then wait bounded for the `token` cookie on `.hyperpure.com`; remove the bare-hyperpure.com navigation the experiment disproved.
- [x] 1.2 Make capture outcome-bearing: report `captured` / `not_captured` (with reason) separately from the Zomato `signed_in` outcome, so a half-success is knowable per channel; keep capture best-effort — it must never fail a completed login.
- [x] 1.3 Save the Zomato storageState back when the portal renews it during the hop, matching `sync.mjs`'s saving rule.
- [x] 1.4 Delete the dead `api.orders` path from the Zomato source.
- [x] 1.5 Give the Hyperpure API client the same transient-failure retry `ops.mjs` has (408/429/5xx with backoff).
- [x] 1.6 If it stays a small filter: window-filter `readStatement`'s missing-orders comparison so short windows stop flagging long-settled orders; drop it if it grows.
- [x] 1.7 Sectional check: replay the captured-state read (`check-hyperpure-state.mjs` pattern) still succeeds against live data after the reader changes.

## 2. Sync repo — capture-only workflow and lazy mailbox

- [x] 2.1 Add `src/capture.mjs`: load the stored Zomato session from the ops database, rebuild a browser context from it through the same launch escalation as `login`, drive the picker hop, save the Hyperpure session; on a lapsed parent, fail with `sessionLapsed` rather than improvising a prompt.
- [x] 2.2 Add `.github/workflows/capture-hyperpure.yml`: dispatchable only, xvfb headed like `login.yml`, artifacts on failure only, session never uploaded.
- [x] 2.3 Move the code-request opening out of dispatch: add an `open_code_request` action to `aggregator-reader`'s contract, and call it from `login` at the moment the OTP screen renders (after the identifier is accepted); sweeping/expiry behaviour unchanged.
- [x] 2.4 Confirm no token, cookie value or code reaches any log line, workflow summary or committed file across both repos; traces stay structure-only and failure-only.
- [x] 2.5 Sectional check: dispatch `capture-hyperpure.yml` on a **branch ref** from this change's working tree and watch it store a live Hyperpure session in CI — no sign-in step anywhere in the run log.

## 3. Ops — probe and the reconnect ladder

- [x] 3.1 Add a `probe` action to `aggregator-reader`: one cheap authenticated call per channel (Zomato finance endpoint; Hyperpure accounts endpoint) returning alive/lapsed from the stored session, service-role authority unchanged.
- [x] 3.2 Rewrite `request-aggregator-sync`'s reconnect path as the ladder: probe both channels → warm-parent/cold-child dispatches `capture-hyperpure.yml` with no auth request → both-warm answers `still_signed_in` → cold parent opens nothing itself but dispatches `login.yml`, whose runner now owns mailbox opening.
- [x] 3.3 Accept `channel: 'hyperpure'` for reconnects (the database has since #43); keep every existing guard — owner authority, configured-channel check, cooldown, one-open-per-channel index, sweep of expired requests.
- [x] 3.4 Remove the eager mailbox insert and its orphan-cleanup branch, leaving the dispatch contract documented where D4 recorded it.
- [x] 3.5 Sectional check: edge-function tests cover each rung — capture-only dispatched with zero auth-request rows; `still_signed_in` with zero dispatches; lapsed parent dispatches `login.yml`; non-owner refused; unconfigured outlet refused.

## 4. Ops — surface

- [x] 4.1 Extend the sync adapters (supabase + mock) with the reconnect result vocabulary: `still_signed_in`, capture-only in progress, per-channel outcomes, and the half-success named; `requestReconnect` takes the channel.
- [x] 4.2 Restore Reconnect on `HyperpureHealthLine`, wired to `requestReconnect(outletId, 'hyperpure')`, with the line's states reading: All quiet / Reading / Session ended (+Reconnect) / awaiting code (shared card) / Stuck (maintainer's).
- [x] 4.3 Name a half-success at the moment it happens: Zomato line reports success while the Hyperpure line says the handoff did not follow and offers trying again.
- [x] 4.4 Keep the code card driven by `awaitingOneTimePassword` alone, so it appears only when a request exists; verify the polling beat picks up a lazily opened request without a manual refresh.
- [x] 4.5 Unit tests: mock-adapter states for every rung; surface test asserting the Hyperpure button appears only in lapsed state, the half-success copy renders, and no code card renders while no request is open; contrast untouched by any new colour pair.
- [x] 4.6 Sectional check: `npm run lint`, `npm run typecheck`, `npm test` green; demo mode shows the new states against mocks with no request beyond the app origin.

## 5. Verification and phase gate

- [x] 5.1 Full suite: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.
- [ ] 5.2 Live end-to-end from the app: reconnect with today's production shape (Zomato warm, Hyperpure absent) completes with no code prompt and ends both lines quiet; then the scheduled Hyperpure job reads real figures on its own schedule.
- [ ] 5.3 OTP-timing proof: force the full-login rung once against a controlled lapsed state and confirm the code card appears only when the code arrives — and never on an alive-session reconnect.
- [x] 5.4 Four-role demo walkthrough still walks end to end with the updated sync surface states.
- [x] 5.5 Hygiene: delete local credential artifacts from the 2026-08-22 experiment (`shawarmania-sync/session/hyperpure-edge-state.json`, Browser Control `zomato-edge` secret profile, redacted HAR), keeping none past archive.
- [x] 5.6 Docs updated before archive: `docs/SCREENS.md` (sync surface states once Reconnect returns) and `docs/OPERATIONS.md` (the reconnect runbook: one reconnect, both channels, code only when asked).
- [ ] 5.7 PHASE GATE — Aggregator reconnect and Hyperpure automation: the owner reconnects the aggregator once and Hyperpure's figures resume alongside Zomato's without a second sign-in or code; a reconnect asks for a one-time code only when the login actually requested one, and never asks when the session is still alive; Hyperpure's daily figures arrive on the schedule without a manual statement upload; the Hyperpure health line offers a working Reconnect again; and the four-role demo walkthrough still walks.
