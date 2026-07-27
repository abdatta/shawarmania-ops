-- Daily cash. The record a manager signs their name to is a snapshot,
-- computed by the database at close and never recomputed on read. Clients
-- cannot write this table at all — close_business_day() is the only path.

create table public.cash_withdrawals (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  business_date date not null,
  amount_paise bigint not null check (amount_paise > 0),
  reason text,
  -- Who physically took the money — a name, not necessarily an app user.
  withdrawn_by text not null,
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index cash_withdrawals_outlet_business_date_idx
  on public.cash_withdrawals (outlet_id, business_date);

alter table public.cash_withdrawals enable row level security;

revoke update, delete on public.cash_withdrawals from authenticated, anon;

create table public.daily_cash_records (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  business_date date not null,
  opening_cash_paise bigint not null check (opening_cash_paise >= 0),
  cash_sales_paise bigint not null check (cash_sales_paise >= 0),
  cash_expenses_paise bigint not null check (cash_expenses_paise >= 0),
  cash_withdrawn_paise bigint not null check (cash_withdrawn_paise >= 0),
  expected_closing_paise bigint not null,
  actual_closing_paise bigint not null check (actual_closing_paise >= 0),
  difference_paise bigint not null,
  closed_by uuid not null references public.profiles (id),
  closed_at timestamptz not null default now(),
  notes text,
  constraint daily_cash_one_per_outlet_day unique (outlet_id, business_date),
  constraint daily_cash_expected_arithmetic check (
    expected_closing_paise
      = opening_cash_paise + cash_sales_paise - cash_expenses_paise - cash_withdrawn_paise
  ),
  -- Short is negative, over is positive.
  constraint daily_cash_difference_arithmetic
    check (difference_paise = actual_closing_paise - expected_closing_paise)
);

alter table public.daily_cash_records enable row level security;

revoke insert, update, delete on public.daily_cash_records from authenticated, anon;

-- ---------------------------------------------------------------------------
-- The only write path. Deliberately Franchise-Admin-only: day close belongs
-- to the person counting the drawer, not to the owner's phone.

create or replace function public.close_business_day(
  p_outlet_id uuid,
  p_business_date date,
  p_opening_cash_paise bigint,
  p_actual_closing_paise bigint,
  p_notes text default null
)
returns public.daily_cash_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_sales bigint;
  v_expenses bigint;
  v_withdrawn bigint;
  v_expected bigint;
  v_record public.daily_cash_records%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();

  if not found
     or not v_profile.is_active
     or v_profile.role <> 'franchise_admin'
     or v_profile.outlet_id is distinct from p_outlet_id then
    raise exception 'only an active franchise admin of this outlet may close its business day';
  end if;

  if p_opening_cash_paise is null or p_opening_cash_paise < 0
     or p_actual_closing_paise is null or p_actual_closing_paise < 0 then
    raise exception 'opening and counted closing cash must be non-negative paise amounts';
  end if;

  -- The three derived figures are computed here, inside the same transaction
  -- that writes the snapshot. The client never supplies them.
  select coalesce(sum(total_paise), 0) into v_sales
    from public.bills
   where outlet_id = p_outlet_id
     and business_date = p_business_date
     and payment_method = 'cash'
     and status = 'settled';

  select coalesce(sum(amount_paise), 0) into v_expenses
    from public.expenses
   where outlet_id = p_outlet_id
     and business_date = p_business_date
     and payment_method = 'cash';

  select coalesce(sum(amount_paise), 0) into v_withdrawn
    from public.cash_withdrawals
   where outlet_id = p_outlet_id
     and business_date = p_business_date;

  v_expected := p_opening_cash_paise + v_sales - v_expenses - v_withdrawn;

  begin
    insert into public.daily_cash_records (
      outlet_id, business_date,
      opening_cash_paise, cash_sales_paise, cash_expenses_paise, cash_withdrawn_paise,
      expected_closing_paise, actual_closing_paise, difference_paise,
      closed_by, notes
    ) values (
      p_outlet_id, p_business_date,
      p_opening_cash_paise, v_sales, v_expenses, v_withdrawn,
      v_expected, p_actual_closing_paise, p_actual_closing_paise - v_expected,
      auth.uid(), p_notes
    )
    returning * into v_record;
  exception
    when unique_violation then
      raise exception 'business day % is already closed for this outlet', p_business_date;
  end;

  return v_record;
end;
$$;

revoke execute on function
  public.close_business_day(uuid, date, bigint, bigint, text)
  from public, anon;
grant execute on function
  public.close_business_day(uuid, date, bigint, bigint, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Policies — reads only. There are deliberately no write policies.

create policy cash_withdrawals_select on public.cash_withdrawals
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy cash_withdrawals_insert on public.cash_withdrawals
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_role() = 'franchise_admin'
    and outlet_id = public.app_outlet_id()
    and recorded_by = auth.uid()
  );

create policy daily_cash_records_select on public.daily_cash_records
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );
