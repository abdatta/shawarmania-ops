-- #74: narrow kitchen projections, append-only Ready/Undo and silent handover.

create function public.kitchen_ready(p_id uuid,p_order_id uuid,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.counter_shifts%rowtype; d public.counter_devices%rowtype;
  o public.orders%rowtype; held public.kitchen_readies%rowtype; l jsonb; ids uuid[]:='{}'; lid uuid;
begin
  select * into s from public.counter_shifts where id=public.app_kitchen_shift();
  if not found then return jsonb_build_object('status','not_authorised'); end if;
  begin
    if p_id is null or p_order_id is null or jsonb_typeof(p_lines) is distinct from 'array'
      or jsonb_array_length(p_lines)=0 then raise exception 'shape'; end if;
    for l in select value from jsonb_array_elements(p_lines) loop
      if not public.billing_payload_has_keys(l,array['id','quantity'])
        or jsonb_typeof(l->'id') is distinct from 'string'
        or jsonb_typeof(l->'quantity') is distinct from 'number'
        or (l->>'quantity') !~ '^[0-9]+$'
        or (l->>'quantity')::integer<=0 then raise exception 'shape'; end if;
      lid:=(l->>'id')::uuid;
      if lid=any(ids) then raise exception 'duplicate'; end if;
      ids:=array_append(ids,lid);
    end loop;
  exception when others then return jsonb_build_object('status','invalid'); end;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,74));
  select * into held from public.kitchen_readies where id=p_id;
  if found then
    if held.device_id=s.device_id and held.order_id=p_order_id and held.lines=p_lines
      and held.undoes is null then return jsonb_build_object('status','accepted','replay',true); end if;
    return jsonb_build_object('status','identity_conflict');
  end if;
  select * into o from public.orders where id=p_order_id and outlet_id=s.outlet_id for update;
  if not found then return jsonb_build_object('status','not_authorised'); end if;
  if o.status='cancelled' or (o.status='paid' and o.prepared_at is not null) then
    return jsonb_build_object('status','invalid'); end if;
  select * into d from public.counter_devices where id=s.device_id;
  -- A stale quantity is what was made, even if the counter lowered it meanwhile.
  -- Every captured identity must still belong to this order and current filter.
  if exists(select 1 from unnest(ids) requested(id) left join public.order_items i on i.id=requested.id
      left join public.menu_items mi on mi.id=i.menu_item_id
      where i.id is null or i.order_id<>o.id or i.kind<>'item'
        or not public.kitchen_line_visible(mi.category_id,d.kitchen_filter_mode,d.kitchen_category_ids)) then
    return jsonb_build_object('status','not_authorised'); end if;
  insert into public.kitchen_readies(id,outlet_id,device_id,shift_id,person_id,order_id,lines)
    values(p_id,s.outlet_id,s.device_id,s.id,s.person_id,o.id,p_lines);
  insert into public.kitchen_pulses(outlet_id,bumped_at) values(s.outlet_id,clock_timestamp())
    on conflict(outlet_id) do update set bumped_at=excluded.bumped_at;
  return jsonb_build_object('status','accepted');
end;
$$;

