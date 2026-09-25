-- ===========================================================================
-- the-ledger-reads-fast-and-keeps-its-place, round two: the screens stop waiting
--
-- Measured on production after round one shipped (2026-09-25), in the owner's
-- own browser. Three of the costs left were the database's, not the network's,
-- and each grew with every bill ever rung. Nothing here changes a policy, a
-- figure, or who can read what.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The effective payments view looks corrections up per bill.
--
-- Same columns, same `security_invoker`, same rows. The "latest correction per
-- bill" was a CTE referenced twice, so Postgres materialised it over EVERY
-- correction; the correction table's policy then asked `bills` about every bill
-- the reader can see — 2,127 on production — to answer a question about forty.
-- 131 ms for one day, and linear in the business's whole history.
--
-- Now the uncorrected branch asks per payment row whether a correction exists,
-- and the corrected branch is a `DISTINCT ON` subquery whose key a caller's
-- `bill_id` filter reaches. Compared on production data, as the owner, before
-- this shipped: identical rows over all 2,238 payments and over the 16 corrected
-- ones, and 4 ms for the same day.
--
-- RLS: untouched. The view still runs as the caller, over the same tables,
-- through the same policies, so exactly the same rows are visible to exactly
-- the same people.

create or replace view public.effective_bill_payments
with (security_invoker = true)
as
select bp.bill_id, bp.outlet_id, bp.method, bp.amount_paise, 0::integer as revision
  from public.bill_payments bp
 where not exists (
   select 1 from public.bill_payment_corrections c where c.bill_id = bp.bill_id
 )
union all
select l.bill_id, l.outlet_id, a.method, a.amount_paise, l.revision
  from (
    select distinct on (c.bill_id) c.id, c.bill_id, c.outlet_id, c.revision
      from public.bill_payment_corrections c
     order by c.bill_id, c.revision desc
  ) l
  join public.bill_payment_correction_allocations a on a.correction_id = l.id;

-- ---------------------------------------------------------------------------
-- 2. Billing history's delivery log is indexed for the question it asks.
--
-- "The last hundred commands at this outlet". The only outlet index led with
-- `business_date`, so every command the outlet ever made — 4,304 at Kalyani —
-- was read, put through the policy and sorted, to keep a hundred: 317 ms, and
-- growing with every bill. With this the read stops after a hundred.

create index if not exists billing_commands_outlet_received_idx
  on public.billing_commands (outlet_id, received_at desc);

-- ---------------------------------------------------------------------------
-- 3. The Ledger day's takings, in its first wave.
--
-- The day used to wait for its bills before it could ask for their payment
-- split, which put a whole round trip on every day the Ledger opens. This is the
-- same answer — cash and UPI, each summed per bill and a bill counted only where
-- its total for the method is positive, over settled bills of the date — in one
-- request that needs nothing first. `ledger_month_inputs` sums the month the same
-- way, and the day/month parity test holds the two together.
--
-- Security definer with the Ledger's own assertion, like the other two ledger
-- reads: another outlet is refused rather than answered as a day of no sales.

create function public.ledger_day_takings(p_outlet_id uuid, p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.ledger_assert_reach(p_outlet_id);

  with per_bill as (
    select b.id,
           coalesce(sum(e.amount_paise) filter (where e.method = 'cash'), 0) as cash,
           coalesce(sum(e.amount_paise) filter (where e.method = 'upi'), 0) as upi
      from public.bills b
      join public.effective_bill_payments e on e.bill_id = b.id
     where b.outlet_id = p_outlet_id
       and b.business_date = p_business_date
       and b.status = 'settled'
     group by b.id
  )
  select jsonb_build_object(
           'cashPaise', coalesce(sum(case when cash > 0 then cash else 0 end), 0)::bigint,
           'cashBills', count(*) filter (where cash > 0),
           'upiPaise', coalesce(sum(case when upi > 0 then upi else 0 end), 0)::bigint,
           'upiBills', count(*) filter (where upi > 0)
         )
    into v_result
    from per_bill;

  return v_result;
end $$;

revoke all on function public.ledger_day_takings(uuid, date) from public;
grant execute on function public.ledger_day_takings(uuid, date) to authenticated;

comment on function public.ledger_day_takings(uuid, date) is
  'The Ledger day''s cash and UPI takings and bill counts, summed per bill over '
  'settled bills of the date. Stores nothing. Security definer with an assertion '
  'that raises for a reader the drawer does not admit.';
