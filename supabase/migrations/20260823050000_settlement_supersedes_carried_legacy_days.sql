-- A settlement takes over from carried legacy days.
--
-- The ingest treated every existing settled channel day as terminal, which was
-- written before this change carried typed Swiggy history into
-- aggregator_channel_days as settled rows with origin 'legacy_typed'. Left
-- alone, that guard made real settlements skip every date the carry had
-- already filled, silently keeping hand-typed guesses above measured facts.
--
-- The authority ladder in aggregator-figures decides: only a settlement
-- outranks legacy, and only while the incumbent is not itself a settlement.
-- Provisional reads still cannot reopen anything settled, and one settlement
-- never rewrites another.

create or replace function public.ingest_aggregator_cycle(p_payload jsonb, p_permitted_outlets uuid[])
returns jsonb
language plpgsql
security definer
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
      coalesce(p_payload ->> 'contract_version', 'none')
      using errcode = '22023';
  end if;

  v_outlet  := (p_payload ->> 'outlet_id')::uuid;
  v_channel := p_payload ->> 'channel';
  v_cycle_start := (p_payload ->> 'cycle_start')::date;
  v_cycle_end   := (p_payload ->> 'cycle_end')::date;
  v_state       := p_payload ->> 'cycle_state';
  -- Validated as text before it is cast: a decimal arriving here must be named,
  -- not survive until a cast raises somewhere it cannot be explained.
  if coalesce(p_payload ->> 'stated_payout_paise', '') <> ''
     and (p_payload ->> 'stated_payout_paise') !~ '^-?[0-9]+$' then
    raise exception 'stated_payout_paise is not an integer paise value: %',
      p_payload ->> 'stated_payout_paise' using errcode = '22023';
  end if;
  v_stated_payout := nullif(p_payload ->> 'stated_payout_paise', '')::bigint;
  v_accepted_by   := nullif(p_payload ->> 'accepted_by', '')::uuid;
  v_operator_cycle_ref := nullif(p_payload ->> 'operator_cycle_ref', '');
  v_bank_status        := nullif(p_payload ->> 'bank_status', '');
  v_source_ref         := nullif(p_payload ->> 'source_ref', '');
  v_as_of_at           := (p_payload ->> 'as_of_at')::timestamptz;
  v_restaurant_ref     := nullif(p_payload ->> 'restaurant_ref', '');

  if v_outlet is null or not (v_outlet = any (p_permitted_outlets)) then
    raise exception 'this credential may not write settlement for outlet %', v_outlet
      using errcode = '42501';
  end if;

  if v_channel not in ('zomato', 'swiggy') then
    raise exception 'unknown channel %', coalesce(v_channel, 'none')
      using errcode = '22023';
  end if;

  if v_state not in ('provisional', 'settled') then
    raise exception 'a cycle arrives provisional or settled, not %', v_state
      using errcode = '22023';
  end if;

  -- A settled conclusion needs an operator cycle identity. Swiggy names its
  -- own; the zomato reader predates references and derives a stable one from
  -- the start date — the same identity the previous schema implied — until its
  -- reader learns to carry the portal's.
  if v_state = 'settled' then
    if v_operator_cycle_ref is null then
      if v_channel <> 'zomato' then
        raise exception 'a settled % cycle names the operator''s own payout reference',
          v_channel using errcode = '22023';
      end if;
      v_operator_cycle_ref := v_cycle_start::text;
    end if;
  end if;

  if coalesce(v_operator_cycle_ref, '') = '' and v_state = 'settled' then
    raise exception 'an operator cycle reference cannot be blank' using errcode = '22023';
  end if;

  if v_bank_status is not null
     and v_bank_status not in ('pending', 'on_hold', 'paid') then
    raise exception 'bank status "%" is none of pending, on_hold, paid', v_bank_status
      using errcode = '22023';
  end if;

  select business_day_cutover into v_cutover from public.outlets where id = v_outlet;
  if v_cutover is null then
    raise exception 'unknown outlet %', v_outlet using errcode = '22023';
  end if;

  -- The restaurant identity resolves before any money moves. A reference that
  -- maps elsewhere would put this channel's trade behind another tenancy
  -- boundary, and a dormant one is kept visible precisely so nobody trades
  -- against it by accident.
  if v_restaurant_ref is not null then
    select r.outlet_id, r.state
      into v_mapped_outlet, v_map_state
      from public.outlet_channel_restaurants r
     where r.channel = v_channel
       and r.external_ref = v_restaurant_ref;

    if not found then
      raise exception 'restaurant % is not mapped for channel %',
        v_restaurant_ref, v_channel using errcode = '22023';
    end if;
    if v_mapped_outlet is distinct from v_outlet then
      raise exception 'restaurant % maps to another outlet', v_restaurant_ref
        using errcode = '22023';
    end if;
    if v_map_state <> 'enabled' then
      raise exception 'restaurant % is dormant for channel %',
        v_restaurant_ref, v_channel using errcode = '22023';
    end if;
  elsif v_channel = 'zomato' then
    -- The scheduled reader predates references; its payload resolves through
    -- this outlet's own mapping rows. Exactly one enabled reference must
    -- answer: none means unconfigured, and more than one means the legacy
    -- shorthand can no longer say which identity it means.
    select count(*) into v_incomplete
      from public.outlet_channel_restaurants r
     where r.channel = 'zomato'
       and r.outlet_id = v_outlet
       and r.state = 'enabled';

    if v_incomplete <> 1 then
      raise exception 'outlet % has % enabled zomato restaurant mappings; a '
                        'payload without restaurant_ref needs exactly one',
        v_outlet, v_incomplete using errcode = '22023';
    end if;

    select r.external_ref into v_restaurant_ref
      from public.outlet_channel_restaurants r
     where r.channel = 'zomato'
       and r.outlet_id = v_outlet
       and r.state = 'enabled';
  else
    raise exception 'a swiggy payload names its restaurant_ref'
      using errcode = '22023';
  end if;

  select synced_from into v_synced_from
    from public.outlet_channel_sync
   where outlet_id = v_outlet and channel = v_channel;

  if v_synced_from is null then
    raise exception 'the % sync is not switched on for outlet %', v_channel, v_outlet
      using errcode = '22023';
  end if;

  -- Money arrives as integers or the cycle is named and refused. A decimal
  -- that slipped a parser must not survive until a cast raises somewhere
  -- inside a sum, where the answer would name neither order nor field.
  select string_agg(distinct o ->> 'order_id' || '::' || m.key, ', ')
    into v_bad_money
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
         cross join lateral jsonb_each_text(o) m
   where m.key like '%_paise'
     and coalesce(m.value, '') <> ''
     and m.value !~ '^-?[0-9]+$';

  if v_bad_money is not null then
    raise exception 'these order figures are not integer paise: %', v_bad_money
      using errcode = '22023';
  end if;

  select string_agg(distinct m.key || '=' || m.value, ', ')
    into v_bad_money
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
         cross join lateral jsonb_each_text(d) m
   where m.key like '%_paise'
     and coalesce(m.value, '') <> ''
     and m.value !~ '^-?[0-9]+$';

  if v_bad_money is not null then
    raise exception 'these deduction figures are not integer paise: %', v_bad_money
      using errcode = '22023';
  end if;

  select string_agg(distinct m.key || '=' || m.value, ', ')
    into v_bad_money
    from jsonb_array_elements(coalesce(p_payload -> 'cycle_deductions', '[]'::jsonb)) c
         cross join lateral jsonb_each_text(c) m
   where m.key like '%_paise'
     and coalesce(m.value, '') <> ''
     and m.value !~ '^-?[0-9]+$';

  if v_bad_money is not null then
    raise exception 'these cycle-deduction figures are not integer paise: %', v_bad_money
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

  -- A settled day stores all three figures, so undetermined is not a settled
  -- answer. Provisional days keep the right to arrive with commission and
  -- payout still unknown.
  if v_state = 'settled' then
    select count(*) into v_incomplete
      from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
     where nullif(o ->> 'commission_paise', '') is null
        or nullif(o ->> 'net_paise', '') is null;

    if v_incomplete > 0 then
      raise exception 'a settled cycle carries every order''s commission and payout; '
                        '% do not', v_incomplete using errcode = '22023';
    end if;
  end if;

  select coalesce(sum((o ->> 'net_paise')::bigint), 0)
    into v_orders_net
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o;

  -- Every deduction counts here, recoveries included, whatever their date. This
  -- is what the payout is measured against, and it is deliberately not the same
  -- set as what gets written.
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

    -- The conclusion, whichever way it went, before anything acts on it.
    -- Bank status rides along as information about the transfer; it never
    -- decides the outcome and never resolves a dispute by arriving paid.
    insert into public.aggregator_cycle_reconciliations
      (outlet_id, channel, operator_cycle_ref, cycle_start, cycle_end,
       computed_paise, stated_payout_paise, outcome, accepted_at, bank_status)
    values (v_outlet, v_channel, v_operator_cycle_ref, v_cycle_start, v_cycle_end,
            v_computed, v_stated_payout,
            case when abs(v_difference) > v_tolerance then 'disputed'
                 else 'reconciled' end,
            case when abs(v_difference) > v_tolerance and v_accepted_by is not null
                 then now() else null end,
            v_bank_status)
    on conflict (outlet_id, channel, operator_cycle_ref) do update set
      cycle_end = excluded.cycle_end,
      computed_paise = excluded.computed_paise,
      stated_payout_paise = excluded.stated_payout_paise,
      outcome = excluded.outcome,
      bank_status = excluded.bank_status,
      -- An acceptance already recorded is not withdrawn by a later re-read.
      accepted_at = coalesce(public.aggregator_cycle_reconciliations.accepted_at,
                             excluded.accepted_at);

    if abs(v_difference) > v_tolerance and v_accepted_by is null then
      update public.aggregator_channel_days
         set settlement_state = 'disputed'
       where outlet_id = v_outlet
         and channel = v_channel
         and business_date between v_cycle_start and v_cycle_end
         and business_date >= v_synced_from
         and settlement_state = 'provisional';

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
    commission_paise bigint,
    net_paise bigint
  ) on commit drop;
  truncate table ingest_days;

  insert into ingest_days (business_date, gross_paise, commission_paise, net_paise)
  select public.app_business_date((o ->> 'placed_at')::timestamptz, v_cutover),
         sum((o ->> 'gross_paise')::bigint),
         case
           when count(*) filter (where (o ->> 'commission_paise') is null) > 0 then null
           else sum((o ->> 'commission_paise')::bigint)
         end,
         case
           when count(*) filter (where (o ->> 'net_paise') is null) > 0 then null
           else sum((o ->> 'net_paise')::bigint)
         end
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   group by 1;

  v_origin := case when v_state = 'settled' then 'settlement' else 'daily_reader' end;

  for v_day in select * from ingest_days order by business_date loop
    if v_day.business_date < v_synced_from then
      continue;
    end if;

    select * into v_existing
      from public.aggregator_channel_days
     where outlet_id = v_outlet
       and channel = v_channel
       and business_date = v_day.business_date;
    v_had := found;

    -- Settled is terminal: a later provisional read does not reopen a paid week.
        -- Settled is terminal: nothing reopens it except a settlement taking
    -- over from a lower authority. A provisional read never reopens a paid
    -- week, but an annexure settlement does supersede a carried legacy day,
    -- retaining what it replaced in the superseded columns below.
    if v_had
       and v_existing.settlement_state = 'settled'
       and (v_origin <> 'settlement' or v_existing.origin = 'settlement') then
      continue;
    end if;

    -- What this write replaces, whatever origin wrote it. A run that writes the
    -- same numbers replaces nothing and leaves the trace alone, which keeps a
    -- re-run from recording that a figure superseded itself.
    if v_had
       and (v_existing.revenue_paise, v_existing.commission_paise)
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

    -- Settling a provisional figure whose numbers moved keeps what they moved
    -- from, so no figure changes without a trace.
    if v_had
       and v_state = 'settled'
       and v_existing.settlement_state = 'provisional'
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
    on conflict (outlet_id, channel, business_date) do update
      set revenue_paise = excluded.revenue_paise,
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

  -- Information, not a refusal. These dates now hold figures; what they lack is
  -- a drawer count, which only a person can supply.
  select string_agg(i.business_date::text, ', ' order by i.business_date)
    into v_unrecorded
    from ingest_days i
   where i.business_date >= v_synced_from
     and not exists (
       select 1 from public.manual_ledger_days d
        where d.outlet_id = v_outlet and d.business_date = i.business_date);

  select count(*) into v_deductions_skipped
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
   where (d ->> 'spent_on')::date < v_synced_from
     and public.expense_category_reserved_owner(
           coalesce(nullif(d ->> 'category', ''), 'Other')) is null;

  -- Sourced deductions name their channel: a Swiggy TDS row and a Zomato TDS
  -- row are different facts even in the same week, and a replay of one must
  -- never update the other.
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description,
     source_system, source_ref, recorded_by)
  select v_outlet,
         (d ->> 'spent_on')::date,
         coalesce(nullif(d ->> 'category', ''), 'Other'),
         false,
         (d ->> 'amount_paise')::bigint,
         d ->> 'description',
         v_channel,
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
         v_channel,
         c ->> 'source_ref'
    from jsonb_array_elements(coalesce(p_payload -> 'cycle_deductions', '[]'::jsonb)) c
  on conflict (outlet_id, source_system, source_ref)
  do update set amount_paise = excluded.amount_paise,
                period_start = excluded.period_start,
                period_end = excluded.period_end;

  -- The acceptance names its channel and the operator's own cycle reference,
  -- so two channels disagreeing in the same dates hold two separate decisions.
  if v_accepted_by is not null and v_difference is not null and abs(v_difference) > v_tolerance then
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref, accepted_by, accepted_at)
    values (v_outlet, v_channel, 'unexplained_settlement_difference',
            v_cycle_start, v_cycle_end, -v_difference,
            'owner', format('accepted::%s::%s::%s', v_channel,
                            coalesce(v_operator_cycle_ref, v_cycle_start::text),
                            v_cycle_end),
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

