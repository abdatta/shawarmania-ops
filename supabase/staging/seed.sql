-- Staging's synthetic history (a-release-can-be-switched-off, design D19).
--
-- Run only through `scripts/seed-staging.mjs`, which refuses production's
-- project, writes the password and counts into the three `{{…}}` places below,
-- and sends the file to `supabase db query`. That takes exactly one statement,
-- so the whole seed is one `do` block of nested blocks. Never by
-- `supabase db reset`: this is not `supabase/seed.sql`, and nothing here is real.
--
-- Two outlets. *Cafe Staging* is the owner's fake outlet: a test account for every
-- role, Kalyani Cafe's real menu, and a trading history sized to production's row
-- counts — because the reads that froze the counter on 12 October cost what they
-- cost because of how many rows sit behind them. Its tablets are the ones the
-- owner sets up. *Smoke tests* belongs to the smoke
-- suite that ends every Staging run: its own manager and biller and a small menu,
-- so the suite's orders, shifts and tablets never touch Cafe Staging.
-- Every order is rung, prepared and paid through the counter's own commands, as
-- the counter tablet, against that day's shift: the same function, payload hash and guards the app uses, so
-- every derived row (the order, its lines, the payment, the command, the public
-- link) is the one the app itself would have written. The menu is the one
-- production row set copied, at the owner's request (2026-10-13): Kalyani Cafe's
-- menu as production held it that day, names, descriptions, prices, veg marks and
-- what was switched off — public business facts the storefront already shows, and
-- nothing about a person. Everything about people is invented: names are made up,
-- phone numbers come from a range no Indian mobile uses, and amounts are integer
-- paise.
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
  v_cafe constant boolean := exists (select 1 from public.outlets where code = 'cafe-staging');
  v_smoke constant boolean := exists (select 1 from public.outlets where code = 'smoke-tests');
