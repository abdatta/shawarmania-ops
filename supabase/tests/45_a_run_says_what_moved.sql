-- Recording what a run changed changes nothing a run writes.
--
-- `ingest_aggregator_cycle` writes settlement money under `security definer`
-- and has been rewritten nine times. #48 adds an accumulator to it, and a
-- summary is worth nothing next to a wrong figure — so the claim that the
-- accumulator is write-only bookkeeping is asserted rather than reasoned about.
--
-- **How.** A frozen copy of the pre-change function is created below as
-- `pg_temp.ingest_before`, lifted verbatim from
-- `20260825000000_live_daily_reader_supersedes_typed_history.sql`. Each fixture
-- cycle is run through it inside a savepoint, the three tables it writes are
-- photographed, the savepoint is rolled back, and the same cycle is run through
-- the live function and photographed again. The two photographs must be equal.
--
-- Both runs happen inside one transaction, so `now()` is the same instant in
-- each and every timestamp the functions write compares equal. Only `id` is
-- dropped from the comparison, because a fresh insert draws a fresh uuid by
-- construction and that is not a difference in what was written.
--
-- The cases are cumulative on purpose: each starts from the state the previous
-- one's live run left, so the chain has to stay identical rather than only the
-- first step.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

alter table public.outlet_channel_sync disable trigger outlet_channel_sync_guarded;
insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
values ('00000000-0000-4000-a000-000000000001', 'zomato',
        public.app_business_date(now(), time '04:00') - 60)
on conflict (outlet_id, channel) do update set synced_from = excluded.synced_from;
alter table public.outlet_channel_sync enable trigger outlet_channel_sync_guarded;

insert into public.outlet_channel_restaurants (outlet_id, channel, external_ref, state)
values ('00000000-0000-4000-a000-000000000001', 'zomato', '21917311', 'enabled')
on conflict do nothing;

\set KAL '00000000-0000-4000-a000-000000000001'

create function pg_temp.day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

create function pg_temp.at_ist(d date, clock time)
returns timestamptz language sql stable as $$
  select ((d + clock) at time zone 'Asia/Kolkata')
$$;

create function pg_temp.outlets()
returns uuid[] language sql stable as $$
  select array['00000000-0000-4000-a000-000000000001'::uuid]
$$;

-- One recorded day and one deliberately without, so the summary's
-- "dates_without_a_recorded_day" has something true to say.
insert into public.manual_ledger_days
  (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
   cash_revenue_paise, recorded_by)
values ('00000000-0000-4000-a000-000000000001',
        public.app_business_date(now(), time '04:00') - 20,
        500000, 500000, 0, '10000000-0000-4000-a000-000000000001')
on conflict (outlet_id, business_date) do nothing;

/*
 * Everything the two functions can write, photographed.
 *
 * `id` is dropped because a re-inserted row draws a new uuid either way. Every
 * other column is compared as stored, timestamps included — both runs sit
 * inside one transaction, so `now()` cannot differ between them.
 */
