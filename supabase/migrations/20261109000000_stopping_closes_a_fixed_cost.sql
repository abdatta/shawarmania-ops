-- part-months-cost-what-was-agreed (#79 follow-up), the owner's staging round
-- (2026-10-31): stopping a fixed cost closes it. Every month through the stop
-- month is settled in the one step, so nothing is left to pay and a stopped
-- cost never asks for Pay again; the final payment, if any, is paid at close.
-- change-gate: agreed-part-months
--
-- `stop_fixed_cost_v3` is new. `stop_fixed_cost_v2` (20261107000000) reached
-- staging only and is called by no published build after this one; it stays
-- until the gate's contract migration, as every replaced function does.

-- Stop, or close the last month of a cost stopped before this change (design
-- D2, D3). Payments fill the months from the oldest, as everywhere (#79 D4); a
-- month they leave short before the stop month is settled at what they
-- covered, and the stop month at what they leave for it plus the final
-- payment. The last day is today or earlier: a stop is the moment it is made,
-- back-dated when it is entered late. A cost already closed is refused, so a
-- second tap cannot raise its last month; a retried tap finds its payment and
-- returns first.
create function public.stop_fixed_cost_v3(
  p_fixed_cost_id uuid,
  p_stops_on date,
  p_final_paise bigint,
  p_payment_id uuid default null,
  p_is_cash boolean default false
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cost public.fixed_costs;
  v_today date;
  v_month date;
  v_pool bigint;
  v_row record;
begin
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    raise exception 'That fixed cost is no longer there.' using errcode = 'P0002';
  end if;
  perform public.fixed_costs_assert_outlet(v_cost.outlet_id);
  if p_payment_id is not null
     and exists (select 1 from public.fixed_cost_payments where expense_id = p_payment_id) then
    return;
  end if;
  v_today := public.fixed_costs_today(v_cost.outlet_id);
  if p_stops_on is null or p_stops_on < v_cost.starts_on then
    raise exception 'It cannot stop before it started.' using errcode = '22023';
  end if;
  if p_stops_on > v_today then
    raise exception 'It stops today or on a day already gone.' using errcode = '22023';
  end if;
  if p_final_paise is null or p_final_paise < 0 then
    raise exception 'The final payment is a number of rupees, 0 for none.' using errcode = '22023';
  end if;
  if v_cost.stops_on is not null
     and exists (select 1 from public.fixed_cost_settlements s
                  where s.fixed_cost_id = v_cost.id and s.voided_at is null
                    and s.month = date_trunc('month', v_cost.stops_on::timestamp)::date) then
    raise exception 'It is already stopped.' using errcode = '22023';
  end if;

  update public.fixed_costs set stops_on = p_stops_on where id = p_fixed_cost_id;
  v_month := date_trunc('month', p_stops_on::timestamp)::date;
  v_pool := public.fixed_cost_paid_paise(p_fixed_cost_id, v_today);
  for v_row in
    select m.month, m.cost_paise
      from public.fixed_cost_months(p_fixed_cost_id, v_month) m
     where m.month < v_month
     order by m.month
  loop
    if v_pool >= v_row.cost_paise then
      v_pool := v_pool - v_row.cost_paise;
    else
      insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise)
      values (p_fixed_cost_id, v_cost.outlet_id, v_row.month, v_pool);
      v_pool := 0;
    end if;
  end loop;
  insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise)
  values (p_fixed_cost_id, v_cost.outlet_id, v_month, v_pool + p_final_paise);

  if p_payment_id is not null and p_final_paise > 0 then
    perform public.record_fixed_cost_payment(p_payment_id, p_fixed_cost_id, p_final_paise,
                                             p_stops_on, p_stops_on, coalesce(p_is_cash, false),
                                             'Final payment', null);
  end if;
end $$;

revoke all on function public.stop_fixed_cost_v3(uuid, date, bigint, uuid, boolean)
  from public, anon;
grant execute on function public.stop_fixed_cost_v3(uuid, date, bigint, uuid, boolean)
  to authenticated;
