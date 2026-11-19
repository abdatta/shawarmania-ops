-- a-campaign-goes-out-on-whatsapp (#85): test numbers on a campaign.
--
-- An owner types up to five numbers onto a campaign, their own or a friend's,
-- not customers. Send test, and submitting, queue the message as it stands to
-- each of them, and the sender sends those by itself: no release, outside the
-- sending window, ahead of any customer, one at a time with everything else.
-- Numbers used before are offered again [owner, 2026-11-18].
--
-- Who is refused all of it is `99_whatsapp_campaigns_are_the_owners.sql`.
--
-- Every number here is from the synthetic 90000 range or the 555 range kept
-- for fiction (docs/TESTING.md).

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Helpers, as `99_a_campaign_goes_out_on_whatsapp.sql` has them.

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

create function pg_temp.owner() returns uuid language sql immutable as
$$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create function pg_temp.kal() returns uuid language sql immutable as
$$ select '00000000-0000-4000-a000-000000000001'::uuid $$;
create function pg_temp.k(n integer) returns uuid language sql immutable as
$$ select ('ca850000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid $$;

create function pg_temp.o(p_sql text)
returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.impersonate(pg_temp.owner());
  execute 'select to_jsonb((' || p_sql || '))' into v;
  perform pg_temp.as_server();
  return v;
end;
$$;

create function pg_temp.run(p_sql text)
returns void language plpgsql as $$
begin
  perform pg_temp.impersonate(pg_temp.owner());
  execute p_sql;
  perform pg_temp.as_server();
end;
$$;

create function pg_temp.refused(p_sql text, p_errcode text, p_message text, p_description text)
returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.impersonate(pg_temp.owner());
  v := throws_ok(p_sql, p_errcode::char(5), p_message, p_description);
  perform pg_temp.as_server();
  return v;
end;
$$;

-- A draft, saved as the owner.
create function pg_temp.draft(p_id uuid, p_name text, p_body text)
returns void language sql as $$
  select pg_temp.run(format(
    $q$select public.save_campaign_draft(%L, %L, %L, null)$q$, p_id, p_name, p_body))
$$;

create function pg_temp.set_tests(p_id uuid, p_phones text[])
returns jsonb language sql as $$
  select pg_temp.o(format(
    $q$select public.set_campaign_test_numbers(%L, %L::text[])$q$, p_id, p_phones))
$$;

create function pg_temp.claim_test()
returns jsonb language sql as $$
  select pg_temp.o($q$select public.campaign_claim_next_test()$q$)
$$;

create function pg_temp.tests(p_id uuid)
returns text language sql as $$
  select string_agg(t.phone || ':' || t.state, ', ' order by t.seq)
    from public.marketing_campaign_tests t where t.campaign_id = p_id
$$;

create function pg_temp.tick()
returns jsonb language sql as $$
  select pg_temp.o($q$select public.campaign_sender_tick('idle', null, 'laptop-a')$q$)
$$;

-- The sending window shut now, on India's clock: opening in two hours and
-- closing an hour after that.
create function pg_temp.shut_window()
returns void language sql as $$
  update public.marketing_sender
     set window_start = ((now() at time zone 'Asia/Kolkata') + interval '2 hours')::time,
         window_end = ((now() at time zone 'Asia/Kolkata') + interval '3 hours')::time
$$;

-- Nobody already in the seed is sent anything here.
insert into public.marketing_stopped (customer_id, source)
select id, 'owner' from public.customers;

insert into public.customers (id, phone, name, created_at, last_used_at) values
  ('c8500000-0000-4000-a000-000000000001', '+919000008501', 'Asha', now(), now());
insert into public.bills
  (id, outlet_id, business_date, biller_profile_id, counter_device_id, customer_id,
   subtotal_paise, discount_paise, total_paise, payment_method, status, created_at)
values
  (gen_random_uuid(), pg_temp.kal(),
   public.app_business_date(now(), (select business_day_cutover from public.outlets
                                     where id = pg_temp.kal())) - 1,
   '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
   'c8500000-0000-4000-a000-000000000001', 20000, 0, 20000, 'cash', 'settled',
   now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- 1. A campaign's test numbers.

select pg_temp.draft(pg_temp.k(1), 'Diwali offer', 'Hi {name}, *20% off* this week.');

select is(
  pg_temp.set_tests(pg_temp.k(1),
    array['90000 08599', '+1 (213) 555-0100', '+919000008599', '0012135550101']),
  to_jsonb(array['+919000008599', '+12135550100', '+12135550101']),
  'an Indian mobile gains +91, a US number keeps its country code, and each is kept once');

-- The cases `src/lib/campaign-test-number.test.ts` holds the composer's rule
-- to: the database reads a number the same way.
select is(
  (select jsonb_agg(public.marketing_test_phone(t) order by n)
     from unnest(array['90000 00901', '+91 90000 00901', '919000000901', '0091 9000000901',
                       '+1 (202) 555-0142', '+44 20 7946 0958', '(+1) 202.555.0142'])
          with ordinality as x (t, n)),
  to_jsonb(array['+919000000901', '+919000000901', '+919000000901', '+919000000901',
                 '+12025550142', '+442079460958', '+12025550142']),
  'a number is read as the composer reads it');

select is(
  (select jsonb_agg(public.marketing_test_phone(t) order by n)
     from unnest(array['12025550142', '5000000901', '+0123456789', '+9112345678901',
                       '+1234567', '+1234567890123456', 'abc', ''])
          with ordinality as x (t, n)),
  to_jsonb(array[null, null, null, null, null, null, null, null]::text[]),
  'and what the composer would have to guess at is not a number');

select pg_temp.refused(
  format($$select public.set_campaign_test_numbers(%L, array['12345'])$$, pg_temp.k(1)),
  '22023', 'phone_incomplete',
  'a number that is not a full number is refused');

select pg_temp.refused(
  format($$select public.set_campaign_test_numbers(%L, array['9000008591', '9000008592',
           '9000008593', '9000008594', '9000008595', '9000008596'])$$, pg_temp.k(1)),
  '22023', 'too_many_test_numbers',
  'six test numbers are one too many');

select is(
  pg_temp.set_tests(pg_temp.k(1), array[]::text[]),
  '[]'::jsonb,
  'an empty list takes them all off');

select pg_temp.refused(
  format($$select public.send_campaign_test(%L)$$, pg_temp.k(1)),
  '22023', 'no_test_numbers',
  'Send test with no test numbers is refused');

select pg_temp.set_tests(pg_temp.k(1), array['9000008599', '+12135550100']);

select pg_temp.draft(pg_temp.k(2), 'Empty', '   ');
select pg_temp.set_tests(pg_temp.k(2), array['9000008599']);
select pg_temp.refused(
  format($$select public.send_campaign_test(%L)$$, pg_temp.k(2)),
  '22023', 'body_required',
  'Send test with no message is refused');

-- ---------------------------------------------------------------------------
-- 2. Send test: no release, outside the window, before any customer.

select pg_temp.shut_window();

select is(
  pg_temp.o(format($$select public.send_campaign_test(%L)$$, pg_temp.k(1))),
  '2'::jsonb,
  'Send test queues one message for each test number');

select is(
  pg_temp.tests(pg_temp.k(1)),
  '+919000008599:waiting, +12135550100:waiting',
  'both wait for the sender, in the order the numbers were typed');

select pg_temp.refused(
  format($$select public.send_campaign_test(%L)$$, pg_temp.k(1)),
  '55000', 'test_already_waiting',
  'a second press while the first is on its way queues nothing more');

-- The draft changes after the press; the test already queued does not.
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Diwali offer', 'Changed afterwards', null)$$,
  pg_temp.k(1)));

select is((pg_temp.tick() ->> 'tests_waiting')::int, 2,
  'the tick tells the sender two tests are waiting');
select is(pg_temp.tick() -> 'window' ->> 'open', 'false',
  'while the sending window is shut');

select is(
  pg_temp.claim_test() - 'recipient',
  '{"kind": "claimed"}'::jsonb,
  'the sender is handed a test with the window shut and no batch released');

select is(
  (select row(t.state, t.claimed_at is not null)::text
     from public.marketing_campaign_tests t
    where t.campaign_id = pg_temp.k(1) and t.phone = '+919000008599'),
  row('sending', true)::text,
  'and it is marked as in hand');

select is(
  pg_temp.claim_test(),
  '{"kind": "refused", "why": "claim_in_flight"}'::jsonb,
  'one in hand at a time: the next test waits');

select is(
  (select pg_temp.o(format($$select public.campaign_report_test_result(%L, 'sent', 'WAMID-T1')$$,
     t.id))
     from public.marketing_campaign_tests t
    where t.campaign_id = pg_temp.k(1) and t.phone = '+919000008599'),
  'true'::jsonb,
  'the sender reports it sent');

select is(
  (select pg_temp.o(format($$select public.campaign_report_test_result(%L, 'sent', 'WAMID-T1')$$,
     t.id))
     from public.marketing_campaign_tests t
    where t.campaign_id = pg_temp.k(1) and t.phone = '+919000008599'),
  'true'::jsonb,
  'the same report again is accepted');

select is(
  (select pg_temp.o(format($$select public.campaign_report_test_result(%L, 'sent', 'OTHER')$$,
     t.id))
     from public.marketing_campaign_tests t
    where t.campaign_id = pg_temp.k(1) and t.phone = '+919000008599'),
  'false'::jsonb,
  'a different report for a settled test is refused');

select is(
  (pg_temp.claim_test() -> 'recipient') - 'test_id',
  jsonb_build_object(
    'campaign_id', pg_temp.k(1),
    'phone', '12135550100',
    'body', 'Hi {name}, *20% off* this week.',
    'image_path', null),
  'the next is handed over with its full number and the message as it stood when queued');

-- ---------------------------------------------------------------------------
-- 3. Resume covers tests.

select is(pg_temp.o('select public.campaign_release_stale_claims()'), '1'::jsonb,
  'a test left in hand is counted among the stale claims');
select is(
  pg_temp.tests(pg_temp.k(1)),
  '+919000008599:sent, +12135550100:unsure',
  'and becomes unsure, never handed over again');
select is(pg_temp.claim_test(), '{"kind": "nothing"}'::jsonb,
  'nothing is left to send');
select is((pg_temp.tick() ->> 'tests_waiting')::int, 0,
  'and the tick says so');

-- ---------------------------------------------------------------------------
-- 4. Submitting sends the tests by itself, and they are nobody's figures.

update public.marketing_sender set window_start = '00:00', window_end = '23:59';

select pg_temp.draft(pg_temp.k(3), 'Weekend combo', 'Hello {name}');
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Weekend combo', 'Hello {name}', %L)$$,
  pg_temp.k(3),
  jsonb_build_object(
    'outletId', pg_temp.kal(), 'sort', 'most_orders',
    'picked', jsonb_build_object('kind', 'all', 'except', jsonb_build_array()))));
