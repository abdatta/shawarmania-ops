-- Compact read-only Home queries. Each independently rendered cell has its own
-- request. Explicit authority is checked before SECURITY DEFINER reads; no new
-- table, policy or write path is introduced.
create function public.overview_assert_outlet(p_outlet_id uuid)
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not (coalesce(public.app_is_owner(), false)
      or coalesce(public.app_has_role_at('franchise_admin', p_outlet_id), false)) then
    raise exception 'Overview is not available at this outlet' using errcode = '42501';
  end if;
  if not exists(select 1 from public.outlets where id = p_outlet_id) then
    raise exception 'Outlet not found';
  end if;
end $$;

create function public.overview_sales(p_outlet_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cash bigint; v_upi bigint;
begin
  perform public.overview_assert_outlet(p_outlet_id);
  if p_from is null or p_through is null or p_through < p_from or p_through - p_from > 31 then
    raise exception 'Invalid Overview period';
  end if;
  select coalesce(sum(p.amount_paise) filter(where p.method = 'cash'),0),
         coalesce(sum(p.amount_paise) filter(where p.method = 'upi'),0)
    into v_cash, v_upi
    from public.bills b join public.effective_bill_payments p on p.bill_id = b.id
   where b.outlet_id = p_outlet_id and b.status = 'settled'
     and b.business_date between p_from and p_through;
  return jsonb_build_object('cashPaise', v_cash, 'upiPaise', v_upi);
end $$;

create function public.overview_revenue(p_outlet_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_sales jsonb; v_delivery bigint; v_provisional boolean; v_incomplete boolean; v_has_sales boolean;
begin
  v_sales := public.overview_sales(p_outlet_id, p_from, p_through);
  select coalesce(sum(case when commission_paise is null then revenue_paise
                     else coalesce(net_paise, revenue_paise - commission_paise) end),0),
         coalesce(bool_or(commission_paise is null),false),
         coalesce(bool_or(revenue_paise > 0),false)
    into v_delivery, v_provisional, v_has_sales
    from public.aggregator_channel_days
   where outlet_id = p_outlet_id and business_date between p_from and p_through;
  -- Missing daily rows are not zero orders. Read mappings only to qualify the
  -- aggregate; private restaurant identifiers never leave this function.
  select exists (
    select 1 from public.outlet_channel_restaurants m
    cross join generate_series(p_from::timestamp, p_through::timestamp, interval '1 day') d
    where m.outlet_id = p_outlet_id and m.state = 'enabled'
      and not exists(select 1 from public.aggregator_channel_days c
        where c.outlet_id = p_outlet_id and c.channel = m.channel and c.business_date = d::date)
  ) into v_incomplete;
  return jsonb_build_object(
    'revenuePaise', (v_sales->>'cashPaise')::bigint + (v_sales->>'upiPaise')::bigint + v_delivery,
    'hasSales', v_has_sales or (v_sales->>'cashPaise')::bigint + (v_sales->>'upiPaise')::bigint > 0,
    'provisional', v_provisional, 'incomplete', v_incomplete);
end $$;

create function public.overview_expenses(p_outlet_id uuid, p_from date, p_through date)
returns bigint language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.overview_assert_outlet(p_outlet_id);
  if p_from is null or p_through is null or p_through < p_from or p_through - p_from > 31 then
    raise exception 'Invalid Overview period';
  end if;
  return (select coalesce(sum(amount_paise),0) from public.effective_expenses
    where outlet_id = p_outlet_id and business_date between p_from and p_through);
end $$;

create function public.overview_drawer(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_last public.drawer_observations; v_left bigint; v_spent bigint; v_receipts bigint; v_out bigint;
begin
  perform public.overview_assert_outlet(p_outlet_id);
  select * into v_last from public.drawer_observations where outlet_id = p_outlet_id
    and counted_at <= now() order by counted_at desc limit 1;
  if not found then
    return jsonb_build_object('expectedPaise',null,'leftPaise',null,'spentPaise',0);
  end if;
  v_left := v_last.counted_total_paise - (select coalesce(sum(amount_paise),0)
    from public.drawer_cash_out where observation_id = v_last.id);
  v_spent := public.drawer_cash_expenses_paise(p_outlet_id, v_last.counted_at, now());
  v_receipts := public.drawer_cash_receipts_paise(p_outlet_id, v_last.counted_at, now());
  v_out := public.drawer_cash_out_paise(p_outlet_id, v_last.counted_at, now(), v_last.id);
  return jsonb_build_object('expectedPaise',v_left + v_receipts - v_spent - v_out,
    'leftPaise',v_left,'spentPaise',v_spent);
end $$;

revoke all on function public.overview_assert_outlet(uuid) from public;
revoke all on function public.overview_sales(uuid,date,date) from public;
revoke all on function public.overview_revenue(uuid,date,date) from public;
revoke all on function public.overview_expenses(uuid,date,date) from public;
revoke all on function public.overview_drawer(uuid) from public;
grant execute on function public.overview_sales(uuid,date,date),
  public.overview_revenue(uuid,date,date), public.overview_expenses(uuid,date,date),
  public.overview_drawer(uuid) to authenticated;
