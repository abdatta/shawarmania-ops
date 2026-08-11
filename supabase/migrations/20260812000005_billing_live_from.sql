-- Counter revenue replaces the temporary typed Cash/UPI ledger figures only
-- from an explicit per-outlet date. The date is scheduled before that trading
-- day begins and becomes immutable once it has begun.
alter table public.outlets add column billing_live_from date;

create or replace function public.guard_outlet_billing_live_from()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_today date;
begin
  if tg_op = 'UPDATE' and new.billing_live_from is not distinct from old.billing_live_from then
    return new;
  end if;

  v_today := public.app_business_date(now(), new.business_day_cutover);
  if tg_op = 'UPDATE' and old.billing_live_from is not null
     and old.billing_live_from <= v_today then
    raise exception 'billing live date has already started and cannot be changed';
  end if;
  if new.billing_live_from is not null and new.billing_live_from <= v_today then
    raise exception 'billing live date is already trading; next eligible business date is %',
      v_today + 1;
  end if;
  return new;
end;
$$;

create trigger outlets_billing_live_from_insert_guarded
  before insert on public.outlets
  for each row execute function public.guard_outlet_billing_live_from();

create trigger outlets_billing_live_from_update_guarded
  before update of billing_live_from on public.outlets
  for each row execute function public.guard_outlet_billing_live_from();

-- Even a hand-crafted request cannot reintroduce typed counter revenue after
-- go-live. Zero remains storable because the temporary ledger row still owns
-- opening/counting and aggregator inputs; reads replace the zeroes with bills.
create or replace function public.guard_manual_ledger_counter_revenue()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_live_from date;
begin
  select billing_live_from into v_live_from
    from public.outlets where id = new.outlet_id;
  if v_live_from is not null and new.business_date >= v_live_from
     and (new.cash_revenue_paise <> 0 or new.upi_revenue_paise <> 0) then
    raise exception 'Cash and UPI revenue come from counter bills after billing go-live';
  end if;
  return new;
end;
$$;

create trigger manual_ledger_counter_revenue_guarded
  before insert or update on public.manual_ledger_days
  for each row execute function public.guard_manual_ledger_counter_revenue();

-- One RLS-respecting read model for the temporary ledger. It returns only
-- settled allocations, grouped by the business date on which payment landed;
-- voids therefore disappear without any compensating arithmetic in the UI.
create or replace function public.manual_ledger_counter_revenue(
  p_outlet_id uuid,
  p_from date,
  p_to date
)
returns table (business_date date, cash_revenue_paise bigint, upi_revenue_paise bigint)
language sql stable security invoker set search_path = '' as $$
  select b.payment_business_date,
         coalesce(sum(bp.amount_paise) filter (where bp.method = 'cash'), 0)::bigint,
         coalesce(sum(bp.amount_paise) filter (where bp.method = 'upi'), 0)::bigint
    from public.bills b
    join public.bill_payments bp
      on bp.bill_id = b.id and bp.outlet_id = b.outlet_id
    join public.outlets o on o.id = b.outlet_id
   where b.outlet_id = p_outlet_id
     and b.status = 'settled'
     and o.billing_live_from is not null
     and b.payment_business_date >= greatest(p_from, o.billing_live_from)
     and b.payment_business_date < p_to
   group by b.payment_business_date
   order by b.payment_business_date;
$$;

grant execute on function public.manual_ledger_counter_revenue(uuid,date,date)
  to authenticated;