select pg_temp.set_tests(pg_temp.k(3), array['9000008598']);
-- A Send test first, not yet sent; then a second number, then Submit.
select pg_temp.o(format($$select public.send_campaign_test(%L)$$, pg_temp.k(3)));
select pg_temp.set_tests(pg_temp.k(3), array['9000008598', '9000008596']);
select pg_temp.run(format($$select public.schedule_campaign(%L)$$, pg_temp.k(3)));

select is(
  pg_temp.tests(pg_temp.k(3)),
  '+919000008598:waiting, +919000008596:waiting',
  'submitting queues the message to each test number not already waiting for one');

select is(
  (select row(state, recipients)::text
     from (select c.state,
                  (select count(*) from public.marketing_campaign_recipients r
                    where r.campaign_id = c.id) as recipients
             from public.marketing_campaigns c where c.id = pg_temp.k(3)) x),
  row('scheduled', 1)::text,
  'and the campaign''s recipients are its customers alone');

select pg_temp.run(format($$select public.release_campaign_batch(%L, 1)$$, pg_temp.k(3)));
select is(
  pg_temp.o(format($$select public.campaign_claim_next(%L, 1)$$, pg_temp.k(3))) ->> 'kind',
  'claimed',
  'a customer is handed over once the batch is released');
select is(
  pg_temp.claim_test(),
  '{"kind": "refused", "why": "claim_in_flight"}'::jsonb,
  'and while a customer is in hand, no test is handed over');
