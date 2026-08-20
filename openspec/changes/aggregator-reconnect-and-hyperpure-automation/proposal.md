# Proposal: Aggregator Reconnect And Hyperpure Automation

> **Model**: Opus · **Wave**: D · **Depends on**: #43 (this finishes the automation #43 stood up but could not land end-to-end) · **Gate**: the owner reconnects the aggregator once and Hyperpure's figures resume alongside Zomato's without a second sign-in or code; a reconnect asks for a one-time code only when the login actually requested one, and never asks when the session is still alive; Hyperpure's daily figures arrive on the schedule without a manual statement upload; the Hyperpure health line offers a working Reconnect again; and the four-role demo walkthrough still walks.

**This is a follow-through change, not new capability.** #43 froze the aggregator entry, moved Zomato and Hyperpure to measured figures, and built the plumbing for Hyperpure to read itself. It shipped with three things deliberately deferred rather than rushed. This change lands them.

## Why

#43 was archived with working figures on both channels, but two of the paths that produce them still need a human step that they were meant to remove, and one screen was hidden rather than fixed.

**Hyperpure cannot capture its own session yet.** The design is settled — **Model A: Hyperpure rides the Zomato partner login** (single sign-on; one reconnect fixes both channels; no separate Hyperpure OTP). The runtime session code, the API client, the CI workflow and the health surface all exist and work when handed a session. What does not work is *minting* that session headlessly: the login handoff goes through the partner portal's Hyperpure outlet-picker at `/partners/onlineordering/hyperPure/`, and the SSO token does not land when the capture runs headless in the CI runner. Until that is solved, Hyperpure figures come from the owner uploading the account statement by hand.

**The Hyperpure Reconnect button is hidden.** Because the automated capture does not complete, pressing Reconnect would ask for a code and then fail to produce a live Hyperpure session. Rather than show a button that lies, #43 hid it and pointed the owner at the manual statement upload instead. The button comes back the moment capture works.

**A reconnect asks for a code even when it does not need one.** The current flow surfaces an OTP prompt on every reconnect attempt, whether or not the login actually requested a code — the sliding 24h session usually means no code is needed at all. The owner pressed Reconnect, was asked for an OTP, and none arrived, because the login had not asked for one. The prompt should appear only when the login genuinely requests it.

## Scope

**Hyperpure automated session capture (the core).** Make `captureHyperpure` in the sync repo mint a live Hyperpure session in the headless CI runner by driving the partner-portal outlet-picker handoff at `/partners/onlineordering/hyperPure/`, so the Zomato reconnect produces both sessions in one pass. When this lands, the manual statement upload becomes the fallback, not the primary path.

**Restore the Hyperpure Reconnect button.** Bring back the Reconnect control on the Hyperpure health line in `zomato-sync-surface.tsx` once capture is proven, wired to the same reconnect dispatch as Zomato.

**OTP-timing redesign.** Surface the code prompt only when the login flow actually requested a code. A reconnect on a still-alive session must complete silently; a reconnect that triggers a genuine OTP challenge must be the only case that asks the owner for a code.

**Live Hyperpure end-to-end (#43 task 9.7's deferred half).** Prove the Hyperpure read end-to-end against the live account the way Zomato's was, once capture works headlessly.

**Cleanups carried over from #43.**
- Delete the dead `api.orders` path in the Hyperpure source (superseded by `deliveredOrders`/`statementBytes`).
- Give the Hyperpure API client the same transient-failure retry the ops poster got (`ops.mjs`: retries 408/429/5xx with exponential backoff), so a flaky `aggregator-reader` call does not fail a run.
- Optional: a small "not counted" note on the month view for figure-only days, matching the day view's treatment.

## Non-goals

- **No removal of the OTP entirely.** The login is OAuth2 + PKCE with `scope=offline`, so a refresh token exists and could remove the one-off code someday — that is separate future work, not this change. This change only fixes *when* the code is asked for.
- **No Swiggy.** Still out of scope, as in #42 and #43.
- **No change to how figures are stored, reconciled or frozen.** #43 settled the ledger shape, the append-only guards, the commission-as-reduction rule and the restatement. This change does not touch any of that; it only changes how the Hyperpure session is obtained and how reconnect behaves.
- **No manual-upload removal.** The manual account-statement upload stays as the proven fallback even after capture works.

## Design questions to settle during `/opsx:propose`

- **How the outlet-picker handoff is driven headlessly.** Whether `captureHyperpure` navigates the partner portal picker at `/partners/onlineordering/hyperPure/` and reads the resulting token cookie, or whether the SSO exchange can be replayed directly from the Zomato session without the portal hop. Prove it in the CI runner (headed-under-xvfb, as Zomato's capture is), not only locally.
- **How the login signals that a code was actually requested**, so the OTP prompt can be conditioned on it rather than shown unconditionally.
- **What the health line shows** in each state once Reconnect returns: alive, needs-reconnect (session lapsed), and needs-code.

## Watch out for

- **Session tokens and customer PII never get logged**, and the `.playwright-mcp/` capture artifacts are gitignored and carry live tokens — clean them after any verification run.
- **The reconnect dispatch target.** `request-aggregator-sync` routes reconnect to `login.yml` and sync to `sync.yml` via `dispatchTarget(mode)`, and sweeps expired open requests before inserting. Do not regress that — the earlier bug where reconnect silently ran the sync job (so no OTP ever came) traces to this.
- **Model A means one reconnect fixes both channels.** Do not reintroduce a separate Hyperpure reconnect path; the whole point is the shared Zomato login.
- **The manual upload response is now human text** (`describeUpload`), not raw JSON. Keep it that way if the upload path is touched.

## Context from the #43 session (2026-08-20)

Everything below was verified live during #43 and is why these follow-ups exist rather than being unknowns:

- **Model A is confirmed and partly built.** `session.mjs` (`createHyperpureSession`: `Bearer ` verbatim in the token cookie, `deviceid`/`x-outletid`/`x-trackingid` headers, `headerroute` v2), `sources/hyperpure/api.mjs` (`statementBytes` → POST `soaFilePath` → signed S3 URL with 404-retry; `deliveredOrders` reads `ListOfOrderDetail`), and `hyperpure.mjs` (`run()` reports outcome to ops) all work when given a session.
- **`auth.mjs` `captureHyperpure` is the broken seam.** It navigates `hyperpure.com` and reads the storageState token, but the SSO handoff does not land headless — it needs the partner-portal outlet-picker at `/partners/onlineordering/hyperPure/`.
- **The manual fallback is proven in prod.** The owner downloads the account statement (per-order or via Your Orders) and uploads it; #43's upload path parses it and writes figures. This is the current source of Hyperpure figures.
- **The reconnect-asked-OTP-but-none-came bug was fixed in #43** (dispatch was sending `sync.yml` not `login.yml`; fixed `dispatchTarget`, added expired-sweep, added `login.yml` inputs). The remaining OTP issue is *timing* — asking for a code when none was requested.
- **The `aggregator-reader` 503s were fixed in #43** by adding transient retry to `ops.mjs`; the Hyperpure API client did not get the same treatment yet (the cleanup above).
- **Channel health for Hyperpure is live** (`getHyperpureHealth`, `HyperpureHealthLine`), but its Reconnect button is currently removed pending capture.

## Docs to update before archiving

`docs/SCREENS.md` (the aggregator/Hyperpure health surface once Reconnect returns), `docs/OPERATIONS.md` (the reconnect runbook: one reconnect, both channels, code only when asked).
