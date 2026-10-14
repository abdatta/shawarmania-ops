-- change-gate: dish-ticks
--
-- #74: the owner's Orders tab reads what the counter reads of its kitchens
-- (each-dish-is-ticked-off, design R11).
--
-- Only adds. `manager_kitchen_marks_v2` is `counter_kitchen_marks_v2` for an
-- outlet named by the caller instead of the counter shift's: the same rail, the
-- same per-kitchen states, ready quantities and kitchens, so the owner sees what
-- the biller sees. One thing more, which the counter has no room to show: each
-- dish the kitchens have acknowledged, so the owner reads a dish as placed,
-- acknowledged, Done or handed over (owner, 2026-10-14). It answers the owner
-- and that outlet's franchise admins,
-- exactly those `orders_select` lets read the orders, and refuses everyone
-- else. Read once when the Orders tab opens, and only with `dish-ticks` on; no
-- published build calls it.

create function public.manager_kitchen_marks_v2(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outlet uuid := p_outlet_id;
  v_kitchens jsonb;
  v_orders jsonb;
  v_tablets integer;
  v_acked jsonb;
begin
  -- Who may read an outlet's orders may read its kitchens' marks: the owner,
  -- and that outlet's franchise admins (as `orders_select`). No counter shift.
  if v_outlet is null
     or not public.app_device_ok()
     or not public.app_account_active()
     or not (public.app_is_owner()
             or v_outlet in (select public.app_outlets_for('franchise_admin'))) then
    raise exception 'only the owner or this outlet''s managers read its kitchens'
      using errcode = '42501';
  end if;

  with kitchens as (
    select d as dev, row_number() over (order by lower(d.label), d.id) as place
      from public.counter_shifts s
      join public.counter_devices d on d.id = s.device_id
       and d.removed_at is null and d.session_proven_at is not null and d.kind = 'kitchen'
     where s.outlet_id = v_outlet
       and s.kind = 'kitchen'
       and s.ended_at is null
       and s.expires_at > now()
  ),
  rail as materialized (
    -- The rail's own predicate, so the read rides `orders_pipeline_idx`.
    select o as ord, o.id, public.dish_lines_v2(o.id) as dish_lines
      from public.orders o
     where o.outlet_id = v_outlet
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
  ),
  cells as materialized (
    select r.id as order_id, k.place,
           public.kitchen_owed_v2(
             (select coalesce(jsonb_agg(l || jsonb_build_object('ready', 0)), '[]'::jsonb)
                from jsonb_array_elements(r.dish_lines) l),
             (k.dev).kitchen_filter_mode, (k.dev).kitchen_category_ids) as untouched,
           exists (select 1 from jsonb_array_elements(r.dish_lines) l
                    where public.kitchen_line_visible(nullif(l ->> 'categoryId', '')::uuid,
                                                      (k.dev).kitchen_filter_mode,
                                                      (k.dev).kitchen_category_ids)) as carries,
           -- A ticket needs food this kitchen shows or an acknowledgement to
           -- compare with; without either there is none to work out.
           case when (r.ord).prepared_at is null
                 and (exists (select 1 from jsonb_array_elements(r.dish_lines) l
                               where public.kitchen_line_visible(nullif(l ->> 'categoryId', '')::uuid,
                                                                 (k.dev).kitchen_filter_mode,
                                                                 (k.dev).kitchen_category_ids))
                      or exists (select 1 from public.kitchen_acknowledgements a
                                  where a.device_id = (k.dev).id and a.order_id = r.id))
                then public.kitchen_ticket_v2(r.ord, k.dev, r.dish_lines) end as ticket,
           -- Receipts only where this kitchen has marked the order Ready at all.
           case when exists (select 1 from public.kitchen_readies x
                              where x.order_id = r.id and x.device_id = (k.dev).id
                                and x.undoes is null)
                then exists (select 1 from public.kitchen_receipts_v2(r.id, (k.dev).id, r.dish_lines) x
                              where jsonb_array_length(x.lines) > 0)
                else false end as has_ready
      from rail r
     cross join kitchens k
  ),
  states as (
    select c.order_id, c.place,
           case
             when not c.carries and c.ticket is null and not c.has_ready then null
             when c.has_ready then 'ready'
             when c.carries and jsonb_array_length(c.untouched) = 0 then 'handed_over'
             when c.ticket is null then 'handed_over'
             when (c.ticket ->> 'acknowledged')::boolean
                  and public.kitchen_same_lines_v2(c.ticket -> 'lines',
                                                   c.ticket -> 'latestAck' -> 'lines')
               then 'acknowledged'
             else 'sent'
           end as state
      from cells c
  ),
  -- A dish is acknowledged when every kitchen still owing it has acknowledged at
  -- least what it owes: the line in that kitchen's ticket, and in its latest ACK.
  -- A dish no kitchen owes is Done, handed over or carried by none on shift.
  dish_acks as (
    select c.order_id, l ->> 'id' as line_id,
           bool_and(
             coalesce((c.ticket ->> 'acknowledged')::boolean, false)
             and exists (
               select 1 from jsonb_array_elements(coalesce(c.ticket -> 'latestAck' -> 'lines',
                                                           '[]'::jsonb)) a
                where a ->> 'id' = l ->> 'id'
                  and (a ->> 'quantity')::integer >= (l ->> 'quantity')::integer)) as acked
      from cells c
     cross join jsonb_array_elements(coalesce(c.ticket -> 'lines', '[]'::jsonb)) l
     group by c.order_id, l ->> 'id'
  )
  select (select coalesce(jsonb_agg(jsonb_build_object(
           'orderId', g.order_id, 'marks', g.marks, 'dishStates', g.states,
           'readyQuantities', (
             select coalesce(jsonb_object_agg(l ->> 'id', (l ->> 'ready')::integer), '{}'::jsonb)
               from rail r cross join jsonb_array_elements(r.dish_lines) l
              where r.id = g.order_id))
         order by g.order_id), '[]'::jsonb)
    from (select s.order_id,
                 jsonb_agg(s.state order by s.place) as states,
                 jsonb_agg(case when s.state is null then null
                                when s.state = 'sent' then 'waiting'
                                else 'seen' end order by s.place) as marks
            from states s
           group by s.order_id
          having count(s.state) > 0) g),
         (select coalesce(jsonb_object_agg(a.order_id, a.lines), '{}'::jsonb)
            from (select d.order_id, jsonb_agg(d.line_id order by d.line_id) as lines
                    from dish_acks d
                   where d.acked
                   group by d.order_id) a)
    into v_orders, v_acked;

  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'label', k.label) order by k.place),
                  '[]'::jsonb)
    into v_kitchens
    from (select d.id, d.label, row_number() over (order by lower(d.label), d.id) as place
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
                            'kitchenTablets', v_tablets, 'ackedLines', v_acked);
end;
$$;

revoke execute on function public.manager_kitchen_marks_v2(uuid) from public, anon;
grant execute on function public.manager_kitchen_marks_v2(uuid) to authenticated;
