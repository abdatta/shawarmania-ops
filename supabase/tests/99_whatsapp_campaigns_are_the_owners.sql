-- a-campaign-goes-out-on-whatsapp (#85): who reaches campaigns, and who is
-- refused.
--
-- Five business-wide tables and the functions over them. They hold the whole
-- customer list's reach: who may be messaged, who said stop, and the one
-- function that hands a full phone number to a program on a laptop. So the
-- questions are the ones `customers` is held to, asked of every table and every
-- function by name:
--
--   * no client role holds a privilege or a policy on any table;
--   * every function a client may call checks the owner in its own body, and
--     the list of those functions is written out here, so one added later
--     without a refusal proved for it fails by name;
--   * a Franchise Admin, a Biller, an Employee and a counter device are each
--     refused every table and every function, and an anonymous caller cannot
--     call any of them at all;
--   * a recipient row carries no phone and no name, and no function but the
--     claim and the laptop's history (decision 17, the owner's choice) returns
--     more of a number than its last four digits.
--
-- How a campaign behaves is `99_a_campaign_goes_out_on_whatsapp.sql`.

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

create function pg_temp.as_server()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set KAL '00000000-0000-4000-a000-000000000001'

-- The six tables, once, for every catalog question below.
create temporary table campaign_tables (tbl text primary key);
insert into campaign_tables values
  ('marketing_campaigns'), ('marketing_campaign_batches'),
  ('marketing_campaign_recipients'), ('marketing_stopped'), ('marketing_sender'),
  ('marketing_campaign_tests');
grant select on campaign_tables to authenticated, anon;

-- Every function a signed-in client may call, with a call that would work for
-- an owner. Arguments are well formed on purpose: a refusal has to be the
-- owner check speaking, not a complaint about the request.
create temporary table campaign_calls (fn text primary key, call text not null);
insert into campaign_calls values
  ('campaign_sender_tick',
   $$select public.campaign_sender_tick('idle', null, 'laptop-probe')$$),
  ('campaign_claim_next',
   $$select public.campaign_claim_next('c0000000-0000-4000-a000-000000000001', 1)$$),
  ('campaign_report_result',
   $$select public.campaign_report_result('c0000000-0000-4000-a000-000000000001',
       '80000000-0000-4000-a000-000000000001', 'sent', 'PROBE', null)$$),
  ('campaign_release_stale_claims', $$select public.campaign_release_stale_claims()$$),
  ('campaign_report_receipts', $$select public.campaign_report_receipts('[]'::jsonb)$$),
  ('campaign_outstanding_message_ids', $$select public.campaign_outstanding_message_ids()$$),
  ('pause_campaign',
   $$select public.pause_campaign('c0000000-0000-4000-a000-000000000001')$$),
  ('resume_campaign',
   $$select public.resume_campaign('c0000000-0000-4000-a000-000000000001')$$),
  ('stop_campaign',
   $$select public.stop_campaign('c0000000-0000-4000-a000-000000000001')$$),
  ('campaigns_overview', $$select public.campaigns_overview()$$),
  ('campaign_reading',
   $$select public.campaign_reading('c0000000-0000-4000-a000-000000000001')$$),
  ('save_campaign_draft',
   $$select public.save_campaign_draft('c0000000-0000-4000-a000-000000000001', 'Probe', 'Hello', null)$$),
  ('set_campaign_image',
   $$select public.set_campaign_image('c0000000-0000-4000-a000-000000000001', null)$$),
  ('campaign_audience_count',
   $$select public.campaign_audience_count(
       '{"outletId": "00000000-0000-4000-a000-000000000001"}'::jsonb)$$),
  ('campaign_audience_list',
   $$select * from public.campaign_audience_list(
       '{"outletId": "00000000-0000-4000-a000-000000000001"}'::jsonb)$$),
  ('schedule_campaign',
   $$select public.schedule_campaign('c0000000-0000-4000-a000-000000000001')$$),
  ('release_campaign_batch',
   $$select public.release_campaign_batch('c0000000-0000-4000-a000-000000000001', 1)$$),
  ('marketing_stopped_list', $$select * from public.marketing_stopped_list()$$),
  ('marketing_stopped_add', $$select * from public.marketing_stopped_add('9000000001')$$),
  ('marketing_stopped_remove',
   $$select public.marketing_stopped_remove('80000000-0000-4000-a000-000000000001')$$),
  ('campaign_record_stop', $$select public.campaign_record_stop('919000000001')$$),
  ('update_marketing_sender_settings',
   $$select public.update_marketing_sender_settings(100, '10:00', '21:00', 45, 90)$$),
  ('set_campaign_test_numbers',
   $$select public.set_campaign_test_numbers('c0000000-0000-4000-a000-000000000001',
       array['9000000001'])$$),
  ('send_campaign_test',
   $$select public.send_campaign_test('c0000000-0000-4000-a000-000000000001')$$),
  ('campaign_test_number_suggestions',
   $$select public.campaign_test_number_suggestions()$$),
  ('campaign_claim_next_test', $$select public.campaign_claim_next_test()$$),
  ('campaign_finish_notices', $$select public.campaign_finish_notices()$$),
  ('campaign_mark_finish_notice',
   $$select public.campaign_mark_finish_notice('c0000000-0000-4000-a000-000000000001')$$),
  ('campaign_report_test_result',
   $$select public.campaign_report_test_result('80000000-0000-4000-a000-000000000001',
       'sent', 'PROBE', null)$$),
  ('campaign_sender_history', $$select public.campaign_sender_history()$$);
