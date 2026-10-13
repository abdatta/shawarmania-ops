-- #75 a-release-can-be-switched-off: change gates.
--
-- Only the owner turns a gate, a gate depending on others turns on only while
-- they are on and turns off with any of them, every signed-in principal reads
-- the gates, history is append-only, and tablet health is isolated by outlet.

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
\set KPA '00000000-0000-4000-a000-000000000002'
\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set COUNTER_KAL '10000000-0000-4000-a000-000000000004'
\set COUNTER_KPA '10000000-0000-4000-a000-000000000005'
\set BILLER '10000000-0000-4000-a000-00000000000a'
\set STAFF '10000000-0000-4000-a000-000000000006'

-- ── Declared gates ─────────────────────────────────────────────────────────

-- Another suite may have turned the probe and left history; every count here
-- is relative to where this file started.
create temp table events_before as select count(*)::int as n from change_gate_events;
grant select on events_before to authenticated;
update change_gates set enabled = false where key in ('probe', 'tablet-health');

select is(
  (select array_agg(key order by key) from change_gates where key in ('probe', 'tablet-health')),
  array['probe', 'tablet-health'],
  'this change declares its own two gates');

select is((select code from change_gates where key = 'probe'), 'PB', 'the probe''s code');

-- Test gates, as a later migration would declare them.
insert into change_gates (key, code, kind, title, on_means, off_means, change_name)
values
  ('cg-a', 'QA', 'change', 'Gate A', 'A on.', 'A off.', 'test'),
  ('cg-b', 'QB', 'change', 'Gate B', 'B on.', 'B off.', 'test'),
  ('cg-c', 'QC', 'change', 'Gate C', 'C on.', 'C off.', 'test'),
  ('cg-x', 'QX', 'change', 'Gate X', 'X on.', 'X off.', 'test'),
  ('cg-d', 'QD', 'change', 'Gate D', 'D on.', 'D off.', 'test');
insert into change_gate_dependencies (gate_key, depends_on)
values ('cg-b', 'cg-a'), ('cg-c', 'cg-b'), ('cg-d', 'cg-a'), ('cg-d', 'cg-x');

select throws_ok(
  $$insert into change_gates (key, code, kind, title, on_means, off_means, change_name)
    values ('probe', 'ZZ', 'change', 'Again', 'x', 'y', 'test')$$,
  '23505', null, 'a key is never declared twice');

select throws_ok(
  $$insert into change_gates (key, code, kind, title, on_means, off_means, change_name)
    values ('cg-twin', 'QA', 'change', 'Twin', 'x', 'y', 'test')$$,
  '23505', null, 'two live gates cannot share a code');

select throws_ok(
  $$insert into change_gates (key, code, kind, title, on_means, off_means, change_name)
    values ('cg-digits', '12', 'change', 'Digits', 'x', 'y', 'test')$$,
  '23514', null, 'a code needs a letter');

select throws_ok(
  $$insert into change_gates (key, code, kind, title, on_means, off_means, change_name)
    values ('cg-long', 'ABC', 'change', 'Long', 'x', 'y', 'test')$$,
  '23514', null, 'a code is two characters');

insert into change_gates (key, code, kind, title, on_means, off_means, change_name, retired_at)
values ('cg-old', 'QR', 'change', 'Old', 'x', 'y', 'test', now());
select lives_ok(
  $$insert into change_gates (key, code, kind, title, on_means, off_means, change_name)
    values ('cg-new', 'QR', 'change', 'New', 'x', 'y', 'test')$$,
  'a retired gate''s code may be given out again');

select throws_ok(
  $$insert into change_gate_dependencies values ('cg-a', 'cg-a')$$,
  '23514', null, 'a gate cannot depend on itself');

select throws_ok(
  $$insert into change_gate_dependencies values ('cg-a', 'cg-c')$$,
  '23514', null, 'a dependency cannot close a loop');

-- ── Who may turn a gate ───────────────────────────────────────────────────

select pg_temp.impersonate(:'FA_KAL');
select throws_ok($$select set_change_gate('probe', true, null)$$, '42501',
  'Only the owner turns a change gate.', 'a Franchise Admin is refused');
select pg_temp.impersonate(:'BILLER');
select throws_ok($$select set_change_gate('probe', true, null)$$, '42501',
  'Only the owner turns a change gate.', 'a Biller is refused');
select pg_temp.impersonate(:'STAFF');
select throws_ok($$select set_change_gate('probe', true, null)$$, '42501',
  'Only the owner turns a change gate.', 'an Employee is refused');
select pg_temp.impersonate(:'COUNTER_KAL');
select throws_ok($$select set_change_gate('probe', true, null)$$, '42501',
  'Only the owner turns a change gate.', 'a counter tablet is refused');
