-- retire-delivery-orders, 3.1: the contract half of `delivery-orders`. Every
-- build since `f632cc42` (first live in Deploy 43190699464, 12 November, 14:51
-- IST) makes and hands over delivery orders, and reads through what knows one,
-- without asking the gate. Every registered device runs a build that contains
-- it: on 15 November, Cafe Laptop, Conti Kitchen and Shawarma Kitchen on
-- `960ce0f1`, after three services on it (12 to 14 November).
-- release: contract delivery-orders
--
-- What reads the key, in production and in the migrations on 15 November: the
-- two trigger functions below, and nothing else. (`billing_order_guard()`
-- matches the reader search only through a comment naming the change; it has
-- never asked the gate.) Each keeps its on branch, with its body, grants and
-- trigger as they were (production's bodies were read and matched
-- `20261112000000` before this was written). Before the row is retired, so no
-- payment or departure from the rail meets a trigger that answers off.
--
-- Nothing is dropped. The order commands' `_v2`s and the reads `_v3` and
-- `_v2` replaced stay: no build since the retirement calls them, but a
-- Republish to an older one would, and none reads the gate. The row is
-- retired.

-- A delivery order is never paid.
create or replace function public.order_delivery_is_not_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.delivery_orders d where d.order_id = new.id) then
    raise exception 'a delivery order is handed over, not paid' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- An order's label is copied as it leaves the rail, before
-- `orders_label_leaves_the_rail` (AFTER) deletes it. The last label wins.
create or replace function public.order_label_is_kept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.kept_order_labels (order_id, outlet_id, label, kept_at)
  select l.order_id, l.outlet_id, l.label, now()
    from public.order_labels l
   where l.order_id = new.id
  on conflict (order_id) do update set label = excluded.label, kept_at = excluded.kept_at;
  return new;
end;
$$;

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'delivery-orders';
