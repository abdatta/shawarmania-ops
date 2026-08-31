-- Retire the manual ledger without deleting the only record of August 2026.
--
-- Order is deliberate and asserted by the change: snapshot outside this file,
-- promote expenses, carry days, reconcile, archive, then drop dead objects.

begin;

-- ---------------------------------------------------------------------------
-- 1. The independent baseline, captured 2026-08-31 before this was drafted.

create temporary table retire_expense_baseline on commit drop as
select * from public.manual_ledger_expenses;

do $baseline$
declare
  v_days bigint;
  v_expenses bigint;
  v_bad bigint;
  v_row record;
begin
  select count(*) into v_days from public.manual_ledger_days;
  select count(*) into v_expenses from public.manual_ledger_expenses;

  -- **The two halves are asserted differently, because only one of them is
  -- closed.**
  --
  -- `manual_ledger_days` stopped being written on 2026-08-27, when #11's drawer
  -- took over the count. It is a finished record, so it is asserted to the row
  -- and to the paise, and any movement in it aborts the release.
  --
  -- `manual_ledger_expenses` is the live expense record for every role and is
  -- written every day the shops trade. Freezing its counts would assert that
  -- nobody used the app between the snapshot and the deploy, which is a
  -- condition no release can meet: the snapshot read 129 rows at 00:34 on
  -- 2026-08-31 and a real expense landed at 00:48. So the expense half is
  -- asserted on what a promotion by rename actually guarantees — no row may be
  -- lost, every row keeps its attribution, and section 3 proves row for row that
  -- nothing changed across the rename — and its drift since the baseline is
  -- reported rather than refused.
  if (v_days, v_expenses) = (0, 0) then
    -- A clean reset has neither table populated.
    null;
  elsif v_days <> 40 then
    raise exception
      'retirement baseline moved: expected a clean (0) or the closed production day table (40), found %',
      v_days;
  else
    if v_expenses < 129 then
      raise exception
        'the expense record lost rows since the 2026-08-31 baseline: 129 read then, % now',
        v_expenses;
    elsif v_expenses > 129 then
      raise notice
        'expense record grew from the 2026-08-31 baseline of 129 to % rows; the notebook was still in use',
        v_expenses;
    end if;

    for v_row in
      select * from (values
        ('skalyani', 20::bigint, 16::bigint, 48::bigint),
        ('skpa',     20::bigint, 16::bigint, 81::bigint)
      ) as x(code, day_rows, counted_rows, baseline_expense_rows)
    loop
      if not exists (
        select 1
          from public.outlets o
         where o.code = v_row.code
           and (select count(*) from public.manual_ledger_days d
                 where d.outlet_id = o.id) = v_row.day_rows
           and (select count(*) from public.manual_ledger_days d
                 where d.outlet_id = o.id and d.counted_cash_paise > 0) = v_row.counted_rows
           and (select count(*) from public.manual_ledger_expenses e
                 where e.outlet_id = o.id) >= v_row.baseline_expense_rows
      ) then
        raise exception 'retirement day counts no longer match the 2026-08-31 snapshot at %',
          v_row.code;
      end if;
    end loop;

    with expected(code, business_date, counted_cash_paise) as (values
      ('skalyani', date '2026-08-01', 0::bigint),
      ('skalyani', date '2026-08-02', 0::bigint),
      ('skalyani', date '2026-08-03', 0::bigint),
      ('skalyani', date '2026-08-04', 0::bigint),
      ('skalyani', date '2026-08-05', 25000::bigint),
      ('skalyani', date '2026-08-06', 47000::bigint),
      ('skalyani', date '2026-08-07', 59000::bigint),
      ('skalyani', date '2026-08-08', 45000::bigint),
      ('skalyani', date '2026-08-09', 34000::bigint),
      ('skalyani', date '2026-08-11', 44000::bigint),
      ('skalyani', date '2026-08-12', 49000::bigint),
      ('skalyani', date '2026-08-13', 44000::bigint),
      ('skalyani', date '2026-08-14', 31000::bigint),
      ('skalyani', date '2026-08-15', 44000::bigint),
      ('skalyani', date '2026-08-16', 32000::bigint),
      ('skalyani', date '2026-08-17', 31000::bigint),
      ('skalyani', date '2026-08-18', 35000::bigint),
      ('skalyani', date '2026-08-22', 36000::bigint),
      ('skalyani', date '2026-08-23', 40000::bigint),
      ('skalyani', date '2026-08-26', 30000::bigint),
      ('skpa', date '2026-08-01', 0::bigint),
      ('skpa', date '2026-08-02', 0::bigint),
      ('skpa', date '2026-08-03', 0::bigint),
      ('skpa', date '2026-08-04', 0::bigint),
      ('skpa', date '2026-08-05', 22000::bigint),
      ('skpa', date '2026-08-06', 19000::bigint),
      ('skpa', date '2026-08-07', 15000::bigint),
      ('skpa', date '2026-08-08', 20000::bigint),
      ('skpa', date '2026-08-09', 10000::bigint),
      ('skpa', date '2026-08-10', 169000::bigint),
      ('skpa', date '2026-08-11', 392000::bigint),
      ('skpa', date '2026-08-12', 422000::bigint),
      ('skpa', date '2026-08-13', 20000::bigint),
      ('skpa', date '2026-08-15', 16000::bigint),
      ('skpa', date '2026-08-16', 30000::bigint),
      ('skpa', date '2026-08-17', 12000::bigint),
      ('skpa', date '2026-08-18', 47000::bigint),
      ('skpa', date '2026-08-20', 20000::bigint),
      ('skpa', date '2026-08-22', 30000::bigint),
      ('skpa', date '2026-08-26', 30000::bigint)
    ), actual as (
      select o.code, d.business_date, d.counted_cash_paise
        from public.manual_ledger_days d
        join public.outlets o on o.id = d.outlet_id
    )
    select count(*) into v_bad
      from (
        (select * from expected except select * from actual)
        union all
        (select * from actual except select * from expected)
      ) mismatch;
    if v_bad <> 0 then
      raise exception 'the per-day counted-cash baseline moved in % places', v_bad;
    end if;
  end if;

  select count(*) into v_bad
    from public.manual_ledger_days d
   where d.recorded_by is null
      or (d.cash_added_paise <> 0 and length(btrim(coalesce(d.cash_added_reason, ''))) = 0);
  if v_bad <> 0 then
    raise exception 'manual day attribution or cash-added reason is incomplete on % rows', v_bad;
  end if;

  -- An uncounted row carries no observation across, so it has nowhere to hang a
  -- movement. On the snapshot the uncounted rows are the four opening days at
  -- each outlet and they hold no cash movement at all. If that ever stopped
  -- being true the carry would drop the movement in silence, so it aborts here
  -- instead.
  select count(*) into v_bad
    from public.manual_ledger_days d
   where d.counted_cash_paise = 0
     and (d.cash_removed_paise <> 0 or d.cash_added_paise <> 0);
  if v_bad <> 0 then
    raise exception
      '% uncounted day rows carry a cash movement that the carry-over cannot place', v_bad;
  end if;

  select count(*) into v_bad
    from public.manual_ledger_expenses e
   where (e.recorded_by is null and e.source_system is null)
      or (e.updated_by is not null and e.recorded_by is null)
      or (e.voided_at is not null and length(btrim(coalesce(e.voided_reason, ''))) = 0);
  if v_bad <> 0 then
    raise exception 'expense attribution or void reason is incomplete on % rows', v_bad;
  end if;

  if exists (select 1 from public.expenses)
     or exists (select 1 from public.daily_cash_records)
     or exists (select 1 from public.cash_withdrawals) then
    raise exception
      'a table declared empty before retirement contains rows; snapshot and reconsider';
  end if;
