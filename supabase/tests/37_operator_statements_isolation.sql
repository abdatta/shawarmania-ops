-- A stored statement is reachable only from the outlets it names.
--
-- The failure this guards is a manager reaching another outlet's revenue by
-- constructing its storage path directly. The rule lives on storage.objects, so
-- it is proved here the way every other boundary is: a hand-crafted request under
-- a foreign outlet's prefix is refused by the database, not by a screen.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- The path shape the upload writes: <outlet_id>/<channel>/<file>.
create function pg_temp.object(outlet uuid)
returns text language sql as $$
  select outlet::text || '/zomato/2026-08-20-statement.xlsx'
$$;

-- The policy's own predicate, first, so a failure here is legible before the
-- storage insert exercises the same thing end to end.
select pg_temp.impersonate(:'FA_KAL');

select is(
  public.may_reach_operator_statement(pg_temp.object(:'KAL')),
  true,
  'a manager may reach a statement under their own outlet''s prefix');

select is(
  public.may_reach_operator_statement(pg_temp.object(:'KPA')),
  false,
  'but not one under the outlet they do not manage, however the path is spelled');

select is(
  public.may_reach_operator_statement('not-a-uuid/zomato/x.xlsx'),
  false,
  'and a malformed path belongs to no outlet, so it is reachable by nobody');

-- End to end, through the storage.objects policy the upload actually hits.
select throws_ok(
  format($$insert into storage.objects (bucket_id, name, owner)
           values ('operator-statements', %L, %L)$$,
    pg_temp.object(:'KPA'), :'FA_KAL'),
  '42501', null,
  'a guessed path into another outlet''s statement is refused by storage itself');

select lives_ok(
  format($$insert into storage.objects (bucket_id, name, owner)
           values ('operator-statements', %L, %L)$$,
    pg_temp.object(:'KAL'), :'FA_KAL'),
  'while a statement under the manager''s own outlet is accepted');

reset role;
select * from finish();
rollback;
