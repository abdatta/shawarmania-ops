# An accepted week is written

> **Model**: Opus · **Fix** (no roadmap row) · corrects `aggregator-settlement-sync`

## Why

On 2026-10-10 the owner pressed **Accept the difference** on a disputed Swiggy week (1–3 Oct, the outlet's figures −₹173.16 against a stated payout of ₹0) and nothing changed, however many times they pressed it. The action has never worked, on either channel: the app sends the request as `mode: 'accept'` with the week's dates, the Edge Function knows only `sync` and `reconnect` and quietly turns anything else into an ordinary read, and no reader ever sends the acceptance the database is waiting for. Every press started a fresh read, which disputed the week again. Earlier disputes all resolved themselves on a later read, so it went unnoticed. The requirement it breaks is already in the spec: accepting writes the aggregator's per-order figures and records the remaining difference against who accepted it.

A disputed week also leaves the Swiggy sync reporting a failure on every run, and the Delivery badge lit, until it is resolved.

The same day the delivery feeds were moved from Kalyani to Kalyani Cafe, with the Cafe's sync starting 1 Oct. The next read re-recorded two **September weeks Kalyani had already been paid for** as settled weeks of the Cafe, because a read writes a week's reconciliation under whichever outlet the feed now names, even when every day of the week falls before that outlet's sync began. The days were rightly left alone; the week was not. Both defects are in the one function that writes a delivery week, so they are fixed together.

## What changes

- **Accepting a disputed week works.** The owner's acceptance is recorded against that week at once — who, when, and the figures they accepted — and a read is started immediately. That read writes the platform's own per-order figures, settles the days, and records the remaining difference as an unexplained settlement difference attributed to the owner; the run reads `ok`, the week reads accepted and the badge clears. No day's figures are adjusted.
- **An acceptance holds only for what was accepted.** If a later read finds different figures for that week, the acceptance lapses: the week reconciles or is disputed afresh, and its recorded difference is withdrawn. Today such a read would be refused outright by the database, stopping the whole run.
- **A request the Edge Function does not recognise is refused,** never carried out as something else.
- **A week that ended before an outlet's sync began is not recorded against that outlet.** The two September weeks already recorded under Kalyani Cafe are removed; Kalyani's own records of them are untouched.

## Non-goals

- Any change to how a week reconciles, its tolerance, or what a re-check does.
- The "Delivery data incomplete" qualifier on Overview (in the backlog as `a-quiet-delivery-day-reads-as-missing`).
- Accepting from anywhere but the Delivery page, or by anyone but the owner.
- The delivery-revenue chart (#73).
- Any change to the sync repository: the acceptance is read by the database itself, so the readers need not carry it.

## Durable documentation

Before archive: `docs/OPERATIONS.md` (what Accept does, and that moving a feed to another outlet re-reads recent weeks), `docs/DATA_MODEL.md` (who accepted a week), `docs/SCREENS.md` (Delivery's accepted week) and `docs/TESTING.md`.
