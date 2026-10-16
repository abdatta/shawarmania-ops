-- #78 billing-day-at-a-glance
--
-- Two reads, and nothing else: no table, column, policy, trigger or changed
-- function, and no published build calls either. A revert leaves them unused.
--
-- `overview_today_v2` is `overview_today` with one figure more: the open,
-- unpaid orders of the outlet's current business date, summed (design D1). It
-- is not revenue, and paid orders still being cooked are left out because they
-- already are.
--
-- `billing_day_stats` is the Stats tab's whole day (design D3): the day's
-- orders as Placed, Updated, Cancelled and Paid; its kitchen marks as Seen,
-- Ready and two averages; and its bills' cancellations and corrections. It
-- answers whoever `orders_select` lets read the outlet's orders, with the guard
-- `manager_kitchen_marks_v2` uses. No index is added: an outlet-day is a few
-- hundred orders among a few thousand, and an index build would lock the table
-- the counter writes.

create function public.overview_today_v2(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_figures jsonb;
  v_open bigint;
begin
  perform public.overview_assert_outlet(p_outlet_id);
  select public.app_business_date(now(), o.business_day_cutover) into v_today
    from public.outlets o where o.id = p_outlet_id;
  v_figures := public.revenue_figures(p_outlet_id, v_today, v_today);
  select coalesce(sum(o.total_paise), 0)::bigint into v_open
    from public.orders o
   where o.outlet_id = p_outlet_id
     and o.business_date = v_today
     and o.status = 'open';
  return jsonb_build_object(
    'cashPaise', (v_figures->>'cashPaise')::bigint,
    'upiPaise', (v_figures->>'upiPaise')::bigint,
    'deliveryPaise', (v_figures->>'deliveryPaise')::bigint,
    'openPaise', v_open);
end $$;

revoke all on function public.overview_today_v2(uuid) from public, anon;
grant execute on function public.overview_today_v2(uuid) to authenticated;

create function public.billing_day_stats(p_outlet_id uuid, p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_outlet_id is null
     or not public.app_device_ok()
     or not public.app_account_active()
     or not (public.app_is_owner()
             or p_outlet_id in (select public.app_outlets_for('franchise_admin'))) then
    raise exception 'only the owner or this outlet''s managers read its day'
      using errcode = '42501';
  end if;
  if p_business_date is null then
    raise exception 'Choose a day' using errcode = 'invalid_parameter_value';
  end if;

  with day_orders as materialized (
    select o.id, o.status, o.ordered_at, o.created_at, o.prepared_at, o.prepared_source
      from public.orders o
     where o.outlet_id = p_outlet_id and o.business_date = p_business_date
  ),
  revised as (
    -- Accepted revisions, once per order however many there were.
    select count(distinct c.result->>'orderId') as n
      from public.billing_commands c
     where c.outlet_id = p_outlet_id
       and c.command_type = 'revise_order'
       and c.result_category in ('accepted', 'replay')
       and c.received_at >= (select min(created_at) from day_orders)
       and c.result->>'orderId' in (select id::text from day_orders)
  ),
  seen as (
    select count(distinct a.order_id) as n
      from public.kitchen_acknowledgements a
     where a.outlet_id = p_outlet_id
       and a.order_id in (select id from day_orders)
  ),
  ready as materialized (
    -- The last live Ready across the order's kitchens: a mark that is not an
    -- undo and has not been undone.
    select r.order_id, max(r.at) as last_at
      from public.kitchen_readies r
     where r.outlet_id = p_outlet_id
       and r.order_id in (select id from day_orders)
       and r.undoes is null
       and not exists (select 1 from public.kitchen_readies u where u.undoes = r.id)
     group by r.order_id
  ),
  timed as (
    select o.ordered_at, o.prepared_at, o.prepared_source, r.last_at
      from ready r join day_orders o on o.id = r.order_id
     where o.prepared_source is distinct from 'day_change'
  ),
  day_bills as materialized (
    select b.id, b.status, b.void_kind
      from public.bills b
     where b.outlet_id = p_outlet_id and b.business_date = p_business_date
  )
  select jsonb_build_object(
    'placed', (select count(*) from day_orders),
    'updated', (select n from revised),
    'cancelled', (select count(*) from day_orders where status = 'cancelled'),
    'paid', (select count(*) from day_orders where status = 'paid'),
    'seen', (select n from seen),
    'ready', (select count(*) from ready),
    'toReadySeconds', (select round(avg(extract(epoch from last_at - ordered_at)))::bigint
                         from timed where last_at >= ordered_at),
    'handoverSeconds', (select round(avg(extract(epoch from prepared_at - last_at)))::bigint
                          from timed
                         where prepared_source = 'counter' and prepared_at >= last_at),
    'billsCancelled', (select count(*) from day_bills
                        where status = 'void' and coalesce(void_kind, 'manager_void') = 'manager_void'),
    'cancelledAfterPaid', (select count(*) from day_bills where void_kind = 'cancelled_after_paid'),
    'paymentUndone', (select count(*) from day_bills where void_kind = 'counter_unpay'),
    'paymentChanged', (select count(distinct x.bill_id)
                         from public.bill_payment_corrections x
                        where x.outlet_id = p_outlet_id
                          and x.bill_id in (select id from day_bills)))
    into v_result;
  return v_result;
end $$;

revoke all on function public.billing_day_stats(uuid, date) from public, anon;
grant execute on function public.billing_day_stats(uuid, date) to authenticated;
