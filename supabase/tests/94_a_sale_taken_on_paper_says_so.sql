-- a-sale-taken-on-paper-says-so (#77): a bill nobody rang names who entered it
-- and nothing it did not have, passes the counter's checks, is recorded once,
-- counts wherever a bill counts, and may be entered only by the outlet's admins.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select * from no_plan();
create function pg_temp.impersonate(p_sub uuid) returns void language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end; $$;
create function pg_temp.unimpersonate() returns void language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
end; $$;

-- ── Fixture ────────────────────────────────────────────────────────────────
-- Kalyani (0001): owner ...0001, its manager ...0002, a biller ...000a, an
-- employee ...0006, its counter tablet ...0004. Kanchrapara (0002): manager
-- ...0003. A paper day two days back at 19:40 Kolkata, inside the 04:00 cutover.
create temp table fx as
select '00000000-0000-4000-a000-000000000001'::uuid as kal,
       '00000000-0000-4000-a000-000000000002'::uuid as kpa,
       (current_date - 2) as day,
       ((current_date - 2)::text || 'T19:40:00+05:30')::timestamptz as at,
       '31000000-0000-4000-a000-000000000001'::uuid as shawarma,
       (select price_paise from public.menu_items
         where id = '31000000-0000-4000-a000-000000000001') as price,
       (select m.id from public.menu_items m
         where m.outlet_id = '00000000-0000-4000-a000-000000000002' and m.is_active
         order by m.sort_order limit 1) as kpa_item;
grant select on fx to authenticated;

create function pg_temp.paper(p_lines jsonb, p_payments jsonb, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('businessDate', fx.day, 'orderedAt', fx.at,
    'lines', p_lines, 'payments', p_payments) || p_extra from fx
$$;
create function pg_temp.two_shawarmas_cash() returns jsonb language sql as $$
  select pg_temp.paper(
    jsonb_build_array(jsonb_build_object('menuItemId', fx.shawarma, 'quantity', 2)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', fx.price * 2)))
  from fx
$$;

-- Figures before, read as postgres where they are definer-only.
create temp table before as
select (public.revenue_figures(fx.kal, fx.day, fx.day, null, false)->>'revenuePaise')::bigint as revenue
  from fx;

-- ── The schema ─────────────────────────────────────────────────────────────
select has_column('public', 'bills', 'entry_source', 'bills say how they were entered');
select has_column('public', 'bills', 'entered_by', 'bills say who entered them');
select col_is_null('public', 'bills', 'counter_device_id', 'a bill may name no tablet');
select col_is_null('public', 'bills', 'biller_profile_id', 'a bill may name no biller');
select is((select count(*) from public.bills where entry_source <> 'counter'), 0::bigint,
  'every bill already recorded is a counter bill');

-- The pairing holds for every writer, postgres included.
select throws_ok($$
  insert into public.bills (id, outlet_id, business_date, subtotal_paise, total_paise,
    payment_method, entry_source, counter_device_id, entered_by, entered_at, entry_payload_hash)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), '04:00'), 10000, 10000, 'cash', 'paper',
    '10000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001', now(), 'x')
$$, '23514', null, 'a paper bill cannot name a tablet');
select throws_ok($$
  insert into public.bills (id, outlet_id, business_date, subtotal_paise, total_paise,
    payment_method, biller_profile_id)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), '04:00'), 10000, 10000, 'cash',
    '10000000-0000-4000-a000-00000000000a')
$$, '23514', null, 'a counter bill must name its tablet');

-- ── Who may record ─────────────────────────────────────────────────────────
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.two_shawarmas_cash()) $$, '42501', null, 'a counter tablet cannot record a paper sale');
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.two_shawarmas_cash()) $$, '42501', null, 'a biller cannot record a paper sale');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.two_shawarmas_cash()) $$, '42501', null, 'an employee cannot record a paper sale');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.two_shawarmas_cash()) $$, '42501', null,
  'a manager cannot record a paper sale at an outlet they do not manage');
select pg_temp.unimpersonate();
set local role anon;
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(),
  '00000000-0000-4000-a000-000000000001', '{}') $$, '42501', null,
  'an anonymous caller cannot record a paper sale');
reset role;

-- A manager for their own outlet.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
create temp table manager_bill as
select '77000000-0000-4000-a000-000000000001'::uuid as id,
       public.record_paper_bill('77000000-0000-4000-a000-000000000001', (select kal from fx),
         pg_temp.two_shawarmas_cash()) as r;
select pg_temp.unimpersonate();
select is((select r->>'status' from manager_bill), 'accepted', 'a manager records a paper sale at their outlet');
select is((select r->>'replayed' from manager_bill), 'false', 'the first recording is not a replay');

