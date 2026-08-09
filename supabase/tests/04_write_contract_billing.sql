-- The legacy write-contract slot now proves the boundary that replaced direct
-- bill and line inserts. Command behavior lives in 26; this file keeps the
-- append-only and privilege facts pinned beside the original suite ordering.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select throws_ok($q$
  insert into public.bills (id) values (gen_random_uuid())
$q$, '42501', null, 'a tablet holds no direct insert privilege on bills');

select throws_ok($q$
  insert into public.bill_items (bill_id, item_name, unit_price_paise, quantity, line_total_paise)
  values ('50000000-0000-4000-a000-000000000001', 'x', 100, 1, 100)
$q$, '42501', null, 'a tablet holds no direct insert privilege on bill items');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select throws_ok($q$
  update public.bills set subtotal_paise = subtotal_paise + 1,
    total_paise = total_paise + 1
   where id = '50000000-0000-4000-a000-000000000001'
$q$, '42501', null, 'an outlet manager holds no direct update privilege on bills');

reset role;

select throws_ok($q$
  update public.bills set subtotal_paise = subtotal_paise + 1,
    total_paise = total_paise + 1
   where id = '50000000-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'the append-only trigger refuses amount edits even for the database owner');

select throws_ok($q$
  delete from public.bills where id = '50000000-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'the database owner cannot delete a historical bill');

select throws_ok($q$
  update public.bill_items set quantity = 2, line_total_paise = unit_price_paise * 2
   where bill_id = '50000000-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'historical bill lines are immutable');

select * from finish();
rollback;