create function pg_temp.snapshot()
returns jsonb language sql as $$
  select jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(to_jsonb(t) - 'id' order by t.channel, t.business_date)
        from public.aggregator_channel_days t
       where t.outlet_id = '00000000-0000-4000-a000-000000000001'), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(to_jsonb(e) - 'id' order by e.source_system, e.source_ref, e.business_date)
        from public.manual_ledger_expenses e
       where e.outlet_id = '00000000-0000-4000-a000-000000000001'), '[]'::jsonb),
    'reconciliations', coalesce((
      select jsonb_agg(to_jsonb(r) - 'id' order by r.channel, r.operator_cycle_ref)
        from public.aggregator_cycle_reconciliations r
       where r.outlet_id = '00000000-0000-4000-a000-000000000001'), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- The frozen pre-change function, lifted verbatim. It is duplication, and it is
-- the point: a copy that drifted with the live one would assert nothing.

create function pg_temp.ingest_before(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_outlet uuid;
  v_channel text;
  v_restaurant_ref text;
  v_mapped_outlet uuid;
  v_map_state text;
  v_operator_cycle_ref text;
  v_bank_status text;
  v_source_ref text;
  v_as_of_at timestamptz;
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
  v_bad_money text;
  v_incomplete int;
  v_written int := 0;
  v_unrecorded text;
  v_day record;
  v_existing record;
  v_had boolean;
  v_origin text;
  v_sup_revenue bigint;
  v_sup_commission bigint;
  v_sup_at timestamptz;
  v_prov_revenue bigint;
  v_prov_commission bigint;
  v_revised_at timestamptz;
  v_tolerance constant bigint := 100;
  v_synced_from date;
  v_deductions_skipped int := 0;
begin
  if coalesce((p_payload ->> 'contract_version')::int, 0) <> 1 then
    raise exception 'unsupported contract version %',
      coalesce(p_payload ->> 'contract_version', 'none') using errcode = '22023';
  end if;

  v_outlet := (p_payload ->> 'outlet_id')::uuid;
  v_channel := p_payload ->> 'channel';
  v_cycle_start := (p_payload ->> 'cycle_start')::date;
  v_cycle_end := (p_payload ->> 'cycle_end')::date;
  v_state := p_payload ->> 'cycle_state';
  if coalesce(p_payload ->> 'stated_payout_paise', '') <> ''
     and (p_payload ->> 'stated_payout_paise') !~ '^-?[0-9]+$' then
    raise exception 'stated_payout_paise is not an integer paise value: %',
      p_payload ->> 'stated_payout_paise' using errcode = '22023';
  end if;
  v_stated_payout := nullif(p_payload ->> 'stated_payout_paise', '')::bigint;
  v_accepted_by := nullif(p_payload ->> 'accepted_by', '')::uuid;
  v_operator_cycle_ref := nullif(p_payload ->> 'operator_cycle_ref', '');
  v_bank_status := nullif(p_payload ->> 'bank_status', '');
  v_source_ref := nullif(p_payload ->> 'source_ref', '');
  v_as_of_at := (p_payload ->> 'as_of_at')::timestamptz;
  v_restaurant_ref := nullif(p_payload ->> 'restaurant_ref', '');

  if v_outlet is null or not (v_outlet = any (p_permitted_outlets)) then
    raise exception 'this credential may not write settlement for outlet %', v_outlet
      using errcode = '42501';
  end if;
  if v_channel not in ('zomato', 'swiggy') then
    raise exception 'unknown channel %', coalesce(v_channel, 'none') using errcode = '22023';
  end if;
  if v_state not in ('provisional', 'settled') then
    raise exception 'a cycle arrives provisional or settled, not %', v_state using errcode = '22023';
  end if;

  if v_state = 'settled' and v_operator_cycle_ref is null then
    if v_channel <> 'zomato' then
      raise exception 'a settled % cycle names the operator''s own payout reference',
        v_channel using errcode = '22023';
    end if;
    v_operator_cycle_ref := v_cycle_start::text;
  end if;
  if coalesce(v_operator_cycle_ref, '') = '' and v_state = 'settled' then
    raise exception 'an operator cycle reference cannot be blank' using errcode = '22023';
  end if;
  if v_bank_status is not null and v_bank_status not in ('pending', 'on_hold', 'paid') then
    raise exception 'bank status "%" is none of pending, on_hold, paid', v_bank_status
      using errcode = '22023';
  end if;

  select business_day_cutover into v_cutover from public.outlets where id = v_outlet;
  if v_cutover is null then
    raise exception 'unknown outlet %', v_outlet using errcode = '22023';
  end if;

  if v_restaurant_ref is not null then
    select r.outlet_id, r.state into v_mapped_outlet, v_map_state
      from public.outlet_channel_restaurants r
     where r.channel = v_channel and r.external_ref = v_restaurant_ref;
    if not found then
      raise exception 'restaurant % is not mapped for channel %', v_restaurant_ref, v_channel
        using errcode = '22023';
    end if;
    if v_mapped_outlet is distinct from v_outlet then
      raise exception 'restaurant % maps to another outlet', v_restaurant_ref using errcode = '22023';
    end if;
    if v_map_state <> 'enabled' then
      raise exception 'restaurant % is dormant for channel %', v_restaurant_ref, v_channel
        using errcode = '22023';
    end if;
  elsif v_channel = 'zomato' then
    select count(*) into v_incomplete from public.outlet_channel_restaurants r
     where r.channel = 'zomato' and r.outlet_id = v_outlet and r.state = 'enabled';
    if v_incomplete <> 1 then
      raise exception 'outlet % has % enabled zomato restaurant mappings; a payload without restaurant_ref needs exactly one',
        v_outlet, v_incomplete using errcode = '22023';
    end if;
    select r.external_ref into v_restaurant_ref from public.outlet_channel_restaurants r
     where r.channel = 'zomato' and r.outlet_id = v_outlet and r.state = 'enabled';
  else
    raise exception 'a swiggy payload names its restaurant_ref' using errcode = '22023';
  end if;

  select synced_from into v_synced_from from public.outlet_channel_sync
   where outlet_id = v_outlet and channel = v_channel;
  if v_synced_from is null then
    raise exception 'the % sync is not switched on for outlet %', v_channel, v_outlet
      using errcode = '22023';
  end if;

  select string_agg(distinct o ->> 'order_id' || '::' || m.key, ', ') into v_bad_money
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
    cross join lateral jsonb_each_text(o) m
   where m.key like '%_paise' and coalesce(m.value, '') <> '' and m.value !~ '^-?[0-9]+$';
  if v_bad_money is not null then
    raise exception 'these order figures are not integer paise: %', v_bad_money using errcode = '22023';
  end if;
  select string_agg(distinct m.key || '=' || m.value, ', ') into v_bad_money
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
    cross join lateral jsonb_each_text(d) m
   where m.key like '%_paise' and coalesce(m.value, '') <> '' and m.value !~ '^-?[0-9]+$';
  if v_bad_money is not null then
    raise exception 'these deduction figures are not integer paise: %', v_bad_money using errcode = '22023';
  end if;
  select string_agg(distinct m.key || '=' || m.value, ', ') into v_bad_money
    from jsonb_array_elements(coalesce(p_payload -> 'cycle_deductions', '[]'::jsonb)) c
    cross join lateral jsonb_each_text(c) m
   where m.key like '%_paise' and coalesce(m.value, '') <> '' and m.value !~ '^-?[0-9]+$';
  if v_bad_money is not null then
    raise exception 'these cycle-deduction figures are not integer paise: %', v_bad_money
      using errcode = '22023';
  end if;
  select string_agg(o ->> 'order_id', ', ') into v_unattributed
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   where nullif(o ->> 'placed_at', '') is null;
  if v_unattributed is not null then
    raise exception 'these orders carry no placement time and were not written: %', v_unattributed
      using errcode = '22023';
  end if;

  if v_state = 'settled' then
    select count(*) into v_incomplete
      from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
     where nullif(o ->> 'commission_paise', '') is null or nullif(o ->> 'net_paise', '') is null;
    if v_incomplete > 0 then
      raise exception 'a settled cycle carries every order''s commission and payout; % do not', v_incomplete
        using errcode = '22023';
    end if;
  end if;

  select coalesce(sum((o ->> 'net_paise')::bigint), 0) into v_orders_net
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o;
  select coalesce(sum((d ->> 'amount_paise')::bigint), 0) into v_deductions
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d;
  select coalesce(sum((c ->> 'amount_paise')::bigint), 0) into v_cycle_deductions
    from jsonb_array_elements(coalesce(p_payload -> 'cycle_deductions', '[]'::jsonb)) c;
  v_computed := v_orders_net + v_cycle_deductions - v_deductions;
  v_difference := case when v_stated_payout is null then null else v_computed - v_stated_payout end;

  if v_state = 'settled' then
    if v_stated_payout is null then
      raise exception 'a settled cycle must state the payout it is reconciled against' using errcode = '22023';
    end if;
    insert into public.aggregator_cycle_reconciliations
      (outlet_id, channel, operator_cycle_ref, cycle_start, cycle_end,
       computed_paise, stated_payout_paise, outcome, accepted_at, bank_status)
    values (v_outlet, v_channel, v_operator_cycle_ref, v_cycle_start, v_cycle_end,
            v_computed, v_stated_payout,
            case when abs(v_difference) > v_tolerance then 'disputed' else 'reconciled' end,
            case when abs(v_difference) > v_tolerance and v_accepted_by is not null then now() else null end,
            v_bank_status)
    on conflict (outlet_id, channel, operator_cycle_ref) do update set
      cycle_end = excluded.cycle_end,
      computed_paise = excluded.computed_paise,
      stated_payout_paise = excluded.stated_payout_paise,
      outcome = excluded.outcome,
      bank_status = excluded.bank_status,
      accepted_at = coalesce(public.aggregator_cycle_reconciliations.accepted_at, excluded.accepted_at);
    if abs(v_difference) > v_tolerance and v_accepted_by is null then
      update public.aggregator_channel_days set settlement_state = 'disputed'
       where outlet_id = v_outlet and channel = v_channel
         and business_date between v_cycle_start and v_cycle_end
         and business_date >= v_synced_from and settlement_state = 'provisional';
      return jsonb_build_object(
        'outcome', 'reconciliation_failed', 'computed_paise', v_computed,
        'stated_payout_paise', v_stated_payout, 'difference_paise', v_difference);
    end if;
  end if;

  create temporary table if not exists ingest_days (
    business_date date primary key,
    gross_paise bigint,
    commission_paise bigint,
    net_paise bigint
  ) on commit drop;
  truncate table ingest_days;
  insert into ingest_days (business_date, gross_paise, commission_paise, net_paise)
  select public.app_business_date((o ->> 'placed_at')::timestamptz, v_cutover),
         sum((o ->> 'gross_paise')::bigint),
         case when count(*) filter (where (o ->> 'commission_paise') is null) > 0 then null
              else sum((o ->> 'commission_paise')::bigint) end,
         case when count(*) filter (where (o ->> 'net_paise') is null) > 0 then null
              else sum((o ->> 'net_paise')::bigint) end
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   group by 1;

  v_origin := case when v_state = 'settled' then 'settlement' else 'daily_reader' end;
  for v_day in select * from ingest_days order by business_date loop
    if v_day.business_date < v_synced_from then continue; end if;
    select * into v_existing from public.aggregator_channel_days
     where outlet_id = v_outlet and channel = v_channel and business_date = v_day.business_date;
    v_had := found;

    -- A portal daily read can overrule only typed carry; neither a real payout
    -- nor a supplied operator statement may reopen before its own settlement.
    if v_had and v_existing.settlement_state = 'settled'
       and (v_existing.origin = 'settlement'
            or (v_origin <> 'settlement' and v_existing.origin <> 'legacy_typed')) then
      continue;
    end if;

    if v_had and (v_existing.revenue_paise, v_existing.commission_paise)
                    is distinct from (v_day.gross_paise, v_day.commission_paise) then
      v_sup_revenue := v_existing.revenue_paise;
      v_sup_commission := v_existing.commission_paise;
      v_sup_at := now();
    elsif v_had then
      v_sup_revenue := v_existing.superseded_revenue_paise;
      v_sup_commission := v_existing.superseded_commission_paise;
      v_sup_at := v_existing.superseded_at;
    else
      v_sup_revenue := null;
      v_sup_commission := null;
      v_sup_at := null;
    end if;

    if v_had and v_state = 'settled' and v_existing.settlement_state = 'provisional'
       and (v_existing.revenue_paise, v_existing.commission_paise)
             is distinct from (v_day.gross_paise, v_day.commission_paise) then
      v_prov_revenue := v_existing.revenue_paise;
      v_prov_commission := v_existing.commission_paise;
      v_revised_at := now();
    elsif v_had then
      v_prov_revenue := v_existing.provisional_revenue_paise;
      v_prov_commission := v_existing.provisional_commission_paise;
      v_revised_at := v_existing.revised_at;
    else
      v_prov_revenue := null;
      v_prov_commission := null;
      v_revised_at := null;
    end if;

    insert into public.aggregator_channel_days
      (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
       settlement_state, origin, source_ref, as_of_at,
       superseded_revenue_paise, superseded_commission_paise, superseded_at,
       provisional_revenue_paise, provisional_commission_paise, revised_at)
    values (v_outlet, v_channel, v_day.business_date,
            v_day.gross_paise, v_day.commission_paise, v_day.net_paise,
            v_state, v_origin, v_source_ref, v_as_of_at,
            v_sup_revenue, v_sup_commission, v_sup_at,
            v_prov_revenue, v_prov_commission, v_revised_at)
    on conflict (outlet_id, channel, business_date) do update set
      revenue_paise = excluded.revenue_paise,
      commission_paise = excluded.commission_paise,
      net_paise = excluded.net_paise,
      settlement_state = excluded.settlement_state,
      origin = excluded.origin,
      source_ref = excluded.source_ref,
      as_of_at = excluded.as_of_at,
      superseded_revenue_paise = excluded.superseded_revenue_paise,
      superseded_commission_paise = excluded.superseded_commission_paise,
      superseded_at = excluded.superseded_at,
      provisional_revenue_paise = excluded.provisional_revenue_paise,
      provisional_commission_paise = excluded.provisional_commission_paise,
      revised_at = excluded.revised_at;
    v_written := v_written + 1;
  end loop;

  select string_agg(i.business_date::text, ', ' order by i.business_date) into v_unrecorded
    from ingest_days i
   where i.business_date >= v_synced_from
     and not exists (select 1 from public.manual_ledger_days d
                      where d.outlet_id = v_outlet and d.business_date = i.business_date);
  select count(*) into v_deductions_skipped
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
   where (d ->> 'spent_on')::date < v_synced_from
     and public.expense_category_reserved_owner(coalesce(nullif(d ->> 'category', ''), 'Other')) is null;

  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description,
     source_system, source_ref, recorded_by)
  select v_outlet, (d ->> 'spent_on')::date,
         coalesce(nullif(d ->> 'category', ''), 'Other'), false,
         (d ->> 'amount_paise')::bigint, d ->> 'description',
         v_channel, d ->> 'source_ref', null
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
  select v_outlet, v_channel, c ->> 'kind', (c ->> 'period_start')::date,
         (c ->> 'period_end')::date, (c ->> 'amount_paise')::bigint,
         v_channel, c ->> 'source_ref'
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
            v_cycle_start, v_cycle_end, -v_difference, 'owner',
            format('accepted::%s::%s::%s', v_channel,
                   coalesce(v_operator_cycle_ref, v_cycle_start::text), v_cycle_end),
            v_accepted_by, now())
    on conflict (outlet_id, source_system, source_ref) do nothing;
  end if;

  return jsonb_build_object(
    'outcome', 'ok',
    'days_written', v_written,
    'days_without_a_recorded_day', coalesce(v_unrecorded, ''),
    'deductions_before_boundary', v_deductions_skipped,
    'computed_paise', v_computed,
    'stated_payout_paise', v_stated_payout,
    'difference_paise', v_difference);
