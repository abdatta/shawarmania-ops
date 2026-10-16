-- The app asks the server less (the-app-asks-the-server-less, design D8): the
-- `fewer-requests` gate exists off, and a tablet's v2 health report writes the
-- row a v1 report writes and answers with every live gate's answer.
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

create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

\set KAL '00000000-0000-4000-a000-000000000001'
\set OWNER '10000000-0000-4000-a000-000000000001'
\set COUNTER_KAL '10000000-0000-4000-a000-000000000004'

-- ── The gate ───────────────────────────────────────────────────────────────

select is((select enabled from public.change_gates where key = 'fewer-requests'), false,
  'fewer-requests is declared off');
select is((select code from public.change_gates where key = 'fewer-requests'), 'FR',
  'its code is FR');
select is((select change_number from public.change_gates where key = 'fewer-requests'), null::integer,
  'it carries no roadmap number');
select is((select count(*)::int from public.change_gate_dependencies where gate_key = 'fewer-requests'), 0,
  'it depends on nothing');

-- ── The v2 report ──────────────────────────────────────────────────────────

-- Known answers to compare against: whatever another suite left, then one
-- retired gate, which a device never reads.
update public.change_gates set enabled = true where key = 'probe';
update public.change_gates set enabled = false where key = 'fewer-requests';
insert into public.change_gates (key, code, kind, title, on_means, off_means, change_name, retired_at)
values ('cg-gone', 'QZ', 'change', 'Gone', 'x', 'y', 'test', now());

select pg_temp.impersonate(:'OWNER');
select throws_ok($$select report_device_health_v2('abc1234', '{}', 60, 1, 0, 10)$$, '42501',
  'Only a tablet reports its health.', 'a person cannot report tablet health through v2 either');

select pg_temp.impersonate(:'COUNTER_KAL');
select is(
  report_device_health_v2('abc1234', array['probe', 'fewer-requests'], 60, 21, 2, 333),
  (select jsonb_object_agg(key, enabled) from public.change_gates where retired_at is null),
  'a tablet''s v2 report is answered with every live gate''s answer, as its own read gives it');
select is(
  report_device_health_v2('abc1234', '{}', 60, 1, 0, 1) -> 'probe', 'true'::jsonb,
  'including a gate that is on');
select is(
  report_device_health_v2('abc1234', '{}', 60, 1, 0, 1) -> 'fewer-requests', 'false'::jsonb,
  'and one that is off');
select ok(
  not (report_device_health_v2('abc1234', '{}', 60, 1, 0, 1) ? 'cg-gone'),
  'a retired gate is not in the answer');
select is(
  (select count(*)::int from jsonb_object_keys(report_device_health_v2('abc1234', '{}', 60, 1, 0, 1))),
  (select count(*)::int from public.change_gates where retired_at is null),
  'one answer per live gate');

select lives_ok($$select report_device_health_v2('def5678', array['probe'], 60, 44, 3, 512)$$,
  'and its last report lands');
select pg_temp.unimpersonate();

select results_eq(
  $$select outlet_id, build, booted_gates, window_seconds, requests, failed, slowest_ms
      from public.device_health where device_id = '10000000-0000-4000-a000-000000000004'$$,
  $$values ('00000000-0000-4000-a000-000000000001'::uuid, 'def5678'::text, array['probe']::text[],
            60, 44, 3, 512)$$,
  'it writes the row a v1 report writes, on the tablet''s own row at its own outlet');

select is(
  has_function_privilege('anon',
    'public.report_device_health_v2(text, text[], integer, integer, integer, integer)', 'execute'),
  false, 'anon cannot call it');
select is(
  has_function_privilege('authenticated',
    'public.report_device_health_v2(text, text[], integer, integer, integer, integer)', 'execute'),
  true, 'a signed-in tablet can');

select * from finish();
rollback;
