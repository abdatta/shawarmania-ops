-- part-months-cost-what-was-agreed (#79 follow-up): a fixed cost's part month
-- costs the figure agreed for it, written as that month's settlement by the
-- same function that sets the start or stop date; stopping asks for the final
-- payment on top of what the month already has.
-- change-gate: agreed-part-months
--
-- Every object here is new. `fixed_cost_month_cost` keeps its day share as the
-- fallback for a part month with no settlement (design D1), so every published
-- build and `record_fixed_cost_payment` keep agreeing about what is owed; the
-- on path simply never leaves a part month without one. What these functions
-- save is a settlement, a stop date and a payment, all of which every published
-- build already reads.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('agreed-part-months', 'AM', 'change', 'Agreed part months',
   'A fixed cost that starts or stops part-way through a month costs the figure agreed for that month, stopping asks for the final payment, and a stopped cost stays in its place, marked done, for the month it stopped in.',
   'A part month costs its share by days, and stopped fixed costs sit under Stopped at the foot of the list.',
   'part-months-cost-what-was-agreed', 79);

-- What payments leave for `p_month` once every earlier month is paid (design
-- D2): everything counted on or before the outlet's business date, less what
-- the months before it cost, never below zero. The SQL copy of `alreadyPaidIn`.
create function public.fixed_cost_already_paid_in(p_fixed_cost_id uuid, p_month date)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(0,
           public.fixed_cost_paid_paise(c.id, public.fixed_costs_today(c.outlet_id))
           - coalesce((select sum(m.cost_paise)
                         from public.fixed_cost_months(c.id, (p_month - interval '1 month')::date) m
                        where m.month < p_month), 0))::bigint
    from public.fixed_costs c
   where c.id = p_fixed_cost_id
$$;

-- Add, with what a month started part-way through comes to (design D4).
create function public.create_fixed_cost_v2(
  p_outlet_id uuid,
  p_name text,
  p_category text,
  p_monthly_paise bigint,
  p_starts_on date,
  p_note text,
  p_first_month_paise bigint
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.fixed_costs_assert_outlet(p_outlet_id);
  if extract(day from p_starts_on) <> 1
     and (p_first_month_paise is null or p_first_month_paise < 0) then
    raise exception 'Say what the first month comes to, in rupees.' using errcode = '22023';
  end if;
  v_id := public.create_fixed_cost(p_outlet_id, p_name, p_category, p_monthly_paise,
                                   p_starts_on, p_note);
  if extract(day from p_starts_on) <> 1 then
    insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise)
    values (v_id, p_outlet_id, date_trunc('month', p_starts_on::timestamp)::date,
            p_first_month_paise);
  end if;
  return v_id;
end $$;

-- Edit, and where the start moves to a day other than the 1st, what that month
-- comes to. Null keeps the start month as it is.
create function public.update_fixed_cost_v2(
  p_fixed_cost_id uuid,
  p_name text,
  p_category text,
  p_starts_on date,
  p_note text,
  p_first_month_paise bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_outlet uuid;
begin
  perform public.update_fixed_cost(p_fixed_cost_id, p_name, p_category, p_starts_on, p_note);
  if p_first_month_paise is not null then
    if p_first_month_paise < 0 then
      raise exception 'Say what the first month comes to, in rupees.' using errcode = '22023';
    end if;
    select outlet_id into v_outlet from public.fixed_costs where id = p_fixed_cost_id;
    insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise)
    values (p_fixed_cost_id, v_outlet, date_trunc('month', p_starts_on::timestamp)::date,
            p_first_month_paise);
  end if;
end $$;

-- Stop, or close the last month of a cost already stopped (design D2, D3): the
-- stop month is settled at what payments already leave for it plus the final
-- payment, and, when `p_payment_id` is given, the final payment is recorded on
-- the last day (today, if that is still ahead) in the same transaction. Once the
-- month is settled the final payment is exactly what is owed, so the pay
-- function asks nothing. A retried tap finds the payment and settles nothing
-- twice.
create function public.stop_fixed_cost_v2(
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
  v_month date;
  v_on date;
begin
  select * into v_cost from public.fixed_costs where id = p_fixed_cost_id;
  if not found then
    raise exception 'That fixed cost is no longer there.' using errcode = 'P0002';
  end if;
  perform public.fixed_costs_assert_outlet(v_cost.outlet_id);
  if p_stops_on is null or p_stops_on < v_cost.starts_on then
    raise exception 'It cannot stop before it started.' using errcode = '22023';
  end if;
  if p_final_paise is null or p_final_paise < 0 then
    raise exception 'The final payment is a number of rupees, or nothing.' using errcode = '22023';
  end if;
  if p_payment_id is not null
     and exists (select 1 from public.fixed_cost_payments where expense_id = p_payment_id) then
    return;
  end if;

  update public.fixed_costs set stops_on = p_stops_on where id = p_fixed_cost_id;
  v_month := date_trunc('month', p_stops_on::timestamp)::date;
  insert into public.fixed_cost_settlements (fixed_cost_id, outlet_id, month, amount_paise)
  values (p_fixed_cost_id, v_cost.outlet_id, v_month,
          public.fixed_cost_already_paid_in(p_fixed_cost_id, v_month) + p_final_paise);

  if p_payment_id is not null and p_final_paise > 0 then
    v_on := least(p_stops_on, public.fixed_costs_today(v_cost.outlet_id));
    perform public.record_fixed_cost_payment(p_payment_id, p_fixed_cost_id, p_final_paise,
                                             v_on, v_on, coalesce(p_is_cash, false),
                                             'Final payment', null);
  end if;
end $$;

revoke all on function
  public.fixed_cost_already_paid_in(uuid, date),
  public.create_fixed_cost_v2(uuid, text, text, bigint, date, text, bigint),
  public.update_fixed_cost_v2(uuid, text, text, date, text, bigint),
  public.stop_fixed_cost_v2(uuid, date, bigint, uuid, boolean)
  from public, anon;
grant execute on function
  public.fixed_cost_already_paid_in(uuid, date),
  public.create_fixed_cost_v2(uuid, text, text, bigint, date, text, bigint),
  public.update_fixed_cost_v2(uuid, text, text, date, text, bigint),
  public.stop_fixed_cost_v2(uuid, date, bigint, uuid, boolean)
  to authenticated;
