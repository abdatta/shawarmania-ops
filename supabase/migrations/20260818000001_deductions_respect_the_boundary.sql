-- A deduction before the boundary is not the sync's to write either.
--
-- `ingest_aggregator_cycle` learned to leave day figures alone behind `synced_from`,
-- and the expense insert beside it did not. The gap is not theoretical: the reader
-- sweeps four payout cycles for deductions by design, because a supply bill is
-- collected 4 to 11 days after the purchase and sometimes several cycles later.
-- Kanchrapara's 27 Jul cycle carried Hyperpure bills dated as far back as 26 May.
--
-- With a boundary of 1 August those older bills would have been inserted against
-- days the owner had already accounted for by hand, so the same purchase would sit in
-- the ledger twice: once as their entry and once as Zomato's. Double-counting a cost
-- understates profit, which is the opposite error from the one this change set out to
-- fix and exactly as wrong.
--
-- The boundary now means one thing for everything the sync writes: **before it, the
-- ledger is the owner's.**
--
-- One asymmetry is deliberate and easy to misread as a bug. The RECONCILIATION sum
-- still counts every deduction in the payload, including those dated before the
-- boundary, because Zomato took that money out of this cycle's payout whatever the
-- purchase date. A sum that omitted an old bill would fail to reconcile against a
-- payout that included it. The boundary governs what is WRITTEN, not what the week is
-- measured against.

