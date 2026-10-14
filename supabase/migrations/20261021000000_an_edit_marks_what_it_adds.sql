-- change-gate: dish-ticks
--
-- #74: the rail sets food an edit added below a divider (each-dish-is-ticked-off,
-- design R12).
--
-- The composer now shows a dish the kitchen has partly made as one row with its
-- true total, and saves the food added since on a line of its own. On the rail
-- that reads as the same dish twice; a divider over what each edit added says
-- why. A line does not record when it was added, so this records it: a row per
-- item line an edit inserted, never one for the lines an order was created
-- with. Only adds. The trigger is inert while `dish-ticks` is off, so rows exist
-- only for edits made with it on, and a published build reads nothing new.

create table public.order_line_additions (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id),
  added_at timestamptz not null default now()
);
create index order_line_additions_order_idx on public.order_line_additions(order_id);
alter table public.order_line_additions enable row level security;
-- Read as the ticks are: the outlet's counter shift, the owner, its franchise admins.
create policy order_line_additions_select on public.order_line_additions
  for select to authenticated using (public.app_device_ok() and (
    outlet_id = (select public.app_counter_shift_outlet())
    or (public.app_account_active() and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));
revoke all on public.order_line_additions from anon, authenticated;
grant select on public.order_line_additions to authenticated;

-- A line inserted into an order that existed before this transaction is an
-- edit's: `now()` is the transaction's start, and an order created with its
-- lines shares it. A revision upserts its lines, so a line it keeps takes the
-- update path and fires no insert.
create function public.order_line_added_by_an_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.app_change_gate('dish-ticks') then return new; end if;
  insert into public.order_line_additions (order_item_id, order_id, outlet_id, added_at)
  select new.id, o.id, o.outlet_id, now()
    from public.orders o
   where o.id = new.order_id and o.created_at < now()
  on conflict (order_item_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.order_line_added_by_an_edit() from public, anon, authenticated;

create trigger order_items_added_by_an_edit
  after insert on public.order_items
  for each row
  when (new.kind = 'item')
  execute function public.order_line_added_by_an_edit();
