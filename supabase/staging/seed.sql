-- Staging's synthetic history (a-release-can-be-switched-off, design D19).
--
-- Run only through `scripts/seed-staging.mjs`, which refuses production's
-- project, writes the password and counts into the three `{{…}}` places below,
-- and sends the file to `supabase db query`. That takes exactly one statement,
-- so the whole seed is one `do` block of nested blocks. Never by
-- `supabase db reset`: this is not `supabase/seed.sql`, and nothing here is real.
--
-- Two outlets. *Test Cafe* is the owner's fake outlet: a test account for every
-- role, a generated menu of production's shape, and a trading history sized to
-- production's row counts — because the reads that froze the counter on
-- 12 October cost what they cost because of how many rows sit behind them. Its
-- tablets are the ones the owner sets up. *Smoke tests* belongs to the smoke
-- suite that ends every Staging run: its own manager and biller and a small menu,
-- so the suite's orders, shifts and tablets never touch Test Cafe.
-- Every order is rung, prepared and paid through the counter's own commands, as
-- the counter tablet, against that day's shift: the same function, payload hash and guards the app uses, so
-- every derived row (the order, its lines, the payment, the command, the public
-- link) is the one the app itself would have written. No production row is
-- copied; names are generated, phone numbers come from a range no Indian mobile
-- uses, and amounts are integer paise.
--
-- Production's row counts, read 2026-10-12 as counts only (pg_stat_user_tables):
-- bills 3,009; order and bill lines about 4,450; payments 3,140; customers 446;
-- expenses 353; attendance days 246; menu items 132 in 17 categories; 7 people.

do $seed$
declare
  c_password constant text := {{seed.password}};
  c_days constant integer := {{seed.days}};
  c_bills constant integer := {{seed.bills}};
  -- `--if-empty`: only what is missing is seeded, and what is there is left as
  -- it is, rather than refused. The Staging workflow seeds this way on every
  -- push, so the first push fills an empty project and every later one changes
  -- nothing unless this file has grown a part staging does not hold yet.
  c_if_empty constant boolean := {{seed.if_empty}};
  v_cafe constant boolean := exists (select 1 from public.outlets where code = 'test-cafe');
  v_smoke constant boolean := exists (select 1 from public.outlets where code = 'smoke-tests');