grant select on campaign_calls to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1. The tables: business-wide, and closed to every client role.

select has_table('public', tbl, tbl || ' exists') from campaign_tables order by tbl;

select is(
  coalesce((select string_agg(t.tbl, ', ' order by t.tbl)
              from campaign_tables t
              join pg_class c on c.oid = ('public.' || t.tbl)::regclass
             where not c.relrowsecurity), ''),
  '',
  'every campaign table has row-level security switched on');

select is(
  (select count(*)::int from pg_policies p
    where p.schemaname = 'public' and p.tablename in (select tbl from campaign_tables)),
  0,
  'and none carries a policy: reads and writes go through the functions or nowhere');

select is(
  (select count(*)::int
     from campaign_tables t,
          unnest(array['anon', 'authenticated']) as r (role),
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as v (verb)
    where has_table_privilege(r.role, 'public.' || t.tbl, v.verb)),
  0,
  'no client role holds any verb on any campaign table');

-- A recipient row points at the customer. The number is read at the moment of
-- sending, so a corrected number or a stop is honoured without anybody
-- re-cutting the audience (design D5).
select is(
  (select array_agg(a.attname::text order by a.attnum)
     from pg_attribute a
    where a.attrelid = 'public.marketing_campaign_recipients'::regclass
      and a.attnum > 0 and not a.attisdropped),
  array['campaign_id', 'customer_id', 'batch_no', 'position', 'state', 'claimed_at',
        'sent_at', 'delivered_at', 'read_at', 'wa_message_id', 'failure_code'],
  'a recipient row holds no phone and no name');

-- Customers' numbers are stored on no campaign table. The two columns below
-- hold the owners' own test numbers, which they type themselves [owner,
-- 2026-11-18]; a phone column anywhere else fails here by name.
select is(
  coalesce((select string_agg(t.tbl || '.' || a.attname, ', ' order by t.tbl, a.attname)
              from campaign_tables t
              join pg_attribute a on a.attrelid = ('public.' || t.tbl)::regclass
             where a.attnum > 0 and not a.attisdropped
               and (a.attname ~ 'phone|mobile|msisdn' or a.attname = 'number')), ''),
  'marketing_campaign_tests.phone, marketing_campaigns.test_phones',
  'no campaign table has a column for a phone number but the owners'' own test numbers');

-- The sender's record: what it last said about itself and the owner's settings.
-- Nothing about linking, which never passes through the database (design D9).
select is(
  (select array_agg(a.attname::text order by a.attname::text)
     from pg_attribute a
    where a.attrelid = 'public.marketing_sender'::regclass
      and a.attnum > 0 and not a.attisdropped),
  array['batch_size', 'halt_reason', 'id', 'installation_id', 'last_seen_at',
        'linked_number_last4', 'max_gap_seconds', 'min_gap_seconds', 'status',
        'window_end', 'window_start'],
  'the sender row carries its last report and the settings, and no pairing code');

select is((select count(*)::int from public.marketing_sender), 1, 'there is exactly one sender row');
select throws_ok(
  $$insert into public.marketing_sender (id) values (false)$$,
  '23514', null,
  'and a second one cannot be made');