-- The same tablet made a kitchen for one call: kind decides nothing here.
select pg_temp.unimpersonate();
update counter_devices set kind = 'kitchen' where id = :'COUNTER_KAL';
select pg_temp.impersonate(:'COUNTER_KAL');
select throws_ok($$select set_change_gate('probe', true, null)$$, '42501',
  'Only the owner turns a change gate.', 'a kitchen tablet is refused');
select pg_temp.unimpersonate();
update counter_devices set kind = 'counter' where id = :'COUNTER_KAL';
select pg_temp.unimpersonate();

select is((select enabled from change_gates where key = 'probe'), false,
  'no refused call changed anything');
select is((select count(*)::int from change_gate_events) - (select n from events_before), 0,
  'and no event was recorded');

select ok(not has_function_privilege('authenticated', 'change_gate_force(text, boolean, text)', 'execute'),
  'the dashboard turn is not callable by a signed-in client');
select ok(not has_function_privilege('anon', 'change_gate_force(text, boolean, text)', 'execute'),
  'nor by anon');
select ok(not has_function_privilege('authenticated', 'change_gate_apply(text, boolean, text, uuid, text)', 'execute'),
  'the internal turn is not callable by a client');

select pg_temp.impersonate(:'OWNER');
select lives_ok($$select set_change_gate('probe', true, 'Quiet hour')$$, 'the owner turns the probe on');
select is((select enabled from change_gates where key = 'probe'), true, 'the probe is on');
select results_eq(
  $$select enabled, reason, source, changed_by from change_gate_events
     where gate_key = 'probe' and reason = 'Quiet hour'$$,
  $$values (true, 'Quiet hour'::text, 'app'::text, '10000000-0000-4000-a000-000000000001'::uuid)$$,
  'the turn is recorded with its reason, source and who');
select lives_ok($$select set_change_gate('probe', true, null)$$, 'setting the current answer is allowed');
select is((select count(*)::int from change_gate_events where gate_key = 'probe'
             and at >= (select max(at) from change_gate_events where reason = 'Quiet hour')), 2,
  'and records an event');
select throws_ok($$select set_change_gate('no-such-gate', true, null)$$, 'P0002',
  'That change gate does not exist.', 'an unknown gate is refused');
select throws_ok($$select set_change_gate('cg-old', true, null)$$, '22023', null,
  'a retired gate cannot be turned');
select throws_ok($$select set_change_gate('probe', false, repeat('x', 201))$$, '22001', null,
  'a reason is at most 200 characters');

-- ── Dependencies ──────────────────────────────────────────────────────────

select throws_ok($$select set_change_gate('cg-b', true, null)$$, '22023',
  'Turn on Gate A first: Gate B is dependent on it.',
  'a gate cannot turn on while a gate it depends on is off');
select lives_ok($$select set_change_gate('cg-a', true, null)$$, 'A on');
select lives_ok($$select set_change_gate('cg-b', true, null)$$, 'then B');
select lives_ok($$select set_change_gate('cg-c', true, null)$$, 'then C');
select throws_ok($$select set_change_gate('cg-d', true, null)$$, '22023',
  'Turn on Gate X first: Gate D is dependent on it.',
  'a gate with two dependencies needs both');
select lives_ok($$select set_change_gate('cg-x', true, null)$$, 'X on');
select lives_ok($$select set_change_gate('cg-d', true, null)$$, 'then D');

select is(app_change_gate('cg-c'), true, 'the database reads C on while A and B are on');

select lives_ok($$select set_change_gate('cg-a', false, 'Counter freezing')$$, 'A off');
select results_eq(
  $$select key, enabled from change_gates where key like 'cg-_' order by key$$,
  $$values ('cg-a'::text, false), ('cg-b', false), ('cg-c', false), ('cg-d', false), ('cg-x', true)$$,
  'turning A off turns off everything depending on it, at any depth, and nothing else');
select results_eq(
  $$select gate_key, reason from change_gate_events
     where gate_key in ('cg-b', 'cg-c', 'cg-d') and not enabled order by gate_key$$,
  $$values ('cg-b'::text, 'Turned off with Gate A'::text),
           ('cg-c', 'Turned off with Gate A'), ('cg-d', 'Turned off with Gate A')$$,
  'each dependent''s turn is its own line in the history');

select lives_ok($$select set_change_gate('cg-a', true, null)$$, 'A back on');
select is((select enabled from change_gates where key = 'cg-b'), false,
  'turning A back on leaves B off: coming back is one change at a time');
select is(app_change_gate('cg-b'), false, 'the database reads B off');
select is(app_change_gate('no-such-gate'), false, 'an unknown gate reads off');
select is(app_change_gate('cg-old'), false, 'a retired gate reads off');
select pg_temp.unimpersonate();

-- A row that somehow says on while a gate it needs is off still reads off.
update change_gates set enabled = true where key = 'cg-c';
select is(app_change_gate('cg-c'), false, 'a gate reads off while anything it depends on is off');

