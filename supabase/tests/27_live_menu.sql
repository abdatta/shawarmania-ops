begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text,
    true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select is((select count(*) from public.menu_categories
            where outlet_id = '00000000-0000-4000-a000-000000000002'), 0::bigint,
  'a manager reads no menu categories outside their assigned outlet');
select is((select count(*) from public.menu_items
            where outlet_id = '00000000-0000-4000-a000-000000000002'), 0::bigint,
  'a manager reads no menu items outside their assigned outlet');

select lives_ok($q$
  select public.create_menu_item_with_category(
    '00000000-0000-4000-a000-000000000001',
    'Beverages', 'Masala Cola', 4500, true, 'Made here', null
  )
$q$, 'a manager creates a new category and its first item in one command');

select is((select count(*) from public.menu_categories
            where outlet_id = '00000000-0000-4000-a000-000000000001'
              and name = 'Beverages' and is_active), 1::bigint,
  'the item-first command creates exactly one active category');
select is((select count(*) from public.menu_items i
            join public.menu_categories c on c.id = i.category_id
           where c.name = 'Beverages' and i.name = 'Masala Cola' and i.is_active), 1::bigint,
  'and creates exactly one active item inside it');

select lives_ok($q$
  select public.create_menu_item_with_category(
    '00000000-0000-4000-a000-000000000001',
    'beverages', 'Lime Soda', 5000, true, null, null
  )
$q$, 'matching category names are reused case-insensitively');
select is((select count(*) from public.menu_categories
            where outlet_id = '00000000-0000-4000-a000-000000000001'
              and lower(name) = 'beverages'), 1::bigint,
  'case changes cannot fragment the counter into duplicate headings');

select throws_ok($q$
  select public.create_menu_item_with_category(
    '00000000-0000-4000-a000-000000000002',
    'Smuggled', 'Smuggled item', 100, false, null, null
  )
$q$, '42501', null,
  'a manager cannot create a category or item at another outlet through the RPC');
select is((select count(*) from public.menu_categories where name = 'Smuggled'), 0::bigint,
  'the refused command leaves no empty category behind');

create temporary table captured_bill_lines as
select id, item_name, unit_price_paise, line_total_paise
  from public.bill_items
 where menu_item_id = '31000000-0000-4000-a000-000000000001';

select lives_ok($q$
  update public.menu_items
     set name = 'Classic renamed', price_paise = 19900
   where id = '31000000-0000-4000-a000-000000000001'
$q$, 'a manager may rename and reprice an own-outlet item');

select results_eq(
  $q$select id, item_name, unit_price_paise, line_total_paise
       from public.bill_items
      where menu_item_id = '31000000-0000-4000-a000-000000000001'
      order by id$q$,
  $q$select id, item_name, unit_price_paise, line_total_paise
       from captured_bill_lines order by id$q$,
  'repricing the menu leaves every captured bill line unchanged');

select lives_ok($q$
  select public.retire_menu_item(i.id)
    from public.menu_items i
    join public.menu_categories c on c.id = i.category_id
   where c.name = 'Beverages' and i.name = 'Masala Cola'
$q$, 'a manager may retire an own-outlet item without deleting it');
select ok((select not is_active and not is_available from public.menu_items
            where name = 'Masala Cola'),
  'retirement keeps the row but removes it from the working menu');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$
  select public.create_menu_item_with_category(
    '00000000-0000-4000-a000-000000000001',
    'Employee category', 'Employee item', 100, false, null, null
  )
$q$, '42501', null, 'an Employee cannot write the menu through the item-first RPC');

reset role;
select * from finish();
rollback;