select is(
  (select row(batch_size, window_start, window_end, min_gap_seconds, max_gap_seconds)::text
     from public.marketing_sender),
  row(100, time '10:00', time '21:00', 45, 90)::text,
  'the settings start at 100 a batch, 10:00 to 21:00 in India, 45 to 90 seconds apart');

-- ---------------------------------------------------------------------------
-- 2. The functions: a written list, and each one checks the owner itself.

-- Everything this change added to `public` that a signed-in client may call.
-- A function added later and granted without joining `campaign_calls` above
-- fails here by name.
select is(
  (select coalesce(string_agg(p.proname::text, ', ' order by p.proname::text), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname ~ 'campaign|marketing'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  (select string_agg(fn, ', ' order by fn) from campaign_calls),
  'the functions a client may call are exactly the ones this file proves refusals for');

select is(
  coalesce((select string_agg(p.proname::text, ', ' order by p.proname::text)
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in (select fn from campaign_calls)
               and (not p.prosecdef
                    or p.prosrc !~ 'app_is_owner\(\)'
                    or p.prosrc !~ 'app_account_active\(\)'
                    or not coalesce(p.proconfig, '{}') @> array['search_path=""'])), ''),
  '',
  'each is security definer with an empty search path, and checks the owner and the account in its own body');

select is(
  coalesce((select string_agg(p.proname::text, ', ' order by p.proname::text)
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname ~ 'campaign|marketing'
               and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('public', p.oid, 'EXECUTE'))), ''),
  '',
  'an anonymous caller may execute none of them, internal pieces included');

-- The internal pieces take arguments that would let a caller skip the owner
-- check (an audience with no authority, a window at any instant), so no client
-- may call them directly.
select ok(
  not has_function_privilege('authenticated', f, 'EXECUTE'),
  format('%s is not a client surface', f))
  from unnest(array[
    'public.marketing_audience(jsonb,boolean,text)',
    'public.marketing_audience_whole(jsonb,bigint)',
    'public.marketing_window_at(timestamptz,time,time)',
    'public.marketing_settle_finished()',
    'public.marketing_next_waiting_batch()',
    'public.marketing_sender_reading()',
    'public.marketing_campaign_summary(uuid)',
    'public.marketing_campaign_counts(uuid,integer)',
    'public.marketing_stopped_rows(uuid)',
    'public.marketing_test_phone(text)',
    'public.marketing_queue_tests(uuid,text[],text,text)'
  ]) f;

-- ---------------------------------------------------------------------------
-- 3. Only the claim returns a phone number, and the reads return four digits.

select is(
  coalesce((select string_agg(p.proname || '.' || returned.name, ', '
                              order by p.proname, returned.name)
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace,
                   unnest(p.proargnames, p.proargmodes) as returned (name, mode)
             where n.nspname = 'public'
               and p.proname in (select fn from campaign_calls)
               and returned.mode = 't'
               and returned.name ~ 'phone'
               and returned.name <> 'phone_last4'), ''),
  '',
  'no read returns a phone column but the last four digits');

select bag_eq(
  $$select returned.name::text
      from pg_proc p, unnest(p.proargnames, p.proargmodes) as returned (name, mode)
     where p.proname = 'campaign_audience_list' and returned.mode = 't'$$,
  $$values ('customer_id'), ('name'), ('phone_last4')$$,
  'the look-through returns who, a name and four digits, and nothing else');

select bag_eq(
  $$select returned.name::text
      from pg_proc p, unnest(p.proargnames, p.proargmodes) as returned (name, mode)
     where p.proname = 'marketing_stopped_list' and returned.mode = 't'$$,
  $$values ('customer_id'), ('name'), ('phone_last4'), ('stopped_at'), ('source'),
           ('campaign_name'), ('recorded_by_name')$$,
  'the stopped list returns who, four digits, when and how, and nothing else');

-- ---------------------------------------------------------------------------
-- 4. The owner is answered.

select pg_temp.impersonate(:'OWNER'::uuid);

select lives_ok(call, format('the owner may call %s', fn))
  from campaign_calls
 where fn in ('campaigns_overview', 'campaign_audience_count', 'campaign_audience_list',
              'marketing_stopped_list', 'campaign_outstanding_message_ids',
              'campaign_release_stale_claims', 'campaign_report_receipts',
              'campaign_sender_tick', 'save_campaign_draft', 'campaign_reading',
              'update_marketing_sender_settings', 'campaign_record_stop',
              'campaign_sender_history')
 order by fn;

select is(
  (select jsonb_array_length(public.campaigns_overview() -> 'campaigns')),
  1,
  'and reads back the draft just saved');

-- The owner's own session still cannot touch a table: the functions are the
-- only way in, for everybody.
select throws_ok(
  format('select * from public.%I', tbl),
  '42501', null,
  format('even the owner cannot select %s directly', tbl))
  from campaign_tables order by tbl;

select pg_temp.as_server();

-- ---------------------------------------------------------------------------
-- 5. Everybody else is refused: every table, every function, at their own
--    outlet too. A hand-made request from each of the four.

select pg_temp.impersonate(:'FA_KAL'::uuid);
select throws_ok(format('select * from public.%I', tbl), '42501', null,
  format('a franchise admin is refused %s', tbl))
  from campaign_tables order by tbl;
select throws_ok(format('insert into public.%I default values', tbl), '42501', null,
  format('a franchise admin cannot write %s', tbl))
  from campaign_tables order by tbl;
select throws_ok(call, '42501', null, format('a franchise admin is refused %s', fn))
  from campaign_calls order by fn;
select pg_temp.as_server();

select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select throws_ok(format('select * from public.%I', tbl), '42501', null,
  format('a biller is refused %s', tbl))
  from campaign_tables order by tbl;
select throws_ok(call, '42501', null, format('a biller is refused %s', fn))
  from campaign_calls order by fn;
select pg_temp.as_server();

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);
select throws_ok(format('select * from public.%I', tbl), '42501', null,
  format('an employee is refused %s', tbl))
  from campaign_tables order by tbl;