end;
$baseline$;

-- ---------------------------------------------------------------------------
-- 2. Promote the richer expense record by rename. No expense row is copied.

drop view public.effective_expenses;
drop table public.expenses;
alter table public.manual_ledger_expenses rename to expenses;

alter index public.manual_ledger_expenses_pkey rename to expenses_pkey;
alter index public.manual_ledger_expenses_outlet_business_date_idx
  rename to expenses_outlet_business_date_idx;
alter index public.manual_ledger_expenses_source_idx rename to expenses_source_idx;

alter table public.expenses
  rename constraint manual_ledger_expenses_amount_paise_check to expenses_amount_paise_check;
alter table public.expenses
  rename constraint manual_ledger_expenses_category_normalized to expenses_category_normalized;
alter table public.expenses
  rename constraint manual_ledger_expenses_category_not_blank to expenses_category_not_blank;
alter table public.expenses
  rename constraint manual_ledger_expenses_description_not_blank to expenses_description_not_blank;
alter table public.expenses
  rename constraint manual_ledger_expenses_recorder_or_source to expenses_recorder_or_source;
alter table public.expenses
  rename constraint manual_ledger_expenses_source_not_blank to expenses_source_not_blank;
alter table public.expenses
  rename constraint manual_ledger_expenses_source_together to expenses_source_together;