end;
$$;

-- ---------------------------------------------------------------------------
-- The five fixture cycles, each a way a figure can or cannot move.

create function pg_temp.payload(n int)
returns jsonb language sql stable as $payload$
  select case n
    -- 1. Two days measured for the first time, plus a deduction.
    when 1 then jsonb_build_object(
      'contract_version', 1, 'outlet_id', (pg_temp.outlets())[1], 'channel', 'zomato',
      'cycle_start', pg_temp.day(20), 'cycle_end', pg_temp.day(14),
      'cycle_state', 'provisional', 'as_of_at', now(),
      'orders', jsonb_build_array(
        jsonb_build_object('order_id', 'B1', 'placed_at', pg_temp.at_ist(pg_temp.day(20), '13:20'),
                           'gross_paise', 300000, 'commission_paise', 84000, 'net_paise', 216000),
        jsonb_build_object('order_id', 'B2', 'placed_at', pg_temp.at_ist(pg_temp.day(19), '20:05'),
                           'gross_paise', 150000, 'commission_paise', 42000, 'net_paise', 108000)),
      'deductions', jsonb_build_array(
        jsonb_build_object('spent_on', pg_temp.day(19), 'amount_paise', 25000,
                           'category', 'Other', 'description', 'promotion',
                           'source_ref', 'D-1')))
    -- 2. The same two days, one of them moved.
    when 2 then jsonb_build_object(
      'contract_version', 1, 'outlet_id', (pg_temp.outlets())[1], 'channel', 'zomato',
      'cycle_start', pg_temp.day(20), 'cycle_end', pg_temp.day(14),
      'cycle_state', 'provisional', 'as_of_at', now(),
      'orders', jsonb_build_array(
        jsonb_build_object('order_id', 'B1', 'placed_at', pg_temp.at_ist(pg_temp.day(20), '13:20'),
                           'gross_paise', 291000, 'commission_paise', 81480, 'net_paise', 209520),
        jsonb_build_object('order_id', 'B2', 'placed_at', pg_temp.at_ist(pg_temp.day(19), '20:05'),
                           'gross_paise', 150000, 'commission_paise', 42000, 'net_paise', 108000)),
      'deductions', jsonb_build_array(
        jsonb_build_object('spent_on', pg_temp.day(19), 'amount_paise', 25000,
                           'category', 'Other', 'description', 'promotion',
                           'source_ref', 'D-1')))
    -- 3. Byte for byte what case 2 sent: a restatement that moved nothing.
    when 3 then pg_temp.payload(2)
    -- 4. The cycle settling against the payout it states.
    when 4 then jsonb_build_object(
      'contract_version', 1, 'outlet_id', (pg_temp.outlets())[1], 'channel', 'zomato',
      'cycle_start', pg_temp.day(20), 'cycle_end', pg_temp.day(14),
      'cycle_state', 'settled', 'as_of_at', now(),
      'operator_cycle_ref', 'PAYOUT-48-1',
      'stated_payout_paise', 317520,
      'orders', jsonb_build_array(
        jsonb_build_object('order_id', 'B1', 'placed_at', pg_temp.at_ist(pg_temp.day(20), '13:20'),
                           'gross_paise', 291000, 'commission_paise', 81480, 'net_paise', 209520),
        jsonb_build_object('order_id', 'B2', 'placed_at', pg_temp.at_ist(pg_temp.day(19), '20:05'),
                           'gross_paise', 150000, 'commission_paise', 42000, 'net_paise', 108000)))
    -- 5. A daily read over days that have already been paid: every one of them
    --    hits `continue` before the upsert, so nothing is read or written.
    when 5 then jsonb_build_object(
      'contract_version', 1, 'outlet_id', (pg_temp.outlets())[1], 'channel', 'zomato',
      'cycle_start', pg_temp.day(20), 'cycle_end', pg_temp.day(14),
      'cycle_state', 'provisional', 'as_of_at', now(),
      'orders', jsonb_build_array(
        jsonb_build_object('order_id', 'B1', 'placed_at', pg_temp.at_ist(pg_temp.day(20), '13:20'),
                           'gross_paise', 999999, 'commission_paise', 1, 'net_paise', 999998),
        jsonb_build_object('order_id', 'B2', 'placed_at', pg_temp.at_ist(pg_temp.day(19), '20:05'),
                           'gross_paise', 888888, 'commission_paise', 1, 'net_paise', 888887)))
  end
