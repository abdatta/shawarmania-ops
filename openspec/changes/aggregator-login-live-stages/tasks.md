## 1. Schema — the stage lives on the channel's credentials row

- [x] 1.1 Migration: `aggregator_channel_credentials.login_stage` (nullable, inline check on the eight words) and `login_stage_at` (nullable), with comments.
- [x] 1.2 `aggregator_credential_health_v2(p_channel)`: v1's columns plus `login_stage`, `login_stage_at`; owner-only, `security definer`, executable by `authenticated` only. v1 untouched.
- [x] 1.3 pgTAP: columns exist and refuse an unknown word; v2 answers the owner, refuses a manager and a biller; `authenticated` still has no select on either table.
- [x] 1.4 Regenerate `database.types.ts`; `npm run lint:migrations` green.

## 2. The server records the stages it sees

- [x] 2.1 `_shared/login-stage.ts`: the vocabulary, the runner-reportable subset, a best-effort `recordLoginStage(service, channel, stage)`, and pure tests.
- [x] 2.2 `request-aggregator-sync`: `starting` when the full-login rung dispatches (not capture-only, not rehearsal, not still-signed-in).
- [x] 2.3 `aggregator-reader`: `waiting_for_code` on `open_code_request`; `checking_code` on a collected `await_code`; `waiting_for_code`/`stopped` on `reject_code` retry/exhausted; `stopped` on `finish_login` expired/abandoned; `bringing_hyperpure` (Zomato) or `done` (Swiggy) on `finish_login signed_in`.
- [x] 2.4 `aggregator-reader` `report_stage`: runner words only, refused `unknown_stage`; refused `no_sign_in` unless a live sign-in is under way; Zomato-only `done`.
- [x] 2.5 `npm run functions:typecheck` green.
- [x] 2.6 A runner `stopped` report also closes the channel's open OTP request, and the surface ignores a request past its expiry: after a refused OTP reopened one and the old runner died, its card stood on the page for hours (2026-11-04). Replayed on the local server; unit test for the surface.

## 3. Reading it

- [x] 3.1 `AggregatorSyncHealth.signIn: { stage, at } | null` and `codeAttempts`; live adapter reads v2.
- [x] 3.2 `src/domain/sign-in-progress.ts`: pure `readSignIn(stage, at, now, lastRunAt)` → hidden / live / quiet / stopped / done, with the ceilings; unit tests for every branch and the 30-minute horizon.

## 4. The stepper

- [x] 4.1 `SignInProgress` replaces the reconnect card while a sign-in is live, quiet, stopped or just done; no Reconnect while live.
- [x] 4.2 Code field and countdown inside "Waiting for your code"; "not accepted" line from attempts.
- [x] 4.3 Fallback: today's code card when a code is awaited and no stepper holds the field.
- [x] 4.4 Done newer than the last run suppresses the lapsed card (D7).
- [x] 4.5 The watch also runs while a sign-in is live, at the 3 s running-read pace (design D10).
- [x] 4.6 Component tests: walk, quiet, stopped, retry, done, Swiggy without Hyperpure, an open request with no recorded stage asks in the steps (the old separate card removed, design D8).
- [x] 4.7 A live sign-in holds its page (design D11): the steps sit over an inert, dimmed page; navigation stays usable; a watched sign-in ends ticked until Done; quiet and stopped do not hold. Unit and browser tests, including leaving for Team and coming back.
- [x] 4.8 Owner review: the first stage shows the moment Reconnect is tapped; OTP, not code, everywhere on the page; a one-line "This can take a couple of minutes."; a watched sign-in's end is said as a toast. Team's toast moved into the shared `src/components/ui/toast.tsx`, documented in DESIGN_SYSTEM and AGENTS.md, with a design-system spec delta.

## 5. Demo mode

- [x] 5.1 The mock walks every stage on timers for Zomato and Swiggy, code at stage four.
- [x] 5.2 The still-alive reconnect and the capture-only repair show no stepper.
- [x] 5.3 Demo e2e: tap Reconnect, see the stages, type a code, reach signed back in.

## 6. Runner (`abdatta/shawarmania-sync`)

- [x] 6.1 `ops.reportStage(stage, channel)`, best effort, never throws.
- [x] 6.2 Zomato: `opening_portal`, `signing_in`, `done` after the capture.
- [x] 6.3 Swiggy: `opening_portal`, `signing_in`.
- [x] 6.4 `login.yml`: on failure or cancel, report `stopped`.
- [x] 6.5 Zomato code-screen wait cannot be satisfied by the phone field; unit test.
- [x] 6.6 No token, cookie or code reaches a log line through the new calls.
- [x] 6.7 `login.yml` passes `HYPERPURE_OPS_OUTLET_ID` to the Zomato step, so the Hyperpure capture riding on a sign-in records its outcome (it was silently dropped, like `hyperpure.yml` and `capture-hyperpure.yml` already pass it).
- [x] 6.8 Zomato: a refused OTP is known from Zomato's red line in seconds, and the run waits for the next OTP, up to three (design D13); unit tests for the verdict.

## 7. Docs

- [x] 7.1 `docs/SCREENS.md`: the stepper replaces the separate code card.
- [x] 7.2 `docs/OPERATIONS.md`: a sign-in, quiet, stopped; Zomato wants one about monthly.

## 8. Gate

- [x] 8.1 Gate (#46) clause by clause, saying which test proved each.
- [x] 8.2 CI gates per `verify.yml`: lint, format:check, typecheck, functions:typecheck, unit, build, e2e, contrast, test:db.
- [x] 8.3 Honest note: no live OTP was spent; the live walk happens at the next real lapse (now: both channels are lapsed).
- [ ] 8.4 The live walk: once the ops build and the runner are deployed, reconnect Zomato and Swiggy (both lapsed since 22 and 24 Oct) and watch every stage arrive on the owner's phone.