-- ── What it is ─────────────────────────────────────────────────────────────
select is((select entry_source from public.bills where id = '77000000-0000-4000-a000-000000000001'),
  'paper', 'the bill is a paper bill');
select is((select entered_by from public.bills where id = '77000000-0000-4000-a000-000000000001'),
  '10000000-0000-4000-a000-000000000002'::uuid, 'it names the manager who entered it');
select ok((select counter_device_id is null and biller_profile_id is null and counter_shift_id is null
                  and entered_at is not null
             from public.bills where id = '77000000-0000-4000-a000-000000000001'),
  'it names no tablet, biller or shift, and says when it was entered');
select is((select bill_number from public.bills where id = '77000000-0000-4000-a000-000000000001'),
  (select (r->>'billNumber')::bigint from manager_bill), 'it takes the outlet''s next bill number');
select ok((select b.total_paise = fx.price * 2 and b.business_date = fx.day and b.ordered_at = fx.at
                  and b.paid_at = fx.at and b.payment_business_date = fx.day
                  and b.payment_method = 'cash' and b.status = 'settled'
             from public.bills b, fx where b.id = '77000000-0000-4000-a000-000000000001'),
  'its total, day, times and tender are the written order''s');
select ok((select i.item_name = 'Classic Chicken Shawarma' and i.quantity = 2
                  and i.unit_price_paise = fx.price and i.category_name is not null
             from public.bill_items i, fx where i.bill_id = '77000000-0000-4000-a000-000000000001'),
  'its line snapshots the dish''s name, price and category from the menu');

-- ── The same written order again ───────────────────────────────────────────
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is((public.record_paper_bill('77000000-0000-4000-a000-000000000001', (select kal from fx),
            pg_temp.two_shawarmas_cash()) ->> 'replayed'), 'true',
  'the same id and content is recognised');
select throws_ok($$ select public.record_paper_bill('77000000-0000-4000-a000-000000000001',
  (select kal from fx), pg_temp.paper(
    jsonb_build_array(jsonb_build_object('menuItemId', (select shawarma from fx), 'quantity', 3)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', (select price * 3 from fx))))) $$,
  '23505', null, 'the same id with different content is refused');
select pg_temp.unimpersonate();
select is((select count(*) from public.bills where id = '77000000-0000-4000-a000-000000000001'),
  1::bigint, 'and nothing was added');
select is((select quantity from public.bill_items where bill_id = '77000000-0000-4000-a000-000000000001'),
  2, 'and the recorded bill is unchanged');

-- ── What is refused ─────────────────────────────────────────────────────────
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.two_shawarmas_cash() || jsonb_build_object('businessDate', current_date + 1,
    'orderedAt', now() + interval '1 day')) $$, '22023', null, 'a future day is refused');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.two_shawarmas_cash() || jsonb_build_object('orderedAt',
    ((select day from fx) - 1)::text || 'T19:40:00+05:30')) $$, '22023', null,
  'a time outside the stated business day is refused');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.paper(jsonb_build_array(jsonb_build_object('menuItemId', (select kpa_item from fx), 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', 10000)))) $$, '22023', null,
  'another outlet''s dish is refused');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.paper(jsonb_build_array(jsonb_build_object('menuItemId', (select shawarma from fx), 'quantity', 2)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', 100)))) $$, '22023', null,
  'payments that do not add up to the total are refused');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.paper(jsonb_build_array(jsonb_build_object('menuItemId', (select shawarma from fx), 'quantity', 1,
      'discountPaise', (select price from fx))),
    '[]'::jsonb)) $$, '22023', null, 'an order given away entirely cannot be a bill');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.two_shawarmas_cash() || '{"discounts": []}'::jsonb) $$, '22023', null,
  'a field a paper bill does not take is refused');
select throws_ok($$ select public.record_paper_bill(gen_random_uuid(), (select kal from fx),
  pg_temp.two_shawarmas_cash() || '{"customerPhone": "12345"}'::jsonb) $$, '22023', null,
  'a phone that is not an Indian mobile is refused');

-- A stated price, a dish given free beside one paid for, a flat discount, and
-- both tenders.
select is((public.record_paper_bill('77000000-0000-4000-a000-000000000002', (select kal from fx),
  pg_temp.paper(jsonb_build_array(
      jsonb_build_object('menuItemId', (select shawarma from fx), 'quantity', 1, 'unitPricePaise', 12000),
      jsonb_build_object('menuItemId', (select shawarma from fx), 'quantity', 1,
        'unitPricePaise', 12000, 'discountPaise', 12000)),
    '[{"method":"cash","amountPaise":5000},{"method":"upi","amountPaise":5000}]'::jsonb,
    '{"discountPaise": 2000}'::jsonb)) ->> 'totalPaise'), '10000',
  'a stated price, a free dish and a flat discount come to the written total');