$payload$;

-- ---------------------------------------------------------------------------
-- Case 1 — a first measurement.

savepoint before_1;
select pg_temp.ingest_before(pg_temp.payload(1), pg_temp.outlets());
select pg_temp.snapshot()::text as snap_1 \gset
rollback to savepoint before_1;
select public.ingest_aggregator_cycle(pg_temp.payload(1), pg_temp.outlets())::text as after_1 \gset
select is(pg_temp.snapshot(), :'snap_1'::jsonb,
  'a first measurement writes exactly what it wrote before summaries existed');

select is(
  jsonb_array_length(:'after_1'::jsonb -> 'summary' -> 'days'), 2,
  'both days measured for the first time enter the summary');
select is(
  (:'after_1'::jsonb -> 'summary' -> 'days' -> 0 ->> 'movement'), 'first_measured',
  'a day nothing was stored for is reported as a first measurement, not a revision');
select is(
  (:'after_1'::jsonb -> 'summary' -> 'days' -> 0 -> 'from')::text, 'null',
  'a first measurement has no figure it came from');
select is(
  (:'after_1'::jsonb -> 'summary' -> 'days' -> 0 -> 'to' ->> 'revenue_paise'), '300000',
  'the summary carries integer paise, the same value the column holds');
select is(
  :'after_1'::jsonb -> 'summary' -> 'dates_without_a_recorded_day',
  jsonb_build_array(pg_temp.day(19)),
  'the day with no recorded ledger row is named, and the recorded one is not');

