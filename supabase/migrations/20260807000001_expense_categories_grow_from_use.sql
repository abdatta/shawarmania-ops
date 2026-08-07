-- Expense categories grow from use.
--
-- The manual ledger proved the fixed enum was not describing the business: all
-- nine production rows used `raw_materials`, while their required descriptions
-- held the three words the owner actually groups the month by. This migration
-- promotes those words without losing the old note, moves both expense tables
-- to snapshot text, and makes deliberate historical rewrites transactional and
-- explainable.

begin;

-- ---------------------------------------------------------------------------
-- 1. One normalisation rule in the database.

create or replace function public.normalize_expense_category(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(
    btrim(p_value, E' \t\n\r\f\v' || chr(160)),
    E'[[:space:]' || chr(160) || ']+',
    ' ',
    'g'
  )
$$;

revoke execute on function public.normalize_expense_category(text) from anon;
grant execute on function public.normalize_expense_category(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The business-wide suggestion list and its durable rewrite log.

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint expense_categories_name_not_blank check (length(name) > 0),
  constraint expense_categories_name_normalized
    check (name = public.normalize_expense_category(name))
);

create unique index expense_categories_name_case_insensitive_key
  on public.expense_categories (lower(name));

alter table public.expense_categories enable row level security;

create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (public.app_account_active());

-- Written for the reader set #38 establishes, not only today's owner-only
-- expense policies. A person who may record an expense may mint its word.
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated
  with check (
    public.app_account_active()
    and created_by = auth.uid()
    and (
      (select public.app_is_owner())
      or exists (select 1 from public.app_outlets_for('franchise_admin'))
      or exists (select 1 from public.app_outlets_for('biller'))
      or exists (select 1 from public.app_outlets_for('employee'))
    )
  );

create table public.expense_category_operations (
  id uuid primary key default gen_random_uuid(),
  operation text not null check (operation in ('rename', 'merge')),
  name_before text not null,
  name_after text not null,
  ledger_rows_moved bigint not null check (ledger_rows_moved >= 0),
  expense_rows_moved bigint not null check (expense_rows_moved >= 0),
  performed_by uuid not null references public.profiles (id) default auth.uid(),
  performed_at timestamptz not null default now(),
  constraint expense_category_operations_before_not_blank
    check (length(btrim(name_before)) > 0),
  constraint expense_category_operations_after_not_blank
    check (length(btrim(name_after)) > 0)
);

alter table public.expense_category_operations enable row level security;

create policy expense_category_operations_select on public.expense_category_operations
  for select to authenticated
  using (public.app_account_active() and (select public.app_is_owner()));

create policy expense_category_operations_insert on public.expense_category_operations
  for insert to authenticated
  with check (
    public.app_account_active()
    and (select public.app_is_owner())
    and performed_by = auth.uid()
  );

grant select, insert on public.expense_categories to authenticated;
grant select, insert on public.expense_category_operations to authenticated;
revoke update, delete on public.expense_categories from authenticated, anon;
revoke update, delete on public.expense_category_operations from authenticated, anon;
grant all on public.expense_categories, public.expense_category_operations to service_role;

-- ---------------------------------------------------------------------------
-- 3. Promote the live notebook words and remove the enum from both tables.

do $$
declare
  v_before bigint;
  v_converted bigint;
  v_bad bigint;
  v_seeded bigint;
  v_live_expenses bigint;
begin
  select count(*) into v_before from public.manual_ledger_expenses;

  -- A clean local reset has no pre-migration rows. Production has the nine rows
  -- captured on 2026-08-07. Any other non-zero count means production changed
  -- after the snapshot and this forward-only conversion must be reconsidered.
  if v_before not in (0, 9) then
    raise exception
      'expected either a clean database or the 9 snapshotted ledger expenses, found %',
      v_before;
  end if;

  alter table public.manual_ledger_expenses add column category_text text;

  update public.manual_ledger_expenses
     set category_text = public.normalize_expense_category(description);
  get diagnostics v_converted = row_count;

  if v_converted <> v_before then
    raise exception 'expected to convert % ledger expenses, converted %', v_before, v_converted;
  end if;

  select count(*) into v_bad
    from public.manual_ledger_expenses
   where category_text is null
      or category_text = ''
      or category_text <> public.normalize_expense_category(category_text);
  if v_bad <> 0 then
    raise exception 'expense category conversion left % blank or unnormalised rows', v_bad;
  end if;

  insert into public.expense_categories (name, created_by)
  select distinct category_text, null::uuid
    from public.manual_ledger_expenses
   order by category_text;

  select count(*) into v_seeded from public.expense_categories;
  if (v_before = 9 and v_seeded <> 3) or (v_before = 0 and v_seeded <> 0) then
    raise exception 'expected % seeded categories, found %',
      case when v_before = 9 then 3 else 0 end,
      v_seeded;
  end if;

  alter table public.manual_ledger_expenses drop column category;
  alter table public.manual_ledger_expenses rename column category_text to category;
  alter table public.manual_ledger_expenses
    alter column category set not null,
    alter column description drop not null,
    add constraint manual_ledger_expenses_category_not_blank
      check (length(category) > 0),
    add constraint manual_ledger_expenses_category_normalized
      check (category = public.normalize_expense_category(category));

  select count(*) into v_live_expenses from public.expenses;
  if v_live_expenses <> 0 then
    raise exception 'expected the demo-gated expenses table to be empty, found % rows',
      v_live_expenses;
  end if;

  alter table public.expenses
    alter column category type text using category::text,
    add constraint expenses_category_not_blank check (length(category) > 0),
    add constraint expenses_category_normalized
      check (category = public.normalize_expense_category(category));
end;
$$;

drop type public.expense_category;

-- Recording a row grows the suggestion list in the same transaction. A case
-- variant resolves to the first spelling, while an unnormalised handcrafted
-- value is refused rather than silently repaired.
create or replace function public.capture_expense_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if new.category is null
     or new.category = ''
     or new.category <> public.normalize_expense_category(new.category) then
    raise exception 'expense category must be present and normalised'
      using errcode = 'check_violation';
  end if;

  select name into v_existing
    from public.expense_categories
   where lower(name) = lower(new.category);

  if v_existing is null then
    insert into public.expense_categories (name, created_by)
    values (new.category, auth.uid())
    on conflict do nothing
    returning name into v_existing;

    if v_existing is null then
      select name into v_existing
        from public.expense_categories
       where lower(name) = lower(new.category);
    end if;
  end if;

  new.category := v_existing;
  return new;
end;
$$;

create trigger manual_ledger_expenses_capture_category
  before insert or update of category on public.manual_ledger_expenses
  for each row execute function public.capture_expense_category();

create trigger expenses_capture_category
  before insert or update of category on public.expenses
  for each row execute function public.capture_expense_category();

revoke execute on function public.capture_expense_category() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Owner-only curation commands. The caller's own assignment is the only
-- authority input; no role or person id is accepted as an argument.

create or replace function public.rename_expense_category(
  p_from text,
  p_to text,
  p_rewrite_history boolean
)
returns table (ledger_rows_moved bigint, expense_rows_moved bigint)
language plpgsql
security definer
set search_path = ''
as $$
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

  select name into v_from
    from public.expense_categories
   where lower(name) = lower(v_from)
   for update;
  if v_from is null then
    raise exception 'category does not exist';
  end if;

  update public.expense_categories set name = v_to where lower(name) = lower(v_from);

  ledger_rows_moved := 0;
  expense_rows_moved := 0;
  if p_rewrite_history then
    update public.manual_ledger_expenses set category = v_to
     where lower(category) = lower(v_from);
    get diagnostics ledger_rows_moved = row_count;

    update public.expenses set category = v_to
     where lower(category) = lower(v_from);
    get diagnostics expense_rows_moved = row_count;
  end if;

  insert into public.expense_category_operations
    (operation, name_before, name_after, ledger_rows_moved,
     expense_rows_moved, performed_by)
  values
    ('rename', v_from, v_to, ledger_rows_moved, expense_rows_moved, auth.uid());

  return next;
end;
$$;

create or replace function public.merge_expense_category(p_from text, p_into text)
returns table (ledger_rows_moved bigint, expense_rows_moved bigint)
language plpgsql
security definer
set search_path = ''
as $$
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
  if v_from is null or v_into is null then
    raise exception 'both categories must exist';
  end if;

  update public.manual_ledger_expenses set category = v_into
   where lower(category) = lower(v_from);
  get diagnostics ledger_rows_moved = row_count;

  update public.expenses set category = v_into
   where lower(category) = lower(v_from);
  get diagnostics expense_rows_moved = row_count;

  delete from public.expense_categories where lower(name) = lower(v_from);

  insert into public.expense_category_operations
    (operation, name_before, name_after, ledger_rows_moved,
     expense_rows_moved, performed_by)
  values
    ('merge', v_from, v_into, ledger_rows_moved, expense_rows_moved, auth.uid());

  return next;
end;
$$;

create or replace function public.retire_expense_category(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.normalize_expense_category(p_name);
begin
  if not public.app_account_active() or not public.app_is_owner() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  delete from public.expense_categories where lower(name) = lower(v_name);
end;
$$;

revoke execute on function public.rename_expense_category(text, text, boolean)
  from public, anon;
revoke execute on function public.merge_expense_category(text, text)
  from public, anon;
revoke execute on function public.retire_expense_category(text)
  from public, anon;
grant execute on function public.rename_expense_category(text, text, boolean)
  to authenticated;
grant execute on function public.merge_expense_category(text, text)
  to authenticated;
grant execute on function public.retire_expense_category(text)
  to authenticated;

commit;
