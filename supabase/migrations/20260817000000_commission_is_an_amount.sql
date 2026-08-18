-- Commission is an amount, not a rate.
--
-- Owner decision, 2026-08-17: with settlement read from Zomato, a stored
-- percentage has nothing left to do. The reader brings the exact commission for
-- every order, so the rate was only ever a way of guessing one — and it was a bad
-- guess. The measured take rate swings between 24% and 35% day to day, which is
-- hundreds of rupees a week on a figure the ledger presented as exact.
--
-- Three things go with it, all at the owner's word:
--
--  1. **No rate is stored anywhere**, for either channel.
--  2. **A typed day takes the commission as an amount too.** Swiggy is still typed
--     by hand and will be for a while; it takes an amount off the statement rather
--     than a percentage the owner works out in their head.
--  3. **No carry-forward.** Seeding today's rate from yesterday's was only
--     defensible when the rate was a slow-moving property of a contract. Copying
--     yesterday's *amount* forward would be copying yesterday's revenue, so the
--     affordance goes rather than being reinterpreted.
--
-- **This rewrites deployed production rows**, which the owner authorised
-- explicitly. The conversion is arithmetic-preserving: the formula below is the
-- same rounding `commissionPaise` in `src/features/manual-ledger/ledger.ts` has
-- always applied, so every day's net comes out byte-identical to what the ledger
-- displayed yesterday. That is the whole safety argument. A conversion that moved
-- a historical figure by a paisa would be a conversion that made the owner
-- distrust the migration, and they would be right to.

-- ---------------------------------------------------------------------------
-- 1. The new columns, filled from the old ones.

alter table public.manual_ledger_days
  add column zomato_commission_paise bigint,
  add column swiggy_commission_paise bigint;

/*
 * `trunc((revenue * bp + 5000) / 10000)`, in integers throughout.
 *
 * Half-up on the magnitude, which is what the application has always done:
 * `sign * Math.trunc((magnitude * bp + COMMISSION_HALF) / COMMISSION_BP_SCALE)`.
 * Postgres integer division truncates toward zero, so the expression matches
 * exactly rather than approximately, and `abs`/`sign` keep a negative revenue —
 * which the schema permits even if the shop has never recorded one — rounding the
 * same way in both directions.
 */
update public.manual_ledger_days
   set zomato_commission_paise =
         sign(zomato_revenue_paise)
         * ((abs(zomato_revenue_paise) * zomato_commission_bp + 5000) / 10000),
       swiggy_commission_paise =
         sign(swiggy_revenue_paise)
         * ((abs(swiggy_revenue_paise) * swiggy_commission_bp + 5000) / 10000)
 where true;

/*
 * Nullable, because "we do not know yet" is a real state [owner, 2026-08-17].
 *
 * Null means **undetermined**: this channel took money and what it kept has not
 * been established. It is not nought, and the difference is the whole point.
 *
 * The state exists because of a measured limitation. Zomato's Order History shows
 * today's orders with timestamps to the minute, but carries no commission and no
 * payout — the per-order detail endpoint was searched field by field and has none
 * either. The figures only exist once the week closes. So a day read tonight can
 * honestly say what came in and cannot say what was kept.
 *
 * The alternative was estimating the commission from the last settled week's take.
 * That would have put a plausible wrong number where a known-unknown belongs,
 * which is the habit this whole change was made to break. An undetermined figure
 * is filled in later by the weekly settlement, or by hand.
 *
 * A default of nought is kept rather than null so that a day which sold nothing on
 * a channel needs no ceremony, and the constraint below is what stops null and
 * nought being confused in the direction that matters.
 */
alter table public.manual_ledger_days
  alter column zomato_commission_paise set default 0,
  alter column swiggy_commission_paise set default 0;

/*
 * Three rules in one, per channel:
 *
 *  - A channel with no revenue was charged nothing, and that is KNOWN. Null there
 *    would render as "commission unknown" on a day that plainly had none.
 *  - A channel with revenue may be undetermined.
 *  - A determined commission cannot exceed the revenue it comes off, in either
 *    direction, since a refunded day's revenue is negative.
 */
alter table public.manual_ledger_days
  add constraint manual_ledger_days_zomato_commission_within_revenue check (
    case
      when zomato_revenue_paise = 0 then zomato_commission_paise = 0
      else zomato_commission_paise is null
        or zomato_commission_paise between least(0, zomato_revenue_paise)
                                     and greatest(0, zomato_revenue_paise)
    end
  ),
  add constraint manual_ledger_days_swiggy_commission_within_revenue check (
    case
      when swiggy_revenue_paise = 0 then swiggy_commission_paise = 0
      else swiggy_commission_paise is null
        or swiggy_commission_paise between least(0, swiggy_revenue_paise)
                                     and greatest(0, swiggy_revenue_paise)
    end
  );

-- ---------------------------------------------------------------------------
-- 2. The rates go.
--
-- Dropped rather than left in place unused. A column nothing writes and nothing
-- reads is a column the next person assumes is authoritative, and this one would
-- read as an authoritative percentage sitting beside an exact amount that
-- disagrees with it.

alter table public.manual_ledger_days
  drop column zomato_commission_bp,
  drop column swiggy_commission_bp;

comment on column public.manual_ledger_days.zomato_commission_paise is
  'Exact commission for the day, in paise. Typed from the statement, or read from Zomato where the day is synced.';
comment on column public.manual_ledger_days.swiggy_commission_paise is
  'Exact commission for the day, in paise. Typed from the statement; Swiggy is not synced.';
