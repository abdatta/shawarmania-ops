-- ===========================================================================
-- the-ledger-reads-fast-and-keeps-its-place: the ledger reads in two round trips
--
-- Measured on production on 2026-09-24: every request from a phone costs about
-- 300 ms whatever it asks, a Ledger day made thirteen of them one after another
-- (4-5 s) and a month about six hundred (15-16.5 s). The cost was round trips,
-- not database work, so these two functions move computation the client
-- already did to the server, where it costs one request instead of many.
--
-- **Neither stores anything.** Both are derived on read from the same sources as
-- the day reader, which is what `ledger-statement` requires: no stored day or
-- month row, nothing that can disagree with its sources.
--
-- **Tenancy.** Both are security definer, so RLS does not filter inside them and
-- the assertion at the top of each is the boundary. It raises rather than
-- returning nothing on purpose: an empty month for an outlet the reader may not
-- see would be indistinguishable from a quiet one. The predicate is the drawer's
-- own, `app_may_reach_drawer`, so the reach is exactly what every drawer and
-- verification policy already admits. Overview's functions take the same shape
-- for the same reason.
-- ===========================================================================

create function public.ledger_assert_reach(p_outlet_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not coalesce(public.app_may_reach_drawer(p_outlet_id), false) then
    raise exception 'may not read the ledger at this outlet' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The drawer balance at an instant.
--
-- The client's former `balanceAt`, one request instead of five: walked forward
-- from the last observation at or before the instant, never stored. The walk
-- resets at every observation, so an error cannot accumulate across counts.
--
-- Integer paise throughout. The one rule that must not be lost in the move: the
-- observation's OWN cash out (a collection taken at the count) comes off the
-- counted total, and is then excluded from the interval's cash out, so it is
-- taken once and only once. `overview_drawer` runs the same arithmetic against
-- `now()`.
--
-- Null before the outlet's first observation: there is no balance to state.

create function public.ledger_drawer_balance_at(p_outlet_id uuid, p_at timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_previous public.drawer_observations;
  v_own bigint;
begin
  perform public.ledger_assert_reach(p_outlet_id);

  select * into v_previous
    from public.drawer_observations
   where outlet_id = p_outlet_id and counted_at <= p_at
   order by counted_at desc
   limit 1;
  if not found then
    return null;
  end if;

  select coalesce(sum(amount_paise), 0)::bigint into v_own
    from public.drawer_cash_out
   where observation_id = v_previous.id;

  return v_previous.counted_total_paise - v_own
    + public.drawer_cash_receipts_paise(p_outlet_id, v_previous.counted_at, p_at)
    - public.drawer_cash_expenses_paise(p_outlet_id, v_previous.counted_at, p_at)
    - public.drawer_cash_out_paise(p_outlet_id, v_previous.counted_at, p_at, v_previous.id);
end $$;

-- ---------------------------------------------------------------------------
-- What the month reading uses, for every date of a month, in one request.
--
-- One element per date, shaped as `MonthDayInput` in src/domain/ledger-month.ts,
-- and field for field what `toMonthDayInput(getDay(date))` produces. The two
-- are held together by a parity test over every date of the seeded month
-- (supabase/tests/rest/zz-ledger-month-timing.test.ts); a change to either side
-- that is not made to the other fails it on the first paisa.
--
-- Everything keys on the explicit `business_date` column except the drawer's
-- word for the date, which asks whether an observation fell inside the date's
-- instants. Those bounds use the day reader's own 04:00 +05:30 cutover, so the
-- month and its days cannot disagree about which date a count belongs to.

create function public.ledger_month_inputs(p_outlet_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first date := date_trunc('month', p_month)::date;
  v_last date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
  v_anchor timestamptz;
  v_result jsonb;
begin
  perform public.ledger_assert_reach(p_outlet_id);

  select min(counted_at) into v_anchor
    from public.drawer_observations
   where outlet_id = p_outlet_id and is_anchor;

  with dates as (
    select d::date as business_date,
           (d::date + time '04:00') at time zone 'Asia/Kolkata' as from_at,
           (d::date + 1 + time '04:00') at time zone 'Asia/Kolkata' as to_at
      from generate_series(v_first, v_last, interval '1 day') as d
  ),
  settled as (
    select b.id, b.business_date, coalesce(b.discount_paise, 0) as discount_paise
      from public.bills b
     where b.outlet_id = p_outlet_id
       and b.status = 'settled'
       and b.business_date between v_first and v_last
  ),
  -- Summed per bill first, and a bill counted only where its total for the
  -- method is positive: exactly the day reader's per-bill map.
  per_bill as (
    select s.id, s.business_date,
           coalesce(sum(e.amount_paise) filter (where e.method = 'cash'), 0) as cash,
           coalesce(sum(e.amount_paise) filter (where e.method = 'upi'), 0) as upi
      from settled s
      join public.effective_bill_payments e on e.bill_id = s.id
     group by s.id, s.business_date
  ),
  takings as (
    select business_date,
           sum(case when cash > 0 then cash else 0 end)::bigint as cash_paise,
           sum(case when upi > 0 then upi else 0 end)::bigint as upi_paise
      from per_bill
     group by business_date
  ),
  discounts as (
    select business_date, sum(discount_paise)::bigint as discount_paise
      from settled
     group by business_date
  ),
  -- Net is null whenever commission is, whatever the row carries: a
  -- provisional net beside an unstated commission lets the reader subtract the
  -- two and discover the charge the page says nobody knows.
  channels as (
    select c.business_date,
           jsonb_agg(
             jsonb_build_object(
               'channel', c.channel,
               'grossPaise', c.revenue_paise,
               'commissionPaise', c.commission_paise,
               'netPaise', case when c.commission_paise is null then null
                                else coalesce(c.net_paise, c.revenue_paise - c.commission_paise) end,
               'asOfAt', coalesce(c.as_of_at, c.updated_at)
             )
             order by c.channel
           ) as channels
      from public.aggregator_channel_days c
     where c.outlet_id = p_outlet_id
       and c.business_date between v_first and v_last
     group by c.business_date
  ),
  -- A note only where the label says more than the category does: `label` is
  -- the description where there is one and the category otherwise.
  expense_lines as (
    select x.business_date,
           jsonb_agg(
             jsonb_build_object(
               'businessDate', x.business_date,
               'category', coalesce(x.category, 'Expense'),
               'note', case when coalesce(x.description, x.category, 'Expense')
                                 = coalesce(x.category, 'Expense') then null
                            else coalesce(x.description, x.category, 'Expense') end,
               'amountPaise', coalesce(x.amount_paise, 0),
               'isCash', coalesce(x.is_cash, false)
             )
             order by coalesce(x.occurred_at, x.created_at), x.id
           ) as expenses
      from public.effective_expenses x
     where x.outlet_id = p_outlet_id
       and x.business_date between v_first and v_last
     group by x.business_date
  )
  select jsonb_agg(
           jsonb_build_object(
             'businessDate', d.business_date,
             'cashPaise', coalesce(t.cash_paise, 0),
             'upiPaise', coalesce(t.upi_paise, 0),
             'discountPaise', coalesce(dc.discount_paise, 0),
             'channels', coalesce(ch.channels, '[]'::jsonb),
             'expenses', coalesce(el.expenses, '[]'::jsonb),
             'drawerState',
               case
                 when v_anchor is null or d.to_at <= v_anchor then 'not-tracked-yet'
                 when exists (
                   select 1 from public.drawer_observations o
                    where o.outlet_id = p_outlet_id
                      and o.counted_at >= d.from_at and o.counted_at < d.to_at
                 ) then 'counted'
                 else 'carried'
               end
           )
           order by d.business_date
         )
    into v_result
    from dates d
    left join takings t on t.business_date = d.business_date
    left join discounts dc on dc.business_date = d.business_date
    left join channels ch on ch.business_date = d.business_date
    left join expense_lines el on el.business_date = d.business_date;

  return v_result;
end $$;

revoke all on function public.ledger_assert_reach(uuid) from public;
revoke all on function public.ledger_drawer_balance_at(uuid, timestamptz) from public;
revoke all on function public.ledger_month_inputs(uuid, date) from public;
grant execute on function public.ledger_assert_reach(uuid) to authenticated;
grant execute on function public.ledger_drawer_balance_at(uuid, timestamptz) to authenticated;
grant execute on function public.ledger_month_inputs(uuid, date) to authenticated;

comment on function public.ledger_drawer_balance_at(uuid, timestamptz) is
  'The drawer balance at an instant, walked from the last observation at or before '
  'it; null before the first. Security definer with an assertion that raises for a '
  'reader the drawer does not admit, so another outlet is refused rather than read '
  'as empty.';

comment on function public.ledger_month_inputs(uuid, date) is
  'One MonthDayInput per date of the month, derived on read from the day reader''s '
  'own sources and held to it by a parity test. Stores nothing. Security definer '
  'with an assertion that raises for a reader the drawer does not admit.';
