-- revenue-reads-the-same-everywhere (#76): the change gate that releases it,
-- and the reads its on path calls.
-- change-gate: one-revenue
--
-- One meaning for revenue on Overview, the Ledger and Analytics (design D1):
-- delivery before commission, commission as an expense derived on read, the
-- month through today, and a comparison with the same dates last month up to
-- the same time of day. The on path writes nothing.
--
-- Every function here is new. overview_sales, overview_revenue,
-- overview_expenses, sales_analytics and sales_analytics_series are untouched:
-- the off path and every build published before this one keep calling them.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('one-revenue', 'RV', 'change', 'One revenue',
   'Overview, the Ledger and Analytics count revenue the same way: every sale before commission, commission as an expense, the month through today, and always a comparison with the same dates last month.',
   'Overview counts the month through yesterday with delivery after commission, the Ledger counts delivery after commission, and Analytics offers the last 30 days.',
   'revenue-reads-the-same-everywhere', 76);

-- ── The compared windows, and the time cut (design D3) ─────────────────────
--
-- Every comparison the gate's screens make, in one place. Window 0 is the
-- current one; each earlier window is either the adjacent one of equal length
-- (`equal`) or the same day-of-month span in an earlier month (`month`), its end
-- clamped to that month's length, with a whole month mapping to a whole month.
-- With p_cut = 'now' and a current window ending on the outlet's today, each
-- earlier window's last date is cut at the same time of day it is now, unless
-- its end was clamped (it is then a different date to match). Granted to no
-- role: reached only through the reads below, which check authority first.
create function public.revenue_compared_windows(
  p_outlet_id uuid,
  p_from date,
  p_to date,
  p_periods integer,
  p_align text,
  p_cut text
)
returns table (period integer, w_first date, w_last date, cut_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutover time;
  v_today date;
  v_span integer := p_to - p_from + 1;
  v_whole boolean;
  v_month date;
  v_month_last date;
  v_last date;
  v_clamped boolean;
  k integer;
begin
  select o.business_day_cutover into v_cutover from public.outlets o where o.id = p_outlet_id;
  v_today := public.app_business_date(now(), v_cutover);
  v_whole := extract(day from p_from) = 1
    and p_to = (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
  for k in 0 .. p_periods - 1 loop
    period := k;
    if k = 0 then
      w_first := p_from;
      w_last := p_to;
      v_clamped := false;
    elsif p_align = 'month' then
      v_month := (date_trunc('month', p_from) - make_interval(months => k))::date;
      v_month_last := (v_month + interval '1 month - 1 day')::date;
      if v_whole then
        w_first := v_month;
        w_last := v_month_last;
        v_clamped := extract(day from v_month_last) <> extract(day from p_to);
      else
        w_first := least(v_month + (extract(day from p_from)::integer - 1), v_month_last);
        v_last := v_month + (extract(day from p_to)::integer - 1);
        v_clamped := v_last > v_month_last;
        w_last := least(v_last, v_month_last);
      end if;
    else
      w_first := p_from - k * v_span;
      w_last := p_to - k * v_span;
      v_clamped := false;
    end if;
    cut_at := case
      when k > 0 and p_cut = 'now' and p_to = v_today and not v_clamped then
        public.app_business_day_end(w_last - 1, v_cutover)
          + (now() - public.app_business_day_end(v_today - 1, v_cutover))
    end;
    return next;
  end loop;
end $$;

revoke all on function public.revenue_compared_windows(uuid, date, date, integer, text, text)
  from public, anon, authenticated;

-- ── The figures, on the one definition (design D1) ─────────────────────────
--
-- Revenue is the settled bills' cash and UPI, each bill's tender counted only
-- when positive as the Ledger's month counts it, plus every channel's stated
-- sales before commission. Commission is each stated channel-day's sales less
-- what arrived (the Ledger's net rule read the other way), summed per day; a
-- day not stated yet adds none and is counted as waiting. Expenses are the
-- recorded ones; the reads add commission to them.
--
-- p_cut_at cuts the last date's bills at an instant; p_count_last_delivery
-- says whether the last date's delivery counts (design D3: a cut date's
-- delivery counts only once today's has arrived). Granted to no role.
create function public.revenue_figures(
  p_outlet_id uuid,
  p_from date,
  p_through date,
  p_cut_at timestamptz default null,
  p_count_last_delivery boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with per_bill as (
    select b.id,
           coalesce(sum(e.amount_paise) filter (where e.method = 'cash'), 0) as cash,
           coalesce(sum(e.amount_paise) filter (where e.method = 'upi'), 0) as upi
      from public.bills b
      join public.effective_bill_payments e on e.bill_id = b.id
     where b.outlet_id = p_outlet_id
       and b.status = 'settled'
       and b.business_date between p_from and p_through
       and (p_cut_at is null or b.business_date < p_through or b.ordered_at < p_cut_at)
     group by b.id
  ),
  counter as (
    select coalesce(sum(greatest(cash, 0)), 0)::bigint as cash,
           coalesce(sum(greatest(upi, 0)), 0)::bigint as upi
      from per_bill
  ),
  delivery as (
    select coalesce(sum(c.revenue_paise), 0)::bigint as gross,
           coalesce(sum(c.revenue_paise
                        - coalesce(c.net_paise, c.revenue_paise - c.commission_paise))
                    filter (where c.commission_paise is not null), 0)::bigint as commission,
           count(distinct c.business_date) filter (where c.commission_paise is null) as waiting
      from public.aggregator_channel_days c
     where c.outlet_id = p_outlet_id
       and c.business_date between p_from and p_through
       and (p_count_last_delivery or c.business_date < p_through)
  ),
  spent as (
    select coalesce(sum(x.amount_paise), 0)::bigint as recorded
      from public.effective_expenses x
     where x.outlet_id = p_outlet_id
       and x.business_date between p_from and p_through
  )
  select jsonb_build_object(
           'cashPaise', counter.cash,
           'upiPaise', counter.upi,
           'deliveryPaise', delivery.gross,
           'revenuePaise', counter.cash + counter.upi + delivery.gross,
           'commissionPaise', delivery.commission,
           'waitingDays', delivery.waiting,
           'recordedExpensesPaise', spent.recorded,
           'hasSales', counter.cash + counter.upi + delivery.gross > 0)
    from counter, delivery, spent
$$;

revoke all on function public.revenue_figures(uuid, date, date, timestamptz, boolean)
  from public, anon, authenticated;

-- ── Overview (design D5) ───────────────────────────────────────────────────
--
-- No date is sent: the server's clock and the outlet's cutover decide today,
-- so a phone with a wrong clock cannot ask for another month or another cut.
create function public.overview_today(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_figures jsonb;
begin
  perform public.overview_assert_outlet(p_outlet_id);
  select public.app_business_date(now(), o.business_day_cutover) into v_today
    from public.outlets o where o.id = p_outlet_id;
  v_figures := public.revenue_figures(p_outlet_id, v_today, v_today);
  return jsonb_build_object(
    'cashPaise', (v_figures->>'cashPaise')::bigint,
    'upiPaise', (v_figures->>'upiPaise')::bigint,
    'deliveryPaise', (v_figures->>'deliveryPaise')::bigint);
end $$;

create function public.overview_month(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_from date;
  v_current jsonb;
  v_previous jsonb;
  v_window record;
  v_today_delivery boolean;
  v_commission bigint;
  v_expenses bigint;
begin
  perform public.overview_assert_outlet(p_outlet_id);
  select public.app_business_date(now(), o.business_day_cutover) into v_today
    from public.outlets o where o.id = p_outlet_id;
  v_from := date_trunc('month', v_today)::date;
  v_current := public.revenue_figures(p_outlet_id, v_from, v_today);
  select * into v_window
    from public.revenue_compared_windows(p_outlet_id, v_from, v_today, 2, 'month', 'now') w
   where w.period = 1;
  v_today_delivery := exists (
    select 1 from public.aggregator_channel_days c
     where c.outlet_id = p_outlet_id and c.business_date = v_today);
  v_previous := public.revenue_figures(p_outlet_id, v_window.w_first, v_window.w_last,
    v_window.cut_at, v_window.cut_at is null or v_today_delivery);
  v_commission := (v_current->>'commissionPaise')::bigint;
  v_expenses := (v_current->>'recordedExpensesPaise')::bigint + v_commission;
  return jsonb_build_object(
    'month', to_char(v_from, 'YYYY-MM'),
    'from', v_from,
    'through', v_today,
    'revenuePaise', (v_current->>'revenuePaise')::bigint,
    'cashPaise', (v_current->>'cashPaise')::bigint,
    'upiPaise', (v_current->>'upiPaise')::bigint,
    'deliveryPaise', (v_current->>'deliveryPaise')::bigint,
    'commissionPaise', v_commission,
    'waitingDays', (v_current->>'waitingDays')::integer,
    'recordedExpensesPaise', (v_current->>'recordedExpensesPaise')::bigint,
    'expensesPaise', v_expenses,
    'profitPaise', case when (v_current->>'hasSales')::boolean
                        then (v_current->>'revenuePaise')::bigint - v_expenses end,
    'hasSales', (v_current->>'hasSales')::boolean,
    'previous', jsonb_build_object(
      'from', v_window.w_first,
      'through', v_window.w_last,
      'cutAt', v_window.cut_at,
      'revenuePaise', (v_previous->>'revenuePaise')::bigint,
      'hasSales', (v_previous->>'hasSales')::boolean));
end $$;

revoke all on function public.overview_today(uuid) from public, anon;
revoke all on function public.overview_month(uuid) from public, anon;
grant execute on function public.overview_today(uuid), public.overview_month(uuid)
  to authenticated;

-- ── Analytics (design D7) ──────────────────────────────────────────────────
--
-- sales_analytics (as of 20261013000000_items_follow_their_measure) with its
-- windows taken from revenue_compared_windows: `month` aligns Sales' Month,
-- and a bill's period is the window it falls in rather than an equal-span
-- division, because month windows differ in length. Comparison figures are
-- cut (each dish's and category's previous and per-period figures, and the new
-- `totals`); days, hours and delivery stay whole, because a chart point is a
-- reading of its date. `cutAt` is the first earlier window's cut, for words.
create function public.sales_analytics_v2(
  p_outlet_id uuid,
  p_from date,
  p_to date,
  p_view text default 'all',
  p_periods integer default 2,
  p_align text default 'equal',
  p_cut text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first date;
  v_cut_at timestamptz;
  v_today_delivery boolean;
  v_result jsonb;
begin
  if auth.uid() is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet_id)) then
    raise exception 'Analytics is available to the owner and outlet managers'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'Choose between 1 and 92 days' using errcode = 'invalid_parameter_value';
  end if;
  if p_view is null or p_view not in ('all', 'items', 'sales')
     or p_periods is null or p_periods not between 1 and 4
     or p_align is null or p_align not in ('equal', 'month')
     or (p_cut is not null and p_cut <> 'now')
     or (p_align = 'month' and date_trunc('month', p_from) <> date_trunc('month', p_to)) then
    raise exception 'Invalid analytics view, period count, alignment or cut'
      using errcode = 'invalid_parameter_value';
  end if;

  select min(w.w_first) into v_first
    from public.revenue_compared_windows(p_outlet_id, p_from, p_to, p_periods, p_align, p_cut) w;
  select w.cut_at into v_cut_at
    from public.revenue_compared_windows(p_outlet_id, p_from, p_to, p_periods, p_align, p_cut) w
   where w.period = 1;
  v_today_delivery := exists (
    select 1 from public.aggregator_channel_days c
     where c.outlet_id = p_outlet_id and c.business_date = p_to);

  with windows as materialized (
    select * from public.revenue_compared_windows(
      p_outlet_id, p_from, p_to, p_periods, p_align, p_cut)
  ),
  selected as materialized (
    select b.id, b.business_date, b.total_paise, b.discount_paise, b.ordered_at, w.period,
           -- Counts toward comparison figures: inside a window, and before its cut.
           (w.period is not null
            and (w.cut_at is null or b.business_date < w.w_last or b.ordered_at < w.cut_at))
             as compared
      from public.bills b
      left join windows w on b.business_date between w.w_first and w.w_last
     where b.outlet_id = p_outlet_id
       and b.business_date between v_first and p_to
       and b.status = 'settled'
  ),
  -- Sales never needs a line: the constant filter keeps the join from running.
  lines as materialized (
    select b.id, b.business_date, b.period, b.compared, i.menu_item_id, i.item_name,
           i.category_name, i.quantity, i.line_total_paise, i.discount_paise
      from selected b
      join public.bill_items i on i.bill_id = b.id
     where i.kind = 'item'
       and p_view <> 'sales'
  ),
  item_sales as (
    select coalesce(menu_item_id::text, 'snapshot:' || item_name) as key,
           menu_item_id,
           max(item_name) as name,
           case when count(distinct coalesce(category_name, 'Uncategorised')) > 1
                then 'Multiple categories'
                else coalesce(max(category_name), 'Uncategorised') end as category,
           coalesce(sum(quantity) filter (where period = 0), 0) as units,
           coalesce(sum(line_total_paise - discount_paise) filter (where period = 0), 0)
             as revenue,
           coalesce(sum(discount_paise) filter (where period = 0), 0) as discounts,
           count(distinct id) filter (where period = 0) as orders,
           coalesce(sum(quantity) filter (where period = 1 and compared), 0) as previous_units,
           coalesce(sum(line_total_paise - discount_paise)
                    filter (where period = 1 and compared), 0) as previous_revenue
      from lines
     group by 1, menu_item_id
  ),
  item_periods as (
    select coalesce(menu_item_id::text, 'snapshot:' || item_name) as key, period,
           sum(quantity) as units,
           sum(line_total_paise - discount_paise) as revenue
      from lines where compared group by 1, 2
  ),
  category_periods as (
    select coalesce(category_name, 'Uncategorised') as name, period,
           sum(quantity) as units,
           sum(line_total_paise - discount_paise) as revenue
      from lines where compared group by 1, 2
  ),
  -- Every dish sold in range, plus every active dish that sold nothing.
  items as (
    select coalesce(s.key, m.id::text) as key,
           coalesce(m.name, s.name) as name,
           coalesce(s.category, c.name, 'Uncategorised') as category,
           coalesce(s.units, 0) as units,
           coalesce(s.revenue, 0) as revenue,
           coalesce(s.discounts, 0) as discounts,
           coalesce(s.orders, 0) as orders,
           coalesce(s.previous_units, 0) as previous_units,
           coalesce(s.previous_revenue, 0) as previous_revenue,
           coalesce(m.is_active and c.is_active, false) as active,
           coalesce(m.is_available, false) as available,
           h.item_id is not null as highlighted
      from item_sales s
      full join (select * from public.menu_items where outlet_id = p_outlet_id) m
        on m.id = s.menu_item_id
      left join public.menu_categories c on c.id = m.category_id
      left join public.menu_highlight_items h
        on h.outlet_id = p_outlet_id and h.item_id = coalesce(m.id, s.menu_item_id)
     where s.key is not null or (m.is_active and c.is_active)
  ),
  line_days as (
    select business_date, sum(quantity) as units from lines group by business_date
  ),
  bill_days as (
    select business_date, sum(total_paise) as revenue, count(*) as orders,
           sum(discount_paise) as discounts
      from selected group by business_date
  ),
  -- Every date from the oldest window's first, so a day without a sale is a
  -- zero, not a gap.
  daily as (
    select d::date as date,
           coalesce(b.revenue, 0) as revenue,
           coalesce(b.orders, 0) as orders,
           coalesce(l.units, 0) as units,
           coalesce(b.discounts, 0) as discounts
      from generate_series(v_first::timestamp, p_to::timestamp, interval '1 day') d
      left join bill_days b on b.business_date = d::date
      left join line_days l on l.business_date = d::date
  ),
  -- Items collapses each window into one row dated by the window's first day.
  days as (
    select case when p_view = 'items' then w.w_first else d.date end as date,
           sum(d.revenue) as revenue, sum(d.orders) as orders,
           sum(d.units) as units, sum(d.discounts) as discounts
      from daily d
      left join windows w on d.date between w.w_first and w.w_last
     where p_view <> 'items' or w.period is not null
     group by 1
  ),
  totals as (
    select w.period,
           coalesce((select sum(s.total_paise) from selected s
                      where s.period = w.period and s.compared), 0) as counter,
           coalesce((select sum(c.revenue_paise) from public.aggregator_channel_days c
                      where c.outlet_id = p_outlet_id
                        and c.business_date between w.w_first and w.w_last
                        and (w.cut_at is null or c.business_date < w.w_last
                             or v_today_delivery)), 0) as delivery,
           (select count(*) from selected s where s.period = w.period and s.compared) as orders
      from windows w
  )
  select jsonb_build_object(
    'categories', case when p_view = 'sales' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'revenue', revenue, 'units', units,
                                          'previousRevenue', previous_revenue,
                                          'previousUnits', previous_units,
                                          'periodUnits', (
                                            select jsonb_agg(coalesce(u.units, 0) order by w)
                                              from generate_series(0, p_periods - 1) w
                                              left join category_periods u
                                                on u.name = c.name and u.period = w),
                                          'periodRevenue', (
                                            select jsonb_agg(coalesce(u.revenue, 0) order by w)
                                              from generate_series(0, p_periods - 1) w
                                              left join category_periods u
                                                on u.name = c.name and u.period = w))
                       order by revenue desc, name)
        from (select coalesce(category_name, 'Uncategorised') as name,
                     coalesce(sum(line_total_paise - discount_paise)
                              filter (where period = 0), 0) as revenue,
                     coalesce(sum(quantity) filter (where period = 0), 0) as units,
                     coalesce(sum(line_total_paise - discount_paise)
                              filter (where period = 1 and compared), 0) as previous_revenue,
                     coalesce(sum(quantity) filter (where period = 1 and compared), 0)
                       as previous_units
                from lines
               group by 1) c), '[]'::jsonb) end,
    'delivery', case when p_view = 'items' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('date', business_date, 'channel', channel,
                                          'revenue', revenue_paise,
                                          'provisional', settlement_state <> 'settled')
                       order by business_date, channel)
        from public.aggregator_channel_days
       where outlet_id = p_outlet_id
         and business_date between v_first and p_to), '[]'::jsonb) end,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', date, 'revenue', revenue, 'orders', orders,
                                          'units', units, 'discounts', discounts)
                       order by date)
        from days), '[]'::jsonb),
    'items', case when p_view = 'sales' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'name', name, 'category', category,
                                          'units', units, 'revenue', revenue,
                                          'discounts', discounts, 'orders', orders,
                                          'previousUnits', previous_units,
                                          'previousRevenue', previous_revenue, 'active', active,
                                          'available', available, 'highlighted', highlighted,
                                          'periodUnits', (
                                            select jsonb_agg(coalesce(u.units, 0) order by w)
                                              from generate_series(0, p_periods - 1) w
                                              left join item_periods u
                                                on u.key = items.key and u.period = w),
                                          'periodRevenue', (
                                            select jsonb_agg(coalesce(u.revenue, 0) order by w)
                                              from generate_series(0, p_periods - 1) w
                                              left join item_periods u
                                                on u.key = items.key and u.period = w))
                       order by units desc, key)
        from items), '[]'::jsonb) end,
    -- Kolkata clock hour of the order, per window: period 0 is the current one.
    'hours', case when p_view = 'items' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('period', period, 'hour', hour,
                                          'orders', orders, 'revenue', revenue)
                       order by period, hour)
        from (select period,
                     extract(hour from ordered_at at time zone 'Asia/Kolkata')::int as hour,
                     count(*) as orders,
                     sum(total_paise) as revenue
                from selected
               where period is not null
               group by 1, 2) h), '[]'::jsonb) end,
    'totals', (select jsonb_agg(jsonb_build_object('period', period, 'counter', counter,
                                                   'delivery', delivery, 'orders', orders)
                                order by period)
                 from totals),
    'cutAt', v_cut_at
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.sales_analytics_v2(uuid, date, date, text, integer, text, text)
  from public, anon;
