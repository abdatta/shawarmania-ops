create function public.sales_analytics(p_outlet_id uuid,p_from date,p_to date,p_view text default 'all',p_periods integer default 2)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not (public.app_is_owner() or public.app_has_role_at('franchise_admin',p_outlet_id)) then
    raise exception 'Analytics is available to the owner and outlet managers' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>91 then
    raise exception 'Choose between 1 and 92 days' using errcode='22023';
  end if;
  if p_view is null or p_view not in ('all','items','sales') or p_periods is null or p_periods not between 1 and 4 then
    raise exception 'Invalid analytics view or period count' using errcode='22023';
  end if;
  with selected as materialized (
    select id,business_date,total_paise,discount_paise,ordered_at,status
    from public.bills where outlet_id=p_outlet_id
      and business_date between p_from-(p_periods-1)*(p_to-p_from+1) and p_to and status='settled'
  ), lines as materialized (
    select b.id,b.business_date,i.menu_item_id,i.item_name,i.category_name,i.quantity,
      i.line_total_paise,i.discount_paise
    from selected b join public.bill_items i on i.bill_id=b.id where i.kind='item' and p_view<>'sales'
  ), item_sales as (
    select coalesce(menu_item_id::text,'snapshot:'||item_name) as key,
      menu_item_id, max(item_name) as name,
      case when count(distinct coalesce(category_name,'Uncategorised'))>1 then 'Multiple categories' else coalesce(max(category_name),'Uncategorised') end as category,
      coalesce(sum(quantity) filter(where business_date>=p_from),0) as units,
      coalesce(sum(line_total_paise-discount_paise) filter(where business_date>=p_from),0) as revenue,
      coalesce(sum(discount_paise) filter(where business_date>=p_from),0) as discounts,
      count(distinct id) filter(where business_date>=p_from) as orders,
      coalesce(sum(quantity) filter(where business_date<p_from and business_date>=p_from-(p_to-p_from+1)),0) as previous_units
    from lines group by coalesce(menu_item_id::text,'snapshot:'||item_name),menu_item_id
  ), items as (
    select coalesce(s.key,m.id::text) as key,coalesce(s.name,m.name) as name,
      coalesce(s.category,c.name,'Uncategorised') as category,
      coalesce(s.units,0) as units,coalesce(s.revenue,0) as revenue,
      coalesce(s.discounts,0) as discounts,coalesce(s.orders,0) as orders,
      coalesce(s.previous_units,0) as previous_units,
      coalesce(m.is_active,false) and coalesce(c.is_active,false) as active,
      coalesce(m.is_available,false) as available
    from item_sales s full join public.menu_items m on m.id=s.menu_item_id and m.outlet_id=p_outlet_id
      left join public.menu_categories c on c.id=m.category_id
    where s.key is not null or (m.outlet_id=p_outlet_id and m.is_active and c.is_active)
  ), daily as (
    select d::date as date,
      coalesce(sum(b.total_paise),0) as revenue,count(b.id) as orders,
      coalesce((select sum(l.quantity) from lines l where l.business_date=d::date),0) as units,
      coalesce(sum(b.discount_paise),0) as discounts
    from generate_series((p_from-(p_periods-1)*(p_to-p_from+1))::timestamp,p_to::timestamp,'1 day') d
      left join selected b on b.business_date=d::date group by d
  ), days as (
    select case when p_view='items' then p_from-((p_to-date)/(p_to-p_from+1))*(p_to-p_from+1) else date end as date,
      sum(revenue) as revenue,sum(orders) as orders,sum(units) as units,sum(discounts) as discounts
    from daily group by 1
  )
  select jsonb_build_object(
    'categories',case when p_view='sales' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('name',name,'revenue',revenue,'units',units) order by revenue desc,name) from (select coalesce(category_name,'Uncategorised') as name,sum(line_total_paise-discount_paise) as revenue,sum(quantity) as units from lines where business_date>=p_from group by coalesce(category_name,'Uncategorised')) c),'[]'::jsonb) end,
    'delivery',case when p_view='items' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('date',business_date,'channel',channel,'revenue',revenue_paise,'provisional',settlement_state<>'settled') order by business_date,channel) from public.aggregator_channel_days where outlet_id=p_outlet_id and business_date between p_from-(p_periods-1)*(p_to-p_from+1) and p_to),'[]'::jsonb) end,
    'days',coalesce((select jsonb_agg(jsonb_build_object('date',date,'revenue',revenue,'orders',orders,'units',units,'discounts',discounts) order by date) from days),'[]'::jsonb),
    'items',case when p_view='sales' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('key',key,'name',name,'category',category,'units',units,'revenue',revenue,'discounts',discounts,'orders',orders,'previousUnits',previous_units,'active',active,'available',available,'highlighted',exists(select 1 from public.menu_highlight_items h where h.outlet_id=p_outlet_id and h.item_id::text=items.key)) order by units desc,key) from items),'[]'::jsonb) end,
    'hours',case when p_view='items' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('period',period,'hour',hour,'orders',orders,'revenue',revenue) order by period,hour) from (
      select ((p_to-business_date)/(p_to-p_from+1))::int as period,extract(hour from ordered_at at time zone 'Asia/Kolkata')::int as hour,count(*) as orders,sum(total_paise) as revenue
      from selected group by 1,2) h),'[]'::jsonb) end
  ) into v_result;
  return v_result;
end; $$;
revoke all on function public.sales_analytics(uuid,date,date,text,integer) from public,anon;
grant execute on function public.sales_analytics(uuid,date,date,text,integer) to authenticated;
