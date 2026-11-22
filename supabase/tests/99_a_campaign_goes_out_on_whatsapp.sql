-- a-campaign-goes-out-on-whatsapp (#85): how a campaign behaves.
--
-- The app writes rows and never sends; a program on the owner's laptop asks the
-- database what to do, one recipient at a time. So the database is where the
-- promises are kept, and each one below fails in its own way:
--
--   * an audience is the outlet's own customers, counted on business dates and
--     settled bills, with nobody who said stop, and what is counted is what
--     submitting cuts into batches;
--   * a batch sends nothing until it is released, one batch at a time across
--     every campaign, and only inside the sending window as the database's
--     clock reads it;
--   * a recipient is handed over one at a time, with the number read at that
--     moment; a claim nobody settled becomes unsure and is never handed over
--     again;
--   * the sender's seven functions answer as `core/rehearsal-queue.ts` does,
--     which is what the sending loop's own tests run against.
--
-- Who is refused all of it is `99_whatsapp_campaigns_are_the_owners.sql`.
--
-- Every phone number here is from the synthetic 90000 range (docs/TESTING.md).

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Helpers.

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
create function pg_temp.kpa() returns uuid language sql immutable as
$$ select '00000000-0000-4000-a000-000000000002'::uuid $$;
-- A fixture customer, and a campaign.
create function pg_temp.c(n integer) returns uuid language sql immutable as
$$ select ('c8400000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n integer) returns uuid language sql immutable as
$$ select ('ca840000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid $$;

-- An audience at Kalyani, most orders first, everybody the filters match
-- picked (what Select all sets), with the filters given.
create function pg_temp.aud(p_filters jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
           'outletId', pg_temp.kal(), 'sort', 'most_orders',
           'picked', jsonb_build_object('kind', 'all', 'except', jsonb_build_array()))
         || p_filters
$$;

-- The same list with exactly these customers ticked, one by one.
create function pg_temp.only(variadic p_customers integer[])
returns jsonb language sql immutable as $$
  select jsonb_build_object('picked', jsonb_build_object(
    'kind', 'only',
    'ids', coalesce((select jsonb_agg(pg_temp.c(n)) from unnest(p_customers) n), '[]'::jsonb)))
$$;

-- One value, asked as the owner. The caller is the server again afterwards.
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

-- A call with nothing to return, made as the owner.
create function pg_temp.run(p_sql text)
returns void language plpgsql as $$
begin
  perform pg_temp.impersonate(pg_temp.owner());
  execute p_sql;
  perform pg_temp.as_server();
end;
$$;

-- A refusal the owner meets: the code and the word the page reads.
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

-- Nobody ticked: where choosing customers starts.
create function pg_temp.nobody()
returns jsonb language sql immutable as
$$ select '{"picked": {"kind": "only", "ids": []}}'::jsonb $$;

-- The names the list shows, in the order they would be sent to: everybody the
-- filters match, whoever is ticked, narrowed by a search when one is given.
create function pg_temp.names(
  p_audience jsonb, p_offset integer default 0, p_search text default null)
returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.impersonate(pg_temp.owner());
  select coalesce(string_agg(coalesce(l.name, '(no name)'), ', ' order by l.n), '')
    into v
    from public.campaign_audience_list(p_audience, p_offset, p_search)
         with ordinality as l (customer_id, name, phone_last4, n);
  perform pg_temp.as_server();
  return v;
end;
$$;

-- Who a campaign would go to, in order: the picked, as submitting cuts them.
create function pg_temp.goes_to(p_audience jsonb)
returns text language sql as $$
  select coalesce(string_agg(coalesce(a.name, '(no name)'), ', ' order by a.seq), '')
    from public.marketing_audience(p_audience, true, null) a
$$;

-- A campaign's recipients as the server sees them, in sending order.
create function pg_temp.states(p_campaign uuid)
returns text language sql as $$
  select string_agg(r.state::text, ', ' order by r.position)
    from public.marketing_campaign_recipients r
   where r.campaign_id = p_campaign
$$;

create function pg_temp.tick(p_installation text default 'laptop-a')
returns jsonb language sql as $$
  select pg_temp.o(format(
    $q$select public.campaign_sender_tick('idle', null, %L)$q$, p_installation))
$$;

create function pg_temp.claim(p_campaign uuid, p_batch integer)
returns jsonb language sql as $$
  select pg_temp.o(format(
    $q$select public.campaign_claim_next(%L, %s)$q$, p_campaign, p_batch))
$$;

-- The outlet's business date, read once while privileged: under an
-- impersonation the cutover is not readable and the date would come back null.
select set_config(
  'test.today',
  public.app_business_date(
    now(), (select business_day_cutover from public.outlets where id = pg_temp.kal()))::text,
  true);

-- A bill `p_days_ago` business dates back. "After midnight" rings it at 00:30
-- on the next calendar day, which the 04:00 cutover still counts as that date.
create function pg_temp.bill(
  p_outlet uuid, p_customer uuid, p_days_ago integer, p_total bigint,
  p_after_midnight boolean default false, p_void boolean default false)
returns void language plpgsql as $$
declare
  v_date date := current_setting('test.today')::date - p_days_ago;
  v_at timestamptz := case
    when p_after_midnight then ((v_date + 1) + time '00:30') at time zone 'Asia/Kolkata'
    else (v_date + time '12:00') at time zone 'Asia/Kolkata' end;
  v_kal boolean := p_outlet = pg_temp.kal();
begin
  insert into public.bills
    (id, outlet_id, business_date, biller_profile_id, counter_device_id, customer_id,
     subtotal_paise, discount_paise, total_paise, payment_method, status,
     voided_by, voided_at, void_reason, created_at)
  values
    (gen_random_uuid(), p_outlet, v_date,
     (case when v_kal then '10000000-0000-4000-a000-00000000000a'
           else '10000000-0000-4000-a000-00000000000b' end)::uuid,
     (case when v_kal then '10000000-0000-4000-a000-000000000004'
           else '10000000-0000-4000-a000-000000000005' end)::uuid,
     p_customer, p_total, 0, p_total, 'cash',
     (case when p_void then 'void' else 'settled' end)::public.bill_status,
     case when p_void then '10000000-0000-4000-a000-000000000002'::uuid end,
     case when p_void then v_at + interval '5 minutes' end,
     case when p_void then 'test' end,
     v_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
--
-- Whoever the seed already holds is put on the stopped list, so every count
-- below is over the eight customers made here and nobody else.

select set_config('test.seeded', (select count(*) from public.customers)::text, true);
insert into public.marketing_stopped (customer_id, source)
select id, 'owner' from public.customers;

insert into public.customers (id, phone, name, created_at, last_used_at) values
  (pg_temp.c(1), '+919000008401', 'Asha', now(), now()),
  (pg_temp.c(2), '+919000008402', 'Bela', now(), now()),
  (pg_temp.c(3), '+919000008403', 'Chitra', now(), now()),
  (pg_temp.c(4), '+919000008404', 'Dev', now(), now()),
  (pg_temp.c(5), '+919000008405', null, now(), now()),
  (pg_temp.c(6), '+919000008406', 'Gauri', now(), now()),
  (pg_temp.c(7), '+919000008407', 'Void Only', now(), now()),
  (pg_temp.c(8), '+919000008408', 'Esha', now(), now());

-- Asha: five orders, the last yesterday, ₹1,000 in all.
select pg_temp.bill(pg_temp.kal(), pg_temp.c(1), d, 20000) from unnest(array[1, 2, 3, 4, 6]) d;
-- Bela: two orders, the later on the business date exactly thirty days back,
-- rung after midnight. ₹600 in all.
select pg_temp.bill(pg_temp.kal(), pg_temp.c(2), 30, 30000, true);
select pg_temp.bill(pg_temp.kal(), pg_temp.c(2), 40, 30000);
-- Chitra: one order thirty-one business dates back, rung at 00:30 on the
-- calendar day thirty back, and a cancelled ₹9,000 bill yesterday.
select pg_temp.bill(pg_temp.kal(), pg_temp.c(3), 31, 50000, true);
select pg_temp.bill(pg_temp.kal(), pg_temp.c(3), 1, 900000, false, true);
-- Dev: a regular at the other outlet, never served here.
select pg_temp.bill(pg_temp.kpa(), pg_temp.c(4), d, 10000) from unnest(array[1, 2, 3]) d;
-- No saved name: one order five days back.
select pg_temp.bill(pg_temp.kal(), pg_temp.c(5), 5, 10000);
-- Gauri: one order three days back, and gold here.
select pg_temp.bill(pg_temp.kal(), pg_temp.c(6), 3, 20000);
-- Only ever a cancelled bill here.
select pg_temp.bill(pg_temp.kal(), pg_temp.c(7), 2, 30000, false, true);
-- Esha: one order ten days back.
select pg_temp.bill(pg_temp.kal(), pg_temp.c(8), 10, 15000);

update public.outlets set gold_enabled = true where id = pg_temp.kal();
insert into public.customer_memberships
  (customer_id, outlet_id, granted_by, granted_at, expires_at)
values
  (pg_temp.c(6), pg_temp.kal(), pg_temp.owner(), now() - interval '1 day',
   now() + interval '30 days');

-- ---------------------------------------------------------------------------
-- 1. The sending window, on the customers' clock (design D8).
--
-- The same cases `core/rehearsal.test.ts` holds the laptop's arithmetic to.

select is(
  (select is_open from public.marketing_window_at('2026-11-18 10:00+05:30', '10:00', '21:00')),
  true, 'the window is open at its start');
select is(
  (select is_open from public.marketing_window_at('2026-11-18 20:59+05:30', '10:00', '21:00')),
  true, 'and a minute before its end');
select is(
  (select is_open from public.marketing_window_at('2026-11-18 21:00+05:30', '10:00', '21:00')),
  false, 'and closed at its end');
select is(
  (select is_open from public.marketing_window_at('2026-11-18 09:59+05:30', '10:00', '21:00')),
  false, 'and closed a minute before its start');
select is(
  (select opens_at from public.marketing_window_at('2026-11-18 07:30+05:30', '10:00', '21:00')),
  '2026-11-18 10:00+05:30'::timestamptz, 'early in the morning it next opens today');
select is(
  (select opens_at from public.marketing_window_at('2026-11-18 23:00+05:30', '10:00', '21:00')),
  '2026-11-19 10:00+05:30'::timestamptz, 'late at night it next opens tomorrow');
select is(
  (select opens_at from public.marketing_window_at('2026-11-18 12:00+05:30', '10:00', '21:00')),
  null, 'while it is open there is no opening to wait for');
select is(
  (select is_open from public.marketing_window_at('2026-11-17 22:30-08:00', '10:00', '21:00')),
  true, 'half past ten at night in Los Angeles is noon in India, and the window is open');
select is(
  (select array_agg(w.is_open order by t.at)
     from unnest(array['2026-11-18 23:00+05:30', '2026-11-19 01:59+05:30',
                       '2026-11-19 02:00+05:30']::timestamptz[]) as t (at),
          public.marketing_window_at(t.at, '22:00', '02:00') w),
  array[true, true, false],
  'a window whose end is before its start runs through midnight');
select is(
  (select is_open from public.marketing_window_at('2026-11-18 12:00+05:30', '00:00', '24:00')),
  true, 'and 00:00 to 24:00 is the whole day');

-- ---------------------------------------------------------------------------
-- 2. Who a campaign goes to.

select is(
  pg_temp.o($$select public.campaign_audience_count(pg_temp.aud())$$),
  '6'::jsonb,
  'with no filter the audience is everybody with a settled bill at the outlet');

select is(
  pg_temp.names(pg_temp.aud()),
  'Asha, Bela, Gauri, (no name), Esha, Chitra',
  'most orders first, then the most recent order: nobody from the other outlet, and nobody whose only bill was cancelled');

select is(
  pg_temp.names(jsonb_build_object('outletId', pg_temp.kpa())),
  'Dev',
  'the other outlet''s audience is its own customers');

-- Recency is counted on the bill's business date against the outlet's current
-- one. Bela's bill was rung after midnight and still belongs to the date
-- thirty back; Chitra's belongs to the date thirty-one back although the
-- calendar day it was rung on is thirty back.
select is(
  pg_temp.names(pg_temp.aud('{"ordered": {"kind": "within", "days": 30}}')),
  'Asha, Bela, Gauri, (no name), Esha',
  'ordered in the last 30 days includes a bill on the business date exactly 30 back');
select is(
  pg_temp.names(pg_temp.aud('{"ordered": {"kind": "within", "days": 29}}')),
  'Asha, Gauri, (no name), Esha',
  'and 29 days leaves it out');
select is(
  pg_temp.names(pg_temp.aud('{"ordered": {"kind": "not_within", "days": 30}}')),
  'Chitra',
  'not ordered in 30 days is the rest: a cancelled bill yesterday is not an order');

select is(
  pg_temp.names(pg_temp.aud('{"orders": {"kind": "at_least", "count": 2}}')),
  'Asha, Bela',
  'at least two orders counts settled bills');
select is(
  pg_temp.names(pg_temp.aud('{"orders": {"kind": "at_most", "count": 1}}')),
  'Gauri, (no name), Esha, Chitra',
  'at most one order is everybody else');

select is(
  pg_temp.names(pg_temp.aud('{"gold": "gold"}')),
  'Gauri',
  'gold is the customers who are gold at this outlet now');
select is(
  pg_temp.names(pg_temp.aud('{"gold": "not_gold"}')),
  'Asha, Bela, (no name), Esha, Chitra',
  'and not gold is everybody else');

-- Money: integer paise, summed over settled bills. Chitra's cancelled ₹9,000
-- would put her far past every floor below if it were counted.
select is(
  pg_temp.names(pg_temp.aud('{"spentAtLeastPaise": 60000}')),
  'Asha, Bela',
  'spent at least ₹600 includes the customer who spent exactly that');
select is(
  pg_temp.names(pg_temp.aud('{"spentAtLeastPaise": 60001}')),
  'Asha',
  'and one paisa more leaves her out');
select is(
  pg_temp.o($$select public.campaign_audience_count(pg_temp.aud('{"spentAtLeastPaise": 100001}'))$$),
  '0'::jsonb,
  'a cancelled bill adds nothing to what somebody spent');

select is(
  pg_temp.names(pg_temp.aud('{"ordered": {"kind": "within", "days": 30},
                              "orders": {"kind": "at_most", "count": 1}}')),
  'Gauri, (no name), Esha',
  'two filters narrow together');

select is(
  pg_temp.names(pg_temp.aud('{"sort": "most_recent"}')),
  'Asha, Gauri, (no name), Esha, Bela, Chitra',
  'most recent first');
select is(
  pg_temp.names(pg_temp.aud('{"sort": "longest_away"}')),
  'Chitra, Bela, Esha, (no name), Gauri, Asha',
  'longest away first');
select is(
  pg_temp.names(pg_temp.aud(), 4),
  'Esha, Chitra',
  'a later page carries on where the last one stopped');

-- The first read that lists customers by what they did returns a name and four
-- digits, and nothing else about them.
select pg_temp.impersonate(pg_temp.owner());
select is(
  (select count(*)::int from public.campaign_audience_list(pg_temp.aud()) l
    where l.phone_last4 !~ '^[0-9]{4}$'),
  0,
  'every row of the look-through carries exactly four digits');
select is(
  (select bool_or(to_jsonb(l)::text ~ '90000084')
     from public.campaign_audience_list(pg_temp.aud()) l),
  false,
  'and no row carries a full number anywhere in it');
select pg_temp.as_server();

select pg_temp.refused(
  $$select public.campaign_audience_count('{"outletId": "00000000-0000-4000-a000-000000000001", "everybody": true}')$$,
  '22023', 'audience_invalid',
  'a filter the database does not know is refused, never ignored');
select pg_temp.refused(
  $$select public.campaign_audience_count('{"sort": "most_orders"}')$$,
  '22023', 'audience_invalid', 'an audience names its outlet');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud('{"ordered": {"kind": "within", "days": -1}}'))$$,
  '22023', 'audience_invalid', 'a number of days is a whole number, nought or more');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud('{"sort": "richest_first"}'))$$,
  '22023', 'audience_invalid', 'an order the app does not offer is refused');
select pg_temp.refused(
  $$select public.campaign_audience_count('{"outletId": "00000000-0000-4000-a000-0000000000ff"}')$$,
  '22023', 'audience_invalid', 'an outlet that does not exist is refused');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud('{"goldOnly": true}'))$$,
  '22023', 'audience_invalid', 'the filter gold replaced is refused, not read as no filter');