alter table public.expenses
  rename constraint manual_ledger_expenses_void_complete to expenses_void_complete;
alter table public.expenses
  rename constraint manual_ledger_expenses_void_reason_needs_void to expenses_void_reason_needs_void;
alter table public.expenses
  rename constraint manual_ledger_expenses_void_reason_not_blank to expenses_void_reason_not_blank;
alter table public.expenses
  rename constraint manual_ledger_expenses_outlet_id_fkey to expenses_outlet_id_fkey;
alter table public.expenses
  rename constraint manual_ledger_expenses_recorded_by_fkey to expenses_recorded_by_fkey;
alter table public.expenses
  rename constraint manual_ledger_expenses_updated_by_fkey to expenses_updated_by_fkey;
alter table public.expenses
  rename constraint manual_ledger_expenses_voided_by_fkey to expenses_voided_by_fkey;

alter policy manual_ledger_expenses_insert on public.expenses rename to expenses_insert;
alter policy manual_ledger_expenses_select on public.expenses rename to expenses_select;
alter policy manual_ledger_expenses_update on public.expenses rename to expenses_update;

alter trigger manual_ledger_expenses_capture_category on public.expenses
  rename to expenses_capture_category;
alter trigger manual_ledger_expenses_enforce_reserved_category on public.expenses
  rename to expenses_enforce_reserved_category;
alter trigger manual_ledger_expenses_guarded on public.expenses rename to expenses_guarded;
alter trigger manual_ledger_expenses_no_delete on public.expenses rename to expenses_no_delete;
alter trigger manual_ledger_expenses_set_updated_at on public.expenses
  rename to expenses_set_updated_at;

create or replace view public.effective_expenses
with (security_invoker = true) as
  select e.id, e.outlet_id, e.business_date, e.category, e.description,
         e.amount_paise, e.is_cash, e.occurred_at, e.created_at, e.recorded_by,
         'expenses'::text as source_table
    from public.expenses e
   where e.voided_at is null;

comment on view public.effective_expenses is
  'The one live expense record, excluding withdrawn rows. Read by the derived Ledger and drawer interval arithmetic.';
grant select on public.effective_expenses to authenticated;

-- The same guard, now honestly named and attached only to expenses.
do $rewrite_guard$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.manual_ledger_guard()'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition,
    'FUNCTION public.manual_ledger_guard()', 'FUNCTION public.expense_guard()');
  v_definition := replace(v_definition, 'manual ledger row', 'expense row');
  v_definition := replace(v_definition, 'manual_ledger_expenses', 'expenses');
  execute v_definition;
end;
$rewrite_guard$;

drop trigger expenses_guarded on public.expenses;
create trigger expenses_guarded before insert or update on public.expenses
  for each row execute function public.expense_guard();

comment on column public.expenses.updated_by is
  'The account that last corrected this row, stamped by expense_guard().';

