-- #72 the-counter-sees-the-kitchen.
--
-- The billing tablet's rail shows, per open order, whether each kitchen on
-- shift has pressed ACK on it. The server works the answer out with the
-- kitchen's own rules and hands the counter nothing more than the answer: which
-- of its outlet's kitchen tablets is still waiting on which of its open orders.
-- The counter learns of a change through the same pulse the kitchens listen to.

-- ---------------------------------------------------------------------------
-- 1. The kitchen's "same dishes" rule, in SQL. The client's `sameLines()`
-- (src/domain/kitchen.ts) compares two line lists by dish totals -- quantities
-- summed per menu item, or per name for a line with no menu item -- and this
-- is that comparison, case for case. pgTAP and the domain tests pin the same
-- pairs on both sides.

create or replace function public.kitchen_same_lines(p_left jsonb, p_right jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
      from (select coalesce(l ->> 'menuItemId', 'name:' || (l ->> 'itemName')) as dish,
                   sum((l ->> 'quantity')::integer) as quantity
              from jsonb_array_elements(coalesce(p_left, '[]'::jsonb)) l
             group by 1) a
      full join
           (select coalesce(r ->> 'menuItemId', 'name:' || (r ->> 'itemName')) as dish,
                   sum((r ->> 'quantity')::integer) as quantity
              from jsonb_array_elements(coalesce(p_right, '[]'::jsonb)) r
             group by 1) b
        using (dish)
     where a.quantity is distinct from b.quantity)
$$;

revoke execute on function public.kitchen_same_lines(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The counter's read. One call, a live counter shift, its own outlet:
--
--   kitchens  every kitchen tablet there holding a live kitchen shift, by
--             label then id -- the order the counter draws its dots in;
--   orders    each rail order a kitchen's board carries, with one answer per
--             listed kitchen in that order: 'waiting', 'seen', or null where
--             that kitchen's board does not carry it;
--   kitchenTablets  how many kitchen tablets the outlet has set up, on shift or
--             not -- so the counter can say "Kitchen offline" where a kitchen
--             screen exists and nobody is on it, and say nothing where none does.
--
-- A kitchen "carries" an order exactly when kitchen_board() would: a dish its
-- filter shows, or an acknowledgement with dishes and no cancel at the current
-- version. Its answer is 'seen' exactly when its card would be quiet -- it has
-- acknowledged the order as new and its latest acknowledgement's dishes equal
-- the dishes it shows now -- and 'waiting' when the card would be new, edited
-- or cancelled. An order the counter has ticked Prepared is answered 'seen' by
-- every kitchen that carries it: the food is made.
--
-- No dish, quantity, time or person leaves this function.

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
           latest.lines as latest_lines,
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

revoke execute on function public.counter_kitchen_marks() from public, anon;
grant execute on function public.counter_kitchen_marks() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The pulse now also means "a kitchen's answer may have changed". It is
-- bumped by an ACK, by a kitchen's filter changing what it shows, and by a
-- kitchen shift starting or ending -- each with the row's own outlet, by the
-- same function the order trigger uses.

create trigger kitchen_acknowledgements_bump_kitchen_pulse
  after insert on public.kitchen_acknowledgements
  for each row execute function public.kitchen_pulse_bump();

create trigger counter_devices_bump_kitchen_pulse
  after update of kitchen_filter_mode, kitchen_category_ids on public.counter_devices
  for each row
  when (new.kind = 'kitchen'
        and (old.kitchen_filter_mode is distinct from new.kitchen_filter_mode
             or old.kitchen_category_ids is distinct from new.kitchen_category_ids))
  execute function public.kitchen_pulse_bump();

create trigger counter_shifts_bump_kitchen_pulse_on_start
  after insert on public.counter_shifts
  for each row when (new.kind = 'kitchen')
  execute function public.kitchen_pulse_bump();

create trigger counter_shifts_bump_kitchen_pulse_on_end
  after update of ended_at on public.counter_shifts
  for each row when (new.kind = 'kitchen' and old.ended_at is null and new.ended_at is not null)
  execute function public.kitchen_pulse_bump();

-- ---------------------------------------------------------------------------
-- 4. A counter shift reads its own outlet's pulse. The row is an outlet id and
-- a time.

drop policy kitchen_pulses_select on public.kitchen_pulses;

create policy kitchen_pulses_select on public.kitchen_pulses
  for select to authenticated using (
    public.app_device_ok() and (
      outlet_id = (select public.app_kitchen_shift_outlet())
      or outlet_id = (select public.app_counter_shift_outlet())
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))))));