-- ---------------------------------------------------------------------------
-- 2a. Ordered between two dates, and not since (owner, 2026-11-20: to win back
-- customers from a past stretch who have not come back). Both dates are
-- business dates and both are included; "not since" means no settled bill
-- after the second date.

create function pg_temp.between(
  p_from_days_ago integer, p_to_days_ago integer, p_not_since boolean default null)
returns jsonb language sql stable as $$
  select jsonb_build_object('ordered',
           jsonb_build_object(
             'kind', 'between',
             'from', (current_setting('test.today')::date - p_from_days_ago)::text,
             'to', (current_setting('test.today')::date - p_to_days_ago)::text)
           || case when p_not_since is null then '{}'::jsonb
                   else jsonb_build_object('notSince', p_not_since) end)
$$;

select is(
  pg_temp.names(pg_temp.aud(pg_temp.between(12, 2))),
  'Asha, Gauri, (no name), Esha',
  'ordered between 12 and 2 days ago is everybody with a settled bill in that stretch');
select is(
  pg_temp.names(pg_temp.aud(pg_temp.between(12, 2, false))),
  'Asha, Gauri, (no name), Esha',
  'and "not since" off is the same');
select is(
  pg_temp.names(pg_temp.aud(pg_temp.between(12, 2, true))),
  'Gauri, (no name), Esha',
  'with "not since" on, a customer who ordered again after the second date is left out');