begin
  -- ── Refuse to run without the runner, or twice ─────────────────────────────

  if (v_cafe or v_smoke) and not c_if_empty then
    raise exception 'Staging is already seeded. Run the Staging reset workflow to start over.';
  end if;

  <<cafe>>
  begin
  if v_cafe then
    raise notice 'Staging already holds Test Cafe; leaving it as it is.';
    exit cafe;
  end if;

  -- ── The outlet ──────────────────────────────────────────────────────────────

  insert into public.outlets
    (id, code, name, location_label, address_line1, city, district, pincode, phone,
     latitude, longitude, geofence_radius_m, business_day_cutover, arrival_deadline, menu_slug)
  values
    ('5a000000-0000-4000-a000-000000000001', 'test-cafe', 'Test Cafe',
     'Staging — not a real outlet', 'Synthetic Road', 'Kalyani', 'Nadia', '741235',
     '+91 90000 00000', 22.9750, 88.4345, 150, time '04:00', time '13:00', 'test-cafe');

  -- ── Accounts: one per role, and the tablet the history is rung on ───────────
  -- Usernames are the part before `@login.shawarmania.invalid`; every password is
  -- the one the runner was given, which lives in the staging environments and
  -- nowhere in this repository.

  declare
    persona record;
  begin
    for persona in
      select * from (values
        ('5a000000-0000-4000-a000-000000000011'::uuid, 'staging.owner'),
        ('5a000000-0000-4000-a000-000000000012'::uuid, 'staging.manager'),
        ('5a000000-0000-4000-a000-000000000013'::uuid, 'staging.biller'),
        ('5a000000-0000-4000-a000-000000000014'::uuid, 'staging.staff'),
        ('5a000000-0000-4000-a000-000000000015'::uuid, 'staging.griller'),
        ('5a000000-0000-4000-a000-000000000016'::uuid, 'staging.prep'),
        ('5a000000-0000-4000-a000-000000000021'::uuid, 'staging.counter')
      ) as p (id, username)
    loop
      insert into auth.users
        (instance_id, id, aud, role, email, email_confirmed_at, encrypted_password,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change_token_new,
         email_change_token_current, email_change, phone_change,
         phone_change_token, reauthentication_token, is_sso_user)
      values
        ('00000000-0000-0000-0000-000000000000', persona.id, 'authenticated', 'authenticated',
         persona.username || '@login.shawarmania.invalid', now(),
         extensions.crypt(c_password, extensions.gen_salt('bf')),
         '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
         now(), now(), '', '', '', '', '', '', '', '', false);
      insert into auth.identities
        (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        (persona.id::text, persona.id,
         jsonb_build_object('sub', persona.id::text,
           'email', persona.username || '@login.shawarmania.invalid', 'email_verified', true),
         'email', now(), now(), now());
    end loop;
  end;

  insert into public.profiles (id, full_name, phone, is_active, role_title)
  values
    ('5a000000-0000-4000-a000-000000000011', 'Staging Owner (test)',   '919000000011', true, null),
    ('5a000000-0000-4000-a000-000000000012', 'Staging Manager (test)', '919000000012', true, 'Manager'),
    ('5a000000-0000-4000-a000-000000000013', 'Staging Biller (test)',  '919000000013', true, null),
    ('5a000000-0000-4000-a000-000000000014', 'Staging Staff (test)',   '919000000014', true, 'Counter staff'),
    ('5a000000-0000-4000-a000-000000000015', 'Staging Griller (test)', '919000000015', true, 'Grill'),
    ('5a000000-0000-4000-a000-000000000016', 'Staging Prep (test)',    '919000000016', true, 'Prep');

  -- The owner's private email and assignment in one transaction: the deferred
  -- invariant refuses either without the other.
  begin
    insert into public.account_emails (profile_id, email)
    values ('5a000000-0000-4000-a000-000000000011', 'staging.owner@example.com');
    insert into public.assignments (person_id, role, outlet_id, started_on)
    values ('5a000000-0000-4000-a000-000000000011', 'super_admin', null, current_date - 120);
  end;

  insert into public.assignments (person_id, role, outlet_id, started_on)
  values
    ('5a000000-0000-4000-a000-000000000012', 'franchise_admin', '5a000000-0000-4000-a000-000000000001', current_date - 120),
    ('5a000000-0000-4000-a000-000000000013', 'biller',          '5a000000-0000-4000-a000-000000000001', current_date - 120),
    ('5a000000-0000-4000-a000-000000000014', 'employee',        '5a000000-0000-4000-a000-000000000001', current_date - 120),
    ('5a000000-0000-4000-a000-000000000015', 'employee',        '5a000000-0000-4000-a000-000000000001', current_date - 120),
    ('5a000000-0000-4000-a000-000000000016', 'employee',        '5a000000-0000-4000-a000-000000000001', current_date - 120);

  -- A tablet is a machine principal: an auth user and a device row, no profile.
  -- This one rings the history below and is then removed, keeping its rows, so
  -- Test Cafe's Tablets list holds only what the owner sets up.
  insert into public.counter_devices
    (id, outlet_id, label, set_up_by, set_up_at, last_seen_at, last_reported_unsent,
     session_proven_at, kind)
  values
    ('5a000000-0000-4000-a000-000000000021', '5a000000-0000-4000-a000-000000000001',
     'Test Cafe counter', '5a000000-0000-4000-a000-000000000012',
     now() - interval '120 days', now(), 0, now() - interval '120 days', 'counter');

  -- ── A menu of production's shape: 17 categories, 132 items ──────────────────

  insert into public.menu_categories (id, outlet_id, name, sort_order)
  select ('5a000000-0000-4000-a001-' || lpad(n::text, 12, '0'))::uuid,
         '5a000000-0000-4000-a000-000000000001',
         (array['Shawarmas', 'Rolls', 'Burgers', 'Sandwiches', 'Platters', 'Bowls',
                'Wraps', 'Fries', 'Appetizers', 'Salads', 'Dips', 'Combos', 'Kids',
                'Desserts', 'Shakes', 'Coolers', 'Hot drinks'])[n],
         n
    from generate_series(1, 17) as n;

  insert into public.menu_items
    (id, outlet_id, category_id, name, price_paise, is_veg, is_available, sort_order)
  select ('5a000000-0000-4000-a002-' || lpad(n::text, 12, '0'))::uuid,
         '5a000000-0000-4000-a000-000000000001',
         ('5a000000-0000-4000-a001-' || lpad((((n - 1) % 17) + 1)::text, 12, '0'))::uuid,
         'Test dish ' || n,
         -- ₹79 to ₹349 in steps of ₹10: integer paise, never a float.
         (7900 + ((n * 37) % 28) * 1000),
         n % 4 = 0, true, n
    from generate_series(1, 132) as n;

  -- ── Customers: production's count, from a range no Indian mobile uses ───────

  insert into public.customers (id, phone, name, created_at, last_used_at)
  select ('5a000000-0000-4000-a003-' || lpad(n::text, 12, '0'))::uuid,
         '+91900001' || lpad(n::text, 4, '0'),
         'Test Customer ' || n,
         now() - make_interval(days => 90 - (n % 90)),
         now() - make_interval(days => n % 30)
    from generate_series(1, 446) as n;

  -- ── The trading history, rung through the counter's own command ─────────────
  -- One shift a day for the counter tablet, held by the test Biller and ended at
  -- close; then that day's orders, as the tablet, rung between 11:30 and 23:00,
  -- each prepared and paid. About one bill in three has a second line and one in twelve
  -- a third; one payment in twenty-five is split between cash and UPI.

  declare
    c_outlet constant uuid := '5a000000-0000-4000-a000-000000000001';
    c_counter constant uuid := '5a000000-0000-4000-a000-000000000021';
    c_biller constant uuid := '5a000000-0000-4000-a000-000000000013';
    v_days integer := c_days;
    v_bills integer := c_bills;
    v_item_ids uuid[];
    v_item_names text[];
    v_item_prices integer[];
    v_today date := public.app_business_date(now(), time '04:00');
    v_day date;
    v_shift uuid;
    v_count integer;
    v_line_count integer;
    v_lines jsonb;
    v_pick integer;
    v_quantity integer;
    v_subtotal integer;
    v_payments jsonb;
    v_cash integer;
    v_payload jsonb;
    v_order uuid;
    v_at timestamptz;
    v_result jsonb;
  begin
    select array_agg(id order by sort_order), array_agg(name order by sort_order),
           array_agg(price_paise order by sort_order)
      into v_item_ids, v_item_names, v_item_prices
      from public.menu_items where outlet_id = c_outlet;

    perform setseed(0.75);

    for d in reverse v_days..1 loop
      v_day := v_today - d;

      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      v_shift := gen_random_uuid();
      insert into public.counter_shifts
        (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at,
         ended_at, ended_reason)
      values
        (v_shift, c_counter, c_outlet, c_biller,
         (v_day + time '11:00') at time zone 'Asia/Kolkata', v_day,
         (v_day + 1 + time '04:00') at time zone 'Asia/Kolkata',
         (v_day + time '23:30') at time zone 'Asia/Kolkata', 'operator');

      -- As the tablet, exactly as PostgREST would run its request.
      perform set_config('request.jwt.claims',
        json_build_object('sub', c_counter, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      v_count := v_bills / v_days + case when d <= v_bills % v_days then 1 else 0 end;
      for i in 1..v_count loop
        v_line_count := 1 + (random() < 0.33)::integer + (random() < 0.08)::integer;
        v_lines := '[]'::jsonb;
        v_subtotal := 0;
        for l in 1..v_line_count loop
          v_pick := 1 + floor(random() * array_length(v_item_ids, 1))::integer;
          v_quantity := 1 + (random() < 0.15)::integer;
          v_lines := v_lines || jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid(),
            'menuItemId', v_item_ids[v_pick],
            'itemName', v_item_names[v_pick],
            'unitPricePaise', v_item_prices[v_pick],
            'quantity', v_quantity,
            'lineTotalPaise', v_item_prices[v_pick] * v_quantity));
          v_subtotal := v_subtotal + v_item_prices[v_pick] * v_quantity;
        end loop;

        if random() < 0.04 then
          v_cash := (v_subtotal / 2 / 100) * 100;
          v_payments := jsonb_build_array(
            jsonb_build_object('method', 'cash', 'amountPaise', v_cash),
            jsonb_build_object('method', 'upi', 'amountPaise', v_subtotal - v_cash));
        else
          v_payments := jsonb_build_array(jsonb_build_object(
            'method', case when random() < 0.45 then 'cash' else 'upi' end,
            'amountPaise', v_subtotal));
        end if;

        v_order := gen_random_uuid();
        v_at := (v_day + time '11:30') at time zone 'Asia/Kolkata'
                + make_interval(secs => (i * 41400.0 / (v_count + 1)));

        -- Rung, prepared six minutes later, paid two minutes after that: the
        -- counter's order path, so every order and its lines exist as they do
        -- in production, where nearly every bill was an order first.
        v_payload := jsonb_build_object(
          'orderId', v_order,
          'businessDate', v_day,
          'customerId', null, 'customerName', null, 'customerPhone', null,
          'subtotalPaise', v_subtotal, 'discountPaise', 0, 'taxPaise', 0,
          'totalPaise', v_subtotal, 'pricingMode', 'no_tax',
          'lines', v_lines);
        v_result := public.create_billing_order(
          gen_random_uuid(), 1, public.billing_payload_hash(v_payload), v_at, v_shift, v_payload);
        if v_result ->> 'status' <> 'accepted' then
          raise exception 'create_billing_order refused order % of % on %: %', i, v_count, v_day, v_result;
        end if;

        v_payload := jsonb_build_object('orderId', v_order, 'prepared', true);
        v_result := public.prepare_billing_order(
          gen_random_uuid(), 1, public.billing_payload_hash(v_payload),
          v_at + interval '6 minutes', v_shift, v_payload);
        if v_result ->> 'status' <> 'accepted' then
          raise exception 'prepare_billing_order refused order % of % on %: %', i, v_count, v_day, v_result;
        end if;

        v_payload := jsonb_build_object(
          'billId', gen_random_uuid(),
          'orderId', v_order,
          'payments', v_payments,
          'paidAt', v_at + interval '8 minutes',
          'paymentBusinessDate', v_day);
        v_result := public.pay_billing_order(
          gen_random_uuid(), 1, public.billing_payload_hash(v_payload),
          v_at + interval '8 minutes', v_shift, v_payload);
        if v_result ->> 'status' <> 'accepted' then
          raise exception 'pay_billing_order refused order % of % on %: %', i, v_count, v_day, v_result;
        end if;
      end loop;
    end loop;

    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
  end;

  -- ── Expenses and attendance, written as the managers' surfaces write them ───

  insert into public.expenses
    (outlet_id, business_date, category, description, amount_paise, is_cash, recorded_by)
  select '5a000000-0000-4000-a000-000000000001',
         public.app_business_date(now(), time '04:00') - (1 + n % c_days),
         (array['Chicken', 'Vegetables', 'Packaging', 'Gas', 'Staff wages', 'Electricity', 'Cleaning'])[1 + n % 7],
         'Synthetic expense ' || n,
         (500 + (n * 53) % 4500) * 100,
         n % 3 <> 0,
         '5a000000-0000-4000-a000-000000000012'
    from generate_series(1, 353) as n;

  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_lat, check_in_lng,
     check_in_accuracy_m, check_in_source, approved_by, approval_reason, approved_at,
     approver_lat, approver_lng, approver_accuracy_m)
  select '5a000000-0000-4000-a000-000000000001', p.person, day, 'present',
         (day + time '10:00' + make_interval(mins => (p.n * 7 + extract(doy from day)::integer) % 50))
           at time zone 'Asia/Kolkata',
         22.97505, 88.43460, 18, 'phone',
         '5a000000-0000-4000-a000-000000000012', null,
         (day + time '11:00') at time zone 'Asia/Kolkata',
         22.97498, 88.43448, 12
    from (values
            (1, '5a000000-0000-4000-a000-000000000014'::uuid),
            (2, '5a000000-0000-4000-a000-000000000015'::uuid),
            (3, '5a000000-0000-4000-a000-000000000016'::uuid)) as p (n, person)
   cross join generate_series(
           public.app_business_date(now(), time '04:00') - 82,
           public.app_business_date(now(), time '04:00') - 1,
           interval '1 day') as g (d)
   cross join lateral (select g.d::date as day) as dd;
  end cafe;

  -- ── Smoke tests: the smoke suite's own outlet ───────────────────────────────
  -- Every Staging run ends with the smoke suite setting up a counter and a
  -- kitchen tablet, opening a shift on each, ringing, acknowledging and paying
  -- one order, then leaving both shifts and removing both tablets. It does it
  -- all here, as this outlet's own manager and biller, so nothing it writes or
  -- ends is the owner's. Nothing is pruned: a run leaves about one bill and a few
  -- small rows behind, around 20 kB, against the 39 MB staging held and the Free
  -- plan's 500 MB when this was measured on 13 October.

  <<smoke>>
  begin
    if v_smoke then
      exit smoke;
    end if;

    insert into public.outlets
      (id, code, name, location_label, address_line1, city, district, pincode, phone,
       latitude, longitude, geofence_radius_m, business_day_cutover, arrival_deadline, menu_slug)
    values
      ('5a000000-0000-4000-a000-000000000002', 'smoke-tests', 'Smoke tests',
       'Staging — the automatic smoke suite', 'Synthetic Road', 'Kalyani', 'Nadia', '741235',
       '+91 90000 00001', 22.9750, 88.4345, 150, time '04:00', time '13:00', 'smoke-tests');

    declare
      persona record;
    begin
      for persona in
        select * from (values
          ('5a000000-0000-4000-a000-000000000031'::uuid, 'staging.smoke.manager'),
          ('5a000000-0000-4000-a000-000000000032'::uuid, 'staging.smoke.biller')
        ) as p (id, username)
      loop
        insert into auth.users
          (instance_id, id, aud, role, email, email_confirmed_at, encrypted_password,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           confirmation_token, recovery_token, email_change_token_new,
           email_change_token_current, email_change, phone_change,
           phone_change_token, reauthentication_token, is_sso_user)
        values
          ('00000000-0000-0000-0000-000000000000', persona.id, 'authenticated', 'authenticated',
           persona.username || '@login.shawarmania.invalid', now(),
           extensions.crypt(c_password, extensions.gen_salt('bf')),
           '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
           now(), now(), '', '', '', '', '', '', '', '', false);
        insert into auth.identities
          (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values
          (persona.id::text, persona.id,
           jsonb_build_object('sub', persona.id::text,
             'email', persona.username || '@login.shawarmania.invalid', 'email_verified', true),
           'email', now(), now(), now());
      end loop;
    end;

    insert into public.profiles (id, full_name, phone, is_active, role_title)
    values
      ('5a000000-0000-4000-a000-000000000031', 'Smoke Manager (test)', '919000000031', true, 'Manager'),
      ('5a000000-0000-4000-a000-000000000032', 'Smoke Biller (test)',  '919000000032', true, null);

    insert into public.assignments (person_id, role, outlet_id, started_on)
    values
      ('5a000000-0000-4000-a000-000000000031', 'franchise_admin', '5a000000-0000-4000-a000-000000000002', current_date - 120),
      ('5a000000-0000-4000-a000-000000000032', 'biller',          '5a000000-0000-4000-a000-000000000002', current_date - 120);

    insert into public.menu_categories (id, outlet_id, name, sort_order)
    values ('5a000000-0000-4000-a011-000000000001', '5a000000-0000-4000-a000-000000000002', 'Smoke', 1);

    insert into public.menu_items
      (id, outlet_id, category_id, name, price_paise, is_veg, is_available, sort_order)
    select ('5a000000-0000-4000-a012-' || lpad(n::text, 12, '0'))::uuid,
           '5a000000-0000-4000-a000-000000000002',
           '5a000000-0000-4000-a011-000000000001',
           'Smoke dish ' || n,
           (9900 + n * 1000),
           n = 3, true, n
      from generate_series(1, 3) as n;
  end smoke;

  -- ── Tablets the smoke suite no longer signs in as ───────────────────────────
  -- Earlier seeds left Test Cafe a counter and a kitchen tablet for the suite.
  -- Retire them wherever they still stand, as an owner removing them would:
  -- removal keeps a tablet's rows, so Test Cafe's history is untouched.

  perform public.remove_counter_device(d.id, '5a000000-0000-4000-a000-000000000011')
     from public.counter_devices d
    where d.id in ('5a000000-0000-4000-a000-000000000021', '5a000000-0000-4000-a000-000000000022')
      and d.removed_at is null;

  raise notice '%', 'Staging holds Test Cafe with ' ||
         (select count(*) from public.bills where outlet_id = '5a000000-0000-4000-a000-000000000001') ||
         ' bills, ' ||
         (select count(*) from public.bill_items bi join public.bills b on b.id = bi.bill_id
           where b.outlet_id = '5a000000-0000-4000-a000-000000000001') ||
         ' lines and ' ||
         (select count(*) from public.bill_payments where outlet_id = '5a000000-0000-4000-a000-000000000001') ||
         ' payments, and Smoke tests with ' ||
         (select count(*) from public.bills where outlet_id = '5a000000-0000-4000-a000-000000000002') ||
         ' bills.';
end;
$seed$;
