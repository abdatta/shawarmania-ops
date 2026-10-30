-- a-check-in-at-the-shop-approves-itself (#81), design D11: an expense's
-- category is picked from a list the owners keep, and Other asks what it was
-- for (asked by the co-owner, 2026-10-29).
-- change-gate: expense-category-list
--
-- Everything here is new: one table, its seed, and three owner-only commands.
-- Expenses keep storing their category as text, and nothing refuses a name off
-- the list: the counter's outbox never reads a gate, so a refusal here would
-- refuse an expense queued on an older build.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('expense-category-list', 'EL', 'change', 'Expense category list',
   'An expense''s category is picked from the owners'' list, and Other asks what it was for.',
   'An expense''s category is typed, with suggestions.',
   'a-check-in-at-the-shop-approves-itself', 81);

insert into public.change_gate_dependencies (gate_key, depends_on)
values ('expense-category-list', 'refreshed-staff-screens');

-- ── The list ────────────────────────────────────────────────────────────────
--
-- Business-wide, as `expense_categories` is: the same vocabulary serves every
-- outlet. Read by every active account, because staff and the counter draw the
-- tiles; written only through the commands below. `sort_order` is unique and
-- checked at commit, so a move swaps two places in one statement.

create table public.expense_category_choices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null,
  asks_note boolean not null default false,
  managers_only boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  constraint expense_category_choices_name_not_blank check (length(name) > 0),
  constraint expense_category_choices_name_normalized
    check (name = public.normalize_expense_category(name)),
  constraint expense_category_choices_sort_order_key
    unique (sort_order) deferrable initially deferred
);

create unique index expense_category_choices_name_case_insensitive_key
  on public.expense_category_choices (lower(name));

alter table public.expense_category_choices enable row level security;

create policy expense_category_choices_select on public.expense_category_choices
  for select to authenticated
  using (public.app_account_active());

grant select on public.expense_category_choices to authenticated;
grant all on public.expense_category_choices to service_role;

-- The co-owner's five, Miscellaneous called Other, with Transport and Wages &
-- bonus from what production records (design D11). The owners change it.
insert into public.expense_category_choices (name, sort_order, asks_note, managers_only)
values
  ('Chicken', 1, false, false),
  ('Raw Materials', 2, false, false),
  ('Gas', 3, false, false),
  ('Staff Food', 4, false, false),
  ('Transport', 5, false, false),
  ('Wages & bonus', 6, false, true),
  ('Other', 7, true, false);

-- ── Add, or change one ──────────────────────────────────────────────────────
--
-- A changed name renames that category everywhere: the suggestion and the
-- recorded expenses move, logged as a rename (or as a merge, where the new name
-- is already a suggestion), because renaming a bucket means the same bucket
-- under a better name. A reserved name is refused, as it is for an expense.

create or replace function public.save_expense_category_choice(
  p_id uuid, p_name text, p_asks_note boolean, p_managers_only boolean
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := public.normalize_expense_category(coalesce(p_name, ''));
  v_before text;
  v_id uuid;
begin
  if not public.app_account_active() or not public.app_is_owner() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if v_name = '' then
    raise exception 'a category needs a name' using errcode = 'check_violation';
  end if;
  if public.expense_category_reserved_owner(v_name) is not null then
    raise exception 'that category is reserved' using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into public.expense_category_choices
      (name, sort_order, asks_note, managers_only, created_by, updated_by)
    select v_name, coalesce(max(sort_order), 0) + 1, coalesce(p_asks_note, false),
           coalesce(p_managers_only, false), auth.uid(), auth.uid()
      from public.expense_category_choices
    returning id into v_id;
    insert into public.expense_categories (name, created_by)
    values (v_name, auth.uid())
    on conflict ((lower(name))) do nothing;
    return v_id;
  end if;

  select name into v_before from public.expense_category_choices
   where id = p_id for update;
  if v_before is null then
    raise exception 'that category is no longer on the list' using errcode = 'no_data_found';
  end if;

  if v_before <> v_name then
    if exists (select 1 from public.expense_categories where lower(name) = lower(v_before))
    then
      if lower(v_before) <> lower(v_name)
         and exists (select 1 from public.expense_categories where lower(name) = lower(v_name))
      then
        perform public.merge_expense_category(v_before, v_name);
      else
        perform public.rename_expense_category(v_before, v_name, true);
      end if;
    else
      insert into public.expense_categories (name, created_by)
      values (v_name, auth.uid())
      on conflict ((lower(name))) do nothing;
    end if;
  end if;

  update public.expense_category_choices
     set name = v_name,
         asks_note = coalesce(p_asks_note, false),
         managers_only = coalesce(p_managers_only, false),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_id;
  return p_id;
end;
$$;

-- ── One place up or down ────────────────────────────────────────────────────

create or replace function public.move_expense_category_choice(p_id uuid, p_direction text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order integer;
  v_other uuid;
  v_other_order integer;
begin
  if not public.app_account_active() or not public.app_is_owner() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_direction not in ('up', 'down') then
    raise exception 'a move is up or down' using errcode = 'check_violation';
  end if;
  -- The whole list, so two owners moving at once cannot swap into one place.
  perform 1 from public.expense_category_choices for update;
  select sort_order into v_order from public.expense_category_choices where id = p_id;
  if v_order is null then
    raise exception 'that category is no longer on the list' using errcode = 'no_data_found';
  end if;
  if p_direction = 'up' then
    select id, sort_order into v_other, v_other_order from public.expense_category_choices
     where sort_order < v_order order by sort_order desc limit 1;
  else
    select id, sort_order into v_other, v_other_order from public.expense_category_choices
     where sort_order > v_order order by sort_order limit 1;
  end if;
  if v_other is null then return; end if;
  update public.expense_category_choices
     set sort_order = case when id = p_id then v_other_order else v_order end,
         updated_by = auth.uid(),
         updated_at = now()
   where id in (p_id, v_other);
end;
$$;

-- ── Off the list ────────────────────────────────────────────────────────────
--
-- Recorded expenses keep their name, and the suggestion stays.

create or replace function public.remove_expense_category_choice(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.app_account_active() or not public.app_is_owner() then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  delete from public.expense_category_choices where id = p_id;
end;
$$;

revoke execute on function public.save_expense_category_choice(uuid, text, boolean, boolean)
  from public, anon;
revoke execute on function public.move_expense_category_choice(uuid, text) from public, anon;
revoke execute on function public.remove_expense_category_choice(uuid) from public, anon;
grant execute on function public.save_expense_category_choice(uuid, text, boolean, boolean)
  to authenticated;
grant execute on function public.move_expense_category_choice(uuid, text) to authenticated;
grant execute on function public.remove_expense_category_choice(uuid) to authenticated;