select is(
  pg_temp.names(pg_temp.aud(pg_temp.between(10, 10))),
  'Esha',
  'both dates are included: one day is a stretch of one');
-- Bela's after-midnight bill belongs to the date 30 back, Chitra's to 31 back.
select is(
  pg_temp.names(pg_temp.aud(pg_temp.between(31, 30, true))),
  'Bela, Chitra',
  'counted on business dates, and a cancelled bill since is not a visit');
select is(
  pg_temp.names(pg_temp.aud(pg_temp.between(29, 11))),
  '',
  'a stretch with no settled bill in it finds nobody');
select is(
  pg_temp.names(pg_temp.aud(pg_temp.between(12, 2, true)
                            || '{"gold": "not_gold"}'::jsonb)),
  '(no name), Esha',
  'and it narrows together with the other filters');
select is(
  pg_temp.goes_to(pg_temp.aud(pg_temp.between(12, 2, true))),
  'Gauri, (no name), Esha',
  'and a campaign submitted with it goes to exactly who the list shows');

select pg_temp.refused(
  format($$select public.campaign_audience_count(%L)$$, pg_temp.aud(pg_temp.between(2, 12))),
  '22023', 'audience_invalid', 'a first date after the second is refused');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud(
      '{"ordered": {"kind": "between", "from": "2026-11-01"}}'))$$,
  '22023', 'audience_invalid', 'a stretch with one date is refused');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud(
      '{"ordered": {"kind": "between", "from": "2026-11-01", "to": "2026-11-31"}}'))$$,
  '22023', 'audience_invalid', 'a date that does not exist is refused');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud(
      '{"ordered": {"kind": "between", "from": "1 Nov 2026", "to": "2026-11-10"}}'))$$,
  '22023', 'audience_invalid', 'a date is written YYYY-MM-DD and nothing else');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud(
      '{"ordered": {"kind": "between", "from": "2026-11-01", "to": "2026-11-10", "notSince": "yes"}}'))$$,
  '22023', 'audience_invalid', '"not since" is true or false');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud(
      '{"ordered": {"kind": "between", "from": "2026-11-01", "to": "2026-11-10", "days": 30}}'))$$,
  '22023', 'audience_invalid', 'a key the stretch does not have is refused, never ignored');

-- ---------------------------------------------------------------------------
-- 2b. Who is picked, and finding somebody (proposal, decision 12).
--
-- The list shows everybody the filters match. Who the campaign goes to is who
-- is ticked: everybody the filters match but the unticked (Select all), or
-- exactly the customers ticked one by one, whatever the filters say afterwards.

select is(
  pg_temp.o($$select public.campaign_audience_count(pg_temp.aud(pg_temp.nobody()))$$),
  '0'::jsonb,
  'with nobody ticked a campaign goes to nobody');
select is(
  pg_temp.o(format($$select public.campaign_audience_count(%L)$$,
    jsonb_build_object('outletId', pg_temp.kal()))),
  '0'::jsonb,
  'and an audience that does not say who is picked has picked nobody');
select is(
  pg_temp.names(pg_temp.aud(pg_temp.nobody())),
  'Asha, Bela, Gauri, (no name), Esha, Chitra',
  'the list still shows everybody, ticked or not');

select is(
  pg_temp.goes_to(pg_temp.aud(
    '{"ordered": {"kind": "within", "days": 30}, "sort": "longest_away"}'
    || pg_temp.only(1, 3, 8))),
  'Chitra, Esha, Asha',
  'customers ticked one by one stay picked whatever the filters say, in the chosen order');
select is(
  pg_temp.o($$select public.campaign_audience_count(pg_temp.aud(pg_temp.only(1, 3, 4, 7)))$$),
  '2'::jsonb,
  'a tick cannot add somebody the outlet has not served: the other outlet''s customer and the cancelled bill''s stay out');

select is(
  pg_temp.goes_to(pg_temp.aud(
    '{"ordered": {"kind": "within", "days": 30}}'
    || jsonb_build_object('picked', jsonb_build_object(
         'kind', 'all', 'except', jsonb_build_array(pg_temp.c(2), pg_temp.c(3)))))),
  'Asha, Gauri, (no name), Esha',
  'Select all is everybody the filters match, but the ones unticked');

select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud('{"picked": {"kind": "some", "ids": []}}'))$$,
  '22023', 'audience_invalid', 'a way of picking the app does not have is refused');
select pg_temp.refused(
  $$select public.campaign_audience_count(pg_temp.aud('{"picked": {"kind": "only", "ids": ["Asha"]}}'))$$,
  '22023', 'audience_invalid', 'a picked customer is an id, and nothing else');
select pg_temp.refused(
  format($$select public.campaign_audience_count(pg_temp.aud(%L))$$,
    jsonb_build_object('picked', jsonb_build_object('kind', 'only', 'ids',
      (select jsonb_agg(gen_random_uuid()) from generate_series(1, 5001))))),
  '22023', 'audience_invalid', 'and a list of more ids than any outlet has customers is refused');

-- The search, by the Customers page's own rules: three letters anywhere in the
-- saved name, or three digits anywhere in the number. It narrows what the list
-- shows and never who is picked.
select is(pg_temp.names(pg_temp.aud(), 0, 'sha'), 'Asha, Esha',
  'three letters find a name they sit in, ignoring case');
select is(pg_temp.names(pg_temp.aud(), 0, ' ASH '), 'Asha',
  'whatever the case and the spaces round them');
select is(pg_temp.names(pg_temp.aud(), 0, 'aha'), 'Asha',
  'and the same letters in order with gaps still find her');
select is(pg_temp.names(pg_temp.aud(), 0, '8403'), 'Chitra',
  'digits find a customer by any run of their number');
select is(pg_temp.names(pg_temp.aud(), 0, '+91 90000 0840'),
  'Asha, Bela, Gauri, (no name), Esha, Chitra',
  'a pasted +91 is the country, never part of what is looked for');
select is(pg_temp.names(pg_temp.aud(), 0, 'as'),
  'Asha, Bela, Gauri, (no name), Esha, Chitra',
  'fewer than three characters narrow nothing');
select is(pg_temp.names(pg_temp.aud(), 0, '%%%'), '',
  'a percent sign is a percent sign, not a wildcard');
select is(pg_temp.names(pg_temp.aud('{"gold": "gold"}'), 0, 'sha'), '',
  'a search looks inside what the filters match, not past them');
select is(pg_temp.names(pg_temp.aud(pg_temp.nobody()), 0, 'sha'), 'Asha, Esha',
  'and finds people whether or not they are ticked');
select pg_temp.impersonate(pg_temp.owner());
select is(
  (select bool_or(to_jsonb(l)::text ~ '90000084')
     from public.campaign_audience_list(pg_temp.aud(), 0, '90000084') l),
  false,
  'a search by number still returns four digits and never the number');
select pg_temp.as_server();

-- ---------------------------------------------------------------------------
-- 3. A draft, and submitting it.

select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Diwali offer', 'Hi {name}, *20%% off* this week.', %L)$$,
  pg_temp.k(1), pg_temp.aud()));
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Diwali offer', 'Hi {name}, *20%% off* this week.', %L)$$,
  pg_temp.k(1), pg_temp.aud()));
select is(
  (select count(*)::int from public.marketing_campaigns where id = pg_temp.k(1)),
  1,
  'a save sent twice writes one campaign');
select is(
  (select row(state, created_by, batch_size, scheduled_at)::text
     from public.marketing_campaigns where id = pg_temp.k(1)),
  row('draft'::public.marketing_campaign_state, pg_temp.owner(), null::integer,
      null::timestamptz)::text,
  'a draft is its writer''s, with no batch size and no submission yet');

select pg_temp.refused(
  format($$select public.save_campaign_draft(%L, '   ', 'Hello', null)$$, pg_temp.k(8)),
  '22023', 'name_required', 'a campaign needs a name');

select pg_temp.run(format(
  $$select public.set_campaign_image(%L, %L)$$, pg_temp.k(1), pg_temp.k(1) || '/offer.jpg'));
select pg_temp.refused(
  format($$select public.set_campaign_image(%L, 'somebody-elses/offer.jpg')$$, pg_temp.k(1)),
  '22023', 'image_path_invalid', 'a picture sits in its own campaign''s folder');

-- What cannot be submitted.
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'No audience yet', 'Hello', null)$$, pg_temp.k(7)));
select pg_temp.refused(
  format($$select public.schedule_campaign(%L)$$, pg_temp.k(7)),
  '22023', 'audience_required', 'a campaign with nobody chosen is not submitted');
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'No message yet', '  ', %L)$$,
  pg_temp.k(7), pg_temp.aud()));
select pg_temp.refused(
  format($$select public.schedule_campaign(%L)$$, pg_temp.k(7)),
  '22023', 'body_required', 'nor one with nothing written');
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Too long', %L, %L)$$,
  pg_temp.k(7), repeat('x', 1025), pg_temp.aud()));