create function public.kitchen_ready_undo(p_id uuid,p_ready_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.counter_shifts%rowtype; r public.kitchen_readies%rowtype;
  held public.kitchen_readies%rowtype;
begin
  select * into s from public.counter_shifts where id=public.app_kitchen_shift();
  if not found then return jsonb_build_object('status','not_authorised'); end if;
  if p_id is null or p_ready_id is null then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,74));
  select * into held from public.kitchen_readies where id=p_id;
  if found then
    if held.device_id=s.device_id and held.undoes=p_ready_id then
      return jsonb_build_object('status','accepted','replay',true); end if;
    return jsonb_build_object('status','identity_conflict');
  end if;
  select * into r from public.kitchen_readies where id=p_ready_id for update;
  if not found or r.device_id<>s.device_id or r.outlet_id<>s.outlet_id or r.undoes is not null then
    return jsonb_build_object('status','not_authorised'); end if;
  -- No time window. One Undo is sufficient even if another tap raced it.
  if exists(select 1 from public.kitchen_readies where undoes=r.id) then
    return jsonb_build_object('status','accepted'); end if;
  insert into public.kitchen_readies(id,outlet_id,device_id,shift_id,person_id,order_id,lines,undoes)
    values(p_id,s.outlet_id,s.device_id,s.id,s.person_id,r.order_id,'[]',r.id);
  insert into public.kitchen_pulses(outlet_id,bumped_at) values(s.outlet_id,clock_timestamp())
    on conflict(outlet_id) do update set bumped_at=excluded.bumped_at;
  return jsonb_build_object('status','accepted');
end;
$$;
revoke execute on function public.kitchen_ready(uuid,uuid,jsonb),public.kitchen_ready_undo(uuid,uuid) from public,anon;
grant execute on function public.kitchen_ready(uuid,uuid,jsonb),public.kitchen_ready_undo(uuid,uuid) to authenticated;

-- All visible lines are narrow snapshots, never order labels, customers or money.
create or replace function public.kitchen_visible_lines(p_order_id uuid,p_mode text,p_category_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'menuItemId',i.menu_item_id,
    'itemName',i.item_name,'quantity',i.quantity,'note',i.note) order by i.item_name,i.id),'[]'::jsonb)
  from public.order_items i left join public.menu_items m on m.id=i.menu_item_id
  where i.order_id=p_order_id and i.kind='item'
    and public.kitchen_line_visible(m.category_id,p_mode,p_category_ids)
$$;

-- Subtract handover from acknowledged snapshots too: a counter tick must never
-- masquerade as a kitchen edit. Removed lines remain until acknowledged.
create function public.kitchen_owed_lines(p_lines jsonb,p_ready boolean default true)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(l || jsonb_build_object('quantity',owed) order by pos),'[]'::jsonb)
  from (select l,pos,greatest(0,(l->>'quantity')::integer-greatest(
    coalesce(p.quantity,0),case when p_ready then coalesce(public.dish_ready_quantity((l->>'id')::uuid),0) else 0 end)) owed
    from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) with ordinality x(l,pos)
    left join public.order_line_preparations p on p.order_item_id=(l->>'id')::uuid) q
  where owed>0
$$;

create or replace function public.kitchen_same_lines(p_left jsonb,p_right jsonb)
returns boolean language sql immutable set search_path='' as $$
  select not exists(select 1 from
    (select coalesce(l->>'menuItemId','name:'||(l->>'itemName')) dish,
      coalesce(l->>'note','') note,sum((l->>'quantity')::integer) quantity
      from jsonb_array_elements(coalesce(p_left,'[]'::jsonb)) l group by 1,2) a
    full join (select coalesce(l->>'menuItemId','name:'||(l->>'itemName')) dish,
      coalesce(l->>'note','') note,sum((l->>'quantity')::integer) quantity
      from jsonb_array_elements(coalesce(p_right,'[]'::jsonb)) l group by 1,2) b using(dish,note)
    where a.quantity is distinct from b.quantity)
$$;