-- ---------------------------------------------------------------------------
-- Case 2 — a revision.

savepoint before_2;
select pg_temp.ingest_before(pg_temp.payload(2), pg_temp.outlets());
select pg_temp.snapshot()::text as snap_2 \gset
rollback to savepoint before_2;
select public.ingest_aggregator_cycle(pg_temp.payload(2), pg_temp.outlets())::text as after_2 \gset
select is(pg_temp.snapshot(), :'snap_2'::jsonb,
  'a revision writes exactly what it wrote before summaries existed');

select is(
  jsonb_array_length(:'after_2'::jsonb -> 'summary' -> 'days'), 1,
  'only the day that moved is in the summary; the one that matched is not');
select is(
  (:'after_2'::jsonb -> 'summary' -> 'days' -> 0 ->> 'movement'), 'revised',
  'a stored figure that changed is reported as a revision');
select is(
  (:'after_2'::jsonb -> 'summary' -> 'days' -> 0 -> 'from' ->> 'revenue_paise'), '300000',
  'the summary says what the figure changed FROM, which nothing else can say later');
select is(
  (:'after_2'::jsonb -> 'summary' -> 'days' -> 0 -> 'to' ->> 'revenue_paise'), '291000',
  'and what it changed to');

-- ---------------------------------------------------------------------------
-- Case 3 — an identical restatement.