select pg_temp.refused(
  format($$select public.schedule_campaign(%L)$$, pg_temp.k(7)),
  '22023', 'body_too_long', 'nor one longer than a message may be');
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Nobody', 'Hello', %L)$$,
  pg_temp.k(7), pg_temp.aud('{"orders": {"kind": "at_least", "count": 99}}')));
select pg_temp.refused(
  format($$select public.schedule_campaign(%L)$$, pg_temp.k(7)),
  '22023', 'nobody_matches', 'nor one whose audience is nobody');
select pg_temp.refused(
  format($$select public.schedule_campaign(%L)$$, pg_temp.k(99)),
  'P0002', 'not_found', 'nor one that does not exist');
select is(
  (select state::text from public.marketing_campaigns where id = pg_temp.k(7)),
  'draft', 'and each refusal leaves the draft a draft');

-- The owner's settings: two to a batch, and the window open all day so the
-- cases below do not depend on the hour this file runs at.
select pg_temp.run(
  $$select public.update_marketing_sender_settings(2, '00:00', '24:00', 45, 90)$$);

-- A customer who asked at the counter not to be messaged.
select is(
  pg_temp.o($$select to_jsonb(s) from public.marketing_stopped_add('9000008405') s$$)
    - 'stopped_at',
  jsonb_build_object(
    'customer_id', pg_temp.c(5), 'name', null, 'phone_last4', '8405', 'source', 'owner',
    'campaign_name', null, 'recorded_by_name', 'Synthetic Owner'),
  'an owner adds a customer to the stopped list by number, and is shown four digits back');
select pg_temp.run($$select * from public.marketing_stopped_add('+91 90000 08405')$$);
select is(
  (select count(*)::int from public.marketing_stopped where customer_id = pg_temp.c(5)),
  1, 'adding somebody twice keeps one row');
select is(
  pg_temp.names(pg_temp.aud()),
  'Asha, Bela, Gauri, Esha, Chitra',
  'a stopped customer is in no audience, whatever the filters say');

select pg_temp.run(format($$select public.schedule_campaign(%L)$$, pg_temp.k(1)));

select is(
  (select row(state, batch_size, scheduled_by, scheduled_at, not_before)::text
     from public.marketing_campaigns where id = pg_temp.k(1)),
  row('scheduled'::public.marketing_campaign_state, 2, pg_temp.owner(), now(),
      null::timestamptz)::text,
  'submitting records who and when, snapshots the batch size, and sets no start time');
select is(
  (select string_agg(coalesce(c.name, '(no name)'), ', ' order by r.position)
     from public.marketing_campaign_recipients r
     join public.customers c on c.id = r.customer_id
    where r.campaign_id = pg_temp.k(1)),
  'Asha, Bela, Gauri, Esha, Chitra',
  'the recipients are the audience as it was counted, in the chosen order, without the stopped customer');
select is(
  (select array_agg(r.batch_no order by r.position)
     from public.marketing_campaign_recipients r where r.campaign_id = pg_temp.k(1)),
  array[1, 1, 2, 2, 3],
  'cut into batches of the size set at that moment');
select is(
  (select string_agg(b.batch_no || ':' || b.state, ', ' order by b.batch_no)
     from public.marketing_campaign_batches b where b.campaign_id = pg_temp.k(1)),
  '1:waiting, 2:waiting, 3:waiting',
  'three batches exist and none is released');
select is(pg_temp.states(pg_temp.k(1)), 'waiting, waiting, waiting, waiting, waiting',
  'and nothing is sent');

select pg_temp.refused(
  format($$select public.save_campaign_draft(%L, 'Changed', 'Changed', null)$$, pg_temp.k(1)),
  '55000', 'not_a_draft', 'a submitted campaign can no longer be rewritten');
select pg_temp.refused(
  format($$select public.set_campaign_image(%L, null)$$, pg_temp.k(1)),
  '55000', 'not_a_draft', 'nor lose its picture');
select pg_temp.refused(
  format($$select public.schedule_campaign(%L)$$, pg_temp.k(1)),
  '55000', 'not_a_draft', 'nor be submitted twice');

-- The setting changes after submitting: this campaign keeps the size it was
-- cut at.
select pg_temp.run(
  $$select public.update_marketing_sender_settings(100, '00:00', '24:00', 45, 90)$$);
select is(
  (select row(c.batch_size,
              (select count(*)::int from public.marketing_campaign_batches b
                where b.campaign_id = c.id))::text
     from public.marketing_campaigns c where c.id = pg_temp.k(1)),
  row(2, 3)::text,
  'a later change to the batch size moves no batch already cut');

-- A draft with nobody ticked cannot be submitted.
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Big spenders', 'Thank you, {name}.', %L)$$,
  pg_temp.k(2), pg_temp.aud(pg_temp.nobody())));
select pg_temp.refused(
  format($$select public.schedule_campaign(%L)$$, pg_temp.k(2)),
  '22023', 'nobody_matches', 'a campaign with nobody ticked is not submitted');

-- A second campaign, submitted while the first is open: two customers ticked by
-- hand. Its filter would not match the first, and the second was never served
-- here, so submitting cuts exactly the one who can be sent to.
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Big spenders', 'Thank you, {name}.', %L)$$,
  pg_temp.k(2),
  pg_temp.aud('{"orders": {"kind": "at_most", "count": 1}}' || pg_temp.only(1, 4))));
select pg_temp.run(format($$select public.schedule_campaign(%L)$$, pg_temp.k(2)));
select is(
  (select string_agg(c.name, ', ' order by r.position)
     from public.marketing_campaign_recipients r
     join public.customers c on c.id = r.customer_id
    where r.campaign_id = pg_temp.k(2)),
  'Asha',
  'submitting cuts exactly the customers ticked that the outlet has served');
-- Submitted "later": every `now()` in one transaction is the same instant.
update public.marketing_campaigns
   set scheduled_at = scheduled_at + interval '1 minute' where id = pg_temp.k(2);
select is(pg_temp.states(pg_temp.k(2)), 'waiting',
  'a customer may be in two campaigns, once in each');

-- ---------------------------------------------------------------------------
-- 4. The tick: the heartbeat and the question (design D6).

select set_config('test.tick', pg_temp.tick()::text, true);

select is(
  current_setting('test.tick')::jsonb
    - 'waiting_for_release' - 'window',
  jsonb_build_object(
    'contract_version', 1, 'stand_down', false,
    'min_gap_seconds', 45, 'max_gap_seconds', 90,
    'released', null, 'campaigns_open', true,
    'sent_today', 0, 'last_batch_finished_at', null, 'tests_waiting', 0),
  'the tick answers the contract version, the gaps, and that nothing is released yet');
select is(
  current_setting('test.tick')::jsonb -> 'window',
  '{"open": true, "opens_at": null}'::jsonb,
  'with the window as the database reads it');
select is(
  current_setting('test.tick')::jsonb -> 'waiting_for_release',
  jsonb_build_object('campaign_id', pg_temp.k(1), 'batch_no', 1,
                     'campaign_name', 'Diwali offer', 'recipients', 2),
  'and the batch waiting to be released, with its campaign''s name and how many are in it');
select is(
  (select row(last_seen_at, status, installation_id)::text from public.marketing_sender),
  row(now(), 'idle'::public.marketing_sender_status, 'laptop-a')::text,
  'the tick records when the sender was seen, what it said and which installation it is');

-- A start time is never set by the app (proposal, decision 11), and is still
-- honoured if a row carries one.
update public.marketing_campaigns
   set not_before = now() + interval '1 day' where id in (pg_temp.k(1), pg_temp.k(2));
select is(pg_temp.tick() -> 'waiting_for_release', 'null'::jsonb,
  'a campaign not yet due has no batch to offer');
select is(pg_temp.o(format($$select public.release_campaign_batch(%L, 1)$$, pg_temp.k(1))), 'false'::jsonb,
  'and its batch cannot be released');
update public.marketing_campaigns
   set not_before = null where id in (pg_temp.k(1), pg_temp.k(2));

-- ---------------------------------------------------------------------------
-- 5. Releasing, and what a claim is refused for.

select is(
  pg_temp.claim(pg_temp.k(1), 1),
  '{"kind": "refused", "why": "not_released"}'::jsonb,
  'no recipient is handed over from a batch nobody released');

select is(pg_temp.o(format($$select public.release_campaign_batch(%L, 2)$$, pg_temp.k(1))), 'false'::jsonb,
  'batches are released in order: the second is not released while the first waits');

select is(pg_temp.o(format($$select public.release_campaign_batch(%L, 1)$$, pg_temp.k(1))), 'true'::jsonb,
  'the owner releases the first batch');
select is(pg_temp.o(format($$select public.release_campaign_batch(%L, 1)$$, pg_temp.k(1))), 'false'::jsonb,
  'and a second press releases nothing, and is not an error');
select is(
  (select row(state, released_by, released_at)::text
     from public.marketing_campaign_batches
    where campaign_id = pg_temp.k(1) and batch_no = 1),
  row('released'::public.marketing_batch_state, pg_temp.owner(), now())::text,
  'releasing records who pressed Send batch and when');