grant execute on function public.sales_analytics_v2(uuid, date, date, text, integer, text, text)
  to authenticated;

-- sales_analytics_series with each window's comparison totals: its items and
-- dish revenue, cut as above, for Items' headline. The arrays stay whole.
create function public.sales_analytics_series_v2(
  p_outlet_id uuid,
  p_from date,
  p_to date,
  p_periods integer default 2,
  p_item text default null,
  p_category text default null,
  p_cut text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first date;
  v_item uuid;
  v_snapshot text;
  v_cut_at timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet_id)) then
    raise exception 'Analytics is available to the owner and outlet managers'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'Choose between 1 and 92 days' using errcode = 'invalid_parameter_value';
  end if;
  if p_periods is null or p_periods not between 1 and 4
     or (p_item is not null and p_category is not null)
     or (p_cut is not null and p_cut <> 'now') then
    raise exception 'Invalid analytics period count, subject or cut'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_item like 'snapshot:%' then
    v_snapshot := substr(p_item, 10);
  elsif p_item is not null then
    if p_item !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Unknown dish' using errcode = 'invalid_parameter_value';
    end if;
    v_item := p_item::uuid;
  end if;

  select min(w.w_first) into v_first
    from public.revenue_compared_windows(p_outlet_id, p_from, p_to, p_periods, 'equal', p_cut) w;
  select w.cut_at into v_cut_at
    from public.revenue_compared_windows(p_outlet_id, p_from, p_to, p_periods, 'equal', p_cut) w
   where w.period = 1;

  with windows as materialized (
    select * from public.revenue_compared_windows(
      p_outlet_id, p_from, p_to, p_periods, 'equal', p_cut)
  ),
  lines as materialized (
    select b.business_date,
           w.period,
           (w.cut_at is null or b.business_date < w.w_last or b.ordered_at < w.cut_at)
             as compared,
           extract(hour from b.ordered_at at time zone 'Asia/Kolkata')::int as hour,
           i.quantity,
           i.line_total_paise - i.discount_paise as revenue
      from public.bills b
      join windows w on b.business_date between w.w_first and w.w_last
      join public.bill_items i on i.bill_id = b.id
     where b.outlet_id = p_outlet_id
       and b.business_date between v_first and p_to
       and b.status = 'settled'
       and i.kind = 'item'
       and (v_item is null or i.menu_item_id = v_item)
       and (v_snapshot is null or (i.menu_item_id is null and i.item_name = v_snapshot))
       and (p_category is null or coalesce(i.category_name, 'Uncategorised') = p_category)
  ),
  per_day as (
    select business_date, sum(quantity) as units, sum(revenue) as revenue
      from lines group by business_date
  ),
  per_hour as (
    select period, hour, sum(quantity) as units, sum(revenue) as revenue
      from lines group by period, hour
  ),
  hours as (
    select p.period, h.hour, coalesce(x.units, 0) as units, coalesce(x.revenue, 0) as revenue
      from generate_series(0, p_periods - 1) p(period)
     cross join generate_series(0, 23) h(hour)
      left join per_hour x on x.period = p.period and x.hour = h.hour
  )
  select jsonb_build_object(
           'from', v_first,
           'units', (select jsonb_agg(coalesce(p.units, 0) order by d)
                       from generate_series(v_first::timestamp, p_to::timestamp, interval '1 day') d
                       left join per_day p on p.business_date = d::date),
           'revenue', (select jsonb_agg(coalesce(p.revenue, 0) order by d)
                         from generate_series(v_first::timestamp, p_to::timestamp, interval '1 day') d
                         left join per_day p on p.business_date = d::date),
           'hourUnits', (select jsonb_agg(units order by period, hour) from hours),
           'hourRevenue', (select jsonb_agg(revenue order by period, hour) from hours),
           'totals', (select jsonb_agg(jsonb_build_object(
                                'units', coalesce((select sum(l.quantity) from lines l
                                                    where l.period = w.period and l.compared), 0),
                                'revenue', coalesce((select sum(l.revenue) from lines l
                                                      where l.period = w.period and l.compared), 0))
                              order by w.period)
                        from windows w),
           'cutAt', v_cut_at)
    into v_result;

  return v_result;
end;
$$;

revoke all on function public.sales_analytics_series_v2(uuid, date, date, integer, text, text, text)
  from public, anon;
grant execute on function public.sales_analytics_series_v2(uuid, date, date, integer, text, text, text)
  to authenticated;
