-- A tablet's current row is authority; its effective-dated identity is display
-- history. Renaming or transferring a tablet must not rename old bills.

create table public.counter_device_history (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.counter_devices(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id),
  label text not null check (length(btrim(label)) between 1 and 120),
  valid_from timestamptz not null,
  valid_to timestamptz,
  constraint counter_device_history_interval_valid
    check (valid_to is null or valid_to > valid_from)
);

create unique index counter_device_history_one_current
  on public.counter_device_history(device_id) where valid_to is null;
create index counter_device_history_lookup
  on public.counter_device_history(device_id, valid_from desc)
  include (valid_to, outlet_id, label);

alter table public.counter_device_history enable row level security;
create policy counter_device_history_select on public.counter_device_history
  for select to authenticated using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

-- The application reads historical labels through the bounded event function
-- below. Keeping the base table ungranted prevents its outlet column becoming a
-- new cross-outlet discovery path.
revoke all on public.counter_device_history from public, anon, authenticated;
grant all on public.counter_device_history to service_role;

create function public.guard_counter_device_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.counter_device_history h
     where h.device_id = new.device_id
       and h.id <> new.id
       and h.valid_from < coalesce(new.valid_to, 'infinity'::timestamptz)
       and new.valid_from < coalesce(h.valid_to, 'infinity'::timestamptz)
  ) then
    raise exception 'counter device identity intervals may not overlap';
  end if;
  return new;
end;
$$;

create trigger counter_device_history_no_overlap
  before insert or update on public.counter_device_history
  for each row execute function public.guard_counter_device_history();

-- Existing devices have one presently-known identity. The incident-specific
-- operator later splits the already-transferred tablet from its retained
-- before-image; a deploy migration must not contain a production identity.
insert into public.counter_device_history
  (device_id, outlet_id, label, valid_from)
select d.id, d.outlet_id, d.label, d.set_up_at
  from public.counter_devices d;

create function public.record_counter_device_initial_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.counter_device_history
    (device_id, outlet_id, label, valid_from)
  values
    (new.id, new.outlet_id, new.label, new.set_up_at);
  return new;
end;
$$;

create trigger counter_devices_record_initial_history
  after insert on public.counter_devices
  for each row execute function public.record_counter_device_initial_history();

create function public.record_counter_device_identity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.counter_device_history%rowtype;
  v_boundary timestamptz;
begin
  if new.outlet_id is not distinct from old.outlet_id
     and new.label is not distinct from old.label then
    return new;
  end if;

  select * into v_current
    from public.counter_device_history h
   where h.device_id = old.id and h.valid_to is null
   for update;
  if not found then
    raise exception 'counter device has no current identity interval';
  end if;
  if v_current.outlet_id is distinct from old.outlet_id
     or v_current.label is distinct from old.label then
    raise exception 'counter device current row disagrees with identity history';
  end if;

  v_boundary := greatest(clock_timestamp(), v_current.valid_from + interval '1 microsecond');
  update public.counter_device_history
     set valid_to = v_boundary
   where id = v_current.id;
  insert into public.counter_device_history
    (device_id, outlet_id, label, valid_from)
  values
    (new.id, new.outlet_id, new.label, v_boundary);
  return new;
end;
$$;

create trigger counter_devices_record_identity_change
  before update of outlet_id, label on public.counter_devices
  for each row execute function public.record_counter_device_identity_change();

-- One bounded read per bill/order page. The function returns display text only
-- after re-deriving the same authority as the underlying event row; callers do
-- not gain access to the history relation or its outlet column.
create function public.billing_event_device_labels(
  p_event_kind text,
  p_event_ids uuid[]
)
returns table (event_id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- PostgREST returns at most 1,000 rows for these history reads in production,
  -- so the bound covers a complete visible result without opening an
  -- unbounded security-definer query.
  if auth.uid() is null or p_event_kind not in ('bill', 'order')
     or coalesce(cardinality(p_event_ids), 0) > 1000 then
    raise exception 'invalid billing device-label request' using errcode = '42501';
  end if;

  if p_event_kind = 'bill' then
    return query
    select b.id, h.label
      from public.bills b
      join lateral (
        select history.label
          from public.counter_device_history history
         where history.device_id = b.counter_device_id
           and history.valid_from <= b.paid_at
           and (history.valid_to is null or b.paid_at < history.valid_to)
         order by history.valid_from desc
         limit 1
      ) h on true
     where b.id = any(coalesce(p_event_ids, '{}'::uuid[]))
       and public.app_device_ok()
       and (
         (b.counter_device_id = auth.uid()
          and b.counter_shift_id = (select public.app_counter_shift()))
         or (
           public.app_account_active()
           and (
             (select public.app_is_owner())
             or b.outlet_id in (select public.app_outlets_for('franchise_admin'))
           )
         )
       );
  else
    return query
    select o.id, h.label
      from public.orders o
      join lateral (
        select history.label
          from public.counter_device_history history
         where history.device_id = o.device_id
           and history.valid_from <= o.ordered_at
           and (history.valid_to is null or o.ordered_at < history.valid_to)
         order by history.valid_from desc
         limit 1
      ) h on true
     where o.id = any(coalesce(p_event_ids, '{}'::uuid[]))
       and public.app_device_ok()
       and (
         o.outlet_id = (select public.app_counter_shift_outlet())
         or (
           public.app_account_active()
           and (
             (select public.app_is_owner())
             or o.outlet_id in (select public.app_outlets_for('franchise_admin'))
           )
         )
       );
  end if;
end;
$$;

revoke execute on function public.billing_event_device_labels(text, uuid[])
  from public, anon;
grant execute on function public.billing_event_device_labels(text, uuid[])
  to authenticated;

comment on table public.counter_device_history is
  'Effective-dated display identity for a counter device. Current authority remains counter_devices; bills and orders resolve the label at their event instant.';
comment on function public.billing_event_device_labels(text, uuid[]) is
  'Returns at most 1,000 historical tablet labels for authorised bill or order IDs in one indexed, temporal read.';