select is(
  (select string_agg(b.batch_no || ':' || b.state, ', ' order by b.batch_no)
     from public.marketing_campaign_batches b where b.campaign_id = pg_temp.k(1)),
  '1:released, 2:waiting, 3:waiting',
  'and the next batch still waits');

select set_config('test.tick', pg_temp.tick()::text, true);
select is(
  current_setting('test.tick')::jsonb -> 'released',
  jsonb_build_object('campaign_id', pg_temp.k(1), 'batch_no', 1),
  'the tick names the released batch');
select is(
  current_setting('test.tick')::jsonb -> 'waiting_for_release', 'null'::jsonb,
  'and offers no other while one is released');

select is(pg_temp.o(format($$select public.release_campaign_batch(%L, 2)$$, pg_temp.k(1))), 'false'::jsonb,
  'a second batch cannot be released while one is sending');
select is(pg_temp.o(format($$select public.release_campaign_batch(%L, 1)$$, pg_temp.k(2))), 'false'::jsonb,
  'nor another campaign''s: one batch at a time across every campaign');
select is(
  (select string_agg(b.batch_no || ':' || b.state, ', ' order by b.campaign_id, b.batch_no)
     from public.marketing_campaign_batches b where b.state <> 'waiting'),
  '1:released',
  'and none of those presses released anything');
select pg_temp.refused(
  format($$select public.release_campaign_batch(%L, 9)$$, pg_temp.k(1)),
  'P0002', 'not_found', 'a batch that does not exist is an error, not an answer');
select throws_ok(
  format($$update public.marketing_campaign_batches set state = 'released'
            where campaign_id = %L and batch_no = 1$$, pg_temp.k(2)),
  '23505', null,
  'which is the table''s own rule, not only the function''s');
select is(
  pg_temp.o(format($$select public.campaign_reading(%L)$$, pg_temp.k(2))) -> 'behind_campaign_name',
  '"Diwali offer"'::jsonb,
  'the waiting campaign''s page is told whose batch is out ahead of it');

-- Outside the window. The window is set to an hour that starts two hours from
-- now, whatever the hour is, and put back afterwards.
select pg_temp.run(format(
  $$select public.update_marketing_sender_settings(100, %L, %L, 45, 90)$$,
  (now() at time zone 'Asia/Kolkata')::time + interval '2 hours',
  (now() at time zone 'Asia/Kolkata')::time + interval '3 hours'));
select is(
  pg_temp.claim(pg_temp.k(1), 1),
  jsonb_build_object('kind', 'refused', 'why', 'outside_window',
                     'opens_at', now() + interval '2 hours'),
  'outside the window a claim is refused, with the instant it opens');
select is(
  pg_temp.tick() -> 'window',
  jsonb_build_object('open', false, 'opens_at', now() + interval '2 hours'),
  'and the tick says the same');
select is(pg_temp.states(pg_temp.k(1)), 'waiting, waiting, waiting, waiting, waiting',
  'nobody was handed over');
select pg_temp.run(
  $$select public.update_marketing_sender_settings(100, '00:00', '24:00', 45, 90)$$);

-- Paused, by an owner.
select pg_temp.run(format($$select public.pause_campaign(%L)$$, pg_temp.k(1)));
select is(pg_temp.o(format($$select public.release_campaign_batch(%L, 1)$$, pg_temp.k(2))), 'false'::jsonb,
  'a paused campaign still holds its turn: nobody else''s batch is released past it');
select is(
  pg_temp.claim(pg_temp.k(1), 1),
  '{"kind": "refused", "why": "paused"}'::jsonb,
  'a paused campaign hands nobody over');
select set_config('test.tick', pg_temp.tick()::text, true);
select is(
  (current_setting('test.tick')::jsonb -> 'released', current_setting('test.tick')::jsonb -> 'campaigns_open')::text,
  ('null'::jsonb, 'true'::jsonb)::text,
  'the tick offers no batch of a paused campaign, and says one is still open');
select pg_temp.refused(
  format($$select public.pause_campaign(%L)$$, pg_temp.k(1)),
  '55000', 'wrong_state', 'an owner cannot pause what is already paused');
select pg_temp.run(format($$select public.resume_campaign(%L)$$, pg_temp.k(1)));
select pg_temp.refused(
  format($$select public.resume_campaign(%L)$$, pg_temp.k(1)),
  '55000', 'wrong_state', 'nor resume what is not paused');

-- ---------------------------------------------------------------------------
-- 6. One recipient at a time, with the number read at that moment.

select set_config('test.claim', pg_temp.claim(pg_temp.k(1), 1)::text, true);
select is(
  current_setting('test.claim')::jsonb,
  jsonb_build_object('kind', 'claimed', 'recipient', jsonb_build_object(
    'campaign_id', pg_temp.k(1), 'batch_no', 1, 'customer_id', pg_temp.c(1), 'position', 1,
    'phone', '919000008401', 'name', 'Asha',
    'body', 'Hi {name}, *20% off* this week.',
    'image_path', pg_temp.k(1) || '/offer.jpg')),
  'a claim hands over the first waiting recipient: who, the number as digits, the name, the message and its picture');
select is(
  (select row(state, claimed_at)::text from public.marketing_campaign_recipients
    where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(1)),
  row('sending'::public.marketing_recipient_state, now())::text,
  'and marks them as being sent to before anything is sent');

select is(
  pg_temp.claim(pg_temp.k(1), 1),
  '{"kind": "refused", "why": "claim_in_flight"}'::jsonb,
  'while one recipient is in hand the next is refused');
select throws_ok(
  format($$update public.marketing_campaign_recipients set state = 'sending'
            where campaign_id = %L and customer_id = %L$$, pg_temp.k(1), pg_temp.c(2)),
  '23505', null,
  'and two in hand at once is something the table itself cannot hold');

-- The report.
select is(
  pg_temp.o(format($$select public.campaign_report_result(%L, %L, 'sent', 'MSG-B', null)$$,
    pg_temp.k(1), pg_temp.c(2))),
  'false'::jsonb,
  'a report for a recipient not in hand is refused');
select is(
  (select state::text from public.marketing_campaign_recipients
    where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(2)),
  'waiting', 'and changes nothing');
select is(
  pg_temp.o(format($$select public.campaign_report_result(%L, %L, 'sent', 'MSG-A', null)$$,
    pg_temp.k(1), pg_temp.c(1))),
  'true'::jsonb,
  'a report for the recipient in hand is accepted');
select is(
  (select row(state, wa_message_id, sent_at)::text from public.marketing_campaign_recipients
    where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(1)),
  row('sent'::public.marketing_recipient_state, 'MSG-A', now())::text,
  'and records the message id and when');
select is(
  pg_temp.o(format($$select public.campaign_report_result(%L, %L, 'sent', 'MSG-A', null)$$,
    pg_temp.k(1), pg_temp.c(1))),
  'true'::jsonb,
  'the same report arriving twice is accepted: its first answer may have been lost');
select is(
  pg_temp.o(format($$select public.campaign_report_result(%L, %L, 'sent', 'MSG-Z', null)$$,
    pg_temp.k(1), pg_temp.c(1))),
  'false'::jsonb,
  'a different result for a settled recipient is not');
select pg_temp.refused(
  format($$select public.campaign_report_result(%L, %L, 'unsure', null, null)$$,
    pg_temp.k(1), pg_temp.c(1)),
  '22023', null,
  'a report is sent, failed or not on WhatsApp, and nothing else');

-- A number corrected between submitting and the customer's turn.
update public.customers
   set phone = '+919000008499', name = 'Bela Das' where id = pg_temp.c(2);
select is(
  (pg_temp.claim(pg_temp.k(1), 1) -> 'recipient') - 'body' - 'image_path',
  jsonb_build_object('campaign_id', pg_temp.k(1), 'batch_no', 1, 'customer_id', pg_temp.c(2),
                     'position', 2, 'phone', '919000008499', 'name', 'Bela Das'),
  'the message goes to what the record says at their turn');

-- Resume: a claim nobody settled.
select is(pg_temp.o($$select public.campaign_release_stale_claims()$$), '1'::jsonb,
  'the recipient left in hand is released as unsure, and counted');
select is(pg_temp.o($$select public.campaign_release_stale_claims()$$), '0'::jsonb,
  'and there is nothing to release the second time');
select is(pg_temp.states(pg_temp.k(1)), 'sent, unsure, waiting, waiting, waiting',
  'she reads unsure');
select is(
  pg_temp.claim(pg_temp.k(1), 1),
  '{"kind": "nothing"}'::jsonb,
  'and is never handed over again: the batch has nobody left');
select is(
  (select row(state, finished_at)::text from public.marketing_campaign_batches
    where campaign_id = pg_temp.k(1) and batch_no = 1),
  row('done'::public.marketing_batch_state, now())::text,
  'a batch with nobody waiting and nobody in hand is done');
select is(
  (select state::text from public.marketing_campaigns where id = pg_temp.k(1)),
  'scheduled', 'and its campaign goes on while batches remain');

