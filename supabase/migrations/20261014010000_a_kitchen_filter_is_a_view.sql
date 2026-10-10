-- #72 D7: a kitchen's filter changes its view, not the order. Compare both
-- current and acknowledged food through today's filter; leave the immutable
-- snapshots untouched. Existing caller authority and grants stay in force.

create or replace function public.kitchen_filter_lines(
  p_lines jsonb, p_mode text, p_category_ids uuid[]
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(l.line order by l.position), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
         with ordinality as l(line, position)
    left join public.menu_items mi on mi.id = (l.line ->> 'menuItemId')::uuid
   where public.kitchen_line_visible(mi.category_id, p_mode, p_category_ids)
$$;

revoke execute on function public.kitchen_filter_lines(jsonb, text, uuid[])
  from public, anon, authenticated;

create or replace function public.kitchen_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shift public.counter_shifts%rowtype;
  v_device public.counter_devices%rowtype;
  v_cutover time;
  v_orders jsonb;
begin
  select s.* into v_shift from public.counter_shifts s
   where s.id = public.app_kitchen_shift();
  if not found then
    raise exception 'the kitchen board needs a live kitchen shift' using errcode = '42501';
  end if;
  select * into v_device from public.counter_devices where id = v_shift.device_id;
  select o.business_day_cutover into v_cutover from public.outlets o where o.id = v_shift.outlet_id;

  with candidates as (
    select o.*
      from public.orders o
     where o.outlet_id = v_shift.outlet_id
       -- On the rail and not yet prepared: an order the counter has ticked
       -- Prepared is done in the kitchen, paid or not. Written as the rail's own
       -- predicate plus the preparation, so the planner can prove it against
       -- `orders_pipeline_idx` and never walks an outlet's whole history.
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
       and o.prepared_at is null
    union all
    select o.*
      from public.orders o
     where o.outlet_id = v_shift.outlet_id
       and o.status = 'cancelled'
       and o.business_date in (v_shift.business_date, v_shift.business_date - 1)
       and public.app_business_date(o.cancelled_at, v_cutover) = v_shift.business_date
  ),
  shaped as (
    select c.*,
           public.kitchen_order_version(c::public.orders) as version,
           public.kitchen_visible_lines(c.id, v_device.kitchen_filter_mode,
                                        v_device.kitchen_category_ids) as visible,
           (select count(*) from public.order_items oi
              left join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = c.id and oi.kind = 'item'
               and not public.kitchen_line_visible(mi.category_id,
                     v_device.kitchen_filter_mode, v_device.kitchen_category_ids)
           ) as other_count,
           (select jsonb_build_object('kind', a.kind, 'orderVersion', a.order_version,
                                      'lines', public.kitchen_filter_lines(a.lines, v_device.kitchen_filter_mode,
                                        v_device.kitchen_category_ids), 'ackedAt', a.acked_at)
              from public.kitchen_acknowledgements a
             where a.device_id = v_device.id and a.order_id = c.id
             order by a.acked_at desc, a.id desc limit 1) as latest_ack,
           exists (select 1 from public.kitchen_acknowledgements a
                    where a.device_id = v_device.id and a.order_id = c.id
                      and a.kind = 'new') as acknowledged
      from candidates c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'orderNumber', s.order_number,
           'serviceType', s.service_type,
           'tableNumber', s.table_number,
           'orderedAt', s.ordered_at,
           'version', s.version,
           'status', s.status,
           'cancelledAt', s.cancelled_at,
           'lines', s.visible,
           'otherItemCount', s.other_count,
           'acknowledged', s.acknowledged,
           'latestAck', s.latest_ack)
         order by s.ordered_at, s.id), '[]'::jsonb)
    into v_orders
    from shaped s
   where (jsonb_array_length(s.visible) > 0
          or jsonb_array_length(coalesce(s.latest_ack -> 'lines', '[]'::jsonb)) > 0)
     and not (coalesce(s.latest_ack ->> 'kind', '') = 'cancel'
              and (s.latest_ack ->> 'orderVersion')::timestamptz = s.version
              and (s.status = 'cancelled' or jsonb_array_length(s.visible) = 0));

  return jsonb_build_object(
    'readAt', now(),
    'outletId', v_shift.outlet_id,
    'businessDate', v_shift.business_date,
    'shiftId', v_shift.id,
    -- Who opened this kitchen, as the counter's header names its operator.
    'operatorName', (select p.full_name from public.profiles p where p.id = v_shift.person_id),
    'filterChangedAt', v_device.kitchen_filter_changed_at,
    'filterMode', v_device.kitchen_filter_mode,
    'categoryIds', to_jsonb(v_device.kitchen_category_ids),
    'sort', v_device.kitchen_sort,
    'orders', v_orders);