select pg_temp.unimpersonate();
select ok((select payment_method is null and discount_paise = 14000 and subtotal_paise = 24000
             from public.bills where id = '77000000-0000-4000-a000-000000000002'),
  'a split tender carries no single method, and every discount is counted');
select is((select count(*) from public.bill_items
            where bill_id = '77000000-0000-4000-a000-000000000002' and discount_percent_bp = 10000),
  1::bigint, 'the free dish is a whole-line waiver');

-- ── A closed outlet ─────────────────────────────────────────────────────────
update public.outlets set is_active = false where id = (select kpa from fx);
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is((public.record_paper_bill(gen_random_uuid(), (select kpa from fx),
  pg_temp.paper(jsonb_build_array(jsonb_build_object('menuItemId', (select kpa_item from fx), 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('method', 'upi', 'amountPaise',
      (select price_paise from public.menu_items where id = (select kpa_item from fx)))))) ->> 'status'),
  'accepted', 'the owner records a paper sale at an outlet already marked closed');
select pg_temp.unimpersonate();

-- ── A customer: points, and no receipt ──────────────────────────────────────
update public.outlets
   set points_enabled = true, points_earn_per_block = 5, points_earn_block_paise = 20000,
       points_use_cap_bp = 1000
 where id = (select kal from fx);
insert into public.bill_receipt_delivery_settings (id, enabled, enabled_at)
values (true, true, now() - interval '30 days')
on conflict (id) do update set enabled = true, enabled_at = now() - interval '30 days';

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select public.record_paper_bill('77000000-0000-4000-a000-000000000003', (select kal from fx),
  pg_temp.paper(jsonb_build_array(jsonb_build_object('menuItemId', (select shawarma from fx), 'quantity', 3)),
    jsonb_build_array(jsonb_build_object('method', 'upi', 'amountPaise', (select price * 3 from fx))),
    '{"customerPhone": "98300 12345", "customerName": "Puja Visitor"}'::jsonb));
select pg_temp.unimpersonate();
set constraints all immediate;
select ok((select customer_id is not null and customer_phone = '+919830012345'
             from public.bills where id = '77000000-0000-4000-a000-000000000003'),
  'a phone links the bill to the customer');
select ok((select points > 0 from public.customer_points_entries
            where bill_id = '77000000-0000-4000-a000-000000000003' and kind = 'earned'),
  'the paper bill earns points at its outlet');
select is((select state from public.bill_receipt_deliveries
            where bill_id = '77000000-0000-4000-a000-000000000003'), 'skipped',
  'its receipt is recorded as not sent');
select is((select count(*) from public.bill_receipt_claim(100) c
            where c.bill_id = '77000000-0000-4000-a000-000000000003'), 0::bigint,
  'and is never claimed for sending');

-- ── It counts where a bill counts ──────────────────────────────────────────
select is((public.revenue_figures((select kal from fx), (select day from fx), (select day from fx),
            null, false)->>'revenuePaise')::bigint,
  (select revenue from before) + (select sum(total_paise) from public.bills
     where id in ('77000000-0000-4000-a000-000000000001', '77000000-0000-4000-a000-000000000002',
                  '77000000-0000-4000-a000-000000000003'))::bigint,
  'revenue rises by the paper bills');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select ok((public.drawer_cash_receipts_paise((select kal from fx), (select at from fx) - interval '1 minute',
            (select at from fx) + interval '1 minute')) >= (select price * 2 + 5000 from fx),
  'the drawer counts the paper bills'' cash at their time');
select ok((public.drawer_recent_cash_bills((select kal from fx), now() - interval '1 hour')->'late')
            @> jsonb_build_array(jsonb_build_object('id', '77000000-0000-4000-a000-000000000001')),
  'a paper bill entered after a count is late-arriving work beside it');

-- ── Undo: the ordinary void ────────────────────────────────────────────────
create temp table void_cmd as
select gen_random_uuid() as id,
       jsonb_build_object('billId', '77000000-0000-4000-a000-000000000003',
         'reason', 'Entered from the wrong sheet') as payload;
select is((public.void_billing_bill((select id from void_cmd), 4,
            public.billing_payload_hash((select payload from void_cmd)), now(), null,
            (select payload from void_cmd))->>'status'), 'accepted',
  'the owner voids a paper bill as any bill');
select pg_temp.unimpersonate();
set constraints all immediate;
select is((select coalesce(sum(points), 0) from public.customer_points_entries
            where bill_id = '77000000-0000-4000-a000-000000000003'), 0::bigint,
  'and its points are reversed');

select * from finish();
rollback;