select set_config('test.tick', pg_temp.tick()::text, true);
select is(
  current_setting('test.tick')::jsonb
    - 'window' - 'contract_version' - 'stand_down' - 'min_gap_seconds' - 'max_gap_seconds',
  jsonb_build_object(
    'released', null,
    'waiting_for_release', jsonb_build_object(
      'campaign_id', pg_temp.k(1), 'batch_no', 2,
      'campaign_name', 'Diwali offer', 'recipients', 2),
    'campaigns_open', true, 'sent_today', 1, 'last_batch_finished_at', now(),
    'tests_waiting', 0),
  'the next tick offers the campaign''s next batch, with one sent today and when the last batch finished');

-- "Today" is India's day. Midnight there is 18:30 the evening before in UTC.
update public.marketing_campaign_recipients
   set sent_at = date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
                 - interval '1 second'
 where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(1);
select is(pg_temp.tick() -> 'sent_today', '0'::jsonb,
  'a message sent a second before midnight in India is not today''s');
update public.marketing_campaign_recipients
   set sent_at = date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
 where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(1);
select is(pg_temp.tick() -> 'sent_today', '1'::jsonb,
  'and one sent at midnight in India is');
update public.marketing_campaign_recipients
   set sent_at = now() where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(1);

-- Stopped after submitting, before their turn.
select pg_temp.run(format($$select public.release_campaign_batch(%L, 2)$$, pg_temp.k(1)));
select pg_temp.run($$select * from public.marketing_stopped_add('9000008406')$$);
select is(
  (pg_temp.claim(pg_temp.k(1), 2) -> 'recipient') ->> 'name',
  'Esha',
  'a customer stopped while waiting is passed over when their turn comes');
select is(
  (select row(state, claimed_at, sent_at)::text from public.marketing_campaign_recipients
    where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(6)),
  row('stopped'::public.marketing_recipient_state, null::timestamptz, null::timestamptz)::text,
  'and is marked stopped, having been sent nothing');
select is(
  pg_temp.o(format($$select public.campaign_report_result(%L, %L, 'not_on_whatsapp', null, null)$$,
    pg_temp.k(1), pg_temp.c(8))),
  'true'::jsonb,
  'a number not on WhatsApp is reported as that');

-- The last batch, and the campaign with it.
select pg_temp.run(format($$select public.release_campaign_batch(%L, 3)$$, pg_temp.k(1)));
select is(
  (pg_temp.claim(pg_temp.k(1), 3) -> 'recipient') ->> 'name', 'Chitra',
  'the last batch hands over its one recipient');
select is(
  pg_temp.o(format($$select public.campaign_report_result(%L, %L, 'sent', 'MSG-C', null)$$,
    pg_temp.k(1), pg_temp.c(3))),
  'true'::jsonb, 'who is sent to');
select is(pg_temp.states(pg_temp.k(1)), 'sent, unsure, stopped, not_on_whatsapp, sent',
  'every recipient has come to something');
select is(
  (select row(state, finished_at)::text from public.marketing_campaigns where id = pg_temp.k(1)),
  row('done'::public.marketing_campaign_state, now())::text,
  'when the last batch finishes the campaign is done');
select is(
  pg_temp.claim(pg_temp.k(1), 3),
  '{"kind": "nothing"}'::jsonb,
  'and a claim on it finds nothing');
select is(
  pg_temp.tick() -> 'waiting_for_release',
  jsonb_build_object('campaign_id', pg_temp.k(2), 'batch_no', 1,
                     'campaign_name', 'Big spenders', 'recipients', 1),
  'the campaign that waited its turn is offered next');

-- ---------------------------------------------------------------------------
-- 7. Receipts, whenever they come (design, *The first real sends*).

select is(
  (select array_agg(id order by id)
     from jsonb_array_elements_text(
       pg_temp.o($$select public.campaign_outstanding_message_ids()$$)) id),
  array['MSG-A', 'MSG-C'],
  'the ids a receipt could still change are the sent messages nobody has read');

