-- Hyperpure changed physical delivery outlet on 2026-09-16. Routing is now a
-- dated database fact, not a current parser flag, and a Hyperpure order number
-- is one identity across the supplier account regardless of outlet.

begin;

-- ---------------------------------------------------------------------------
-- Effective-dated supplier delivery routes.

create table public.supplier_delivery_routes (
  source_system text not null,
  effective_from date not null,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  primary key (source_system, effective_from),
  constraint supplier_delivery_routes_source_not_blank
    check (length(btrim(source_system)) > 0),
  constraint supplier_delivery_routes_source_normalized
    check (source_system = lower(btrim(source_system)))
);

comment on table public.supplier_delivery_routes is
  'Delivery attribution history for account-level suppliers. An invoice uses the row for its source with the greatest effective_from not later than its invoice date.';
comment on column public.supplier_delivery_routes.effective_from is
  'First India-calendar invoice date delivered to this outlet; the next row implicitly ends this route.';

alter table public.supplier_delivery_routes enable row level security;

create policy supplier_delivery_routes_select
  on public.supplier_delivery_routes
  for select to authenticated
  using (public.app_is_owner());

revoke all on public.supplier_delivery_routes from anon, authenticated;
grant select on public.supplier_delivery_routes to authenticated;
grant all on public.supplier_delivery_routes to service_role;

do $seed_routes$
declare
  v_kalyani uuid;
  v_kanchrapara uuid;
  v_count bigint;
begin
  -- `supabase db reset` applies migrations before the synthetic seed inserts
  -- outlets. Production already has its outlet rows, so seed the real database
  -- here; the local seed writes the same two route rows after its outlets.
  select count(*) into v_count from public.outlets;
  if v_count = 0 then
    raise notice 'no outlets yet; the local synthetic seed will add Hyperpure routes';
    return;
  end if;

  -- Production codes are `skalyani` / `skpa`; the shorter aliases belong only
  -- to the deterministic local seed. Accepting that closed pair lets the same
  -- migration rehearse locally without weakening production resolution by name.
  select count(*) into v_count from public.outlets
   where code in ('skalyani', 'kalyani');
  if v_count <> 1 then
    raise exception 'Hyperpure cutover expected exactly one Kalyani outlet code, found %', v_count;
  end if;
  select id into v_kalyani from public.outlets
   where code in ('skalyani', 'kalyani');

  select count(*) into v_count from public.outlets
   where code in ('skpa', 'kanchrapara');
  if v_count <> 1 then
    raise exception 'Hyperpure cutover expected exactly one Kanchrapara outlet code, found %', v_count;
  end if;
  select id into v_kanchrapara from public.outlets
   where code in ('skpa', 'kanchrapara');

  insert into public.supplier_delivery_routes (source_system, effective_from, outlet_id)
  values
    ('hyperpure', date '0001-01-01', v_kanchrapara),
    ('hyperpure', date '2026-09-16', v_kalyani);

  -- The historical-default row is deliberately earlier than any retained
  -- invoice. It resolves the supplier route before the ledger date is clamped
  -- to the first day for which this application has books.
  if (select outlet_id
        from public.supplier_delivery_routes
       where source_system = 'hyperpure'
         and effective_from <= date '2026-08-01'
       order by effective_from desc
       limit 1) is distinct from v_kanchrapara then
    raise exception 'the retained pre-books Hyperpure invoice does not resolve to Kanchrapara';
  end if;

  -- Compatibility only: an old parser still needs a value for the version-1
  -- top-level field while old and new deployments can overlap. The ingest
  -- function below never treats this boolean as routing authority.
  -- The compatibility marker has a partial unique index. PostgreSQL checks a
  -- non-deferrable unique index row by row, so one CASE-style update can try to
  -- set Kalyani true before it has cleared Kanchrapara and fail even though the
  -- statement's final state would be unique. Clear the old holder first.
  update public.outlets
     set hyperpure_delivery = false
   where hyperpure_delivery
     and id <> v_kalyani;

  update public.outlets
     set hyperpure_delivery = true
   where id = v_kalyani;
end;
$seed_routes$;

comment on column public.outlets.hyperpure_delivery is
  'Rollout-compatibility marker used only to populate the version-1 supply payload. Supplier delivery routing is authoritative in supplier_delivery_routes.';

-- ---------------------------------------------------------------------------
-- Bounded correction of rows created after the physical-delivery cutover.
--
-- A clean local/test database has no imported Hyperpure rows, so the data
-- correction is intentionally a no-op there. Any database that already has
-- Hyperpure history must match the production anchor and all attribution
-- preconditions exactly or this entire migration rolls back.

create or replace function public.apply_hyperpure_delivery_cutover()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $cutover$
declare
  v_kalyani uuid;
  v_kanchrapara uuid;
  v_hyperpure_count bigint;
  v_bad_count bigint;
  v_anchor_count bigint;
  v_snapshot_count bigint;
  v_snapshot_total bigint;
  v_after_count bigint;
  v_after_total bigint;