end;
$$;

create or replace function public.counter_kitchen_marks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outlet uuid := public.app_counter_shift_outlet();
  v_kitchens jsonb;
  v_orders jsonb;
  v_tablets integer;
begin
  if v_outlet is null then
    raise exception 'the kitchen marks need a live counter shift' using errcode = '42501';
  end if;

  with kitchens as (
    select d.id, d.label, d.kitchen_filter_mode, d.kitchen_category_ids,
           row_number() over (order by lower(d.label), d.id) as place
      from public.counter_shifts s
      join public.counter_devices d on d.id = s.device_id
       and d.removed_at is null and d.session_proven_at is not null and d.kind = 'kitchen'
     where s.outlet_id = v_outlet
       and s.kind = 'kitchen'
       and s.ended_at is null
       and s.expires_at > now()
  ),
  rail as (
    -- The rail's own predicate, so the read rides `orders_pipeline_idx`.
    select o.id, o.prepared_at, public.kitchen_order_version(o) as version
      from public.orders o
     where o.outlet_id = v_outlet
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
  ),
  cells as (
    select r.id as order_id, r.prepared_at, r.version, k.place,
           public.kitchen_visible_lines(r.id, k.kitchen_filter_mode, k.kitchen_category_ids)
             as visible,
           latest.kind as latest_kind, latest.order_version as latest_version,
           public.kitchen_filter_lines(latest.lines, k.kitchen_filter_mode,
                                       k.kitchen_category_ids) as latest_lines,
           exists (select 1 from public.kitchen_acknowledgements a
                    where a.device_id = k.id and a.order_id = r.id and a.kind = 'new')
             as acknowledged
      from rail r
     cross join kitchens k
      left join lateral (
        select a.kind, a.order_version, a.lines
          from public.kitchen_acknowledgements a
         where a.device_id = k.id and a.order_id = r.id
         order by a.acked_at desc, a.id desc
         limit 1) latest on true
  ),
  answers as (
    select c.order_id, c.place,
           case
             when not (jsonb_array_length(c.visible) > 0
                       or (jsonb_array_length(coalesce(c.latest_lines, '[]'::jsonb)) > 0
                           and not (c.latest_kind = 'cancel' and c.latest_version = c.version)))
               then null
             when c.prepared_at is not null then 'seen'
             when jsonb_array_length(c.visible) > 0 and c.acknowledged
                  and c.latest_lines is not null
                  and public.kitchen_same_lines(c.visible, c.latest_lines) then 'seen'
             else 'waiting'
           end as answer
      from cells c
  )
  select coalesce(jsonb_agg(jsonb_build_object('orderId', g.order_id, 'marks', g.marks)
                            order by g.order_id), '[]'::jsonb)
    into v_orders
    from (select a.order_id, jsonb_agg(a.answer order by a.place) as marks
            from answers a
           group by a.order_id
          having count(a.answer) > 0) g;

  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'label', k.label) order by k.place),
                  '[]'::jsonb)
    into v_kitchens
    from (select d.id, d.label,
                 row_number() over (order by lower(d.label), d.id) as place
            from public.counter_shifts s
            join public.counter_devices d on d.id = s.device_id
             and d.removed_at is null and d.session_proven_at is not null and d.kind = 'kitchen'
           where s.outlet_id = v_outlet
             and s.kind = 'kitchen'
             and s.ended_at is null
             and s.expires_at > now()) k;

  select count(*) into v_tablets
    from public.counter_devices d
   where d.outlet_id = v_outlet and d.kind = 'kitchen'
     and d.removed_at is null and d.session_proven_at is not null;

  return jsonb_build_object('kitchens', v_kitchens, 'orders', v_orders,
                            'kitchenTablets', v_tablets);
end;
$$;