select pg_temp.run($$select public.campaign_report_receipts(
  '[{"message_id": "MSG-C", "status": "delivered"},
    {"message_id": "never-heard-of", "status": "read"}]')$$);
select is(
  (select row(state, delivered_at, read_at)::text from public.marketing_campaign_recipients
    where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(3)),
  row('sent'::public.marketing_recipient_state, now(), null::timestamptz)::text,
  'a delivered receipt is kept by message id, and an id nobody holds is ignored');
select is(
  jsonb_array_length(pg_temp.o($$select public.campaign_outstanding_message_ids()$$)),
  2, 'a delivered message may still be read');

select pg_temp.run($$select public.campaign_report_receipts(
  '[{"message_id": "MSG-A", "status": "read"}]')$$);
select is(
  (select row(delivered_at, read_at)::text from public.marketing_campaign_recipients
    where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(1)),
  row(now(), now())::text,
  'a read with no delivered before it fills both');
select is(
  pg_temp.o($$select public.campaign_outstanding_message_ids()$$),
  '["MSG-C"]'::jsonb, 'and a read message is no longer outstanding');

-- An age limit, so the list cannot grow for ever (design, *The database*).
update public.marketing_campaign_recipients
   set sent_at = now() - interval '31 days'
 where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(3);
select is(
  pg_temp.o($$select public.campaign_outstanding_message_ids()$$),
  '[]'::jsonb, 'a message sent more than thirty days ago is not asked about');
update public.marketing_campaign_recipients
   set sent_at = now() - interval '1 hour'
 where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(3);

select pg_temp.run($$select public.campaign_report_receipts(
  '[{"message_id": "MSG-C", "status": "rejected", "code": "463"}]')$$);
select is(
  (select row(state, failure_code)::text from public.marketing_campaign_recipients
    where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(3)),
  row('failed'::public.marketing_recipient_state, '463')::text,
  'a message WhatsApp refused after taking it turns from sent to failed, with the code');
select is(
  pg_temp.o($$select public.campaign_outstanding_message_ids()$$),
  '[]'::jsonb, 'and is no longer outstanding');
select pg_temp.refused(
  $$select public.campaign_report_receipts('[{"message_id": "MSG-A", "status": "seen"}]')$$,
  '22023', null, 'a receipt is delivered, read or rejected, and nothing else');

-- ---------------------------------------------------------------------------
-- 8. What the pages read.

select set_config('test.reading',
  pg_temp.o(format($$select public.campaign_reading(%L)$$, pg_temp.k(1)))::text, true);

select is(
  current_setting('test.reading')::jsonb -> 'campaign' -> 'counts',
  jsonb_build_object(
    'recipients', 5, 'sent', 1, 'to_go', 0, 'delivered', 2, 'read', 1,
    'not_on_whatsapp', 1, 'failed', 1, 'unsure', 1, 'stopped', 1),
  'a campaign''s page counts every recipient once by what they came to, and receipts beside');
select is(
  (select jsonb_agg(jsonb_build_object(
            'batch_no', b -> 'batch_no', 'state', b -> 'state',
            'recipients', b -> 'recipients', 'sent', b -> 'sent', 'unsure', b -> 'unsure',
            'stopped', b -> 'stopped', 'not_on_whatsapp', b -> 'not_on_whatsapp',
            'failed', b -> 'failed') order by (b ->> 'batch_no')::int)
     from jsonb_array_elements(current_setting('test.reading')::jsonb -> 'campaign' -> 'batches') b),
  jsonb_build_array(
    jsonb_build_object('batch_no', 1, 'state', 'done', 'recipients', 2, 'sent', 1, 'unsure', 1,
                       'stopped', 0, 'not_on_whatsapp', 0, 'failed', 0),
    jsonb_build_object('batch_no', 2, 'state', 'done', 'recipients', 2, 'sent', 0, 'unsure', 0,
                       'stopped', 1, 'not_on_whatsapp', 1, 'failed', 0),
    jsonb_build_object('batch_no', 3, 'state', 'done', 'recipients', 1, 'sent', 0, 'unsure', 0,
                       'stopped', 0, 'not_on_whatsapp', 0, 'failed', 1)),
  'with a row of the same counts for each batch');
select is(
  (current_setting('test.reading')::jsonb -> 'campaign')
    - 'counts' - 'batches' - 'created_at' - 'scheduled_at' - 'finished_at',
  jsonb_build_object(
    'id', pg_temp.k(1), 'name', 'Diwali offer', 'state', 'done', 'paused_reason', null,
    'not_before', null, 'recipients', 5, 'sent', 1, 'sending_batch_no', null,
    'next_batch_no', null, 'body', 'Hi {name}, *20% off* this week.',
    'image_path', pg_temp.k(1) || '/offer.jpg', 'audience', pg_temp.aud(), 'batch_size', 2,
    'scheduled_by_name', 'Synthetic Owner', 'test_phones', '[]'::jsonb, 'tests', '[]'::jsonb),
  'and the campaign as it was written and submitted');
select is(
  current_setting('test.reading')::jsonb -> 'behind_campaign_name', 'null'::jsonb,
  'nothing is out ahead of a finished campaign');
select ok(
  current_setting('test.reading') !~ '90000084',
  'the page''s read carries no phone number');

select set_config('test.overview', pg_temp.o($$select public.campaigns_overview()$$)::text, true);
select is(
  (select jsonb_object_agg(c ->> 'name', jsonb_build_array(
            c -> 'state', c -> 'recipients', c -> 'sent', c -> 'sending_batch_no', c -> 'next_batch_no'))
     from jsonb_array_elements(current_setting('test.overview')::jsonb -> 'campaigns') c),
  jsonb_build_object(
    'Diwali offer', jsonb_build_array('done', 5, 1, null, null),
    'Big spenders', jsonb_build_array('scheduled', 1, 0, null, 1),
    'Nobody', jsonb_build_array('draft', 0, 0, null, null)),
  'the list reads every campaign with how far it has got and which batch is next');
select is(
  current_setting('test.overview')::jsonb -> 'sender',
  jsonb_build_object(
    'status', 'idle', 'last_seen_at', now(), 'halt_reason', null, 'linked_number_last4', null,
    'server_now', now(), 'batch_size', 100, 'window_start', '00:00:00', 'window_end', '24:00:00',
    'min_gap_seconds', 45, 'max_gap_seconds', 90),
  'with what the sender last said, the settings, and the database''s own clock to judge it by');
select is(
  (current_setting('test.overview')::jsonb ->> 'stopped_count')::int,
  current_setting('test.seeded')::int + 2,
  'and how many customers are stopped');
select is(
  pg_temp.o(format($$select public.campaign_reading(%L)$$, pg_temp.k(99))),
  null, 'a campaign that does not exist reads as nothing');

-- ---------------------------------------------------------------------------
-- 8a. The laptop's history (owner, 2026-11-21: what has gone, what is to come,
-- on the sender's own page). The one read besides the claim that returns full
-- numbers, by the owner's choice: the sender's page is on the owner's laptop.

-- One test still to go, for the open campaign, and one gone, for the finished one.
insert into public.marketing_campaign_tests
  (campaign_id, phone, body, queued_by, state, claimed_at, sent_at, wa_message_id)
values
  (pg_temp.k(2), '+919000008599', 'Thank you, Asha.', pg_temp.owner(), 'waiting', null, null, null),
  (pg_temp.k(1), '+12135550100', 'Hi Asha, *20% off* this week.', pg_temp.owner(), 'sent',
   now() - interval '1 minute', now() - interval '1 minute', 'wamid.HISTORYTEST');

select set_config('test.history',
  pg_temp.o($$select public.campaign_sender_history()$$)::text, true);

select is(
  current_setting('test.history')::jsonb -> 'tests_waiting',
  jsonb_build_array(jsonb_build_object(
    'campaign_name', 'Big spenders', 'phone', '+919000008599',
    'queued_at', (select to_jsonb(queued_at) from public.marketing_campaign_tests
                   where phone = '+919000008599'))),
  'coming up: a test still to go, with its whole number');
select is(
  (select jsonb_agg(b - 'campaign_id')
     from jsonb_array_elements(current_setting('test.history')::jsonb -> 'batches_ahead') b),
  jsonb_build_array(jsonb_build_object(
    'campaign_name', 'Big spenders', 'campaign_state', 'scheduled', 'batch_no', 1,
    'state', 'waiting', 'recipients', 1, 'to_go', 1)),
  'and every batch not yet done of a campaign still going: none of a finished one, none of a draft');

select bag_eq(
  $$select h ->> 'kind' as kind, h ->> 'campaign_name' as campaign, h ->> 'name' as name,
           h ->> 'phone' as phone, h ->> 'state' as state
      from jsonb_array_elements(current_setting('test.history')::jsonb -> 'sent') h$$,
  $$select 'customer' as kind, 'Diwali offer' as campaign, c.name, c.phone, r.state::text as state
      from public.marketing_campaign_recipients r
      join public.customers c on c.id = r.customer_id
     where r.claimed_at is not null
    union all
    select 'test', 'Diwali offer', null, '+12135550100', 'sent'$$,
  'sent: every message the laptop picked up, customers and tests, each with a whole number and how it ended');
select is(
  (select count(*)::int
     from jsonb_array_elements(current_setting('test.history')::jsonb -> 'sent') h
    where h ->> 'phone' !~ '^\+[1-9][0-9]{7,14}$'),
  0, 'every number in it is whole, country code and all');
select ok(
  (select bool_and(prev is null or (h ->> 'at')::timestamptz <= prev)
     from (select h, lag((h ->> 'at')::timestamptz) over (order by n) as prev
             from jsonb_array_elements(current_setting('test.history')::jsonb -> 'sent')
                  with ordinality as e (h, n)) x),
  'newest first');
select is(
  (select jsonb_build_object('delivered', count(*) filter (where h ->> 'delivered_at' is not null),
                             'read', count(*) filter (where h ->> 'read_at' is not null))
     from jsonb_array_elements(current_setting('test.history')::jsonb -> 'sent') h
    where h ->> 'kind' = 'customer'),
  jsonb_build_object(
    'delivered', (select count(*) from public.marketing_campaign_recipients
                   where claimed_at is not null and delivered_at is not null),
    'read', (select count(*) from public.marketing_campaign_recipients
              where claimed_at is not null and read_at is not null)),
  'with the receipts as they came');
select is(
  jsonb_array_length(pg_temp.o($$select public.campaign_sender_history(2)$$) -> 'sent'),
  2, 'and as many of the newest as asked for');
select pg_temp.refused(
  $$select public.campaign_sender_history(0)$$,
  '22023', 'history_invalid', 'at least one');
select pg_temp.refused(
  $$select public.campaign_sender_history(1001)$$,
  '22023', 'history_invalid', 'and a thousand at most');

delete from public.marketing_campaign_tests where phone in ('+919000008599', '+12135550100');

-- ---------------------------------------------------------------------------
-- 9. Who was sent a campaign, and STOP.

-- Sent means handed to WhatsApp: Asha and Chitra. Bela is unsure and Esha is
-- not on WhatsApp, so neither was sent one. Gauri and the customer with no
-- name are stopped.
select is(
  pg_temp.names(pg_temp.aud('{"campaigns": {"kind": "never"}}')),
  'Bela Das, Esha',
  'never sent a campaign leaves out everybody one was handed to WhatsApp for');
update public.marketing_campaign_recipients
   set sent_at = now() - interval '8 days'
 where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(1);
select is(
  pg_temp.names(pg_temp.aud('{"campaigns": {"kind": "not_within", "days": 7}}')),
  'Asha, Bela Das, Esha',
  'not sent one within 7 days includes a customer sent one 8 days ago');
select is(
  pg_temp.names(pg_temp.aud('{"campaigns": {"kind": "not_within", "days": 8}}')),
  'Bela Das, Esha',
  'and exactly 8 days ago is still within 8 days');

select is(pg_temp.o($$select public.campaign_record_stop('919000008401')$$), 'true'::jsonb,
  'a reply of STOP from a customer who was sent a campaign puts them on the stopped list');
select is(
  (select row(source, campaign_id, recorded_by)::text from public.marketing_stopped
    where customer_id = pg_temp.c(1)),
  row('reply'::public.marketing_stop_source, pg_temp.k(1), null::uuid)::text,
  'as a reply, to the campaign they were last sent');
select is(pg_temp.o($$select public.campaign_record_stop('919000008499')$$), 'true'::jsonb,
  'a customer left unsure may well have got the message, and their STOP counts');
select is(pg_temp.o($$select public.campaign_record_stop('919000008408')$$), 'false'::jsonb,
  'a customer who was sent nothing is not stopped by the word');
select is(pg_temp.o($$select public.campaign_record_stop('919000008404')$$), 'false'::jsonb,
  'nor one who was never in a campaign');
select is(pg_temp.o($$select public.campaign_record_stop('919000009999')$$), 'false'::jsonb,
  'nor a number that is no customer''s');
select is(pg_temp.o($$select public.campaign_record_stop('stop')$$), 'false'::jsonb,
  'nor something that is not a number');
update public.marketing_campaign_recipients
   set sent_at = now() - interval '31 days'
 where campaign_id = pg_temp.k(1) and customer_id = pg_temp.c(3);
select is(pg_temp.o($$select public.campaign_record_stop('919000008403')$$), 'false'::jsonb,
  'nor a customer whose last campaign was more than thirty days ago');
select is(
  (select count(*)::int from public.marketing_stopped
    where customer_id in (pg_temp.c(3), pg_temp.c(4), pg_temp.c(8))),
  0, 'none of those four is on the list');

select is(
  pg_temp.o(format($$select public.campaign_reading(%L)$$, pg_temp.k(1)))
    -> 'campaign' -> 'counts' -> 'stopped',
  '3'::jsonb,
  'a campaign''s stopped figure is who was already stopped at their turn and who replied STOP to it');
select is(
  pg_temp.o(format($$select public.campaign_reading(%L)$$, pg_temp.k(1)))
    -> 'campaign' -> 'counts' -> 'sent',
  '1'::jsonb,
  'and somebody who got the message and then said stop is still counted as sent');

-- The stopped list.
select pg_temp.impersonate(pg_temp.owner());
select is(
  (select count(*)::int from public.marketing_stopped_list()),
  current_setting('test.seeded')::int + 4,
  'the stopped list shows everybody on it');
select is(
  (select to_jsonb(s) - 'stopped_at' from public.marketing_stopped_list() s
    where s.customer_id = pg_temp.c(1)),
  jsonb_build_object(
    'customer_id', pg_temp.c(1), 'name', 'Asha', 'phone_last4', '8401', 'source', 'reply',
    'campaign_name', 'Diwali offer', 'recorded_by_name', null),
  'a reply is shown with the campaign it answered');
select is(
  (select bool_or(to_jsonb(s)::text ~ '90000084') from public.marketing_stopped_list() s),
  false, 'and no row carries a full number');
select pg_temp.as_server();

select pg_temp.run(format($$select public.marketing_stopped_remove(%L)$$, pg_temp.c(1)));
select pg_temp.run(format($$select public.marketing_stopped_remove(%L)$$, pg_temp.c(1)));
select is(
  pg_temp.names(pg_temp.aud()),
  'Asha, Esha, Chitra',
  'a customer taken off the list may be in a later audience again');
select is(
  pg_temp.o(format($$select public.campaign_reading(%L)$$, pg_temp.k(1)))
    -> 'campaign' -> 'counts' -> 'stopped',
  '2'::jsonb,
  'and no longer counts as having stopped that campaign');

select pg_temp.refused(
  $$select * from public.marketing_stopped_add('12345')$$,
  '22023', 'phone_incomplete', 'a number added by hand is a complete one');
select pg_temp.refused(
  $$select * from public.marketing_stopped_add('9000009999')$$,
  'P0002', 'no_such_customer', 'and is somebody the business has served');

-- ---------------------------------------------------------------------------
-- 10. The sender pauses a campaign itself; an owner stops one for good.

select pg_temp.run(format($$select public.release_campaign_batch(%L, 1)$$, pg_temp.k(2)));
select pg_temp.run(format($$select public.pause_campaign(%L, 'three_in_a_row')$$, pg_temp.k(2)));
select is(
  (select row(state, paused_reason)::text from public.marketing_campaigns where id = pg_temp.k(2)),
  row('paused'::public.marketing_campaign_state, 'three_in_a_row')::text,
  'the sender pauses a campaign with the reason the page shows');
select lives_ok(
  format($$select pg_temp.run($q$select public.pause_campaign(%L, 'three_in_a_row')$q$)$$, pg_temp.k(2)),
  'pausing it again as the sender is not an error: it is already what was asked for');
select pg_temp.refused(
  format($$select public.pause_campaign(%L, 'felt_like_it')$$, pg_temp.k(2)),
  '22023', null, 'a reason is one the page knows how to say');
select is(
  pg_temp.claim(pg_temp.k(2), 1),
  '{"kind": "refused", "why": "paused"}'::jsonb,
  'the sender is refused its next recipient while paused');

select pg_temp.run(format($$select public.resume_campaign(%L)$$, pg_temp.k(2)));
select is(
  (select row(state, paused_reason)::text from public.marketing_campaigns where id = pg_temp.k(2)),
  row('scheduled'::public.marketing_campaign_state, null::text)::text,
  'resuming clears the reason');

select pg_temp.run(format($$select public.stop_campaign(%L)$$, pg_temp.k(2)));
select is(
  (select row(state, finished_at)::text from public.marketing_campaigns where id = pg_temp.k(2)),
  row('stopped'::public.marketing_campaign_state, now())::text,
  'an owner stops a campaign');
select is(pg_temp.states(pg_temp.k(2)), 'waiting',
  'its waiting recipients stay as they are, and read as not sent');
select is(
  (select state::text from public.marketing_campaign_batches
    where campaign_id = pg_temp.k(2) and batch_no = 1),
  'done',
  'its released batch is closed, so another campaign''s can be released');
select is(
  pg_temp.claim(pg_temp.k(2), 1),
  '{"kind": "refused", "why": "stopped"}'::jsonb,
  'a stopped campaign hands nobody over');
select pg_temp.refused(
  format($$select public.resume_campaign(%L)$$, pg_temp.k(2)),
  '55000', 'wrong_state', 'and cannot be resumed');
select pg_temp.refused(
  format($$select public.stop_campaign(%L)$$, pg_temp.k(2)),
  '55000', 'wrong_state', 'nor stopped twice');
select lives_ok(
  format($$select pg_temp.run($q$select public.pause_campaign(%L, 'three_in_a_row')$q$)$$, pg_temp.k(2)),
  'a pause from the sender arriving after the stop is not an error');
select is(
  (select state::text from public.marketing_campaigns where id = pg_temp.k(2)),
  'stopped', 'and it stays stopped');
select pg_temp.refused(
  format($$select public.pause_campaign(%L)$$, pg_temp.k(99)),
  'P0002', 'not_found', 'a campaign that does not exist cannot be paused');

select set_config('test.tick', pg_temp.tick()::text, true);
select is(
  (current_setting('test.tick')::jsonb -> 'released',
   current_setting('test.tick')::jsonb -> 'waiting_for_release',
   current_setting('test.tick')::jsonb -> 'campaigns_open')::text,
  ('null'::jsonb, 'null'::jsonb, 'false'::jsonb)::text,
  'with one campaign done and one stopped, nothing is open');

-- ---------------------------------------------------------------------------
-- 11. One sender at a time (design D12).

select is(pg_temp.tick('laptop-b') ->> 'stand_down', 'true',
  'a second installation, while the first was seen in the last ten minutes, is told to stand down');
select is(
  (select installation_id from public.marketing_sender), 'laptop-a',
  'and does not become the sender');

update public.marketing_sender set last_seen_at = now() - interval '11 minutes';
select is(pg_temp.tick('laptop-b') ->> 'stand_down', 'false',
  'once the first has not been seen for ten minutes, the second takes over');
select is(
  (select row(installation_id, last_seen_at)::text from public.marketing_sender),
  row('laptop-b', now())::text, 'and is the sender now');
select is(pg_temp.tick('laptop-a') ->> 'stand_down', 'true',
  'and the first, coming back, is the one told to stand down');

-- A stood-down installation is offered no batch, whatever is released.
select pg_temp.run(format(
  $$select public.save_campaign_draft(%L, 'Third', 'Hello again.', %L)$$,
  pg_temp.k(3), pg_temp.aud()));
select pg_temp.run(format($$select public.schedule_campaign(%L)$$, pg_temp.k(3)));
select is(
  pg_temp.tick('laptop-a') -> 'waiting_for_release', 'null'::jsonb,
  'it is offered no batch to release');
select is(
  pg_temp.tick('laptop-b') -> 'waiting_for_release' ->> 'campaign_name', 'Third',
  'while the sender is');

select pg_temp.refused(
  $$select public.campaign_sender_tick('idle')$$,
  '22023', null, 'a tick says which installation it is');

select pg_temp.run($$select public.campaign_sender_tick('halted', 'logged_out', 'laptop-b', '4721')$$);
select is(
  (select row(status, halt_reason, linked_number_last4)::text from public.marketing_sender),
  row('halted'::public.marketing_sender_status, 'logged_out', '4721')::text,
  'a halt is recorded with its reason, and the linked number''s last four digits');
select pg_temp.run($$select public.campaign_sender_tick('idle', null, 'laptop-b')$$);
select is(
  (select row(status, halt_reason, linked_number_last4)::text from public.marketing_sender),
  row('idle'::public.marketing_sender_status, null::text, '4721')::text,
  'the next tick clears the reason and keeps the digits');
select pg_temp.run($$select public.campaign_sender_tick('not_linked', null, 'laptop-b')$$);
select is(
  (select linked_number_last4 from public.marketing_sender), null,
  'a sender that is not linked has no number');
select pg_temp.refused(
  $$select public.campaign_sender_tick('idle', null, 'laptop-b', '94721')$$,
  '22023', null, 'four digits of the linked number, and never more');

-- ---------------------------------------------------------------------------
-- 12. The owner's settings.

select pg_temp.refused(
  $$select public.update_marketing_sender_settings(0, '10:00', '21:00', 45, 90)$$,
  '22023', 'settings_invalid', 'a batch holds at least one customer');
select pg_temp.refused(
  $$select public.update_marketing_sender_settings(100, '10:00', '21:00', 90, 45)$$,
  '22023', 'settings_invalid', 'the longest gap is not shorter than the shortest');
select pg_temp.refused(
  $$select public.update_marketing_sender_settings(100, '10:00', '10:00', 45, 90)$$,
  '22023', 'settings_invalid', 'a window opens and closes at different times');
select pg_temp.run(
  $$select public.update_marketing_sender_settings(50, '11:00', '20:00', 30, 60)$$);
select is(
  (select row(batch_size, window_start, window_end, min_gap_seconds, max_gap_seconds)::text
     from public.marketing_sender),
  row(50, time '11:00', time '20:00', 30, 60)::text,
  'an owner changes the batch size, the window and the gaps');

select * from finish();
rollback;