begin
  -- Freeze the expense set before even deciding whether the correction is a
  -- no-op. This closes the gap where an unexpected writer could otherwise add
  -- the first post-cutover row after the count but before the snapshot.
  lock table public.expenses in access exclusive mode;

  select count(*) into v_hyperpure_count
    from public.expenses where source_system = 'hyperpure';
  if v_hyperpure_count = 0 then
    raise notice 'no existing Hyperpure expenses; production correction is a no-op';
    return jsonb_build_object('rows_moved', 0, 'paise_moved', 0);
  end if;

  select id into strict v_kalyani from public.outlets
   where code in ('skalyani', 'kalyani');
  select id into strict v_kanchrapara from public.outlets
   where code in ('skpa', 'kanchrapara');

  if (select tgenabled from pg_trigger
       where tgrelid = 'public.expenses'::regclass and tgname = 'expenses_guarded') <> 'O' then
    raise exception 'expenses_guarded was not enabled before the Hyperpure correction';
  end if;

  drop table if exists pg_temp.hyperpure_cutover_snapshot;
  create temporary table hyperpure_cutover_snapshot on commit drop as
  select e.id, e.source_ref, e.business_date, e.amount_paise, e.shared_cost,
         e.voided_at, e.outlet_id
    from public.expenses e
   where e.source_system = 'hyperpure'
     and e.outlet_id = v_kanchrapara
     and e.business_date >= date '2026-09-16'
     and e.voided_at is null;

  select count(*) into v_bad_count
    from public.expenses
   where source_system = 'hyperpure' and source_ref is null;
  if v_bad_count <> 0 then
    raise exception 'Hyperpure cutover found % rows without an order reference', v_bad_count;
  end if;

  select count(*) into v_bad_count
    from (
      select source_ref
        from public.expenses
       where source_system = 'hyperpure'
       group by source_ref
      having count(*) <> 1
    ) duplicates;
  if v_bad_count <> 0 then
    raise exception 'Hyperpure cutover found % duplicate global order identities', v_bad_count;
  end if;

  select count(*) into v_anchor_count
    from public.expenses
   where source_system = 'hyperpure'
     and source_ref = 'ZHPWB27-OR-0030242357'
     and outlet_id = v_kanchrapara
     and business_date = date '2026-09-17'
     and amount_paise = 110129
     and voided_at is null;
  if v_anchor_count <> 1 then
    raise exception 'Hyperpure cutover anchor mismatch: expected one Kanchrapara row ZHPWB27-OR-0030242357 on 2026-09-17 for 110129 paise, found %',
      v_anchor_count;
  end if;

  select count(*) into v_bad_count
    from public.expenses
   where source_system = 'hyperpure'
     and business_date <= date '2026-09-15'
     and outlet_id <> v_kanchrapara;
  if v_bad_count <> 0 then
    raise exception 'Hyperpure cutover found % pre-cutover rows outside Kanchrapara', v_bad_count;
  end if;

  select count(*) into v_bad_count
    from public.expenses
   where source_system = 'hyperpure'
     and business_date >= date '2026-09-16'
     and outlet_id not in (v_kanchrapara, v_kalyani);
  if v_bad_count <> 0 then
    raise exception 'Hyperpure cutover found % post-cutover rows at an unexplained outlet', v_bad_count;
  end if;

  select count(*), coalesce(sum(amount_paise), 0)
    into v_snapshot_count, v_snapshot_total
    from pg_temp.hyperpure_cutover_snapshot;

  -- The ordinary expense contract makes outlet identity immutable. The lock
  -- and trigger bypass are reachable only by this owner-only, fixed-boundary
  -- migration helper and touch only the pre-snapshotted correction set.
  execute 'alter table public.expenses disable trigger expenses_guarded';

  update public.expenses e
     set outlet_id = v_kalyani
    from pg_temp.hyperpure_cutover_snapshot s
   where e.id = s.id;

  execute 'alter table public.expenses enable trigger expenses_guarded';

  select count(*), coalesce(sum(e.amount_paise), 0)
    into v_after_count, v_after_total
    from public.expenses e
    join pg_temp.hyperpure_cutover_snapshot s on s.id = e.id
   where e.outlet_id = v_kalyani
     and e.source_system = 'hyperpure'
     and e.source_ref is not distinct from s.source_ref
     and e.business_date = s.business_date
     and e.amount_paise = s.amount_paise
     and e.shared_cost = s.shared_cost
     and e.voided_at is not distinct from s.voided_at;

  if (v_after_count, v_after_total) is distinct from (v_snapshot_count, v_snapshot_total) then
    raise exception 'Hyperpure correction drifted: snapshot % rows/% paise, corrected % rows/% paise',
      v_snapshot_count, v_snapshot_total, v_after_count, v_after_total;
  end if;

  select count(*) into v_bad_count
    from public.expenses
   where source_system = 'hyperpure'
     and source_ref = 'ZHPWB27-OR-0030242357'
     and outlet_id = v_kalyani
     and business_date = date '2026-09-17'
     and amount_paise = 110129
     and voided_at is null;
  if v_bad_count <> 1 then
    raise exception 'Hyperpure cutover anchor was not corrected exactly once';
  end if;

  select count(*) into v_bad_count
    from public.expenses
   where source_system = 'hyperpure'
     and business_date <= date '2026-09-15'
     and outlet_id <> v_kanchrapara;
  if v_bad_count <> 0 then
    raise exception 'Hyperpure correction moved or exposed % pre-cutover rows outside Kanchrapara', v_bad_count;
  end if;

  if (select tgenabled from pg_trigger
       where tgrelid = 'public.expenses'::regclass and tgname = 'expenses_guarded') <> 'O' then
    raise exception 'expenses_guarded was not restored after the Hyperpure correction';
  end if;

  return jsonb_build_object(
    'rows_moved', v_snapshot_count,
    'paise_moved', v_snapshot_total);
