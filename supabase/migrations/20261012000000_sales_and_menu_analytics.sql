-- #71 sales-and-menu-analytics.
--
-- One read for the owner's Items and Sales pages: an aggregate over settled
-- bills, never the bills themselves. The Free Plan meters egress, so the shape
-- of the answer is the design:
--
--   * a window is 1-92 days, and the current window plus up to three equal,
--     adjacent earlier ones is all one call may cover (p_periods 1-4);
--   * `items` returns dish and category totals for the current and previous
--     window, their units in every window asked for (at most four numbers
--     each), and one summary row per window -- no daily, hourly or delivery
--     rows;
--   * `sales` returns days, delivery days and period-by-hour totals (at most
--     24 x p_periods rows) and never reads `bill_items`;
--   * no identity, customer field or raw ticket leaves the function.
--
-- `sales_analytics_series` is the Items page's chart: one subject (every dish,
-- one dish or one captured category) as two arrays of daily units and dish
-- revenue, oldest day first, and two of clock-hour totals per window (24 per
-- window, current window first). Read only when the owner picks that subject, so
-- the page never downloads a line per dish per day.
--
-- Revenue is grouped by `business_date` (the order's day, docs/GLOSSARY.md),
-- not `payment_business_date`, which is the drawer's. Dish revenue is the
-- captured line total less its line discount; packaging lines and bill-level
-- discounts are not a dish's. Delivery is the imported gross before
-- commission; a day nobody imported is simply absent, never a zero.
--
-- `security definer`, so the authority check below is the whole gate: it reads
-- current assignments and runs before anything is scanned, and a crafted
-- request for another outlet is refused there rather than filtered to nothing.

create function public.sales_analytics(
  p_outlet_id uuid,
  p_from date,
  p_to date,
  p_view text default 'all',
  p_periods integer default 2
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_span integer;
  v_first date;
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
     or p_periods is null or p_periods not between 1 and 4 then
    raise exception 'Invalid analytics view or period count'
      using errcode = 'invalid_parameter_value';
  end if;

  v_span := p_to - p_from + 1;
  -- The first day of the oldest window asked for.
  v_first := p_from - (p_periods - 1) * v_span;

  with selected as materialized (
    select b.id, b.business_date, b.total_paise, b.discount_paise, b.ordered_at
      from public.bills b
     where b.outlet_id = p_outlet_id
       and b.business_date between v_first and p_to
       and b.status = 'settled'
  ),
  -- Sales never needs a line: the constant filter keeps the join from running.
  lines as materialized (
    select b.id, b.business_date, i.menu_item_id, i.item_name, i.category_name,
           i.quantity, i.line_total_paise, i.discount_paise
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
           coalesce(sum(quantity) filter (where business_date >= p_from), 0) as units,
           coalesce(sum(line_total_paise - discount_paise)
                    filter (where business_date >= p_from), 0) as revenue,
           coalesce(sum(discount_paise) filter (where business_date >= p_from), 0) as discounts,
           count(distinct id) filter (where business_date >= p_from) as orders,
           coalesce(sum(quantity) filter (where business_date < p_from
                                            and business_date >= p_from - v_span), 0)
             as previous_units
      from lines
     group by 1, menu_item_id
  ),
  -- Units per window, window 0 the current one, for each dish and each
  -- captured category: the rows' direction across every compared period.
  item_periods as (
    select coalesce(menu_item_id::text, 'snapshot:' || item_name) as key,
           (p_to - business_date) / v_span as period,
           sum(quantity) as units
      from lines group by 1, 2
  ),
  category_periods as (
    select coalesce(category_name, 'Uncategorised') as name,
           (p_to - business_date) / v_span as period,
           sum(quantity) as units
      from lines group by 1, 2
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
  -- Every date in every window, so a day without a sale is a zero, not a gap.
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
    select case when p_view = 'items' then p_from - ((p_to - date) / v_span) * v_span
                else date end as date,
           sum(revenue) as revenue, sum(orders) as orders,
           sum(units) as units, sum(discounts) as discounts
      from daily
     group by 1
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
                                                on u.name = c.name and u.period = w))
                       order by revenue desc, name)
        from (select coalesce(category_name, 'Uncategorised') as name,
                     coalesce(sum(line_total_paise - discount_paise)
                              filter (where business_date >= p_from), 0) as revenue,
                     coalesce(sum(quantity) filter (where business_date >= p_from), 0) as units,
                     coalesce(sum(line_total_paise - discount_paise)
                              filter (where business_date < p_from
                                        and business_date >= p_from - v_span), 0)
                       as previous_revenue,
                     coalesce(sum(quantity) filter (where business_date < p_from
                                                      and business_date >= p_from - v_span), 0)
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
                                          'previousUnits', previous_units, 'active', active,
                                          'available', available, 'highlighted', highlighted,
                                          'periodUnits', (
                                            select jsonb_agg(coalesce(u.units, 0) order by w)
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
        from (select (p_to - business_date) / v_span as period,
                     extract(hour from ordered_at at time zone 'Asia/Kolkata')::int as hour,
                     count(*) as orders,
                     sum(total_paise) as revenue
                from selected
               group by 1, 2) h), '[]'::jsonb) end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.sales_analytics(uuid, date, date, text, integer) from public, anon;
grant execute on function public.sales_analytics(uuid, date, date, text, integer) to authenticated;

create function public.sales_analytics_series(
  p_outlet_id uuid,
  p_from date,
  p_to date,
  p_periods integer default 2,
  p_item text default null,
  p_category text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_span integer;
  v_first date;
  v_item uuid;
  v_snapshot text;
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
     or (p_item is not null and p_category is not null) then
    raise exception 'Invalid analytics period count or subject'
      using errcode = 'invalid_parameter_value';
  end if;
  -- A dish is its menu id, or `snapshot:<name>` for a line sold without one,
  -- exactly the key `sales_analytics` hands out.
  if p_item like 'snapshot:%' then
    v_snapshot := substr(p_item, 10);
  elsif p_item is not null then
    if p_item !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Unknown dish' using errcode = 'invalid_parameter_value';
    end if;
    v_item := p_item::uuid;
  end if;

  v_span := p_to - p_from + 1;
  v_first := p_from - (p_periods - 1) * v_span;

  with lines as materialized (
    select b.business_date,
           (p_to - b.business_date) / v_span as period,
           extract(hour from b.ordered_at at time zone 'Asia/Kolkata')::int as hour,
           i.quantity,
           i.line_total_paise - i.discount_paise as revenue
      from public.bills b
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
  -- Every Kolkata clock hour of every window, current window first: the bill's
  -- order time, totalled across the window's days, as Sales groups its hours.
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
           'hourRevenue', (select jsonb_agg(revenue order by period, hour) from hours))
    into v_result;

  return v_result;
end;
$$;

revoke all on function public.sales_analytics_series(uuid, date, date, integer, text, text)
  from public, anon;
grant execute on function public.sales_analytics_series(uuid, date, date, integer, text, text)
  to authenticated;