begin
  -- ── Refuse to run without the runner, or twice ─────────────────────────────

  if (v_cafe or v_smoke) and not c_if_empty then
    raise exception 'Staging is already seeded. Run the Staging reset workflow to start over.';
  end if;

  <<cafe>>
  begin
  if v_cafe then
    raise notice 'Staging already holds Cafe Staging; leaving it as it is.';
    exit cafe;
  end if;

  -- ── The outlet ──────────────────────────────────────────────────────────────

  insert into public.outlets
    (id, code, name, location_label, address_line1, city, district, pincode, phone,
     latitude, longitude, geofence_radius_m, business_day_cutover, arrival_deadline, menu_slug)
  values
    ('5a000000-0000-4000-a000-000000000001', 'cafe-staging', 'Cafe Staging',
     'Staging — not a real outlet', 'Synthetic Road', 'Kalyani', 'Nadia', '741235',
     '+91 90000 00000', 22.9750, 88.4345, 150, time '04:00', time '13:00', 'cafe-staging');

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
    -- Invented names: realistic on every screen, and nobody's.
    ('5a000000-0000-4000-a000-000000000011', 'Staging Owner', '919000000011', true, null),
    ('5a000000-0000-4000-a000-000000000012', 'Rohit Saha',    '919000000012', true, 'Manager'),
    ('5a000000-0000-4000-a000-000000000013', 'Priya Ghosh',   '919000000013', true, null),
    ('5a000000-0000-4000-a000-000000000014', 'Sourav Paul',   '919000000014', true, 'Counter staff'),
    ('5a000000-0000-4000-a000-000000000015', 'Bikash Mondal', '919000000015', true, 'Grill'),
    ('5a000000-0000-4000-a000-000000000016', 'Ankita Roy',    '919000000016', true, 'Prep');

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
  -- Cafe Staging's Tablets list holds only what the owner sets up.
  insert into public.counter_devices
    (id, outlet_id, label, set_up_by, set_up_at, last_seen_at, last_reported_unsent,
     session_proven_at, kind)
  values
    ('5a000000-0000-4000-a000-000000000021', '5a000000-0000-4000-a000-000000000001',
     'Cafe Staging counter', '5a000000-0000-4000-a000-000000000012',
     now() - interval '120 days', now(), 0, now() - interval '120 days', 'counter');

  -- ── Kalyani Cafe's menu, as production held it on 13 October ──────────────
  -- Copied at the owner's request; see the header. Regenerate it by reading the
  -- live outlet's categories and items read-only and writing them out here.

  declare
    c_cafe constant uuid := '5a000000-0000-4000-a000-000000000001';
  begin
    insert into public.menu_categories (id, outlet_id, name, sort_order, is_active)
    values
      ('5a000000-0000-4000-a001-000000000001', c_cafe, 'Shawarmas', 1, true),
      ('5a000000-0000-4000-a001-000000000002', c_cafe, 'Burgers', 2, true),
      ('5a000000-0000-4000-a001-000000000003', c_cafe, 'Main Course', 3, true),
      ('5a000000-0000-4000-a001-000000000004', c_cafe, 'Sandwiches', 4, true),
      ('5a000000-0000-4000-a001-000000000005', c_cafe, 'Appetizers', 5, true),
      ('5a000000-0000-4000-a001-000000000006', c_cafe, 'Arabian Favourites', 6, false),
      ('5a000000-0000-4000-a001-000000000007', c_cafe, 'Desserts', 7, true),
      ('5a000000-0000-4000-a001-000000000008', c_cafe, 'Tea & Coffee', 8, true),
      ('5a000000-0000-4000-a001-000000000009', c_cafe, 'Mocktails', 9, true),
      ('5a000000-0000-4000-a001-000000000010', c_cafe, 'Water', 10, true),
      ('5a000000-0000-4000-a001-000000000011', c_cafe, 'Add On', 11, true);

    insert into public.menu_items
      (id, outlet_id, category_id, name, description, price_paise, is_veg, is_available, sort_order, is_active)
    values
      ('5a000000-0000-4000-a002-000000000001', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Peri Peri Chicken Shawarma', 'Our signature chicken shawarma with a fiery peri peri finish in crispy saaj bread.',
       14500, false, true, 1, true),
      ('5a000000-0000-4000-a002-000000000002', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Mayonnaise Chicken Shawarma', 'Creamy, indulgent & subtly sweet with our signature chicken filling.',
       15500, false, true, 2, true),
      ('5a000000-0000-4000-a002-000000000003', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Double Chicken Shawarma', 'Twice the chicken. Twice the indulgence. Made for serious cravings.',
       17500, false, true, 3, true),
      ('5a000000-0000-4000-a002-000000000004', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Cheese Chicken Shawarma', 'Our signature chicken shawarma finished with a generous mozzarella melt.',
       17500, false, true, 4, true),
      ('5a000000-0000-4000-a002-000000000005', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Lebanese Chicken Shawarma', 'Tender chicken paired with silky hummus & tahini for a Lebanese touch.',
       22000, false, true, 5, true),
      ('5a000000-0000-4000-a002-000000000006', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Taco Chicken Shawarma', 'A bold meeting of Mexican taco flavours and our signature shawarma.',
       22000, false, true, 6, true),
      ('5a000000-0000-4000-a002-000000000007', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Chicken Shawarma Salad', 'Juicy shawarma chicken over crisp greens for a lighter, protein-packed plate.',
       22000, false, true, 7, true),
      ('5a000000-0000-4000-a002-000000000008', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Shawarmania Mutton Shawarma', 'Succulent mutton, bold spices & signature flavours in every bite.',
       25000, false, true, 8, true),
      ('5a000000-0000-4000-a002-000000000009', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Classic Chicken Shawarma', null,
       13500, false, true, 9, true),
      ('5a000000-0000-4000-a002-000000000010', c_cafe, '5a000000-0000-4000-a001-000000000001',
       'Paneer Shawarma', null,
       15000, true, true, 10, true),
      ('5a000000-0000-4000-a002-000000000011', c_cafe, '5a000000-0000-4000-a001-000000000002',
       'Smashed Mutton Burger', 'Hand-smashed mutton, aromatic spices & signature sauce in a buttery brioche with fries.',
       35000, false, true, 1, true),
      ('5a000000-0000-4000-a002-000000000012', c_cafe, '5a000000-0000-4000-a001-000000000002',
       'Messy Chicken Burger', 'Smashed chicken, fresh crunch & a lavish pour of house cheese sauce. Will make your hands messy with fries.',
       32000, false, true, 2, true),
      ('5a000000-0000-4000-a002-000000000013', c_cafe, '5a000000-0000-4000-a001-000000000002',
       'Nashville Chicken Burger', 'Crispy chicken glazed in fiery Nashville sauce, tucked into buttery brioche with fries.',
       27000, false, true, 3, true),
      ('5a000000-0000-4000-a002-000000000014', c_cafe, '5a000000-0000-4000-a001-000000000002',
       'Smashed Chicken Burger', 'Crispy-edged smashed chicken, fresh vegetables & our signature house sauces with fries.',
       25000, false, true, 4, true),
      ('5a000000-0000-4000-a002-000000000015', c_cafe, '5a000000-0000-4000-a001-000000000002',
       'Smashed Veg Burger', null,
       20000, true, true, 5, true),
      ('5a000000-0000-4000-a002-000000000016', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Mutton Chapli Kebab', 'Silken Awadhi mutton kebabs that melt effortlessly, served with paratha & gravy.',
       45000, false, true, 1, true),
      ('5a000000-0000-4000-a002-000000000017', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Chicken Steak', 'Succulent chicken breast with herb rice, silky mash, sautéed vegetables & house gravy.',
       40000, false, true, 2, true),
      ('5a000000-0000-4000-a002-000000000018', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Paneer Steak', 'Spiced paneer paired with herb rice, creamy mash, vegetables & house gravy.',
       40000, true, true, 3, true),
      ('5a000000-0000-4000-a002-000000000019', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Lemon Butter Garlic Fish', 'Grilled Vetki Fish with lemon butter sauce and herb rice',
       40000, false, true, 4, true),
      ('5a000000-0000-4000-a002-000000000020', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Fish & Chips', 'Golden battered fish with crisp, chunky potato wedges.',
       35000, false, true, 5, true),
      ('5a000000-0000-4000-a002-000000000021', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Chicken À la Kiev', 'Crisp chicken revealing a rich garlic-herb butter centre, served with herb rice  & vegetables.',
       35000, false, true, 6, true),
      ('5a000000-0000-4000-a002-000000000022', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Omelette Rice', 'A fluffy double omelette over herb rice with savoury curry.',
       20000, false, false, 7, false),
      ('5a000000-0000-4000-a002-000000000023', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Chicken Katsu Rice', 'Golden chicken katsu over fragrant herb rice with savoury curry.',
       28000, false, true, 7, true),
      ('5a000000-0000-4000-a002-000000000024', c_cafe, '5a000000-0000-4000-a001-000000000003',
       'Sauted Mushroom Rice', 'Mushroom Sauted over herb rice and savory curry along with veggies.',
       18000, true, true, 8, true),
      ('5a000000-0000-4000-a002-000000000025', c_cafe, '5a000000-0000-4000-a001-000000000004',
       'Avocado Mushroom Sandwich', 'Creamy avocado, sautéed mushrooms & house sauce layered on toasted brown bread along with fries.',
       30000, true, true, 1, true),
      ('5a000000-0000-4000-a002-000000000026', c_cafe, '5a000000-0000-4000-a001-000000000004',
       'Tuna Sandwich', 'Tuna, sweet corn & creamy textures between beautifully toasted bread along with fries.',
       30000, false, false, 2, false),
      ('5a000000-0000-4000-a002-000000000027', c_cafe, '5a000000-0000-4000-a001-000000000004',
       'Chicken & Cheese Sandwich', 'Tender chicken and molten cheese layered between golden toasted bread along with fries.',
       25000, false, true, 3, true),
      ('5a000000-0000-4000-a002-000000000028', c_cafe, '5a000000-0000-4000-a001-000000000004',
       'Spinach & Cheese Sandwich', 'Creamy spinach, sweet corn & cheese in perfectly toasted bread along with fries.',
       20000, true, false, 4, false),
      ('5a000000-0000-4000-a002-000000000029', c_cafe, '5a000000-0000-4000-a001-000000000005',
       'Fish Fry (Vetki)', 'Spiced Vetki, fried golden and served with classic mustard sauce.',
       30000, false, false, 1, false),
      ('5a000000-0000-4000-a002-000000000030', c_cafe, '5a000000-0000-4000-a001-000000000005',
       'Cilantro Fish Sticks', 'Crispy fish with fragrant cilantro, wrapped in a golden crumb. (4 pieces)',
       24000, false, true, 2, true),
      ('5a000000-0000-4000-a002-000000000031', c_cafe, '5a000000-0000-4000-a001-000000000005',
       'Nashville Chicken Wings', 'Crispy wings lacquered in our fiery Nashville house sauce. (4 pieces)',
       27000, false, true, 3, true),
      ('5a000000-0000-4000-a002-000000000032', c_cafe, '5a000000-0000-4000-a001-000000000005',
       'Chicken Nachos', 'Crispy tortilla chips layered with seasoned chicken, molten cheese & fresh toppings.',
       24000, false, true, 4, true),
      ('5a000000-0000-4000-a002-000000000033', c_cafe, '5a000000-0000-4000-a001-000000000005',
       'Scotch Chicken & Egg', 'A whole egg wrapped in seasoned chicken, crumbed & fried golden.',
       20000, false, true, 5, true),
      ('5a000000-0000-4000-a002-000000000034', c_cafe, '5a000000-0000-4000-a001-000000000005',
       'Chicken Overloaded Fries', 'Golden fries piled with savoury chicken and a generous cheese sauce.',
       20000, false, false, 6, false),
      ('5a000000-0000-4000-a002-000000000035', c_cafe, '5a000000-0000-4000-a001-000000000005',
       'Chicken Nuggets', 'Tender seasoned chicken encased in a delicate golden crunch. (6 pieces)',
       14000, false, true, 7, true),
      ('5a000000-0000-4000-a002-000000000036', c_cafe, '5a000000-0000-4000-a001-000000000005',
       'Peri Peri French Fries', 'Golden fries tossed with our signature fiery peri peri seasoning.',
       12000, true, true, 8, true),
      ('5a000000-0000-4000-a002-000000000037', c_cafe, '5a000000-0000-4000-a001-000000000006',
       'Chicken Batata Harra', 'Crisp potatoes, tender chicken, garlic, cilantro, chilli & a bright lemon finish.',
       22000, false, false, 1, false),
      ('5a000000-0000-4000-a002-000000000038', c_cafe, '5a000000-0000-4000-a001-000000000006',
       'Veg Batata Harra', 'Golden potatoes & cottage cheese with garlic, cilantro, chilli & lemon.',
       20000, true, false, 2, false),
      ('5a000000-0000-4000-a002-000000000039', c_cafe, '5a000000-0000-4000-a001-000000000007',
       'Lotus Biscoff Cheesecake', 'Velvety cheesecake layered with the unmistakable caramelised charm of Biscoff.',
       30000, true, true, 1, true),
      ('5a000000-0000-4000-a002-000000000040', c_cafe, '5a000000-0000-4000-a001-000000000007',
       'Melt-In-Mouth Biscoff', 'A rich Biscoff indulgence with an irresistibly soft, melt-away finish.',
       25000, true, true, 2, true),
      ('5a000000-0000-4000-a002-000000000041', c_cafe, '5a000000-0000-4000-a001-000000000007',
       'OG Tiramisu', 'Classic Italian comfort — coffee, cream & mascarpone in perfect harmony.',
       20000, true, true, 3, true),
      ('5a000000-0000-4000-a002-000000000042', c_cafe, '5a000000-0000-4000-a001-000000000007',
       'Brownie Sticks', 'Brownie sticks dipped in sweet condensed milk and chocolate sauce topped with cocoa powder',
       20000, true, true, 4, true),
      ('5a000000-0000-4000-a002-000000000043', c_cafe, '5a000000-0000-4000-a001-000000000007',
       'Hot Fudge Brownie', 'Warm, decadent brownie crowned with a luxurious hot fudge pour.',
       20000, true, true, 5, true),
      ('5a000000-0000-4000-a002-000000000044', c_cafe, '5a000000-0000-4000-a001-000000000007',
       'Chocolate Taco Cake', 'A playful chocolate creation with crisp taco-style shells and indulgent cake.',
       15000, true, true, 6, true),
      ('5a000000-0000-4000-a002-000000000045', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Milk Tea', 'A comforting classic, brewed rich and smooth.',
       4000, true, true, 1, true),
      ('5a000000-0000-4000-a002-000000000046', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Green Tea', 'Delicate, refreshing and wonderfully light.',
       6000, true, true, 2, true),
      ('5a000000-0000-4000-a002-000000000047', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Lemon Honey Tea', 'Bright lemon and mellow honey in a soothing brew.',
       6000, true, true, 3, true),
      ('5a000000-0000-4000-a002-000000000048', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Makaibari Spring Tea', 'A delicate premium brew from the celebrated Makaibari estate.',
       10000, true, true, 4, true),
      ('5a000000-0000-4000-a002-000000000049', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Kashmiri Kawa Tea', 'Fragrant Kashmiri tea kissed with warming aromatic spices and Kesar.',
       10000, true, true, 5, true),
      ('5a000000-0000-4000-a002-000000000050', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Black Coffee', 'Bold, aromatic and beautifully uncomplicated.',
       6000, true, true, 6, true),
      ('5a000000-0000-4000-a002-000000000051', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Milk Coffee', 'Smooth espresso-style coffee softened with creamy milk.',
       7000, true, true, 7, true),
      ('5a000000-0000-4000-a002-000000000052', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Cold Coffee with Ice Cream', 'Velvety chilled coffee crowned with a scoop of creamy indulgence.',
       15000, true, true, 8, true),
      ('5a000000-0000-4000-a002-000000000053', c_cafe, '5a000000-0000-4000-a001-000000000008',
       'Eye Opener', 'Cold brew, ice cream & brownie — a dessert disguised as coffee.',
       20000, true, true, 9, true),
      ('5a000000-0000-4000-a002-000000000054', c_cafe, '5a000000-0000-4000-a001-000000000009',
       'Virgin Piña Colada', 'Tropical pineapple and creamy coconut in a chilled island-inspired blend.',
       15000, true, true, 1, true),
      ('5a000000-0000-4000-a002-000000000055', c_cafe, '5a000000-0000-4000-a001-000000000009',
       'Cold Blue', 'A vibrant, icy-blue refresher with bright fruity notes.',
       12000, true, true, 2, true),
      ('5a000000-0000-4000-a002-000000000056', c_cafe, '5a000000-0000-4000-a001-000000000009',
       'Mango Crush', 'Luscious mango blended into a bright, refreshing cooler.',
       12000, true, true, 3, true),
      ('5a000000-0000-4000-a002-000000000057', c_cafe, '5a000000-0000-4000-a001-000000000009',
       'Masala Cold Drinks', 'Fizzy favourites elevated with a punch of Indian masala.',
       10000, true, true, 4, true),
      ('5a000000-0000-4000-a002-000000000058', c_cafe, '5a000000-0000-4000-a001-000000000009',
       'Virgin Mojito', 'Fresh mint, zesty lime and sparkling refreshment.',
       9000, true, true, 5, true),
      ('5a000000-0000-4000-a002-000000000059', c_cafe, '5a000000-0000-4000-a001-000000000009',
       'Fresh Lime Soda', 'Bright, bubbly and refreshing with freshly squeezed lime.',
       7000, true, true, 6, true),
      ('5a000000-0000-4000-a002-000000000060', c_cafe, '5a000000-0000-4000-a001-000000000010',
       'Water', null,
       1000, true, true, 1, true),
      ('5a000000-0000-4000-a002-000000000061', c_cafe, '5a000000-0000-4000-a001-000000000010',
       'Water', null,
       2000, true, true, 2, true),
      ('5a000000-0000-4000-a002-000000000062', c_cafe, '5a000000-0000-4000-a001-000000000011',
       'Mayonnaise', null,
       1000, true, true, 1, true),
      ('5a000000-0000-4000-a002-000000000063', c_cafe, '5a000000-0000-4000-a001-000000000011',
       'Cheese', null,
       2000, true, true, 2, true),
      ('5a000000-0000-4000-a002-000000000064', c_cafe, '5a000000-0000-4000-a001-000000000011',
       'Tortilla Bread', null,
       1000, true, true, 3, true),
      ('5a000000-0000-4000-a002-000000000065', c_cafe, '5a000000-0000-4000-a001-000000000011',
       'Packaging', null,
       1000, true, true, 4, true);
  end;

  -- ── Customers: production's count, from a range no Indian mobile uses ───────

  insert into public.customers (id, phone, name, created_at, last_used_at)
  select ('5a000000-0000-4000-a003-' || lpad(n::text, 12, '0'))::uuid,
         '+91900001' || lpad(n::text, 4, '0'),
         -- An invented first name and surname, stepping at different rates so the
         -- 446 customers rarely repeat a pair.
         (array['Arjun', 'Riya', 'Sayan', 'Puja', 'Rahul', 'Moumita', 'Debjit', 'Sneha',
                'Ankit', 'Tania', 'Subham', 'Ishita', 'Rohan', 'Payel', 'Aritra', 'Megha',
                'Soumik', 'Nandini', 'Kunal', 'Anushka', 'Abir', 'Shreya', 'Tanmoy', 'Rimpa',
                'Sagnik', 'Oindrila', 'Pritam', 'Sohini', 'Arnab', 'Debolina'])[1 + n % 30]
           || ' ' ||
         (array['Das', 'Sen', 'Ghosh', 'Bose', 'Dutta', 'Chatterjee', 'Banerjee', 'Mukherjee',
                'Saha', 'Roy', 'Mondal', 'Paul', 'Sarkar', 'Biswas', 'Majumdar', 'Chakraborty',
                'Halder', 'Pal', 'Nandi', 'Kundu'])[1 + (n * 7) % 20],
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
    v_customer_phones text[];
    v_customer_names text[];
    v_customer integer;
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
    -- Only what the counter could sell: available items in categories in use.
    select array_agg(i.id order by c.sort_order, i.sort_order),
           array_agg(i.name order by c.sort_order, i.sort_order),
           array_agg(i.price_paise order by c.sort_order, i.sort_order)
      into v_item_ids, v_item_names, v_item_prices
      from public.menu_items i
      join public.menu_categories c on c.id = i.category_id
     where i.outlet_id = c_outlet and i.is_active and i.is_available and c.is_active;

    -- About a third of bills carry a customer, found the way the counter finds
    -- one: by the phone and name the order carries.
    select array_agg(phone order by phone), array_agg(name order by phone)
      into v_customer_phones, v_customer_names
      from public.customers where phone like '+91900001%';

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
        v_customer := case when random() < 0.35
          then 1 + floor(random() * array_length(v_customer_phones, 1))::integer end;
        v_at := (v_day + time '11:30') at time zone 'Asia/Kolkata'
                + make_interval(secs => (i * 41400.0 / (v_count + 1)));

        -- Rung, prepared six minutes later, paid two minutes after that: the
        -- counter's order path, so every order and its lines exist as they do
        -- in production, where nearly every bill was an order first.
        v_payload := jsonb_build_object(
          'orderId', v_order,
          'businessDate', v_day,
          'customerId', null,
          'customerName', v_customer_names[v_customer],
          'customerPhone', v_customer_phones[v_customer],
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
         -- What that category's receipt would say, in the same order as above.
         (array[
           (array['Boneless chicken 10 kg', 'Chicken thigh 8 kg', 'Chicken wings 5 kg', 'Mutton 3 kg'])[1 + (n / 7) % 4],
           (array['Onion, tomato, cucumber', 'Lettuce and cabbage', 'Garlic and ginger', 'Potatoes 20 kg'])[1 + (n / 7) % 4],
           (array['Foil rolls and butter paper', 'Carry bags, 500', 'Takeaway boxes, 200', 'Tissue and straws'])[1 + (n / 7) % 4],
           (array['Commercial LPG cylinder', 'LPG refill', 'LPG cylinder deposit', 'Regulator and pipe'])[1 + (n / 7) % 4],
           (array['Daily wage, helper', 'Weekly advance', 'Overtime, Saturday', 'Delivery boy, daily'])[1 + (n / 7) % 4],
           (array['Electricity bill', 'Meter recharge', 'Generator diesel', 'Inverter battery water'])[1 + (n / 7) % 4],
           (array['Floor cleaner and phenyl', 'Dishwash liquid', 'Garbage collection', 'Scrubbers and mops'])[1 + (n / 7) % 4]
         ])[1 + n % 7],
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
  -- Earlier seeds left Cafe Staging a counter and a kitchen tablet for the suite.
  -- Retire them wherever they still stand, as an owner removing them would:
  -- removal keeps a tablet's rows, so Cafe Staging's history is untouched.

  perform public.remove_counter_device(d.id, '5a000000-0000-4000-a000-000000000011')
     from public.counter_devices d
    where d.id in ('5a000000-0000-4000-a000-000000000021', '5a000000-0000-4000-a000-000000000022')
      and d.removed_at is null;

  raise notice '%', 'Staging holds Cafe Staging with ' ||
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
