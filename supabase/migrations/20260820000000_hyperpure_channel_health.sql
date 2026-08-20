-- Hyperpure joins the aggregator channels the owner can see the health of.
--
-- Until now the sync machinery admitted one channel, 'zomato'. A Hyperpure read
-- that failed went out as a red CI job — a maintainer's signal, invisible to the
-- owner, who was left with a stale supply figure and no reason given. This lets the
-- same run/credential machinery carry Hyperpure, so a failed read shows up on the
-- owner's sync surface and a lapsed session asks to be reconnected.
--
-- **Model A: Hyperpure rides Zomato's login.** One Zomato partner sign-in
-- auto-authorises Hyperpure, so there is no separate Hyperpure password to type and
-- no reconnect of its own — the login flow captures Hyperpure's session in the same
-- pass and stores it under its own channel. That is why only TWO checks widen:
--
--   * `aggregator_channel_credentials` — so the captured Hyperpure session can be
--     stored and its freshness described to the owner, and
--   * `aggregator_sync_runs` — so each Hyperpure read records its outcome, and a
--     failure is a line the owner reads rather than a job only a maintainer sees.
--
-- Everything else stays Zomato-only, on purpose:
--
--   * `aggregator_auth_requests` — the one-time-password mailbox. Hyperpure has no
--     code of its own; inventing an empty mailbox for it would be a lie the owner
--     could act on.
--   * `aggregator_cycle_deductions`, `aggregator_cycle_reconciliations`,
--     `aggregator_channel_days` — the payout-cycle and revenue-day machinery. A
--     Hyperpure statement is a supply cost booked as an expense, not a payout cycle
--     with a commission and a settled day, so none of these shapes apply to it.
--
-- The credential-health RPC and every credential/run function are already
-- parameterised on the channel, so nothing else changes: widening the two checks is
-- the whole of it.

alter table public.aggregator_channel_credentials
  drop constraint aggregator_channel_credentials_channel_known,
  add constraint aggregator_channel_credentials_channel_known
    check (channel in ('zomato', 'hyperpure'));

alter table public.aggregator_sync_runs
  drop constraint aggregator_sync_runs_channel_known,
  add constraint aggregator_sync_runs_channel_known
    check (channel in ('zomato', 'hyperpure'));