-- Category rewrites now touch the one expense record exactly once.
create or replace function public.rename_expense_category(
  p_from text, p_to text, p_rewrite_history boolean
)
returns table (ledger_rows_moved bigint, expense_rows_moved bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_from text := public.normalize_expense_category(p_from);
  v_to text := public.normalize_expense_category(p_to);
begin
  if not public.app_account_active() or not public.app_is_owner() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if v_from = '' or v_to = '' then
    raise exception 'category names cannot be blank' using errcode = 'check_violation';
  end if;
  select name into v_from from public.expense_categories
   where lower(name) = lower(v_from) for update;
  if v_from is null then raise exception 'category does not exist'; end if;
  update public.expense_categories set name = v_to where lower(name) = lower(v_from);
  ledger_rows_moved := 0;
  expense_rows_moved := 0;
  if p_rewrite_history then
    update public.expenses set category = v_to where lower(category) = lower(v_from);
    get diagnostics expense_rows_moved = row_count;
  end if;
  insert into public.expense_category_operations
    (operation, name_before, name_after, ledger_rows_moved, expense_rows_moved, performed_by)
  values ('rename', v_from, v_to, 0, expense_rows_moved, auth.uid());
  return next;
end;
$$;

create or replace function public.merge_expense_category(p_from text, p_into text)
returns table (ledger_rows_moved bigint, expense_rows_moved bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_from text := public.normalize_expense_category(p_from);
  v_into text := public.normalize_expense_category(p_into);
begin
  if not public.app_account_active() or not public.app_is_owner() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if v_from = '' or v_into = '' or lower(v_from) = lower(v_into) then
    raise exception 'merge needs two different category names' using errcode = 'check_violation';
  end if;
  select name into v_from from public.expense_categories
   where lower(name) = lower(v_from) for update;
  select name into v_into from public.expense_categories
   where lower(name) = lower(v_into) for update;
  if v_from is null or v_into is null then raise exception 'both categories must exist'; end if;
  update public.expenses set category = v_into where lower(category) = lower(v_from);
  get diagnostics expense_rows_moved = row_count;
  ledger_rows_moved := 0;
  delete from public.expense_categories where lower(name) = lower(v_from);
  insert into public.expense_category_operations
    (operation, name_before, name_after, ledger_rows_moved, expense_rows_moved, performed_by)
  values ('merge', v_from, v_into, 0, expense_rows_moved, auth.uid());
  return next;
end;
$$;

create or replace function public.expense_people()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name
    from public.profiles p
   where public.app_account_active()
     and exists (
       select 1 from public.expenses e
        where p.id in (e.recorded_by, e.updated_by, e.voided_by)
          and (
            (select public.app_is_owner())
            or e.outlet_id in (select public.app_outlets_for('franchise_admin'))
            or public.app_has_role_at('biller', e.outlet_id)
            or public.app_has_role_at('employee', e.outlet_id)
          )
     )
$$;
revoke execute on function public.expense_people() from public, anon;
grant execute on function public.expense_people() to authenticated;
drop function public.manual_ledger_people();

-- Keep automated deductions and supplier rows pointed at the promoted table,
-- while removing the last live function read of the notebook day table.
do $rewrite_automation$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.ingest_aggregator_cycle(jsonb,uuid[])'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition, 'public.manual_ledger_expenses', 'public.expenses');
  v_old := 'and not exists (select 1 from public.manual_ledger_days d' || E'\n' ||
           '                      where d.outlet_id = v_outlet and d.business_date = i.business_date)';
  v_new := 'and not exists (select 1 from public.drawer_observations observation' || E'\n' ||
           '                      join public.outlets outlet on outlet.id = observation.outlet_id' || E'\n' ||
           '                     where observation.outlet_id = v_outlet' || E'\n' ||
           '                       and public.app_business_date(' || E'\n' ||
           '                         observation.counted_at - case when observation.is_legacy_imprecise' || E'\n' ||
           '                           then interval ''1 microsecond'' else interval ''0'' end,' || E'\n' ||
           '                         outlet.business_day_cutover) = i.business_date)';
  v_definition := replace(v_definition, v_old, v_new);
  if v_definition like '%manual_ledger_%' then
    raise exception 'ingest_aggregator_cycle still names a retired relation';
  end if;
  execute v_definition;

  select pg_get_functiondef('public.rehearse_aggregator_cycle(jsonb,uuid[])'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition, 'public.manual_ledger_expenses', 'public.expenses');
  if v_definition like '%manual_ledger_%' then
    raise exception 'rehearse_aggregator_cycle still names a retired relation';
  end if;
  execute v_definition;

  select pg_get_functiondef('public.ingest_supply_statement(jsonb,uuid[])'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition, 'public.manual_ledger_expenses', 'public.expenses');
  v_old := '(select min(business_date) from public.manual_ledger_days' || E'\n' ||
           '             where outlet_id = v_outlet),' || E'\n' ||
           '           (select min(business_date) from public.expenses' || E'\n' ||
           '             where outlet_id = v_outlet)';
  v_new := '(select min(business_date) from public.bills' || E'\n' ||
           '             where outlet_id = v_outlet),' || E'\n' ||
           '           (select min(business_date) from public.expenses' || E'\n' ||
           '             where outlet_id = v_outlet),' || E'\n' ||
           '           (select min(business_date) from public.aggregator_channel_days' || E'\n' ||
           '             where outlet_id = v_outlet)';
  v_definition := replace(v_definition, v_old, v_new);
  if v_definition like '%manual_ledger_%' then
    raise exception 'ingest_supply_statement still names a retired relation';
  end if;
  execute v_definition;
end;
$rewrite_automation$;

-- A counted drawer is an observation, not a lock on the business day. Remove
-- the stopgap close-day refusal from the offline order command before the
-- dead close table disappears.
do $rewrite_billing$
declare
  v_definition text;
  v_old text;
begin
  select pg_get_functiondef(
    'public.create_billing_order(uuid,integer,text,timestamptz,uuid,jsonb)'::regprocedure
  ) into v_definition;
  v_old := '  if exists (select 1 from public.daily_cash_records' || E'\n' ||
           '      where outlet_id=v_outlet and business_date=v_date) then' || E'\n' ||
           '    return public.billing_finish_command(p_command_id,' || E'\n' ||
           '      jsonb_build_object(''status'',''authorization_refused'',''commandId'',p_command_id),v_date);' || E'\n' ||
           '  end if;' || E'\n';
  v_definition := replace(v_definition, v_old, '');
  if v_definition like '%daily_cash_records%' then
    raise exception 'create_billing_order still names the retired close table';
  end if;
  execute v_definition;
end;
$rewrite_billing$;

-- ---------------------------------------------------------------------------
-- 3. Carry each real historical count into the continuous drawer.

alter table public.drawer_observations
  add column is_legacy_imprecise boolean not null default false,
  add constraint drawer_observations_legacy_marker_consistent check (
    not is_legacy_imprecise or (not is_approximate and tolerance_minutes = 0)
  );

comment on column public.drawer_observations.is_legacy_imprecise is
  'True only for a carried manual count whose date is known and whose hour was never recorded. The UI must not display its boundary instant or a tolerance.';

drop index public.drawer_observations_one_anchor_per_outlet;

with source as (
  select d.*,
         ((d.business_date + 1)::timestamp + o.business_day_cutover)
           at time zone 'Asia/Kolkata' - interval '1 microsecond' as carried_at,
         row_number() over (partition by d.outlet_id order by d.business_date) as sequence,
         lag(((d.business_date + 1)::timestamp + o.business_day_cutover)
           at time zone 'Asia/Kolkata' - interval '1 microsecond') over
           (partition by d.outlet_id order by d.business_date) as previous_at,
         -- Decision 0: `next opening = counted_cash_paise`. The notebook counted
         -- AFTER the collection and BEFORE nothing else, so the count is the
         -- float left behind and is exactly what the next day opens on. This is
         -- also what the notebook's own form prefilled (`draftInheriting`).
         lag(d.counted_cash_paise) over
           (partition by d.outlet_id order by d.business_date) as opening,
         lag(d.business_date) over
           (partition by d.outlet_id order by d.business_date) as previous_date
    from public.manual_ledger_days d
    join public.outlets o on o.id = d.outlet_id
   where d.counted_cash_paise > 0
), calculated as (
  select s.*,
         case when s.sequence = 1 then null::bigint else
           s.opening
           -- **The notebook's own cash revenue, not the bills.** Kalyani's
           -- counter did not start billing until 2026-08-12 and Kanchrapara's
           -- until 08-14, so re-deriving receipts from bills would report the
           -- drawer as thousands of rupees OVER on every earlier carried day —
           -- an invented surplus standing in for a till that was never rung.
           -- The typed figure is the only record of receipts this period has,
           -- and carrying it is what makes the derived statement reproduce the
           -- month the notebook held. Where both sources exist they mostly
           -- agree; where they do not, the day's bills are listed beside this
           -- figure and the disagreement stays visible rather than being
           -- resolved by whichever source the carry-over happened to pick.
           + s.cash_revenue_paise
           -- **By business date, not by instant.** A carried expense's
           -- `occurred_at` is when somebody typed it, and much of August was
           -- typed days later in one sitting: matching on the instant drops a
           -- day's expenses into a neighbouring day's interval and moves the
           -- difference with them. The notebook read these by business date and
           -- so does this, which is what makes the carried figure reproduce it.
           -- The range covers any skipped dates too, so a gap in the notebook
           -- does not lose the expenses recorded across it.
           - coalesce((
               select sum(e.amount_paise) from public.expenses e
                where e.outlet_id = s.outlet_id and e.voided_at is null and e.is_cash
                  and e.business_date > s.previous_date
                  and e.business_date <= s.business_date), 0)
           - coalesce((
               select sum(c.amount_paise) from public.drawer_cash_out c
                where c.outlet_id = s.outlet_id and c.occurred_at > s.previous_at
                  and c.occurred_at <= s.carried_at), 0)
           -- Cash the notebook recorded as brought in during this day. It is an
           -- inflow before the count, which is where the notebook put it
           -- (`expected = opening + revenue + added − expenses − removed`), so
           -- it belongs in this interval and NOT in the next opening. It is
           -- carried as an unlinked negative collection below, which is how the
           -- reader recomputes the very same term.
           + s.cash_added_paise
         end as expected
    from source s
)
insert into public.drawer_observations (
  id, outlet_id, counted_at, recorded_at, is_anchor, opening_paise,
  expected_paise, difference_paise, counted_total_paise, is_approximate,
  tolerance_minutes, recorded_by, corrected_by, recorded_on_site, away_reason,
  note, created_at, updated_at, is_legacy_imprecise
)
select c.id, c.outlet_id, c.carried_at, greatest(c.updated_at, c.carried_at),
       c.sequence = 1,
       case when c.sequence = 1 then null else c.opening end,
       c.expected,
       case when c.sequence = 1 then null
            else c.counted_cash_paise + c.cash_removed_paise - c.expected end,
       c.counted_cash_paise + c.cash_removed_paise,
       false, 0, c.recorded_by, c.updated_by, false,
       'Carried from the manual ledger; recording location and hour were not captured.',
       c.note, c.created_at, c.updated_at, true
  from calculated c;

insert into public.drawer_cash_out (
  outlet_id, kind, amount_paise, occurred_at, recorded_by, observation_id,
  reason, recorded_on_site, away_reason, created_at
)
select d.outlet_id,
       case when d.cash_removed_reason is null then 'collection' else 'spend' end,
       d.cash_removed_paise, observation.counted_at, d.recorded_by, observation.id,
       d.cash_removed_reason, false,
       'Carried from the manual ledger; recording location and hour were not captured.',
       d.updated_at
  from public.manual_ledger_days d
  join public.drawer_observations observation on observation.id = d.id
 where d.cash_removed_paise <> 0;

insert into public.drawer_cash_out (
  outlet_id, kind, amount_paise, occurred_at, recorded_by, observation_id,
  reason, recorded_on_site, away_reason, created_at
)
select d.outlet_id, 'collection', -d.cash_added_paise, observation.counted_at,
       -- **Deliberately unlinked.** A movement linked to an observation is
       -- excluded from that observation's arithmetic and raises the NEXT
       -- opening instead. The notebook's cash added is the other case: it went
       -- in during the day and the count already holds it, so it belongs inside
       -- this interval. Linking it would inflate the following day's opening by
       -- the top-up and put the same amount on the difference twice.
       d.recorded_by, null, d.cash_added_reason, false,
       'Carried from the manual ledger; recording location and hour were not captured.',
       d.updated_at
  from public.manual_ledger_days d
  join public.drawer_observations observation on observation.id = d.id
 where d.cash_added_paise <> 0;

-- Report every disagreement in the notebook's stored opening chain. The
-- carried chain uses the ordinary observation rule and does not repair source.
do $chain$
declare
  v_breaks bigint := 0;
  v_row record;
begin
  for v_row in
    with source as (
      select o.code, d.business_date, d.opening_cash_paise,
             -- `checkOpeningChain` compared the stored opening against the
             -- previous count and nothing else. Reporting against any other
             -- rule would invent breaks the notebook never had.
             lag(d.counted_cash_paise) over
               (partition by d.outlet_id order by d.business_date) as carried_opening,
             lag(d.business_date) over
               (partition by d.outlet_id order by d.business_date) as previous_date
        from public.manual_ledger_days d
        join public.outlets o on o.id = d.outlet_id
       where d.counted_cash_paise > 0
    )
    select * from source
     where carried_opening is not null
       and (opening_cash_paise <> carried_opening
            or business_date > previous_date + 1)
     order by code, business_date
  loop
    v_breaks := v_breaks + 1;
    raise notice 'manual ledger chain break at % %: stored opening %, carried %, previous date %',
      v_row.code, v_row.business_date, v_row.opening_cash_paise,
      v_row.carried_opening, v_row.previous_date;
  end loop;
  if exists (select 1 from public.manual_ledger_days) and v_breaks = 0 then
    raise exception 'the production notebook was known to contain chain breaks; none were reported';
  end if;
end;
$chain$;

-- Rebase #11's former anchors behind the carried history. Counted totals,
-- people and instants remain untouched; only their now-false anchor arithmetic
-- is established once.
alter table public.drawer_observations disable trigger user;
with former as (
  select current_observation.id, current_observation.outlet_id,
         previous.id as previous_id, previous.counted_at as previous_at,
         previous.counted_total_paise
           - coalesce((select sum(c.amount_paise) from public.drawer_cash_out c
                        where c.observation_id = previous.id), 0) as opening
    from public.drawer_observations current_observation
    join lateral (
      select p.* from public.drawer_observations p
       where p.outlet_id = current_observation.outlet_id
         and p.is_legacy_imprecise
         and p.counted_at < current_observation.counted_at
       order by p.counted_at desc limit 1
    ) previous on true
   where current_observation.is_anchor and not current_observation.is_legacy_imprecise
), arithmetic as (
  select f.*,
         f.opening
         + coalesce((select sum(p.amount_paise)
                       from public.bills b
                       join public.effective_bill_payments p on p.bill_id = b.id
                      where b.outlet_id = f.outlet_id and b.status = 'settled'
                        and p.method = 'cash' and b.paid_at > f.previous_at
                        and b.paid_at <= observation.counted_at), 0)
         - coalesce((select sum(e.amount_paise) from public.expenses e
                      where e.outlet_id = f.outlet_id and e.voided_at is null and e.is_cash
                        and coalesce(e.occurred_at, e.created_at) > f.previous_at
                        and coalesce(e.occurred_at, e.created_at) <= observation.counted_at), 0)
         - coalesce((select sum(c.amount_paise) from public.drawer_cash_out c
                      where c.outlet_id = f.outlet_id and c.occurred_at > f.previous_at
                        and c.occurred_at <= observation.counted_at
                        and c.observation_id is distinct from f.previous_id), 0) as expected
    from former f
    join public.drawer_observations observation on observation.id = f.id
)
update public.drawer_observations observation
   set is_anchor = false,
       opening_paise = a.opening,
       expected_paise = a.expected,
       difference_paise = observation.counted_total_paise - a.expected
  from arithmetic a
 where observation.id = a.id;
alter table public.drawer_observations enable trigger user;

create unique index drawer_observations_one_anchor_per_outlet
  on public.drawer_observations (outlet_id) where is_anchor;

do $carry_assertions$
declare
  v_bad bigint;
begin
  select count(*) into v_bad
    from public.manual_ledger_days d
    left join public.drawer_observations o on o.id = d.id
   where (d.counted_cash_paise > 0 and (
          o.id is null or not o.is_legacy_imprecise
          or o.counted_total_paise <> d.counted_cash_paise + d.cash_removed_paise))
      or (d.counted_cash_paise = 0 and o.id is not null);
  if v_bad <> 0 then raise exception 'legacy observation identity failed on % rows', v_bad; end if;

  select count(*) into v_bad
    from public.drawer_observations o
   where o.is_legacy_imprecise
     and o.counted_total_paise
         - coalesce((select sum(c.amount_paise) from public.drawer_cash_out c
                      where c.observation_id = o.id), 0)
         <> (select d.counted_cash_paise
               from public.manual_ledger_days d where d.id = o.id);
  if v_bad <> 0 then raise exception 'legacy carry-forward failed on % rows', v_bad; end if;

  select count(*) into v_bad
    from public.outlets outlet
   where exists (select 1 from public.drawer_observations o where o.outlet_id = outlet.id)
     and (select count(*) from public.drawer_observations o
           where o.outlet_id = outlet.id and o.is_anchor) <> 1;
  if v_bad <> 0 then raise exception 'drawer anchor rebase failed at % outlets', v_bad; end if;

  select count(*) into v_bad
    from retire_expense_baseline before
    full join public.expenses after using (id)
   where before is null or after is null or to_jsonb(before) <> to_jsonb(after);
  if v_bad <> 0 then raise exception 'expense promotion changed % rows', v_bad; end if;
end;
$carry_assertions$;

-- ---------------------------------------------------------------------------
-- 4. Archive before every destructive drop.

drop trigger manual_ledger_counter_revenue_guarded on public.manual_ledger_days;
drop trigger manual_ledger_days_guarded on public.manual_ledger_days;
drop trigger manual_ledger_days_set_updated_at on public.manual_ledger_days;
drop function public.manual_ledger_guard();
drop policy manual_ledger_days_select on public.manual_ledger_days;
drop policy manual_ledger_days_insert on public.manual_ledger_days;
drop policy manual_ledger_days_update on public.manual_ledger_days;
drop policy manual_ledger_days_delete on public.manual_ledger_days;

alter table public.manual_ledger_days rename to archived_manual_ledger_days;
alter index public.manual_ledger_days_pkey rename to archived_manual_ledger_days_pkey;
alter index public.manual_ledger_days_outlet_business_date_idx
  rename to archived_manual_ledger_days_outlet_business_date_idx;

revoke all on public.archived_manual_ledger_days from anon, authenticated, service_role;
create trigger archived_manual_ledger_days_immutable
  before insert or update or delete on public.archived_manual_ledger_days
  for each row execute function public.reject_mutation();
comment on table public.archived_manual_ledger_days is
  'Read-only source archive for the August 2026 manual ledger carry-over. No runtime role may read or mutate it, and no application query uses it.';

-- ---------------------------------------------------------------------------
-- 5. Drop the dead day-close estate and the handover flag.

drop trigger counter_shifts_closed_day_guard on public.counter_shifts;
drop function public.counter_shift_closed_day_guard();
drop function public.close_business_day(uuid, date, bigint, bigint, text);
drop function public.billing_assert_day_ready(uuid, date);

drop trigger outlets_billing_live_from_insert_guarded on public.outlets;
drop trigger outlets_billing_live_from_update_guarded on public.outlets;
drop function public.guard_outlet_billing_live_from();
drop function public.manual_ledger_counter_revenue(uuid, date, date);
drop function public.guard_manual_ledger_counter_revenue();

drop table public.cash_withdrawals;
drop table public.daily_cash_records;
alter table public.outlets drop column billing_live_from;

-- No function, trigger, policy or view may retain a live reference to either
-- retired relation name.
do $no_readers$
declare
  v_bad bigint;
begin
  select count(*) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and (pg_get_functiondef(p.oid) ilike '%manual_ledger_days%'
          or pg_get_functiondef(p.oid) ilike '%manual_ledger_expenses%');
  if v_bad <> 0 then raise exception '% functions still name a retired relation', v_bad; end if;
end;
$no_readers$;

commit;
