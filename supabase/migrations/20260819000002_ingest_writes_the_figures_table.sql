-- The write contract targets the figures table, and stops refusing a day nobody
-- recorded.
--
-- Until now a measured figure could only attach to a day row that already
-- existed, because that is where the columns were. Every run since go-live has
-- reported dates it could not write for that reason: 10 August at Kalyani and
-- 14 August at Kanchrapara among them. The refusal was right while the figures
-- lived on the day row, because writing one meant creating a row that requires
-- an opening balance and a drawer count nobody took.
--
-- The figures now have their own row, so the refusal has nothing left to protect.
-- A date with no ledger row gets its figures, and the count of such dates is
-- reported as information rather than as a failure: the owner asked to see what
-- the app already holds for a day they have not filled in, and this is the half
-- of that which belongs in the database.

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
    if v_had and v_existing.settlement_state = 'settled' then
      continue;
    end if;

    -- What this write replaces, whatever origin wrote it.
    --
    -- Under the old shape this retained the owner's typed estimate, which was the
    -- only figure a sourced one ever replaced. Typed figures are gone, so the
    -- trace generalises to its real purpose: no measured figure changes without
    -- the one it replaced remaining readable. A run that writes the same numbers
    -- replaces nothing and leaves the trace alone, which is what keeps a re-run
    -- from recording that a figure superseded itself.
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
    -- from, so no figure changes without a trace. A settling run that changes
    -- nothing marks nothing.
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
      (outlet_id, channel, business_date, revenue_paise, commission_paise,
       settlement_state, origin,
       superseded_revenue_paise, superseded_commission_paise, superseded_at,
       provisional_revenue_paise, provisional_commission_paise, revised_at)
    values (v_outlet, v_channel, v_day.business_date,
            v_day.gross_paise, v_day.commission_paise,
            v_state, v_origin,
            v_sup_revenue, v_sup_commission, v_sup_at,
            v_prov_revenue, v_prov_commission, v_revised_at)
    on conflict (outlet_id, channel, business_date) do update
      set revenue_paise = excluded.revenue_paise,
          commission_paise = excluded.commission_paise,
          settlement_state = excluded.settlement_state,
          origin = excluded.origin,
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

  -- A recovery of a purchase whose own origin already recorded it is dropped by
  -- the reserved-category trigger, not filtered here, so the rule holds for
  -- every writer rather than only this one.
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
    'days_without_a_recorded_day', coalesce(v_unrecorded, ''),
    'deductions_before_boundary', v_deductions_skipped,
    'computed_paise', v_computed,
    'stated_payout_paise', v_stated_payout,
    'difference_paise', v_difference);
end;
$ingest$;

-- The rehearsal snapshots the figures table too, or it would report every day
-- as unchanged by reading a column that no longer exists.

create or replace function public.rehearse_aggregator_cycle(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verdict jsonb;
  v_outlet uuid;
  v_cycle_start date;
  v_cycle_end date;
  v_before jsonb;
  v_after jsonb;
  v_would_change jsonb;
  v_expenses_before int;
  v_expenses_after int;
  v_deductions_before int;
  v_deductions_after int;
begin
  v_outlet := (p_payload ->> 'outlet_id')::uuid;
  v_cycle_start := (p_payload ->> 'cycle_start')::date;
  v_cycle_end := (p_payload ->> 'cycle_end')::date;

  /*
   * A real snapshot, taken before anything is called.
   *
   * The first version of this read the pre-image out of the `zomato_provisional_*`
   * columns, which only carry one thing: what a *settling* run moved a
   * *provisional* figure from. On the far more common first sync of a day the
   * owner typed, those columns are null, the fallback returned the new value, and
   * the report cheerfully said the day changed from 2160.00 to 2160.00.
   *
   * One pair of figures per day, whatever wrote them, plus the state that says
   * which source did. On a first sync the "from" side is the owner's own typed
   * revenue and commission, which is exactly the comparison they want: their
   * number beside Zomato's. Net is reported as the difference rather than read
   * from a column, because there is no column — with commission exact, a stored
   * net would be a third figure able to disagree with the two it came from.
   */
  select jsonb_object_agg(a.business_date::text, jsonb_build_object(
           'revenue_paise', a.revenue_paise,
           'commission_paise', a.commission_paise,
           'net_paise', a.revenue_paise - a.commission_paise,
           'state', a.settlement_state))
    into v_before
    from public.aggregator_channel_days a
   where a.outlet_id = v_outlet and a.channel = 'zomato'
     and a.business_date between v_cycle_start and v_cycle_end;

  select count(*) into v_expenses_before
    from public.manual_ledger_expenses
   where outlet_id = v_outlet and source_system = 'zomato';

  select count(*) into v_deductions_before
    from public.aggregator_cycle_deductions
   where outlet_id = v_outlet;

  begin
    v_verdict := public.ingest_aggregator_cycle(p_payload, p_permitted_outlets);

    select jsonb_object_agg(a.business_date::text, jsonb_build_object(
             'revenue_paise', a.revenue_paise,
             'commission_paise', a.commission_paise,
             'net_paise', a.revenue_paise - a.commission_paise,
             'state', a.settlement_state))
      into v_after
      from public.aggregator_channel_days a
     where a.outlet_id = v_outlet and a.channel = 'zomato'
       and a.business_date between v_cycle_start and v_cycle_end;

    select count(*) into v_expenses_after
      from public.manual_ledger_expenses
     where outlet_id = v_outlet and source_system = 'zomato';

    select count(*) into v_deductions_after
      from public.aggregator_cycle_deductions
     where outlet_id = v_outlet;

    -- The rollback. Raised deliberately with a code nothing else uses, and
    -- caught immediately below, so the subtransaction unwinds and every write
    -- above it disappears. The variables survive it, which is the asymmetry the
    -- whole function rests on.
    raise exception 'rehearsal' using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then
      null;
  end;

  -- The diff, computed outside the block from two saved snapshots. Only days that
  -- actually moved appear: a report listing every day in the cycle would bury the
  -- one the owner needs to look at.
  select jsonb_agg(
           jsonb_build_object(
             'business_date', moved.business_date,
             'from', v_before -> moved.business_date,
             'to', v_after -> moved.business_date)
           order by moved.business_date)
    into v_would_change
    from jsonb_object_keys(coalesce(v_after, '{}'::jsonb)) as moved(business_date)
   where (v_before -> moved.business_date) is distinct from (v_after -> moved.business_date);

  return coalesce(v_verdict, jsonb_build_object('outcome', 'rehearsal_failed'))
    || jsonb_build_object(
         'rehearsal', true,
         'days_that_would_change', coalesce(v_would_change, '[]'::jsonb),
         'expenses_that_would_appear', coalesce(v_expenses_after - v_expenses_before, 0),
         'cycle_deductions_that_would_appear',
           coalesce(v_deductions_after - v_deductions_before, 0));
end;
$$;

revoke execute on function public.rehearse_aggregator_cycle(jsonb, uuid[]) from public;
grant execute on function public.rehearse_aggregator_cycle(jsonb, uuid[]) to service_role;

comment on function public.rehearse_aggregator_cycle(jsonb, uuid[]) is
  'Runs the real write contract against a real payload and throws the writes away, reporting what it would have changed.';
