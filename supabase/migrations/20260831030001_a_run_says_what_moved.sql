-- What a run changed, worked out while both sides are still known.
--
-- `ingest_aggregator_cycle` already reads every affected day's stored figures
-- before it writes the incoming ones — `v_existing`, which it uses to compute
-- `superseded_*` and `provisional_*`. That read is the only moment the question
-- "did this figure move" has an answer: once the write commits, a day restated
-- identically is indistinguishable from a day touched, and a first measurement
-- looks like every other row.
--
-- So the diff is accumulated there and returned with the cycle's result. The
-- Edge Function carries it onto the run's row in the call it already makes;
-- the run's row does not exist yet from inside here (design D2).
--
-- **This runs after `retire_the_manual_ledger`, deliberately.** That migration
-- rewrites these two functions by reading their live definitions and doing
-- textual replaces on them — `manual_ledger_expenses` becomes `expenses`, and
-- the recorded-day check becomes a drawer-observation check. Ordered before it,
-- this file's accumulator survived only because its added predicate happened to
-- be formatted character-for-character like the string that migration searches
-- for; formatted differently, the rewrite would have raised and the deploy would
-- have stopped. So the bodies below are written against the schema that exists
-- after the retirement, and nothing rewrites them afterwards.
--
-- **This is the money path, and the accumulator is write-only bookkeeping.**
-- It reads what was already read and appends. No branch below it reads any of
-- it. Delete every accumulator line and this function writes byte-identical
-- rows — asserted directly by `45_a_run_says_what_moved.sql`, which runs a
-- fixture cycle through a frozen copy of the pre-change function and diffs
-- `aggregator_channel_days`, `expenses` and `aggregator_cycle_reconciliations`.
--
-- Money inside the summary is the same `bigint` integer paise the columns hold,
-- never formatted and never divided. Rupees happen at the display edge.