end;
$cutover$;

comment on function public.apply_hyperpure_delivery_cutover() is
  'Fixed-boundary, owner-only migration rehearsal for the audited 2026-09-16 Hyperpure correction. No runtime role may execute it.';
revoke all on function public.apply_hyperpure_delivery_cutover()
  from public, anon, authenticated, service_role;

select public.apply_hyperpure_delivery_cutover();

-- Existing source systems retain their outlet-local identity. Hyperpure alone
-- has proved account-global order references, including for withdrawn rows.
create unique index expenses_hyperpure_source_key
  on public.expenses (source_system, source_ref)
  where source_system = 'hyperpure';

-- ---------------------------------------------------------------------------
-- The database, not the version-1 compatibility field, routes every order.

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

  v_source_system := p_payload ->> 'source_system';

  -- A reserved category owns these rows, and only its own origin may write them.
  if public.expense_category_reserved_owner(p_payload ->> 'category')
       is distinct from v_source_system then
    raise exception 'the category % is not owned by the source %',
      p_payload ->> 'category', v_source_system
      using errcode = '22023';
  end if;

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
    if v_order.invoice_date is null then
      raise exception 'supply order % carries no invoice date and cannot be routed', v_order.order_ref
        using errcode = '22023';
    end if;

    select r.outlet_id into v_outlet
      from public.supplier_delivery_routes r
     where r.source_system = v_source_system
       and r.effective_from <= v_order.invoice_date
     order by r.effective_from desc
     limit 1;

    if v_outlet is null then
      raise exception 'no delivery route exists for source % on invoice date %',
        v_source_system, v_order.invoice_date
        using errcode = '22023';
    end if;

    if p_permitted_outlets is null or not (v_outlet = any (p_permitted_outlets)) then
      raise exception 'this credential may not write supply costs for resolved outlet % on invoice date %',
        v_outlet, v_order.invoice_date
        using errcode = '42501';
    end if;

    -- The opening fallback is outlet-specific and therefore follows routing.
    select least(
             (select min(business_date) from public.bills where outlet_id = v_outlet),
             (select min(business_date) from public.expenses where outlet_id = v_outlet),
             (select min(business_date) from public.aggregator_channel_days where outlet_id = v_outlet))
      into v_books_open;
    v_business_date := greatest(v_order.invoice_date, coalesce(v_books_open, v_order.invoice_date));

    if v_source_system = 'hyperpure' then
      select outlet_id, amount_paise, business_date, description, category, shared_cost, voided_at
        into v_prior
        from public.expenses
       where source_system = v_source_system
         and source_ref = v_order.order_ref;
      v_prior_had := found;

      if v_prior_had and v_prior.outlet_id is distinct from v_outlet then
        raise exception 'Hyperpure order % has an attribution conflict: stored outlet %, dated route %',
          v_order.order_ref, v_prior.outlet_id, v_outlet
          using errcode = '22023';
      end if;

      insert into public.expenses
        (outlet_id, business_date, category, is_cash, amount_paise, description,
         source_system, source_ref, shared_cost, recorded_by)
      values (v_outlet, v_business_date, p_payload ->> 'category', false,
              v_order.amount_paise, v_order.description,
              v_source_system, v_order.order_ref, v_order.shared_cost, null)
      on conflict (source_system, source_ref) where source_system = 'hyperpure'
      do update set amount_paise = excluded.amount_paise,
                    business_date = excluded.business_date,
                    description = excluded.description,
                    category = excluded.category,
                    shared_cost = excluded.shared_cost
      where public.expenses.voided_at is null;
    else
      select outlet_id, amount_paise, business_date, description, category, shared_cost, voided_at
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
    end if;

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
      'read', null,
      'days', '[]'::jsonb,
      'cycles_settled', '[]'::jsonb,
      'supply_orders', jsonb_build_object('added', v_added, 'amended', v_amended),
      'dates_without_a_recorded_day', '[]'::jsonb));
end;
$body$;

commit;