create or replace function public.ingest_aggregator_cycle(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $ingest$
declare
  v_outlet uuid;
  v_channel text;
  v_cycle_start date;
  v_cycle_end date;
  v_state text;
  v_stated_payout bigint;
  v_accepted_by uuid;
  v_cutover time;
  v_orders_net bigint;
  v_deductions bigint;
  v_cycle_deductions bigint;
  v_computed bigint;
  v_difference bigint;
  v_unattributed text;
  v_written int := 0;
  v_pending text;
  v_day record;
  v_existing record;
  v_tolerance constant bigint := 100;
  v_synced_from date;
  v_deductions_skipped int := 0;
begin
  if coalesce((p_payload ->> 'contract_version')::int, 0) <> 1 then
    raise exception 'unsupported contract version %',
      coalesce(p_payload ->> 'contract_version', 'none')
      using errcode = '22023';
  end if;

  v_outlet  := (p_payload ->> 'outlet_id')::uuid;
  v_channel := p_payload ->> 'channel';
  v_cycle_start := (p_payload ->> 'cycle_start')::date;
  v_cycle_end   := (p_payload ->> 'cycle_end')::date;
  v_state       := p_payload ->> 'cycle_state';
  v_stated_payout := nullif(p_payload ->> 'stated_payout_paise', '')::bigint;
  v_accepted_by   := nullif(p_payload ->> 'accepted_by', '')::uuid;

  if v_outlet is null or not (v_outlet = any (p_permitted_outlets)) then
    raise exception 'this credential may not write settlement for outlet %', v_outlet
      using errcode = '42501';
  end if;

  if v_channel is distinct from 'zomato' then
    raise exception 'unknown channel %', v_channel using errcode = '22023';
  end if;

  if v_state not in ('provisional', 'settled') then
    raise exception 'a cycle arrives provisional or settled, not %', v_state
      using errcode = '22023';
  end if;

  select business_day_cutover into v_cutover from public.outlets where id = v_outlet;
  if v_cutover is null then
    raise exception 'unknown outlet %', v_outlet using errcode = '22023';
  end if;

  select synced_from into v_synced_from
    from public.outlet_channel_sync
   where outlet_id = v_outlet and channel = v_channel;

  if v_synced_from is null then
    raise exception 'the % sync is not switched on for outlet %', v_channel, v_outlet
      using errcode = '22023';
  end if;

  select string_agg(o ->> 'order_id', ', ')
    into v_unattributed
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   where nullif(o ->> 'placed_at', '') is null;

  if v_unattributed is not null then
    raise exception 'these orders carry no placement time and were not written: %',
      v_unattributed using errcode = '22023';
  end if;

  select coalesce(sum((o ->> 'net_paise')::bigint), 0)
    into v_orders_net
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o;

  select coalesce(sum((d ->> 'amount_paise')::bigint), 0)
    into v_deductions
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d;

  select coalesce(sum((c ->> 'amount_paise')::bigint), 0)
    into v_cycle_deductions
    from jsonb_array_elements(coalesce(p_payload -> 'cycle_deductions', '[]'::jsonb)) c;

  v_computed := v_orders_net + v_cycle_deductions - v_deductions;
  v_difference := case when v_stated_payout is null then null
                       else v_computed - v_stated_payout end;

  if v_state = 'settled' then
    if v_stated_payout is null then
      raise exception 'a settled cycle must state the payout it is reconciled against'
        using errcode = '22023';
    end if;

    if abs(v_difference) > v_tolerance and v_accepted_by is null then
      update public.manual_ledger_days
         set zomato_settlement_state = 'disputed'
       where outlet_id = v_outlet
         and business_date between v_cycle_start and v_cycle_end
         and business_date >= v_synced_from
         and zomato_settlement_state = 'provisional';

      return jsonb_build_object(
        'outcome', 'reconciliation_failed',
        'computed_paise', v_computed,
        'stated_payout_paise', v_stated_payout,
        'difference_paise', v_difference);
    end if;
  end if;

  create temporary table if not exists ingest_days (
    business_date date primary key,
    gross_paise bigint,
    commission_paise bigint
  ) on commit drop;
  truncate table ingest_days;

  insert into ingest_days (business_date, gross_paise, commission_paise)
  select public.app_business_date((o ->> 'placed_at')::timestamptz, v_cutover),
         sum((o ->> 'gross_paise')::bigint),
         case
           when count(*) filter (where (o ->> 'commission_paise') is null) > 0 then null
           else sum((o ->> 'commission_paise')::bigint)
         end
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   group by 1;

  for v_day in select * from ingest_days order by business_date loop
    select * into v_existing
      from public.manual_ledger_days
     where outlet_id = v_outlet and business_date = v_day.business_date;

    if not found then
      continue;
    end if;

    if v_day.business_date < v_synced_from then
      continue;
    end if;

    if v_existing.zomato_settlement_state = 'settled' then
      continue;
    end if;

    update public.manual_ledger_days d
       set zomato_revenue_paise = v_day.gross_paise,
           zomato_commission_paise = v_day.commission_paise,
           zomato_settlement_state = v_state,

           zomato_superseded_revenue_paise = case
             when d.zomato_superseded_at is not null then d.zomato_superseded_revenue_paise
             when d.zomato_settlement_state is null then d.zomato_revenue_paise
             else null end,
           zomato_superseded_commission_paise = case
             when d.zomato_superseded_at is not null then d.zomato_superseded_commission_paise
             when d.zomato_settlement_state is null then d.zomato_commission_paise
             else null end,
           zomato_superseded_at = case
             when d.zomato_superseded_at is not null then d.zomato_superseded_at
             when d.zomato_settlement_state is null then now()
             else null end,

           zomato_provisional_revenue_paise = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_revenue_paise, d.zomato_commission_paise)
                   is distinct from (v_day.gross_paise, v_day.commission_paise)
               then d.zomato_revenue_paise
             else d.zomato_provisional_revenue_paise end,
           zomato_provisional_commission_paise = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_revenue_paise, d.zomato_commission_paise)
                   is distinct from (v_day.gross_paise, v_day.commission_paise)
               then d.zomato_commission_paise
             else d.zomato_provisional_commission_paise end,
           zomato_revised_at = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_revenue_paise, d.zomato_commission_paise)
                   is distinct from (v_day.gross_paise, v_day.commission_paise)
               then now()
             else d.zomato_revised_at end
     where d.outlet_id = v_outlet and d.business_date = v_day.business_date;

    v_written := v_written + 1;
  end loop;

  select string_agg(i.business_date::text, ', ' order by i.business_date)
    into v_pending
    from ingest_days i
   where i.business_date >= v_synced_from
     and not exists (
       select 1 from public.manual_ledger_days d
        where d.outlet_id = v_outlet and d.business_date = i.business_date);

  -- Counted before the insert filters them out, so the answer can say how many bills
  -- were left to the owner rather than leaving their absence to be noticed.
  select count(*) into v_deductions_skipped
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
   where (d ->> 'spent_on')::date < v_synced_from;

  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description,
     source_system, source_ref, recorded_by)
  select v_outlet,
         (d ->> 'spent_on')::date,
         coalesce(nullif(d ->> 'category', ''), 'Other'),
         false,
         (d ->> 'amount_paise')::bigint,
         d ->> 'description',
         'zomato',
         d ->> 'source_ref',
         null
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
   where (d ->> 'spent_on')::date >= v_synced_from
  on conflict (outlet_id, source_system, source_ref) where source_system is not null
  do update set amount_paise = excluded.amount_paise,
                business_date = excluded.business_date,
                description = excluded.description,
                category = excluded.category
  where public.manual_ledger_expenses.voided_at is null;

  insert into public.aggregator_cycle_deductions
    (outlet_id, channel, kind, period_start, period_end, amount_paise,
     source_system, source_ref)
  select v_outlet, v_channel,
         c ->> 'kind',
         (c ->> 'period_start')::date,
         (c ->> 'period_end')::date,
         (c ->> 'amount_paise')::bigint,
         'zomato',
         c ->> 'source_ref'
    from jsonb_array_elements(coalesce(p_payload -> 'cycle_deductions', '[]'::jsonb)) c
  on conflict (outlet_id, source_system, source_ref)
  do update set amount_paise = excluded.amount_paise,
                period_start = excluded.period_start,
                period_end = excluded.period_end;

  if v_accepted_by is not null and v_difference is not null and abs(v_difference) > v_tolerance then
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref, accepted_by, accepted_at)
    values (v_outlet, v_channel, 'unexplained_settlement_difference',
            v_cycle_start, v_cycle_end, -v_difference,
            'owner', format('accepted::%s::%s', v_cycle_start, v_cycle_end),
            v_accepted_by, now())
    on conflict (outlet_id, source_system, source_ref) do nothing;
  end if;

  return jsonb_build_object(
    'outcome', 'ok',
    'days_written', v_written,
    'days_pending', coalesce(v_pending, ''),
    'deductions_before_boundary', v_deductions_skipped,
    'computed_paise', v_computed,
    'stated_payout_paise', v_stated_payout,
    'difference_paise', v_difference);
end;
$ingest$;
