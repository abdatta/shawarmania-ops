-- part-months-cost-what-was-agreed (#79 follow-up), the owner's production
-- look (2026-10-31): a stop can be undone from the cost's page, quietly, behind
-- a confirmation, so a cost stopped by mistake runs again without the database.
-- change-gate: agreed-part-months
--
-- `unstop_fixed_cost` is new; nothing published is replaced. What it takes back
-- is found from what the stop wrote, all in one transaction and so at one
-- instant: the stop month's closing figures (every unvoided settlement of that
-- month that no payment set), the settlements written beside them for earlier
-- months left short, and the final payment recorded at that instant, undone as
-- the payment's own Undo does. A first month agreed when the cost was added is
-- kept: it is not the stop's. Nothing is deleted; each row is voided.

create function public.unstop_fixed_cost(p_fixed_cost_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cost public.fixed_costs;
  v_month date;
  v_instants timestamptz[];
  v_link uuid;
begin
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    raise exception 'That fixed cost is no longer there.' using errcode = 'P0002';
  end if;
  perform public.fixed_costs_assert_outlet(v_cost.outlet_id);
  if v_cost.stops_on is null then
    raise exception 'It is not stopped.' using errcode = '22023';
  end if;
  v_month := date_trunc('month', v_cost.stops_on::timestamp)::date;

  select coalesce(array_agg(distinct s.created_at), '{}') into v_instants
    from public.fixed_cost_settlements s
   where s.fixed_cost_id = v_cost.id and s.month = v_month
     and s.voided_at is null and s.fixed_cost_payment_id is null
     and s.created_at <> v_cost.created_at;

  for v_link in
    select p.id from public.fixed_cost_payments p
     where p.fixed_cost_id = v_cost.id and p.created_at = any (v_instants)
  loop
    perform public.undo_fixed_cost_payment(v_cost.id, v_link);
  end loop;

  update public.fixed_cost_settlements s
     set voided_at = now()
   where s.fixed_cost_id = v_cost.id and s.voided_at is null
     and s.fixed_cost_payment_id is null and s.month <= v_month
     and s.created_at = any (v_instants);

  update public.fixed_costs set stops_on = null where id = v_cost.id;
end $$;

revoke all on function public.unstop_fixed_cost(uuid) from public, anon;
grant execute on function public.unstop_fixed_cost(uuid) to authenticated;