-- ── Reading ───────────────────────────────────────────────────────────────

select pg_temp.impersonate(:'FA_KAL');
select ok((select count(*) from change_gates) > 0, 'a Franchise Admin reads the gates');
select is((select count(*)::int from change_gate_events), 0, 'but not their history');
select pg_temp.impersonate(:'BILLER');
select ok((select count(*) from change_gates) > 0, 'a Biller reads the gates');
select pg_temp.impersonate(:'COUNTER_KAL');
select ok((select count(*) from change_gates) > 0, 'a counter tablet reads the gates');
select ok((select count(*) from change_gate_dependencies) > 0, 'and their dependencies');
select pg_temp.impersonate(:'OWNER');
select ok((select count(*) from change_gate_events) > 0, 'the owner reads the history');
select pg_temp.unimpersonate();

set local role anon;
select throws_ok($$select count(*) from change_gates$$, '42501', null,
  'anon cannot read the gates at all');
reset role;

-- ── Direct writes ─────────────────────────────────────────────────────────

select pg_temp.impersonate(:'OWNER');
select throws_ok($$update change_gates set enabled = true where key = 'tablet-health'$$, '42501', null,
  'not even the owner turns a gate directly');
select throws_ok($$insert into change_gates (key, code, kind, title, on_means, off_means, change_name)
  values ('cg-z', 'QZ', 'change', 'Z', 'x', 'y', 'test')$$, '42501', null,
  'no client declares a gate');
select throws_ok($$insert into change_gate_events (gate_key, enabled, source) values ('probe', false, 'app')$$,
  '42501', null, 'no client writes history');
select throws_ok($$insert into change_gate_dependencies values ('cg-x', 'cg-a')$$, '42501', null,
  'no client writes a dependency');
select throws_ok($$delete from device_health$$, '42501', null, 'no client deletes health');
select pg_temp.unimpersonate();

select throws_ok($$update change_gate_events set reason = 'rewritten'$$, '42501',
  'change gate events are append-only', 'history is append-only, even for the database owner');
select throws_ok($$delete from change_gate_events$$, '42501',
  'change gate events are append-only', 'and cannot be deleted');

-- ── Tablet health ─────────────────────────────────────────────────────────

select pg_temp.impersonate(:'OWNER');
select throws_ok($$select report_device_health('abc1234', '{}', 60, 1, 0, 10)$$, '42501',
  'Only a tablet reports its health.', 'a person cannot report tablet health');
select pg_temp.impersonate(:'COUNTER_KAL');
select lives_ok($$select report_device_health('abc1234', array['probe'], 60, 38, 0, 420)$$,
  'a counter tablet reports its health');
select lives_ok($$select report_device_health('abc1234', array['probe'], 60, 40, 1, 500)$$,
  'and reports again over the same row');
select throws_ok($$insert into device_health (device_id, outlet_id, build, window_seconds, requests, failed, slowest_ms)
  values ('10000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000002', 'x', 60, 1, 0, 1)$$,
  '42501', null, 'a tablet cannot write another tablet''s row');
select pg_temp.impersonate(:'COUNTER_KPA');
select lives_ok($$select report_device_health('abc1234', '{}', 60, 12, 0, 290)$$,
  'the other outlet''s tablet reports too');
select pg_temp.unimpersonate();

select results_eq(
  $$select device_id, outlet_id, requests, failed from device_health order by device_id$$,
  $$values ('10000000-0000-4000-a000-000000000004'::uuid, '00000000-0000-4000-a000-000000000001'::uuid, 40, 1),
           ('10000000-0000-4000-a000-000000000005'::uuid, '00000000-0000-4000-a000-000000000002'::uuid, 12, 0)$$,
  'each report lands on its own tablet''s row, at the tablet''s own outlet');

select pg_temp.impersonate(:'OWNER');
select is((select count(*)::int from device_health), 2, 'the owner reads every tablet''s health');
select pg_temp.impersonate(:'FA_KAL');
select results_eq($$select outlet_id from device_health$$,
  $$values ('00000000-0000-4000-a000-000000000001'::uuid)$$,
  'a Franchise Admin reads only their own outlet''s tablets');
select pg_temp.impersonate(:'FA_KPA');
select results_eq($$select outlet_id from device_health$$,
  $$values ('00000000-0000-4000-a000-000000000002'::uuid)$$,
  'and the other outlet''s manager only theirs');
select is((select count(*)::int from device_health where outlet_id = :'KAL'), 0,
  'a hand-crafted select of the other outlet''s health returns nothing');
select pg_temp.impersonate(:'BILLER');
select is((select count(*)::int from device_health), 0, 'a Biller reads no tablet health');
select pg_temp.impersonate(:'COUNTER_KAL');
select is((select count(*)::int from device_health), 0, 'a tablet reads no tablet health');
select pg_temp.unimpersonate();

select * from finish();
rollback;