-- Shared by board and marks: judgement through today's filter and since Ready.
create function public.kitchen_ticket(p_order uuid,p_device uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.counter_devices%rowtype; o public.orders%rowtype;
  since timestamptz; ack public.kitchen_acknowledgements%rowtype;
  visible jsonb; before_lines jsonb; ticket integer; answered boolean;
begin
  select * into d from public.counter_devices where id=p_device;
  select * into o from public.orders where id=p_order;
  select max(r.at),count(*)+1 into since,ticket from public.kitchen_readies r
    where r.order_id=p_order and r.device_id=p_device and r.undoes is null
      and not exists(select 1 from public.kitchen_readies u where u.undoes=r.id);
  visible:=public.kitchen_owed_lines(public.kitchen_visible_lines(p_order,d.kitchen_filter_mode,d.kitchen_category_ids));
  select * into ack from public.kitchen_acknowledgements a
    where a.order_id=p_order and a.device_id=p_device and (since is null or a.acked_at>since)
    order by a.acked_at desc,a.id desc limit 1;
  before_lines:=public.kitchen_owed_lines(public.kitchen_filter_lines(ack.lines,d.kitchen_filter_mode,d.kitchen_category_ids),false);
  answered:=exists(select 1 from public.kitchen_acknowledgements a
    where a.order_id=p_order and a.device_id=p_device and a.kind='new' and (since is null or a.acked_at>since));
  if jsonb_array_length(visible)=0 and jsonb_array_length(before_lines)=0 then return null; end if;
  if ack.kind='cancel' and ack.order_version=public.kitchen_order_version(o)
    and (o.status='cancelled' or jsonb_array_length(visible)=0) then return null; end if;
  return jsonb_build_object('id',o.id,'orderNumber',o.order_number,'serviceType',o.service_type,
    'tableNumber',o.table_number,'orderedAt',o.ordered_at,'version',public.kitchen_order_version(o),
    'status',o.status,'cancelledAt',o.cancelled_at,'lines',visible,'ticketNumber',ticket,
    'otherItemCount',(select count(*) from public.order_items i left join public.menu_items m on m.id=i.menu_item_id
      where i.order_id=o.id and i.kind='item' and not public.kitchen_line_visible(m.category_id,d.kitchen_filter_mode,d.kitchen_category_ids)),
    'acknowledged',answered,'latestAck',case when ack.id is not null then
      jsonb_build_object('kind',ack.kind,'orderVersion',ack.order_version,'lines',before_lines,'ackedAt',ack.acked_at) end);
end;
$$;

-- Older receipts consume handover first. Keep their captured quantities capped
-- to the surviving line, without using the kitchen's current filter to rewrite
-- food it already made.
create function public.kitchen_done_lines(p_ready uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with captured as (
    select r.id,r.at,l,(l->>'quantity')::integer amount,
      coalesce(sum((l->>'quantity')::integer) over(partition by l->>'id' order by r.at,r.id
        rows between unbounded preceding and 1 preceding),0) prior
    from public.kitchen_readies r cross join lateral jsonb_array_elements(r.lines) l
    where r.undoes is null and r.order_id=(select order_id from public.kitchen_readies where id=p_ready)
      and r.device_id=(select device_id from public.kitchen_readies where id=p_ready)
      and not exists(select 1 from public.kitchen_readies u where u.undoes=r.id)
  ), remaining as (
    select c.l,i.item_name,i.menu_item_id,i.note,
      greatest(0,least(c.amount,i.quantity-c.prior)-greatest(0,coalesce(p.quantity,0)-c.prior)) qty
    from captured c join public.order_items i on i.id=(c.l->>'id')::uuid
    left join public.order_line_preparations p on p.order_item_id=i.id where c.id=p_ready
  ) select coalesce(jsonb_agg(jsonb_build_object('id',l->>'id','menuItemId',menu_item_id,
    'itemName',item_name,'quantity',qty,'note',note)),'[]'::jsonb) from remaining where qty>0
$$;

create or replace function public.kitchen_board() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.counter_shifts%rowtype; d public.counter_devices%rowtype; cutover time; cards jsonb;
begin
  select * into s from public.counter_shifts where id=public.app_kitchen_shift();
  if not found then raise exception 'the kitchen board needs a live kitchen shift' using errcode='42501'; end if;
  select * into d from public.counter_devices where id=s.device_id;
  select business_day_cutover into cutover from public.outlets where id=s.outlet_id;
  with candidates as (
    select o.* from public.orders o where o.outlet_id=s.outlet_id
      and (o.status='open' or (o.status='paid' and o.prepared_at is null)) and o.prepared_at is null
    union all select o.* from public.orders o where o.outlet_id=s.outlet_id and o.status='cancelled'
      and o.business_date in (s.business_date,s.business_date-1)
      and public.app_business_date(o.cancelled_at,cutover)=s.business_date
  ), active as (
    select o.ordered_at,public.kitchen_ticket(o.id,d.id) card from candidates o
  ), receipts as (
    select o.ordered_at,jsonb_build_object('id',r.id,'sourceOrderId',o.id,'readyId',r.id,
      'orderNumber',o.order_number,'serviceType',o.service_type,'tableNumber',o.table_number,
      'orderedAt',o.ordered_at,'version',public.kitchen_order_version(o),'status',o.status,
      'cancelledAt',null,'lines',x.lines,'otherItemCount',0,'ticketNumber',
      row_number() over(partition by r.order_id order by r.at,r.id),'acknowledged',true,
      'latestAck',jsonb_build_object('kind','new','orderVersion',public.kitchen_order_version(o),
        'lines',x.lines,'ackedAt',r.at)) card
    from public.kitchen_readies r join public.orders o on o.id=r.order_id
    cross join lateral (select public.kitchen_done_lines(r.id) lines) x
    where r.device_id=d.id and r.outlet_id=s.outlet_id and r.undoes is null
      and not exists(select 1 from public.kitchen_readies u where u.undoes=r.id)
      and (o.status='open' or (o.status='paid' and o.prepared_at is null))
  ) select coalesce(jsonb_agg(card order by ordered_at,card->>'id'),'[]'::jsonb) into cards
    from (select * from active where card is not null
      union all select * from receipts where jsonb_array_length(card->'lines')>0) q;
  return jsonb_build_object('readAt',now(),'outletId',s.outlet_id,'businessDate',s.business_date,
    'shiftId',s.id,'operatorName',(select full_name from public.profiles where id=s.person_id),
    'filterChangedAt',d.kitchen_filter_changed_at,'filterMode',d.kitchen_filter_mode,
    'categoryIds',to_jsonb(d.kitchen_category_ids),'sort',d.kitchen_sort,'orders',cards);
end;
$$;

create or replace function public.counter_kitchen_marks() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare outlet uuid:=public.app_counter_shift_outlet(); kitchens jsonb; orders jsonb; tablets integer;
begin
  if outlet is null then raise exception 'the kitchen marks need a live counter shift' using errcode='42501'; end if;
  with ks as (
    select d.*,row_number() over(order by lower(d.label),d.id) place
    from public.counter_devices d join public.counter_shifts s on s.device_id=d.id
    where s.outlet_id=outlet and s.kind='kitchen' and s.ended_at is null and s.expires_at>now()
      and d.removed_at is null and d.session_proven_at is not null and d.kind='kitchen'
  ), rail as (
    select o.id,o.prepared_at from public.orders o where o.outlet_id=outlet
      and (o.status='open' or (o.status='paid' and o.prepared_at is null))
  ), cells as (
    select r.id order_id,k.place,public.kitchen_visible_lines(r.id,k.kitchen_filter_mode,k.kitchen_category_ids) visible,
      public.kitchen_ticket(r.id,k.id) ticket,
      exists(select 1 from public.kitchen_readies rd where rd.order_id=r.id and rd.device_id=k.id and rd.undoes is null
        and not exists(select 1 from public.kitchen_readies u where u.undoes=rd.id)
        and jsonb_array_length(public.kitchen_done_lines(rd.id))>0) has_ready
    from rail r cross join ks k
  ), states as (
    select *,case
      when jsonb_array_length(visible)=0 and ticket is null and not has_ready then null
      when has_ready then 'ready'
      when jsonb_array_length(visible)>0 and jsonb_array_length(public.kitchen_owed_lines(visible,false))=0 then 'handed_over'
      when ticket->>'acknowledged'='true' and public.kitchen_same_lines(ticket->'lines',ticket->'latestAck'->'lines') then 'acknowledged'
      else 'sent' end state from cells
  ) select coalesce(jsonb_agg(jsonb_build_object('orderId',order_id,'marks',marks,'dishStates',states,
      'readyQuantities',(select coalesce(jsonb_object_agg(i.id,public.dish_ready_quantity(i.id)),'{}'::jsonb)
        from public.order_items i where i.order_id=order_id and i.kind='item'))),'[]'::jsonb)
    into orders from (select order_id,jsonb_agg(state order by place) states,
      jsonb_agg(case when state is null then null when state in ('acknowledged','ready','handed_over') then 'seen' else 'waiting' end order by place) marks
      from states group by order_id having count(state)>0) g;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'label',d.label) order by lower(d.label),d.id),'[]'::jsonb)
    into kitchens from public.counter_devices d join public.counter_shifts s on s.device_id=d.id
    where s.outlet_id=outlet and s.kind='kitchen' and s.ended_at is null and s.expires_at>now()
      and d.removed_at is null and d.session_proven_at is not null and d.kind='kitchen';
  select count(*) into tablets from public.counter_devices where outlet_id=outlet and kind='kitchen' and removed_at is null and session_proven_at is not null;
  return jsonb_build_object('kitchens',kitchens,'orders',orders,'kitchenTablets',tablets);
