-- The Tablets surface reads the counter in one RLS-scoped statement.
--
-- This is an oversight snapshot, not a feed. The server stamps the read so the
-- operator, shift and every figure on one card describe the same moment; the
-- phone neither subscribes nor polls afterwards.

create index bills_counter_shift_id_idx on public.bills(counter_shift_id);

create or replace function public.counter_operations_snapshot(
  p_outlet_ids uuid[]
)
returns table (
  read_at timestamptz,
  device_id uuid,
  outlet_id uuid,
  label text,
  set_up_at timestamptz,
  last_seen_at timestamptz,
  last_reported_unsent integer,
  shift_id uuid,
  operator_name text,
  opened_at timestamptz,
  business_date date,
  bill_count bigint,
  cash_total_paise bigint,
  upi_total_paise bigint,
  open_order_count bigint,
  drawer_cash_paise bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.app_account_active()
     or not (
       (select public.app_is_owner())
       or (
         exists (select 1 from public.app_outlets_for('franchise_admin'))
         and not exists (
           select requested
             from unnest(coalesce(p_outlet_ids, array[]::uuid[])) requested
            where requested not in (select public.app_outlets_for('franchise_admin'))
         )
       )
     ) then
    raise exception 'counter operations are limited to authorised managers'
      using errcode = '42501';
  end if;

  return query
  with visible_devices as (
    select d.id, d.outlet_id, d.label, d.set_up_at,
           d.last_seen_at, d.last_reported_unsent
      from public.counter_devices d
     where d.removed_at is null
       and d.outlet_id = any(coalesce(p_outlet_ids, array[]::uuid[]))
  ),
  live_shifts as (
    select distinct on (s.device_id)
           s.id, s.device_id, s.outlet_id, s.person_id,
           s.opened_at, s.business_date
      from public.counter_shifts s
      join visible_devices d on d.id = s.device_id and d.outlet_id = s.outlet_id
     where s.ended_at is null and s.expires_at > statement_timestamp()
     order by s.device_id, s.opened_at desc
  ),
  bill_rollup as (
    select s.id as shift_id,
           count(distinct b.id)::bigint as bill_count,
           coalesce(sum(ep.amount_paise) filter (
             where b.status = 'settled' and ep.method = 'cash'
           ), 0)::bigint as cash_total_paise,
           coalesce(sum(ep.amount_paise) filter (
             where b.status = 'settled' and ep.method = 'upi'
           ), 0)::bigint as upi_total_paise
      from live_shifts s
      left join public.bills b on b.counter_shift_id = s.id
      left join public.effective_bill_payments ep
        on ep.bill_id = b.id and ep.outlet_id = b.outlet_id
     group by s.id
  ),
  order_rollup as (
    select s.id as shift_id, count(o.id)::bigint as open_order_count
      from live_shifts s
      left join public.orders o
        on o.device_id = s.device_id
       and o.outlet_id = s.outlet_id
       and o.business_date = s.business_date
       and o.status = 'open'
     group by s.id
  )
  select statement_timestamp() as read_at,
         d.id as device_id,
         d.outlet_id,
         d.label,
         d.set_up_at,
         d.last_seen_at,
         d.last_reported_unsent,
         s.id as shift_id,
         p.full_name as operator_name,
         s.opened_at,
         s.business_date,
         case when s.id is null then null else coalesce(b.bill_count, 0) end,
         case when s.id is null then null else coalesce(b.cash_total_paise, 0) end,
         case when s.id is null then null else coalesce(b.upi_total_paise, 0) end,
         case when s.id is null then null else coalesce(o.open_order_count, 0) end,
         -- V1 has no opening-float allocation by shift. The drawer contribution
         -- from billing is therefore precisely the latest effective Cash tender.
         case when s.id is null then null else coalesce(b.cash_total_paise, 0) end
    from visible_devices d
    left join live_shifts s on s.device_id = d.id
    left join public.profiles p on p.id = s.person_id
    left join bill_rollup b on b.shift_id = s.id
    left join order_rollup o on o.shift_id = s.id
   order by d.label;
end;
$$;

revoke execute on function public.counter_operations_snapshot(uuid[]) from public, anon;
grant execute on function public.counter_operations_snapshot(uuid[]) to authenticated;