savepoint before_3;
select pg_temp.ingest_before(pg_temp.payload(3), pg_temp.outlets());
select pg_temp.snapshot()::text as snap_3 \gset
rollback to savepoint before_3;
select public.ingest_aggregator_cycle(pg_temp.payload(3), pg_temp.outlets())::text as after_3 \gset
select is(pg_temp.snapshot(), :'snap_3'::jsonb,
  'an identical restatement writes exactly what it wrote before summaries existed');

select is(
  (:'after_3'::jsonb -> 'summary' -> 'days')::text, '[]',
  'a run that restated the same figures reports no movement, which is the distinction the whole recording exists to preserve');

-- ---------------------------------------------------------------------------
-- Case 4 — the cycle settles.

savepoint before_4;
select pg_temp.ingest_before(pg_temp.payload(4), pg_temp.outlets());
select pg_temp.snapshot()::text as snap_4 \gset
rollback to savepoint before_4;
select public.ingest_aggregator_cycle(pg_temp.payload(4), pg_temp.outlets())::text as after_4 \gset
select is(pg_temp.snapshot(), :'snap_4'::jsonb,
  'a settlement writes exactly what it wrote before summaries existed');

select is(
  jsonb_array_length(:'after_4'::jsonb -> 'summary' -> 'cycles_settled'), 1,
  'the week that settled is named');