end;
$$;

revoke execute on function public.kitchen_owed_lines(jsonb,boolean),public.kitchen_ticket(uuid,uuid),
  public.kitchen_done_lines(uuid) from public,anon,authenticated;


-- Acknowledgements capture the active ticket, not earlier Ready food.
create or replace function public.kitchen_acknowledge(
  p_id uuid, p_order_id uuid, p_kind text, p_order_version timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.kitchen_acknowledgements%rowtype;
  v_shift public.counter_shifts%rowtype;
  v_device public.counter_devices%rowtype;
  v_order public.orders%rowtype;
begin
  if p_id is null or p_order_id is null or p_order_version is null
     or p_kind is null or p_kind not in ('new', 'edit', 'cancel') then
    return jsonb_build_object('status', 'invalid');
  end if;

  select s.* into v_shift from public.counter_shifts s
   where s.id = public.app_kitchen_shift();
  if not found then
    return jsonb_build_object('status', 'not_authorised');
  end if;

  select * into v_existing from public.kitchen_acknowledgements where id = p_id;
  if found then
    if v_existing.device_id = v_shift.device_id and v_existing.order_id = p_order_id
       and v_existing.kind = p_kind and v_existing.order_version = p_order_version then
      return jsonb_build_object('status', 'accepted', 'replay', true);
    end if;
    return jsonb_build_object('status', 'identity_conflict');
  end if;

  select * into v_order from public.orders
   where id = p_order_id and outlet_id = v_shift.outlet_id;
  if not found then
    return jsonb_build_object('status', 'not_authorised');
  end if;
  if public.kitchen_order_version(v_order) <> p_order_version then
    -- The cook acknowledged a version that is no longer current; the card is
    -- already alerting for the newer one.
    return jsonb_build_object('status', 'stale');
  end if;

  select * into v_device from public.counter_devices where id = v_shift.device_id;

  insert into public.kitchen_acknowledgements
    (id, outlet_id, device_id, shift_id, person_id, order_id, kind, order_version, lines)
  values
    (p_id, v_shift.outlet_id, v_shift.device_id, v_shift.id, v_shift.person_id, p_order_id,
     p_kind, p_order_version,
     public.kitchen_owed_lines(public.kitchen_visible_lines(p_order_id, v_device.kitchen_filter_mode,
                                  v_device.kitchen_category_ids)));
  return jsonb_build_object('status', 'accepted');
end;
$$;