select is(
  pg_temp.o(format($$select public.campaign_report_result(%L, %L, 'sent', 'WAMID-C1')$$,
    pg_temp.k(3), 'c8500000-0000-4000-a000-000000000001')),
  'true'::jsonb,
  'the customer is reported sent');

-- The other way round: a test in hand holds the customers back.
select pg_temp.claim_test();
select pg_temp.run(format($$select public.save_campaign_draft(%L, 'Third', 'Hi', %L)$$,
  pg_temp.k(4),
  jsonb_build_object(
    'outletId', pg_temp.kal(), 'sort', 'most_orders',
    'picked', jsonb_build_object('kind', 'all', 'except', jsonb_build_array()))));
select is(
  (pg_temp.tick() ->> 'sent_today')::int,
  1,
  'tests are not in the day''s count either');

select is(
  (select jsonb_array_length(pg_temp.o(format($$select public.campaign_reading(%L)$$,
     pg_temp.k(3))) -> 'campaign' -> 'tests')),
  2,
  'the campaign''s page lists its test sends');
select is(
  pg_temp.o(format($$select public.campaign_reading(%L)$$, pg_temp.k(3)))
    -> 'campaign' -> 'test_phones',
  to_jsonb(array['+919000008598', '+919000008596']),
  'and its test numbers');
