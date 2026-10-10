-- Items follows its measure (owner, 2026-10-10).
--
-- With Revenue chosen, the Items page's Dishes and Categories lists show,
-- rank, compare and filter on dish revenue rather than units, as everything on
-- Sales follows its measure. sales_analytics (#71, 20261012000000) carried a
-- dish's current revenue but not its earlier windows', so each dish now also
-- carries `previousRevenue`, and every dish and category `periodRevenue`: its
-- dish revenue (line total less line discount) in every compared window,
-- current first, at most four integers each. Nothing else changes; the
-- signature, the grant and every other key are as before.

create or replace function public.sales_analytics(
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
             as previous_units,
           coalesce(sum(line_total_paise - discount_paise)
                    filter (where business_date < p_from
                              and business_date >= p_from - v_span), 0) as previous_revenue
      from lines
     group by 1, menu_item_id
  ),
  -- Units per window, window 0 the current one, for each dish and each
  -- captured category: the rows' direction across every compared period.
  item_periods as (
    select coalesce(menu_item_id::text, 'snapshot:' || item_name) as key,
           (p_to - business_date) / v_span as period,
           sum(quantity) as units,
           sum(line_total_paise - discount_paise) as revenue
      from lines group by 1, 2
  ),
  category_periods as (
    select coalesce(category_name, 'Uncategorised') as name,
           (p_to - business_date) / v_span as period,
           sum(quantity) as units,
           sum(line_total_paise - discount_paise) as revenue
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
                                                on u.name = c.name and u.period = w),
                                          'periodRevenue', (
                                            select jsonb_agg(coalesce(u.revenue, 0) order by w)
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
