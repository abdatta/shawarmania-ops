-- retire-dish-ticks, 3.3: the contract half of `dish-ticks`. Each dish has been
-- ticked off on its own on every build since `aabc97b7` (first live in Deploy
-- `ac4ce56d`, 18 October), and every registered device runs a build that
-- contains it: on 21 October, Kalyani Counter 2 and Shawarma Kitchen on
-- `0b06e73`, both outboxes empty, after three services on it.
-- release: contract dish-ticks
--
-- Last of the three, after `instant-saves` and `kitchen-ready`, which depended
-- on it.
--
-- 1. The database's two readers of the gate keep only their on branch, before
--    the row is retired, so retiring it does not quietly switch them off.
-- 2. What only the off path used goes: the pre-#74 functions restored by
--    `20261017000000_restore_counter_before_dish_ticks` that a `_v2` replaced,
--    and that no published build since the retirement calls. Every `_v2` stays.
--    Two old functions stay because something kept still calls them:
--    `prepare_order_lines` (`prepare_order_lines_v2` delivers through it) and
--    `kitchen_visible_lines` (`kitchen_ticket` reads it).
-- 3. The row is retired.

-- 1. The readers -------------------------------------------------------------

create or replace function public.order_label_leaves_the_rail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.order_labels where order_id = new.id;
  return new;
end;
$$;

create or replace function public.order_line_added_by_an_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_line_additions (order_item_id, order_id, outlet_id, added_at)
  select new.id, o.id, o.outlet_id, now()
    from public.orders o
   where o.id = new.order_id and o.created_at < now()
  on conflict (order_item_id) do nothing;
  return new;
end;
$$;

-- 2. The off path's functions --------------------------------------------------

-- The counter's commands: every build since the retirement sends `create_order`
-- and `revise_order` with the `dishes` variant, to the `_v2`s.
drop function public.create_billing_order(uuid, integer, text, timestamptz, uuid, jsonb);
drop function public.revise_billing_order(uuid, integer, text, timestamptz, uuid, jsonb);

-- The old kitchen board, the counter's old read of it, and the old
-- acknowledgement; and the comparison only the counter's old read used.
drop function public.kitchen_board();
drop function public.counter_kitchen_marks();
drop function public.kitchen_acknowledge(uuid, uuid, text, timestamptz);
drop function public.kitchen_same_lines(jsonb, jsonb);

-- 3. The row -----------------------------------------------------------------

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'dish-ticks';