create or replace function public.ingest_aggregator_cycle(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
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
  -- The movement accumulator (#48).
  --
  -- Append-only bookkeeping over reads this function already makes. NOTHING
  -- below branches on any of these: delete every line touching them and this
  -- function writes byte-identical rows, which is the invariant
  -- `45_a_run_says_what_moved.sql` asserts directly.
  v_moved jsonb := '[]'::jsonb;
  v_settled jsonb := '[]'::jsonb;
  v_unwritten jsonb := '[]'::jsonb;
  v_read_from date;
  v_read_to date;
  v_read_days int := 0;
  v_prior_recon record;
  v_recon_had boolean;
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
    -- Read before the upsert so the summary can tell a settlement that moved
    -- from a sheet restating a fortnight-old week whose figures still match.
    -- The upsert itself is untouched.
    select computed_paise, stated_payout_paise, outcome
      into v_prior_recon
      from public.aggregator_cycle_reconciliations
     where outlet_id = v_outlet and channel = v_channel
       and operator_cycle_ref = v_operator_cycle_ref;
    v_recon_had := found;

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

    if not v_recon_had
       or (v_prior_recon.computed_paise, v_prior_recon.stated_payout_paise, v_prior_recon.outcome)
            is distinct from (
              v_computed, v_stated_payout,
              case when abs(v_difference) > v_tolerance then 'disputed' else 'reconciled' end
            ) then
      v_settled := v_settled || jsonb_build_array(jsonb_build_object(
        'cycle_start', v_cycle_start,
        'cycle_end', v_cycle_end,
        'operator_cycle_ref', v_operator_cycle_ref,
        'computed_paise', v_computed,
        'stated_payout_paise', v_stated_payout));
    end if;
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

  /*
   * The window this run considered, which is what makes "nothing moved" mean
   * something. A run that looked at seven days and found none of them changed
   * has said far more than one that only says "nothing", and after the write
   * commits there is nothing left to work it out from: the payload is gone.
   *
   * Counted from the boundary forward, because a day before the sync was
   * switched on is not considered — the loop skips it before reading anything.
   */
  select min(business_date), max(business_date), count(*)
    into v_read_from, v_read_to, v_read_days
    from ingest_days
   where business_date >= v_synced_from;

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

    -- Past the `continue` above, so a settled day this run may not touch
    -- contributes nothing, which is true rather than an omission (design D3).
    if not v_had then
      v_moved := v_moved || jsonb_build_array(jsonb_build_object(
        'business_date', v_day.business_date,
        'movement', 'first_measured',
        'from', null,
        'to', jsonb_build_object(
          'revenue_paise', v_day.gross_paise,
          'commission_paise', v_day.commission_paise,
          'net_paise', v_day.net_paise)));
    elsif (v_existing.revenue_paise, v_existing.commission_paise, v_existing.net_paise)
            is distinct from (v_day.gross_paise, v_day.commission_paise, v_day.net_paise) then
      v_moved := v_moved || jsonb_build_array(jsonb_build_object(
        'business_date', v_day.business_date,
        'movement', 'revised',
        'from', jsonb_build_object(
          'revenue_paise', v_existing.revenue_paise,
          'commission_paise', v_existing.commission_paise,
          'net_paise', v_existing.net_paise),
        'to', jsonb_build_object(
          'revenue_paise', v_day.gross_paise,
          'commission_paise', v_day.commission_paise,
          'net_paise', v_day.net_paise)));
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
     and not exists (select 1 from public.drawer_observations observation
                      join public.outlets outlet on outlet.id = observation.outlet_id
                     where observation.outlet_id = v_outlet
                       and public.app_business_date(
                         observation.counted_at - case when observation.is_legacy_imprecise
                           then interval '1 microsecond' else interval '0' end,
                         outlet.business_day_cutover) = i.business_date);
  -- The same dates, as data rather than prose, for the run's own summary.
  -- The predicate is the one directly above, so the sentence the owner reads
  -- and the list the history renders cannot disagree about which days are
  -- waiting on a count.
  select coalesce(jsonb_agg(i.business_date order by i.business_date), '[]'::jsonb)
    into v_unwritten
    from ingest_days i
   where i.business_date >= v_synced_from
     and not exists (select 1 from public.drawer_observations observation
                      join public.outlets outlet on outlet.id = observation.outlet_id
                     where observation.outlet_id = v_outlet
                       and public.app_business_date(
                         observation.counted_at - case when observation.is_legacy_imprecise
                           then interval '1 microsecond' else interval '0' end,
                         outlet.business_day_cutover) = i.business_date);

  select count(*) into v_deductions_skipped
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
   where (d ->> 'spent_on')::date < v_synced_from
     and public.expense_category_reserved_owner(coalesce(nullif(d ->> 'category', ''), 'Other')) is null;

  insert into public.expenses
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
  where public.expenses.voided_at is null;

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
    'difference_paise', v_difference,
    -- Carried out to the caller, which folds it onto the run's row. The run
    -- does not exist yet from in here (design D2), so this is as close to the
    -- writes as the record can get, and it is the close half that matters:
    -- the diff was taken while both sides were still known.
    'summary', jsonb_build_object(
      'version', 1,
      'read', case
        when v_read_days = 0 then null
        else jsonb_build_object('from', v_read_from, 'to', v_read_to, 'days', v_read_days)
      end,
      'days', v_moved,
      'cycles_settled', v_settled,
      'supply_orders', jsonb_build_object('added', 0, 'amended', 0),
      'dates_without_a_recorded_day', v_unwritten));
end;
$body$;

-- ---------------------------------------------------------------------------
-- The supplier's side of the same question.
--
-- A Hyperpure read that re-fetched a two-day-old statement already booked says
-- nothing about it, so the count is of orders that actually landed or actually
-- moved — not of rows the upsert touched. The prior figure is read before the
-- upsert for exactly the reason above: afterwards there is nothing to compare.

create or replace function public.ingest_supply_statement(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $body$
declare
  v_outlet uuid;
  v_source_system text;
  v_books_open date;
  v_written int := 0;
  v_order record;
  v_business_date date;
  -- Append-only bookkeeping (#48). Nothing below branches on either.
  v_added int := 0;
  v_amended int := 0;
  v_prior record;
  v_prior_had boolean;
begin
  if coalesce((p_payload ->> 'contract_version')::int, 0) <> 1 then
    raise exception 'unsupported contract version %',
      coalesce(p_payload ->> 'contract_version', 'none')
      using errcode = '22023';
  end if;

  v_outlet := (p_payload ->> 'outlet_id')::uuid;
  v_source_system := p_payload ->> 'source_system';

  if v_outlet is null or not (v_outlet = any (p_permitted_outlets)) then
    raise exception 'this credential may not write supply costs for outlet %', v_outlet
      using errcode = '42501';
  end if;

  -- A reserved category owns these rows, and only its own origin may write them.
  -- Refusing an unknown source here rather than letting the reserved-category
  -- trigger drop the row keeps the failure legible: a statement from a supplier
  -- the ledger does not recognise is a mistake to report, not a row to swallow.
  if public.expense_category_reserved_owner(p_payload ->> 'category')
       is distinct from v_source_system then
    raise exception 'the category % is not owned by the source %',
      p_payload ->> 'category', v_source_system
      using errcode = '22023';
  end if;

  -- The books' opening for this outlet: the earliest day the ledger already
  -- holds, whether a recorded day or an expense. An order invoiced before it is
  -- dated to it, so money that left an in-period payout lands inside the period
  -- the ledger covers rather than in one it does not.
  select least(
           (select min(business_date) from public.bills
             where outlet_id = v_outlet),
           (select min(business_date) from public.expenses
             where outlet_id = v_outlet),
           (select min(business_date) from public.aggregator_channel_days
             where outlet_id = v_outlet))
    into v_books_open;

  for v_order in
    select o ->> 'order_ref' as order_ref,
           (o ->> 'invoice_date')::date as invoice_date,
           (o ->> 'amount_paise')::bigint as amount_paise,
           coalesce(nullif(o ->> 'description', ''), p_payload ->> 'category') as description,
           coalesce((o ->> 'shared_cost')::boolean, false) as shared_cost
      from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
  loop
    if v_order.order_ref is null or length(btrim(v_order.order_ref)) = 0 then
      raise exception 'a supply order carries no reference and cannot be deduplicated'
        using errcode = '22023';
    end if;

    v_business_date := greatest(v_order.invoice_date, coalesce(v_books_open, v_order.invoice_date));

    select amount_paise, business_date, description, category, shared_cost, voided_at
      into v_prior
      from public.expenses
     where outlet_id = v_outlet
       and source_system = v_source_system
       and source_ref = v_order.order_ref;
    v_prior_had := found;

    insert into public.expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description,
       source_system, source_ref, shared_cost, recorded_by)
    values (v_outlet, v_business_date, p_payload ->> 'category', false,
            v_order.amount_paise, v_order.description,
            v_source_system, v_order.order_ref, v_order.shared_cost, null)
    on conflict (outlet_id, source_system, source_ref) where source_system is not null
    do update set amount_paise = excluded.amount_paise,
                  business_date = excluded.business_date,
                  description = excluded.description,
                  category = excluded.category,
                  shared_cost = excluded.shared_cost
    where public.expenses.voided_at is null;

    if not v_prior_had then
      v_added := v_added + 1;
    elsif v_prior.voided_at is null
          and (v_prior.amount_paise, v_prior.business_date, v_prior.description,
               v_prior.category, v_prior.shared_cost)
                is distinct from (v_order.amount_paise, v_business_date, v_order.description,
                                  p_payload ->> 'category', v_order.shared_cost) then
      v_amended := v_amended + 1;
    end if;

    v_written := v_written + 1;
  end loop;

  return jsonb_build_object(
    'outcome', 'ok',
    'orders_written', v_written,
    'summary', jsonb_build_object(
      'version', 1,
      -- A statement is not a window of business days, so this reader has no
      -- range to report. Its own count of orders is below.
      'read', null,
      'days', '[]'::jsonb,
      'cycles_settled', '[]'::jsonb,
      'supply_orders', jsonb_build_object('added', v_added, 'amended', v_amended),
      'dates_without_a_recorded_day', '[]'::jsonb));
end;
$body$;