select is(
  (pg_temp.o(format($$select public.campaign_reading(%L)$$, pg_temp.k(3)))
    -> 'campaign' -> 'counts' ->> 'sent')::int,
  1,
  'its sent count is the one customer, not the test');

-- ---------------------------------------------------------------------------
-- 5. A stopped campaign's tests are not sent.

select pg_temp.o('select public.campaign_release_stale_claims()');
-- The weekend combo's second test goes out, so nothing else is waiting.
select pg_temp.o(format($$select public.campaign_report_test_result(%L, 'sent', 'WAMID-T2')$$,
  pg_temp.claim_test() -> 'recipient' ->> 'test_id'));
select pg_temp.run(format($$select public.save_campaign_draft(%L, 'Stopped soon', 'Hi', %L)$$,
  pg_temp.k(5),
  jsonb_build_object(
    'outletId', pg_temp.kal(), 'sort', 'most_orders',
    'picked', jsonb_build_object('kind', 'all', 'except', jsonb_build_array()))));
select pg_temp.set_tests(pg_temp.k(5), array['9000008597']);
-- Submitting queues the test; stopping the campaign before the laptop is on
-- means it is never sent.
select pg_temp.run(format($$select public.schedule_campaign(%L)$$, pg_temp.k(5)));
select pg_temp.run(format($$select public.stop_campaign(%L)$$, pg_temp.k(5)));
select is((pg_temp.tick() ->> 'tests_waiting')::int, 0,
  'a stopped campaign''s tests are not counted as waiting');
select is(pg_temp.claim_test(), '{"kind": "nothing"}'::jsonb,
  'and are not handed over');
select is(pg_temp.tests(pg_temp.k(5)), '+919000008597:stopped',
  'they read stopped');
select pg_temp.refused(
  format($$select public.set_campaign_test_numbers(%L, array['9000008599'])$$, pg_temp.k(5)),
  '55000', 'campaign_finished',
  'and its test numbers can no longer be changed');

-- ---------------------------------------------------------------------------
-- 5b. A finished campaign: its totals for the owner who submitted it.

update public.profiles set phone = '919000008590' where id = pg_temp.owner();

select is(
  (select jsonb_agg(n -> 'name') from jsonb_array_elements(
     pg_temp.o('select public.campaign_finish_notices()')) n),
  '["Weekend combo"]'::jsonb,
  'the finished campaign is offered for its notice, and the stopped one is not');
select is(
  (select n -> 'phone' from jsonb_array_elements(
     pg_temp.o('select public.campaign_finish_notices()')) n),
  '"919000008590"'::jsonb,
  'with the number of the owner who submitted it, as digits');
select is(
  (select (n -> 'counts' ->> 'sent')::int from jsonb_array_elements(
     pg_temp.o('select public.campaign_finish_notices()')) n),
  1,
  'and its totals, which are its customers alone');
select is(
  pg_temp.o(format($$select public.campaign_mark_finish_notice(%L)$$, pg_temp.k(3))),
  'true'::jsonb,
  'the sender says it told them');
select is(
  pg_temp.o(format($$select public.campaign_mark_finish_notice(%L)$$, pg_temp.k(3))),
  'false'::jsonb,
  'and a second time records nothing');
select is(pg_temp.o('select public.campaign_finish_notices()'), '[]'::jsonb,
  'and it is not offered again');

update public.marketing_campaigns
   set finish_notice_sent_at = null, finished_at = now() - interval '8 days'
 where id = pg_temp.k(3);
select is(pg_temp.o('select public.campaign_finish_notices()'), '[]'::jsonb,
  'a campaign finished more than a week ago is old news, and is not sent');

update public.marketing_campaigns set finished_at = now() where id = pg_temp.k(3);
update public.profiles set phone = null where id = pg_temp.owner();
select is(pg_temp.o('select public.campaign_finish_notices()'), '[]'::jsonb,
  'an owner with no number on their account is sent nothing');

-- ---------------------------------------------------------------------------
-- 6. Numbers used before are offered again, most recently used first.

update public.marketing_campaigns set created_at = now() - interval '4 days'
 where id = pg_temp.k(2);
update public.marketing_campaigns set created_at = now() - interval '3 days'
 where id = pg_temp.k(1);
update public.marketing_campaigns set created_at = now() - interval '2 days'
 where id = pg_temp.k(3);
update public.marketing_campaigns set created_at = now() - interval '1 day'
 where id = pg_temp.k(5);

select is(
  pg_temp.o('select public.campaign_test_number_suggestions()'),
  to_jsonb(array['+919000008597', '+919000008596', '+919000008598', '+12135550100',
                 '+919000008599']),
  'every number used before, each once, the most recently used first');

select * from finish();
rollback;