select throws_ok(call, '42501', null, format('an employee is refused %s', fn))
  from campaign_calls order by fn;
select pg_temp.as_server();

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select throws_ok(format('select * from public.%I', tbl), '42501', null,
  format('a counter tablet is refused %s', tbl))
  from campaign_tables order by tbl;
select throws_ok(call, '42501', null, format('a counter tablet is refused %s', fn))
  from campaign_calls order by fn;
select pg_temp.as_server();

-- An anonymous caller holds no execute at all (section 2), so there is no body
-- to reach. Asked once more as the role itself, on a table and on a function.
set local role anon;
select throws_ok(format('select * from public.%I', tbl), '42501', null,
  format('an anonymous caller is refused %s', tbl))
  from campaign_tables order by tbl;
select throws_ok(call, '42501', null, format('an anonymous caller is refused %s', fn))
  from campaign_calls order by fn;
reset role;

-- Nobody but the owner left a mark: the one draft is the owner's own.
select is(
  (select count(*)::int from public.marketing_campaigns),
  1,
  'none of the refused calls made a campaign');
select is(
  (select count(*)::int from public.marketing_stopped),
  0,
  'and none of them put anybody on the stopped list');

-- ---------------------------------------------------------------------------
-- 6. The pictures: a private bucket only an owner reaches.

select is(
  (select row(public, file_size_limit, allowed_mime_types)::text
     from storage.buckets where id = 'campaign-images'),
  row(false, 1048576::bigint, array['image/jpeg', 'image/png'])::text,
  'the campaign-images bucket is private, capped at 1 MB, and takes JPEG and PNG only');

select is(
  (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ', '
                     order by policyname)
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%campaign-images%'),
  'campaign_images_readable:SELECT:authenticated, campaign_images_writable:INSERT:authenticated',
  'two policies name the bucket: a read and an upload, for signed-in callers only');

select pg_temp.impersonate(:'OWNER'::uuid);
select lives_ok(
  format($$insert into storage.objects (bucket_id, name, owner)
           values ('campaign-images', 'c0000000-0000-4000-a000-000000000001/offer.jpg', %L)$$,
    :'OWNER'),
  'an owner uploads a campaign picture');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'campaign-images'),
  1,
  'and reads it back');
select pg_temp.as_server();

select pg_temp.impersonate(:'FA_KAL'::uuid);
select throws_ok(
  format($$insert into storage.objects (bucket_id, name, owner)
           values ('campaign-images', 'c0000000-0000-4000-a000-000000000001/theirs.jpg', %L)$$,
    :'FA_KAL'),
  '42501', null,
  'a franchise admin cannot upload one');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'campaign-images'),
  0,
  'and cannot see the owner''s');
select pg_temp.as_server();

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'campaign-images'),
  0,
  'a counter tablet cannot see it either');
select pg_temp.as_server();

select * from finish();
rollback;
