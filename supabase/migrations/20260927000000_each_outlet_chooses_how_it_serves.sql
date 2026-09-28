-- each-outlet-chooses-how-it-serves (#60), section 3: how an outlet serves.
--
-- Six columns on the outlet row (design D1), every one off by default, and the
-- one narrow function through which the owner and the outlet's own managers
-- change them (design, RLS).
--
-- **Why columns on `outlets` and not a table of their own.** The row is already
-- scoped: `outlets_select` gives it to the owner, to everybody live at the
-- outlet, and to a counter device for its own outlet, which is exactly who
-- needs these (design D6). A 1:1 table would need its own policy and its own
-- isolation case to say the same thing.
--
-- **Why a function, and not a wider `outlets_update`.** A manager changes these
-- six settings for the outlets they manage [owner, 2026-09-27], and nothing
-- else of the row. `outlets_update` is the owner's alone; widening it to
-- managers would hand them the business-day cutover and the check-in fence,
-- which judges staff attendance. So the policy stays as it is, and the manager's
-- only door is `set_outlet_service_settings`, which re-derives the caller's
-- authority and writes these six columns and no others.

create type public.packaging_mode as enum ('off', 'per_bag', 'per_order');

alter table public.outlets
  add column dine_in_offered boolean not null default false,
  add column takeaway_offered boolean not null default false,
  -- Dine-in orders are keyed a table, 1 to 999. There is no count of tables
  -- [owner, 2026-09-27]: the floor changes, and a number keyed needs no list.
  add column table_numbers boolean not null default false,
  add column packaging_mode public.packaging_mode not null default 'off',
  add column packaging_price_paise integer,
  add column packaging_free_for_gold boolean not null default false,

  -- Each check is on the table, so a hand-crafted request meets it as surely as
  -- a form does.
  add constraint outlets_table_numbers_need_dine_in
    check (not table_numbers or dine_in_offered),
  -- Packaging is charged on takeaway orders and nowhere else, so it cannot
  -- outlive the type it charges.
  add constraint outlets_packaging_needs_takeaway
    check (packaging_mode = 'off' or takeaway_offered),
  add constraint outlets_packaging_price_matches_charge
    check ((packaging_mode = 'off') = (packaging_price_paise is null)),
  -- Whole rupees, at least one, and no ceiling [owner, 2026-09-27]: every bill
  -- already ends on a whole rupee, so part-rupees would only feed the rounding
  -- line, and the price is the shop's own business.
  add constraint outlets_packaging_price_whole_rupees
    check (packaging_price_paise is null
           or (packaging_price_paise >= 100 and packaging_price_paise % 100 = 0)),
  add constraint outlets_gold_waiver_needs_charge
    check (not packaging_free_for_gold or packaging_mode <> 'off');

comment on column public.outlets.dine_in_offered is
  'The counter offers dine-in (#60). With takeaway also offered, the biller must choose; alone, every order is dine-in.';
comment on column public.outlets.takeaway_offered is
  'The counter offers takeaway (#60). Packaging is charged on takeaway orders only.';
comment on column public.outlets.table_numbers is
  'Dine-in orders are keyed a table number, 1 to 999 (#60). There is no count of tables.';
comment on column public.outlets.packaging_mode is
  'Whether takeaway orders carry a packaging line, per bag or flat per order (#60).';
comment on column public.outlets.packaging_price_paise is
  'The packaging price in paise: whole rupees, at least one, null exactly when packaging is off (#60).';
comment on column public.outlets.packaging_free_for_gold is
  'A gold member''s packaging is waived, as the packaging line''s own whole discount (#60).';

-- Every outlet that exists takes the defaults, which are all off, and so bills
-- exactly as it did the moment before this migration. Asserted rather than
-- assumed: a default that did not land would change a live counter silently.
do $$
begin
  if exists (
    select 1 from public.outlets
     where dine_in_offered or takeaway_offered or table_numbers
        or packaging_mode <> 'off' or packaging_price_paise is not null
        or packaging_free_for_gold
  ) then
    raise exception 'an outlet ended the #60 migration with a service choice on';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The one write path for a manager.

create or replace function public.set_outlet_service_settings(
  p_outlet uuid,
  p_dine_in_offered boolean,
  p_takeaway_offered boolean,
  p_table_numbers boolean,
  p_packaging_mode public.packaging_mode,
  p_packaging_price_paise integer,
  p_packaging_free_for_gold boolean
)
returns public.outlets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet public.outlets;
begin
  -- Authority from the caller's own token and live assignments, never from the
  -- request: the owner anywhere, a Franchise Admin at an outlet they manage.
  -- A counter device, a biller and an employee hold neither.
  if auth.uid() is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet)) then
    raise exception 'only the owner or this outlet''s manager may change how it serves'
      using errcode = 'insufficient_privilege';
  end if;

  -- These six columns and no others: this function is not a way round
  -- `outlets_update` for anything else on the row.
  update public.outlets
     set dine_in_offered = p_dine_in_offered,
         takeaway_offered = p_takeaway_offered,
         table_numbers = p_table_numbers,
         packaging_mode = p_packaging_mode,
         packaging_price_paise = p_packaging_price_paise,
         packaging_free_for_gold = p_packaging_free_for_gold
   where id = p_outlet
  returning * into v_outlet;

  if not found then
    raise exception 'no such outlet' using errcode = 'no_data_found';
  end if;
  return v_outlet;
end;
$$;

comment on function public.set_outlet_service_settings is
  'How an outlet serves (#60): the owner for any outlet, a manager for the outlets they manage. Writes the six service columns and nothing else of the row; the table''s checks refuse an inconsistent combination.';

revoke execute on function public.set_outlet_service_settings(
  uuid, boolean, boolean, boolean, public.packaging_mode, integer, boolean
) from public, anon;
grant execute on function public.set_outlet_service_settings(
  uuid, boolean, boolean, boolean, public.packaging_mode, integer, boolean
) to authenticated;