select is(
  (:'after_4'::jsonb -> 'summary' -> 'cycles_settled' -> 0 ->> 'stated_payout_paise'), '317520',
  'against the payout it was reconciled to, in integer paise');

-- ---------------------------------------------------------------------------
-- Case 5 — a payload of days that have already been paid.

savepoint before_5;
select pg_temp.ingest_before(pg_temp.payload(5), pg_temp.outlets());
select pg_temp.snapshot()::text as snap_5 \gset
rollback to savepoint before_5;
select public.ingest_aggregator_cycle(pg_temp.payload(5), pg_temp.outlets())::text as after_5 \gset
select is(pg_temp.snapshot(), :'snap_5'::jsonb,
  'a payload of already-settled days writes exactly what it wrote before, which is nothing');

select is(
  (:'after_5'::jsonb -> 'summary' -> 'days')::text, '[]',
  'a day skipped before the upsert is not read and not summarised, which is true rather than an omission');
select is(
  (:'after_5'::jsonb -> 'summary' -> 'cycles_settled')::text, '[]',
  'and re-reading a week already reconciled to the same payout says nothing about it');

-- ---------------------------------------------------------------------------
-- The supplier's side: only an order that landed or moved is counted.

select is(
  public.ingest_supply_statement(jsonb_build_object(
    'contract_version', 1, 'outlet_id', (pg_temp.outlets())[1],
    'source_system', 'hyperpure', 'category', 'Hyperpure',
    'orders', jsonb_build_array(
      jsonb_build_object('order_ref', 'HP-1', 'invoice_date', pg_temp.day(19),
                         'amount_paise', 410000),
      jsonb_build_object('order_ref', 'HP-2', 'invoice_date', pg_temp.day(18),
                         'amount_paise', 220000))
  ), pg_temp.outlets()) -> 'summary' -> 'supply_orders',
  jsonb_build_object('added', 2, 'amended', 0),
  'two orders the ledger had never seen are two orders added');

select is(
  public.ingest_supply_statement(jsonb_build_object(
    'contract_version', 1, 'outlet_id', (pg_temp.outlets())[1],
    'source_system', 'hyperpure', 'category', 'Hyperpure',
    'orders', jsonb_build_array(
      jsonb_build_object('order_ref', 'HP-1', 'invoice_date', pg_temp.day(19),
                         'amount_paise', 410000),
      jsonb_build_object('order_ref', 'HP-2', 'invoice_date', pg_temp.day(18),
                         'amount_paise', 231500))
  ), pg_temp.outlets()) -> 'summary' -> 'supply_orders',
  jsonb_build_object('added', 0, 'amended', 1),
  're-reading the same statement reports only the order whose figure actually moved');

-- ---------------------------------------------------------------------------
-- The recorder carries both columns, and refuses a third word.

select lives_ok($$
  select public.record_aggregator_sync_run(
    '00000000-0000-4000-a000-000000000001', 'zomato', now(), 'ok', null, false,
    'owner', '{"version":1,"days":[]}'::jsonb)
$$, 'a run records how it began and what it changed');

select is(
  (select started_by from public.aggregator_sync_runs
    where outlet_id = '00000000-0000-4000-a000-000000000001' and started_by is not null
    order by created_at desc limit 1),
  'owner', 'the word the runner posted is the word stored');

select throws_ok($$
  insert into public.aggregator_sync_runs
    (outlet_id, channel, started_at, outcome, started_by)
  values ('00000000-0000-4000-a000-000000000001', 'zomato', now(), 'ok', 'guessed')
$$, '23514', null, 'a run cannot claim to have begun in a way the vocabulary does not have');

select * from finish();
rollback;
