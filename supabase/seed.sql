-- Synthetic seed data. LOCAL DEVELOPMENT ONLY.
--
-- Real business facts (outlets, menu, prices, cutover, geofence radius) are
-- seeded because tests need them and they are not personal data. Every
-- person, phone number, and credential below is synthetic and obviously so.
-- Never seed real customer or employee data — see docs/TESTING.md.
--
-- UUIDs are deterministic so the pgTAP suite and the REST probes can refer to
-- rows without discovery queries:
--   00000000-…  outlets
--   10000000-…  auth users / profiles / counter devices
--   20000000-…  staff accounts that arrived via the roster merge (the ids the
--               dead employees table used; kept so attendance history reads
--               the same before and after staff-as-accounts)
--   30000000-…  menu categories     31/32000000-…  menu items (kal / kpa)
--   40000000-…  shifts              50000000-…     bills
--   60000000-…  inventory           70000000-…     alerts
--   80000000-…  customers (business-wide, not per outlet — see #32)
--   90000000-…  counter shifts (who is on which tablet today)

-- ---------------------------------------------------------------------------
-- Outlets. Cutover 04:00 and radius 150 m are owner-confirmed (2026-07-26).
-- ⚠ Coordinates are PLACEHOLDERS — the real ones must be captured standing at
-- each counter before attendance (#5) goes live. See docs/BUSINESS_CONTEXT.md.

-- Kalyani carries synthetic capture metadata and Kanchrapara carries none, so
-- both states of the owner's outlet screen — surveyed on site, and never
-- captured — exist locally without anyone travelling.

insert into public.outlets
  (id, code, name, location_label,
   address_line1, city, district, pincode, phone,
   latitude, longitude, geofence_radius_m, business_day_cutover, arrival_deadline,
   location_accuracy_m, location_captured_at)
values
  ('00000000-0000-4000-a000-000000000001', 'kalyani', 'Shawarmania Kalyani',
   'Kalyani — Central Park', 'Ward 10, B-9 Diagonal Road, Near Central Park Ground',
   'Kalyani', 'Nadia', '741235', '+91 89815 24778',
   22.9750, 88.4345, 150, time '04:00', time '13:00',
   9, now() - interval '3 days'),
  -- Kanchrapara keeps a deadline that is NOT the 13:00 default, so every
  -- surface and test that judges lateness has to read the outlet's own rule
  -- rather than a constant it happens to share with the other shop. That
  -- matters more since attendance-one-day-per-person: a combined roll-call puts
  -- two outlets' rows in one list, and a view that reached for one clock would
  -- mislabel half of them. Production's two outlets currently agree on 04:00
  -- and 13:00, which is exactly why the seed must not.
  ('00000000-0000-4000-a000-000000000002', 'kanchrapara', 'Shawarmania Kanchrapara',
   'Kanchrapara', '281, K G Path (N), Near Joramandir Bus Stand',
   'Kanchrapara', 'North 24 Parganas', '743145', '+91 89815 24778',
   22.9450, 88.4330, 150, time '04:00', time '20:00',
   null, null);

-- ---------------------------------------------------------------------------
-- Auth users. Username + password, encoded through the reserved
-- non-deliverable Auth alias required by Supabase's native password grant.
-- Passwords are all 'shawarmania-local'. Signup is disabled — these exist only
-- so local tests can sign in through the real GoTrue password grant.

do $$
declare
  persona record;
begin
  for persona in
    select * from (values
      ('10000000-0000-4000-a000-000000000001'::uuid, 'owner@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-000000000002'::uuid, 'admin.kalyani@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-000000000003'::uuid, 'admin.kanchrapara@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-000000000004'::uuid, 'tablet.kalyani@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-000000000005'::uuid, 'tablet.kanchrapara@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-000000000006'::uuid, 'staff.kalyani@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-000000000007'::uuid, 'staff.kanchrapara@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-000000000008'::uuid, 'deactivated.kalyani@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-000000000009'::uuid, 'revoked.tablet.kalyani@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-00000000000a'::uuid, 'biller.kalyani@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-00000000000b'::uuid, 'biller.kanchrapara@login.shawarmania.invalid'),
      -- Two accounts that exist only to carry an outstanding one-time code, so
      -- the invite policies have rows to isolate and the activation flow has
      -- something to redeem. Nothing else signs in as these, so a test that
      -- redeems one and changes its password disturbs no other test.
      ('10000000-0000-4000-a000-00000000000c'::uuid, 'pending.kalyani@login.shawarmania.invalid'),
      ('10000000-0000-4000-a000-00000000000d'::uuid, 'pending.kanchrapara@login.shawarmania.invalid'),
      -- The grillers, formerly unlinked roster rows. Staff are accounts now;
      -- their 20000000-… ids remain exactly the old roster ids while their
      -- owner-approved usernames replace every placeholder identity.
      ('20000000-0000-4000-a000-000000000002'::uuid, 'griller.kalyani@login.shawarmania.invalid'),
      ('20000000-0000-4000-a000-000000000004'::uuid, 'griller.kanchrapara@login.shawarmania.invalid'),
      -- The two-outlet person: one login, live assignments at BOTH outlets.
      -- Multi-outlet is the case that has to be seeded rather than assumed —
      -- every isolation persona below is single-outlet, and a model that only
      -- ever sees single-outlet people is a model whose second outlet is
      -- untested (multi-outlet-people). They worked SOME days at one and some
      -- at the other, never both on one date: a day belongs to the person
      -- (attendance-one-day-per-person).
      ('10000000-0000-4000-a000-00000000000e'::uuid, 'two.outlets@login.shawarmania.invalid')
    ) as p (id, email)
  loop
    insert into auth.users
      (instance_id, id, aud, role, email, email_confirmed_at, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new,
       email_change_token_current, email_change, phone_change,
       phone_change_token, reauthentication_token, is_sso_user)
    values
      ('00000000-0000-0000-0000-000000000000', persona.id, 'authenticated',
       'authenticated', persona.email, now(),
       extensions.crypt('shawarmania-local', extensions.gen_salt('bf')),
       '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
       now(), now(), '', '', '', '', '', '', '', '', false);

    insert into auth.identities
      (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      (persona.id::text, persona.id,
       jsonb_build_object('sub', persona.id::text, 'email', persona.email,
                          'email_verified', true),
       'email', now(), now(), now());
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles. The person record: who they are, whether they may sign in, and
-- their job title. Since multi-outlet-people, WHERE they work and AS WHAT is
-- not here — it is one row per place in `public.assignments` below, because a
-- person may work at more than one outlet and a single column cannot say so.
-- Staff codes are gone entirely (owner, 2026-07-29).

insert into public.profiles
  (id, full_name, phone, is_active, role_title)
values
  ('10000000-0000-4000-a000-000000000001', 'Synthetic Owner',        '911111111001', true,  null),
  ('10000000-0000-4000-a000-000000000002', 'Synthetic Admin Kal',    '911111111002', true,  'Manager'),
  ('10000000-0000-4000-a000-000000000003', 'Synthetic Admin Kpa',    '911111111003', true,  'Manager'),
  -- The three tablets are NOT here. A counter tablet has no profile and no
  -- assignment since counter-devices-and-offline: it is a machine principal, and
  -- a synthetic person for it would inherit human behaviour by accident rather
  -- than by decision. Their auth users exist above; their rows are in
  -- `counter_devices` below and nowhere else.
  ('10000000-0000-4000-a000-000000000006', 'Synthetic Staff Kal',    '911111111006', true,  'Counter staff'),
  ('10000000-0000-4000-a000-000000000007', 'Synthetic Staff Kpa',    '911111111007', true,  'Counter staff'),
  ('10000000-0000-4000-a000-000000000008', 'Deactivated Admin Kal',  '911111111008', false, 'Manager'),
  ('10000000-0000-4000-a000-00000000000a', 'Synthetic Biller Kal',   '911111111010', true,  null),
  ('10000000-0000-4000-a000-00000000000b', 'Synthetic Biller Kpa',   '911111111011', true,  null),
  ('10000000-0000-4000-a000-00000000000c', 'Pending Staff Kal',      '911111111014', true,  'Prep'),
  ('10000000-0000-4000-a000-00000000000d', 'Pending Staff Kpa',      '911111111015', true,  'Prep'),
  ('10000000-0000-4000-a000-00000000000e', 'Synthetic Two Outlets',  '911111111016', true,  'Counter staff'),
  -- The grillers: staff accounts carrying the facts their roster rows held.
  ('20000000-0000-4000-a000-000000000002', 'Synthetic Griller Kal',  '911111111012', true,  'Grill'),
  ('20000000-0000-4000-a000-000000000004', 'Synthetic Griller Kpa',  '911111111013', true,  'Grill');

-- ---------------------------------------------------------------------------
-- Assignments: person × role × outlet. One live row per person per outlet.
--
-- Every isolation persona below is deliberately single-outlet, so the sweeps
-- keep meaning what they meant. `Synthetic Two Outlets` is the exception and
-- the point: one login, an Employee assignment at each outlet, and a day
-- worked at each — on two different dates, because one person has one day.
--
-- The owner and private account email are seeded as one transaction. The
-- deferred invariant makes either row without the other impossible, including
-- from a hand-crafted write.
do $$
begin
  insert into public.account_emails (profile_id, email)
  values ('10000000-0000-4000-a000-000000000001', 'owner.account@example.com');

  insert into public.assignments (person_id, role, outlet_id, started_on)
  values (
    '10000000-0000-4000-a000-000000000001',
    'super_admin',
    null,
    current_date - 600
  );
end;
$$;

-- Owner-as-manager is proved in
-- 14_assignments.sql by granting the assignment inside the test, so the
-- isolation sweeps are not quietly weakened by an owner who also passes every
-- manager branch.

insert into public.assignments (person_id, role, outlet_id, started_on)
values
  ('10000000-0000-4000-a000-000000000002', 'franchise_admin', '00000000-0000-4000-a000-000000000001', current_date - 500),
  ('10000000-0000-4000-a000-000000000003', 'franchise_admin', '00000000-0000-4000-a000-000000000002', current_date - 450),
  ('10000000-0000-4000-a000-000000000006', 'employee',        '00000000-0000-4000-a000-000000000001', current_date - 200),
  ('10000000-0000-4000-a000-000000000007', 'employee',        '00000000-0000-4000-a000-000000000002', current_date - 150),
  ('10000000-0000-4000-a000-000000000008', 'franchise_admin', '00000000-0000-4000-a000-000000000001', current_date - 400),
  ('10000000-0000-4000-a000-00000000000a', 'biller',          '00000000-0000-4000-a000-000000000001', current_date - 300),
  ('10000000-0000-4000-a000-00000000000b', 'biller',          '00000000-0000-4000-a000-000000000002', current_date - 300),
  ('10000000-0000-4000-a000-00000000000c', 'employee',        '00000000-0000-4000-a000-000000000001', current_date - 10),
  ('10000000-0000-4000-a000-00000000000d', 'employee',        '00000000-0000-4000-a000-000000000002', current_date - 10),
  -- One person, two outlets.
  ('10000000-0000-4000-a000-00000000000e', 'employee',        '00000000-0000-4000-a000-000000000001', current_date - 60),
  ('10000000-0000-4000-a000-00000000000e', 'employee',        '00000000-0000-4000-a000-000000000002', current_date - 30),
  ('20000000-0000-4000-a000-000000000002', 'employee',        '00000000-0000-4000-a000-000000000001', current_date - 400),
  ('20000000-0000-4000-a000-000000000004', 'employee',        '00000000-0000-4000-a000-000000000002', current_date - 300);

-- ---------------------------------------------------------------------------
-- Outstanding one-time codes, one per outlet. Stored as a hash exactly as the
-- Edge Function stores them; the plaintext codes are recorded here only
-- because this file is local-only synthetic data and the tests need them:
--   pending.kalyani      ABCDE-FGHJK
--   pending.kanchrapara  KMNPQ-RSTVW
-- Normalisation before hashing is "uppercase, drop everything non-alphanumeric",
-- the same rule redeem-invite applies to what a person types.

insert into public.account_invites
  (id, profile_id, code_hash, issued_by, issued_at, expires_at)
values
  ('80000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-00000000000c',
   encode(extensions.digest('ABCDEFGHJK', 'sha256'), 'hex'),
   '10000000-0000-4000-a000-000000000002', now(), now() + interval '7 days'),
  ('80000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-00000000000d',
   encode(extensions.digest('KMNPQRSTVW', 'sha256'), 'hex'),
   '10000000-0000-4000-a000-000000000003', now(), now() + interval '7 days');

-- ---------------------------------------------------------------------------
-- Counter devices. One active per outlet — the database now enforces that — plus
-- one removed, so the partial index is exercised by data rather than only by a
-- test, and so the tests have a still-tokened tablet that must be refused.
--
-- None of these has a profile or an assignment. That is the point: a tablet is a
-- machine principal, and what it reaches comes from the shift below rather than
-- from a synthetic Biller assignment it used to carry.

insert into public.counter_devices
  (id, outlet_id, label, set_up_by, set_up_at, removed_at, last_seen_at, last_reported_unsent)
values
  ('10000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001',
   'Kalyani counter tablet', '10000000-0000-4000-a000-000000000002',
   now() - interval '30 days', null, now(), 0),
  ('10000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000002',
   'Kanchrapara counter tablet', '10000000-0000-4000-a000-000000000003',
   now() - interval '30 days', null, now(), 3),
  ('10000000-0000-4000-a000-000000000009', '00000000-0000-4000-a000-000000000001',
   'Kalyani old tablet (removed)', '10000000-0000-4000-a000-000000000002',
   now() - interval '90 days', now() - interval '7 days', now() - interval '8 days', 0);

-- ---------------------------------------------------------------------------
-- A live shift on each active tablet, held by that outlet's Biller.
--
-- Seeded rather than opened by the handshake, because a handshake needs a code
-- somebody read off a screen and there is no screen here. What it gives the
-- suite is the state every counter policy is written against: this tablet, this
-- person, this outlet, this trading day. Expiry is the outlet's own next
-- cutover, so a seeded shift dies at 04:00 exactly as a real one does.

insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at)
select v.id, v.device_id, v.outlet_id, v.person_id,
       now() - interval '2 hours',
       public.app_business_date(now(), o.business_day_cutover),
       public.app_next_cutover(now(), o.business_day_cutover)
  from (values
    ('90000000-0000-4000-a000-000000000001'::uuid,
     '10000000-0000-4000-a000-000000000004'::uuid,
     '00000000-0000-4000-a000-000000000001'::uuid,
     '10000000-0000-4000-a000-00000000000a'::uuid),
    ('90000000-0000-4000-a000-000000000002'::uuid,
     '10000000-0000-4000-a000-000000000005'::uuid,
     '00000000-0000-4000-a000-000000000002'::uuid,
     '10000000-0000-4000-a000-00000000000b'::uuid)
  ) as v (id, device_id, outlet_id, person_id)
  join public.outlets o on o.id = v.outlet_id;

-- ---------------------------------------------------------------------------
-- Menu. The real live menu (business facts), per outlet. All items are
-- non-veg chicken builds; prices in paise.

insert into public.menu_categories (id, outlet_id, name, sort_order)
values
  ('30000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Shawarma', 1),
  ('30000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Salads', 2),
  ('30000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'Burgers', 3),
  ('30000000-0000-4000-a000-000000000011', '00000000-0000-4000-a000-000000000002', 'Shawarma', 1),
  ('30000000-0000-4000-a000-000000000012', '00000000-0000-4000-a000-000000000002', 'Salads', 2),
  ('30000000-0000-4000-a000-000000000013', '00000000-0000-4000-a000-000000000002', 'Burgers', 3);

insert into public.menu_items
  (id, outlet_id, category_id, name, description, price_paise, is_veg, sort_order)
values
  -- Kalyani
  ('31000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
   '30000000-0000-4000-a000-000000000001', 'Classic Chicken Shawarma', 'Bestseller', 13900, false, 1),
  ('31000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
   '30000000-0000-4000-a000-000000000001', 'Mayonnaise Chicken Shawarma', 'Top rated', 15900, false, 2),
  ('31000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001',
   '30000000-0000-4000-a000-000000000001', 'Double Chicken Shawarma', null, 17900, false, 3),
  ('31000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001',
   '30000000-0000-4000-a000-000000000001', 'Mozzarella Cheese Chicken Shawarma', null, 19900, false, 4),
  ('31000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001',
   '30000000-0000-4000-a000-000000000002', 'Healthy Chicken Shawarma Salad', 'Viral; 25.8g protein per 100g', 21900, false, 1),
  ('31000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001',
   '30000000-0000-4000-a000-000000000001', 'Stuffed Lebanese Chicken Shawarma', 'Saaj/pita style', 23800, false, 5),
  ('31000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000001',
   '30000000-0000-4000-a000-000000000003', 'Fully Loaded Smashed Burger', 'New', 25000, false, 1),
  -- Kanchrapara
  ('32000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002',
   '30000000-0000-4000-a000-000000000011', 'Classic Chicken Shawarma', 'Bestseller', 13900, false, 1),
  ('32000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002',
   '30000000-0000-4000-a000-000000000011', 'Mayonnaise Chicken Shawarma', 'Top rated', 15900, false, 2),
  ('32000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000002',
   '30000000-0000-4000-a000-000000000011', 'Double Chicken Shawarma', null, 17900, false, 3),
  ('32000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000002',
   '30000000-0000-4000-a000-000000000011', 'Mozzarella Cheese Chicken Shawarma', null, 19900, false, 4),
  ('32000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000002',
   '30000000-0000-4000-a000-000000000012', 'Healthy Chicken Shawarma Salad', 'Viral; 25.8g protein per 100g', 21900, false, 1),
  ('32000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000002',
   '30000000-0000-4000-a000-000000000011', 'Stuffed Lebanese Chicken Shawarma', 'Saaj/pita style', 23800, false, 5),
  ('32000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000002',
   '30000000-0000-4000-a000-000000000013', 'Fully Loaded Smashed Burger', 'New', 25000, false, 1);

-- ---------------------------------------------------------------------------
-- Inventory: items enter at quantity zero; every quantity below arrives
-- through the ledger, so cache = sum(deltas) holds from the first row.

insert into public.inventory_items
  (id, outlet_id, name, unit, purchase_cost_paise, low_stock_threshold)
values
  ('60000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Chicken', 'kg', 22000, 5),
  ('60000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Pita bread', 'packet', 4500, 10),
  ('60000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'Mayonnaise', 'litre', 18000, 2),
  ('60000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001', 'Packaging boxes', 'piece', 800, 50),
  ('60000000-0000-4000-a000-000000000011', '00000000-0000-4000-a000-000000000002', 'Chicken', 'kg', 21500, 5),
  ('60000000-0000-4000-a000-000000000012', '00000000-0000-4000-a000-000000000002', 'Pita bread', 'packet', 4500, 10),
  ('60000000-0000-4000-a000-000000000013', '00000000-0000-4000-a000-000000000002', 'Mayonnaise', 'litre', 18000, 2);

insert into public.inventory_movements
  (outlet_id, inventory_item_id, movement_type, quantity_delta, unit_cost_paise,
   note, recorded_by, business_date)
values
  -- Kalyani chicken: bought 20, used 6.5, wasted 0.5, corrected -1 after audit
  ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
   'added', 20, 22000, null, '10000000-0000-4000-a000-000000000002', current_date - 2),
  ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
   'used', -6.5, null, null, '10000000-0000-4000-a000-000000000002', current_date - 2),
  ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
   'wasted', -0.5, null, 'Spoiled in afternoon heat (synthetic)', '10000000-0000-4000-a000-000000000002', current_date - 1),
  ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
   'correction', -1, null, 'Stock audit found 12 kg, not 13 (synthetic)', '10000000-0000-4000-a000-000000000002', current_date - 1),
  ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000002',
   'added', 30, 4500, null, '10000000-0000-4000-a000-000000000002', current_date - 2),
  ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000002',
   'used', -12, null, null, '10000000-0000-4000-a000-000000000002', current_date - 1),
  ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000003',
   'added', 5, 18000, null, '10000000-0000-4000-a000-000000000002', current_date - 2),
  ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000004',
   'added', 200, 800, null, '10000000-0000-4000-a000-000000000002', current_date - 2),
  -- Kanchrapara
  ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000011',
   'added', 15, 21500, null, '10000000-0000-4000-a000-000000000003', current_date - 2),
  ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000011',
   'used', -4, null, null, '10000000-0000-4000-a000-000000000003', current_date - 1),
  ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000012',
   'added', 20, 4500, null, '10000000-0000-4000-a000-000000000003', current_date - 2),
  ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000013',
   'added', 4, 18000, null, '10000000-0000-4000-a000-000000000003', current_date - 2),
  -- The owner's remote correction: recorded by the Super Admin at an outlet
  -- they hold no assignment at. `correction` is the only movement type that
  -- branch permits — receiving and consuming stock is done standing in the
  -- shop (multi-outlet-people, design D8).
  ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000011',
   'correction', -0.5, null, 'Owner audit: half a kilo unaccounted (synthetic)',
   '10000000-0000-4000-a000-000000000001', current_date - 1);

-- ---------------------------------------------------------------------------
-- Customers. ONE list for the whole business — no outlet column, because since
-- #32 a phone identifies a person, not a person-at-a-shop.
--
-- The first of them deliberately has a bill at BOTH outlets. That is the case
-- the change exists for, and it is also the case the isolation suite needs: a
-- Kalyani manager holding this customer's id must still read exactly one of
-- those two bills.
--
-- Synthetic and obviously so: 9000000001 upward is not an allocated Indian
-- mobile range. Never seed a real customer number here — docs/TESTING.md.

insert into public.customers (id, phone, name, created_at, last_used_at)
values
  ('80000000-0000-4000-a000-000000000001', '+919000000001',
   'Test Customer (Synthetic)', now() - interval '40 days', now() - interval '2 days'),
  ('80000000-0000-4000-a000-000000000002', '+919000000002',
   null, now() - interval '3 days', now() - interval '3 days');

-- ---------------------------------------------------------------------------
-- Shifts and bills. D-2 is a fully traded, reconciled day at both outlets;
-- today has open shifts with live bills. Bill numbers are allocated by the
-- trigger in insert order. One D-2 bill is rung at 00:20 — it belongs to the
-- previous business day, which is the whole point of the cutover.

insert into public.shifts
  (id, outlet_id, counter_device_id, biller_profile_id, business_date, opened_at, closed_at)
values
  -- Kalyani D-2, closed
  ('40000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-00000000000a',
   current_date - 2, ((current_date - 2) + time '11:00') at time zone 'Asia/Kolkata',
   ((current_date - 1) + time '00:40') at time zone 'Asia/Kolkata'),
  -- Kalyani today, open
  ('40000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-00000000000a',
   public.app_business_date(now() - interval '2 hours', time '04:00'),
   now() - interval '2 hours', null),
  -- Kanchrapara D-2, closed
  ('40000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-00000000000b',
   current_date - 2, ((current_date - 2) + time '11:30') at time zone 'Asia/Kolkata',
   ((current_date - 2) + time '23:30') at time zone 'Asia/Kolkata'),
  -- Kanchrapara today, open
  ('40000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-00000000000b',
   public.app_business_date(now() - interval '90 minutes', time '04:00'),
   now() - interval '90 minutes', null),
  -- Kalyani earlier today, already closed — the device must NOT see its bills
  ('40000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-00000000000a',
   public.app_business_date(now() - interval '5 hours', time '04:00'),
   now() - interval '5 hours', now() - interval '3 hours');

insert into public.bills
  (id, outlet_id, business_date, biller_profile_id, counter_device_id, shift_id,
   customer_id, customer_name, customer_phone, subtotal_paise, discount_paise, total_paise,
   payment_method, status, voided_by, voided_at, void_reason, created_at)
values
  -- ------------------------------------------------ Kalyani D-2 (shift 1)
  ('50000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
   current_date - 2, '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   null, null, null, 27800, 0, 27800, 'cash', 'settled', null, null, null,
   ((current_date - 2) + time '12:15') at time zone 'Asia/Kolkata'),
  ('50000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
   current_date - 2, '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   '80000000-0000-4000-a000-000000000001', 'Test Customer (Synthetic)', '+919000000001', 40900, 0, 40900, 'cash', 'settled',
   null, null, null,
   ((current_date - 2) + time '13:40') at time zone 'Asia/Kolkata'),
  ('50000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001',
   current_date - 2, '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   null, null, null, 21900, 0, 21900, 'upi', 'settled', null, null, null,
   ((current_date - 2) + time '19:05') at time zone 'Asia/Kolkata'),
  ('50000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001',
   current_date - 2, '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   null, null, null, 23800, 0, 23800, 'upi', 'settled', null, null, null,
   ((current_date - 2) + time '20:30') at time zone 'Asia/Kolkata'),
  -- Rung at 00:20, after midnight: previous business day under the 04:00 cutover.
  ('50000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001',
   current_date - 2, '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   null, null, null, 17900, 0, 17900, 'cash', 'settled', null, null, null,
   ((current_date - 1) + time '00:20') at time zone 'Asia/Kolkata'),
  -- A voided bill: mis-rung, corrected the honest way.
  ('50000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001',
   current_date - 2, '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   null, null, null, 13900, 0, 13900, 'cash', 'void',
   '10000000-0000-4000-a000-000000000002',
   ((current_date - 2) + time '14:05') at time zone 'Asia/Kolkata',
   'Rung twice by mistake (synthetic)',
   ((current_date - 2) + time '14:00') at time zone 'Asia/Kolkata'),
  -- ------------------------------------------------ Kalyani today, open shift
  ('50000000-0000-4000-a000-000000000011', '00000000-0000-4000-a000-000000000001',
   public.app_business_date(now() - interval '45 minutes', time '04:00'),
   '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000002',
   null, null, null, 13900, 0, 13900, 'cash', 'settled', null, null, null,
   now() - interval '45 minutes'),
  ('50000000-0000-4000-a000-000000000012', '00000000-0000-4000-a000-000000000001',
   public.app_business_date(now() - interval '20 minutes', time '04:00'),
   '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000002',
   null, null, null, 15900, 0, 15900, 'upi', 'settled', null, null, null,
   now() - interval '20 minutes'),
  -- ------------------------------------------------ Kalyani today, closed shift
  ('50000000-0000-4000-a000-000000000013', '00000000-0000-4000-a000-000000000001',
   public.app_business_date(now() - interval '4 hours', time '04:00'),
   '10000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000005',
   null, null, null, 25000, 0, 25000, 'upi', 'settled', null, null, null,
   now() - interval '4 hours'),
  -- ------------------------------------------------ Kanchrapara D-2 (shift 3)
  ('50000000-0000-4000-a000-000000000021', '00000000-0000-4000-a000-000000000002',
   current_date - 2, '10000000-0000-4000-a000-00000000000b',
   '10000000-0000-4000-a000-000000000005', '40000000-0000-4000-a000-000000000003',
   '80000000-0000-4000-a000-000000000001', 'Test Customer (Synthetic)', '+919000000001',
   27800, 0, 27800, 'cash', 'settled', null, null, null,
   ((current_date - 2) + time '12:45') at time zone 'Asia/Kolkata'),
  ('50000000-0000-4000-a000-000000000022', '00000000-0000-4000-a000-000000000002',
   current_date - 2, '10000000-0000-4000-a000-00000000000b',
   '10000000-0000-4000-a000-000000000005', '40000000-0000-4000-a000-000000000003',
   null, null, null, 25000, 0, 25000, 'upi', 'settled', null, null, null,
   ((current_date - 2) + time '18:10') at time zone 'Asia/Kolkata'),
  ('50000000-0000-4000-a000-000000000023', '00000000-0000-4000-a000-000000000002',
   current_date - 2, '10000000-0000-4000-a000-00000000000b',
   '10000000-0000-4000-a000-000000000005', '40000000-0000-4000-a000-000000000003',
   null, null, null, 15900, 0, 15900, 'upi', 'settled', null, null, null,
   ((current_date - 2) + time '20:55') at time zone 'Asia/Kolkata'),
  ('50000000-0000-4000-a000-000000000024', '00000000-0000-4000-a000-000000000002',
   current_date - 2, '10000000-0000-4000-a000-00000000000b',
   '10000000-0000-4000-a000-000000000005', '40000000-0000-4000-a000-000000000003',
   null, null, null, 21900, 0, 21900, 'upi', 'settled', null, null, null,
   ((current_date - 2) + time '21:15') at time zone 'Asia/Kolkata'),
  -- ------------------------------------------------ Kanchrapara today, open shift
  ('50000000-0000-4000-a000-000000000031', '00000000-0000-4000-a000-000000000002',
   public.app_business_date(now() - interval '30 minutes', time '04:00'),
   '10000000-0000-4000-a000-00000000000b',
   '10000000-0000-4000-a000-000000000005', '40000000-0000-4000-a000-000000000004',
   null, null, null, 13900, 0, 13900, 'cash', 'settled', null, null, null,
   now() - interval '30 minutes');

insert into public.bill_payments (bill_id,outlet_id,method,amount_paise,created_at)
select id,outlet_id,payment_method,total_paise,paid_at
from public.bills
where payment_method is not null;

-- Line items: name and unit price snapshotted at sale time.
insert into public.bill_items
  (bill_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise)
values
  ('50000000-0000-4000-a000-000000000001', '31000000-0000-4000-a000-000000000001',
   'Classic Chicken Shawarma', 13900, 2, 27800),
  ('50000000-0000-4000-a000-000000000002', '31000000-0000-4000-a000-000000000002',
   'Mayonnaise Chicken Shawarma', 15900, 1, 15900),
  ('50000000-0000-4000-a000-000000000002', '31000000-0000-4000-a000-000000000007',
   'Fully Loaded Smashed Burger', 25000, 1, 25000),
  ('50000000-0000-4000-a000-000000000003', '31000000-0000-4000-a000-000000000005',
   'Healthy Chicken Shawarma Salad', 21900, 1, 21900),
  ('50000000-0000-4000-a000-000000000004', '31000000-0000-4000-a000-000000000006',
   'Stuffed Lebanese Chicken Shawarma', 23800, 1, 23800),
  ('50000000-0000-4000-a000-000000000005', '31000000-0000-4000-a000-000000000003',
   'Double Chicken Shawarma', 17900, 1, 17900),
  ('50000000-0000-4000-a000-000000000006', '31000000-0000-4000-a000-000000000001',
   'Classic Chicken Shawarma', 13900, 1, 13900),
  ('50000000-0000-4000-a000-000000000011', '31000000-0000-4000-a000-000000000001',
   'Classic Chicken Shawarma', 13900, 1, 13900),
  ('50000000-0000-4000-a000-000000000012', '31000000-0000-4000-a000-000000000002',
   'Mayonnaise Chicken Shawarma', 15900, 1, 15900),
  ('50000000-0000-4000-a000-000000000013', '31000000-0000-4000-a000-000000000007',
   'Fully Loaded Smashed Burger', 25000, 1, 25000),
  ('50000000-0000-4000-a000-000000000021', '32000000-0000-4000-a000-000000000001',
   'Classic Chicken Shawarma', 13900, 2, 27800),
  ('50000000-0000-4000-a000-000000000022', '32000000-0000-4000-a000-000000000007',
   'Fully Loaded Smashed Burger', 25000, 1, 25000),
  ('50000000-0000-4000-a000-000000000023', '32000000-0000-4000-a000-000000000002',
   'Mayonnaise Chicken Shawarma', 15900, 1, 15900),
  ('50000000-0000-4000-a000-000000000024', '32000000-0000-4000-a000-000000000005',
   'Healthy Chicken Shawarma Salad', 21900, 1, 21900),
  ('50000000-0000-4000-a000-000000000031', '32000000-0000-4000-a000-000000000001',
   'Classic Chicken Shawarma', 13900, 1, 13900);

-- ---------------------------------------------------------------------------
-- Expenses and withdrawals for the reconciled day. Only cash rows feed the
-- drawer; the UPI electricity bill deliberately does not.
--
-- Categories are free text since `expense-categories-grow-from-use`, and every
-- row inserted here mints its word into the business-wide suggestion list. So
-- they are written the way a person would type them: the old enum identifiers
-- would greet the first local sign-in as `raw_materials` in the owner's own
-- vocabulary.

insert into public.expenses
  (outlet_id, business_date, category, description, amount_paise, payment_method, recorded_by)
values
  ('00000000-0000-4000-a000-000000000001', current_date - 2, 'Chicken',
   'Chicken and vegetables (synthetic)', 150000, 'cash', '10000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-a000-000000000001', current_date - 2, 'Electricity',
   'Monthly electricity bill (synthetic)', 80000, 'upi', '10000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-a000-000000000001', current_date - 1, 'Staff wages',
   'Advance to staff (synthetic)', 50000, 'cash', '10000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-a000-000000000002', current_date - 2, 'Packaging',
   'Pita and packaging (synthetic)', 10000, 'cash', '10000000-0000-4000-a000-000000000003'),
  -- The owner's remote entry: recorded by the Super Admin, at an outlet they
  -- hold no assignment at, non-cash by necessity — `expenses_insert` refuses
  -- `cash` from that branch, so this row cannot move Kanchrapara's drawer
  -- (multi-outlet-people, design D8).
  ('00000000-0000-4000-a000-000000000002', current_date - 1, 'Platform fee',
   'Aggregator platform fee, paid centrally (synthetic)', 62000, 'upi',
   '10000000-0000-4000-a000-000000000001');

insert into public.cash_withdrawals
  (outlet_id, business_date, amount_paise, reason, withdrawn_by, recorded_by)
values
  ('00000000-0000-4000-a000-000000000001', current_date - 2, 50000,
   'Owner draw (synthetic)', 'Synthetic Owner', '10000000-0000-4000-a000-000000000002');

-- ---------------------------------------------------------------------------
-- Attendance. Coordinates are synthetic offsets around the placeholder
-- outlet positions; the inputs sit beside the verdict on every row. Rows key
-- on the person's account (person_id) since staff-as-accounts; the
-- 20000000-… people keep the ids their roster rows had, so history reads
-- the same before and after the merge.
--
-- A check-in counts as nothing until a manager approves it, so these rows are
-- the four states a day can be in and every surface has to render:
--
--   * approved on site, on the day — the honest path, no reason recorded
--   * approved from elsewhere, with the reason that cost
--   * recorded and still waiting for a manager
--   * late: recorded after the outlet's own arrival deadline, and approved
--
-- No row is checked out, because a check-out no longer exists. Distances and
-- the stamped arrival deadline are left to the triggers deliberately: the
-- database recomputes each distance from the coordinates and takes the
-- deadline from the outlet, and a seed that supplied them could describe a row
-- the real system cannot produce. Manual entries stay exercised live in
-- 06_write_contract_attendance_alerts.sql rather than seeded, because their
-- whole point is the enterer stamp the trigger applies to a session.

insert into public.attendance
  (outlet_id, person_id, business_date, status,
   check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source,
   approved_by, approval_reason, approved_at,
   approver_lat, approver_lng, approver_accuracy_m)
values
  -- Kalyani staff: in the fence at 09:05, approved by their manager standing at
  -- the counter the same morning. On site and on the day, so no reason.
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
   current_date - 1, 'present',
   ((current_date - 1) + time '09:05') at time zone 'Asia/Kolkata', 22.97505, 88.43460, 18, 'phone',
   '10000000-0000-4000-a000-000000000002', null,
   ((current_date - 1) + time '09:20') at time zone 'Asia/Kolkata',
   22.97498, 88.43448, 12),
  -- Kalyani staff, the day before: arrived at 14:20 against a 13:00 deadline.
  -- Late is a tag, never a status — approved, this day is present AND late.
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
   current_date - 2, 'present',
   ((current_date - 2) + time '14:20') at time zone 'Asia/Kolkata', 22.97511, 88.43455, 21, 'phone',
   '10000000-0000-4000-a000-000000000002', null,
   ((current_date - 2) + time '14:31') at time zone 'Asia/Kolkata',
   22.97502, 88.43452, 15),
  -- Kalyani griller, tablet check-in (no GPS on the counter tablet). Nobody has
  -- approved it, so it waits: the counter device stands in the outlet, but it
  -- does not decide who worked.
  ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
   current_date - 1, 'present',
   ((current_date - 1) + time '09:30') at time zone 'Asia/Kolkata', null, null, null, 'counter_tablet',
   null, null, null, null, null, null),
  -- Kalyani griller, absent two days ago (no check-in, nothing to validate)
  ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
   current_date - 2, 'absent',
   null, null, null, null, null,
   null, null, null, null, null, null),
  -- Kanchrapara staff: out of fence at 09:10, and the manager who settled it
  -- was over a kilometre away. Not refused — recorded, with the reason that
  -- being elsewhere costs, and every surface says the approver was not there.
  ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000007',
   current_date - 1, 'present',
   ((current_date - 1) + time '09:10') at time zone 'Asia/Kolkata', 22.94680, 88.43510, 35, 'phone',
   '10000000-0000-4000-a000-000000000003',
   'GPS drifted; staff visibly at counter, called in from home (synthetic)',
   ((current_date - 1) + time '09:12') at time zone 'Asia/Kolkata',
   22.95600, 88.44200, 30),
  -- Kanchrapara griller, still waiting for a decision: the state a manager's
  -- day view has to make actionable. Status is 'absent' because nobody has
  -- vouched for it — which is what "waiting" means for payroll.
  ('00000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000004',
   current_date - 1, 'absent',
   ((current_date - 1) + time '09:40') at time zone 'Asia/Kolkata', 22.94120, 88.42880, 28, 'phone',
   null, null, null, null, null, null),
  -- The two-outlet person: ONE person, TWO outlets, and never both on one date.
  -- Yesterday at Kalyani, the day before at Kanchrapara, each check-in inside
  -- its own fence. This pair is what a month actually looks like for somebody
  -- staffed at two shops, and it is deliberately readable from both sides:
  --
  --   D-1  a row at Kalyani, and NOTHING at Kanchrapara — so Kanchrapara's
  --        manager must read them as working at another outlet, not absent
  --   D-2  the mirror, so neither outlet is the privileged one
  --
  -- A pair on the SAME date is what the unique constraint now refuses
  -- (attendance-one-day-per-person). Kanchrapara's 20:00 deadline is why its
  -- 15:10 arrival is not late.
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000e',
   current_date - 1, 'present',
   ((current_date - 1) + time '08:55') at time zone 'Asia/Kolkata', 22.97495, 88.43443, 15, 'phone',
   '10000000-0000-4000-a000-000000000002', null,
   ((current_date - 1) + time '09:15') at time zone 'Asia/Kolkata',
   22.97500, 88.43450, 11),
  ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-00000000000e',
   current_date - 2, 'present',
   ((current_date - 2) + time '15:10') at time zone 'Asia/Kolkata', 22.94508, 88.43312, 19, 'phone',
   '10000000-0000-4000-a000-000000000003', null,
   ((current_date - 2) + time '15:22') at time zone 'Asia/Kolkata',
   22.94503, 88.43305, 16);

-- ---------------------------------------------------------------------------
-- Close D-2 at both outlets. Seeds run as the database owner, not through
-- close_business_day() (there is no session); the figures are computed here
-- the same way the RPC computes them, and the CHECK constraints hold them to
-- the invariant. Kalyani's drawer is deliberately ₹5 short.

do $$
declare
  v_outlet uuid;
  v_fa uuid;
  v_opening bigint;
  v_short bigint;
  v_sales bigint;
  v_expenses bigint;
  v_withdrawn bigint;
  v_expected bigint;
begin
  for v_outlet, v_fa, v_opening, v_short in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid,
       '10000000-0000-4000-a000-000000000002'::uuid, 200000::bigint, 500::bigint),
      ('00000000-0000-4000-a000-000000000002'::uuid,
       '10000000-0000-4000-a000-000000000003'::uuid, 150000::bigint, 0::bigint)
    ) as t (outlet_id, fa, opening, short)
  loop
    select coalesce(sum(bp.amount_paise), 0) into v_sales
      from public.bill_payments bp
      join public.bills b
        on b.id = bp.bill_id and b.outlet_id = bp.outlet_id
     where b.outlet_id = v_outlet and b.business_date = current_date - 2
       and bp.method = 'cash' and b.status = 'settled';

    select coalesce(sum(amount_paise), 0) into v_expenses
      from public.expenses
     where outlet_id = v_outlet and business_date = current_date - 2
       and payment_method = 'cash';

    select coalesce(sum(amount_paise), 0) into v_withdrawn
      from public.cash_withdrawals
     where outlet_id = v_outlet and business_date = current_date - 2;

    v_expected := v_opening + v_sales - v_expenses - v_withdrawn;

    insert into public.daily_cash_records
      (outlet_id, business_date, opening_cash_paise, cash_sales_paise,
       cash_expenses_paise, cash_withdrawn_paise, expected_closing_paise,
       actual_closing_paise, difference_paise, closed_by, closed_at, notes)
    values
      (v_outlet, current_date - 2, v_opening, v_sales, v_expenses, v_withdrawn,
       v_expected, v_expected - v_short, -v_short, v_fa,
       ((current_date - 1) + time '01:00') at time zone 'Asia/Kolkata',
       case when v_short > 0 then 'Drawer short (synthetic)' else 'Clean close (synthetic)' end);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- An alert thread: Franchise Admin raises, Super Admin responds.

insert into public.alerts
  (id, outlet_id, raised_by, subject, message, category, priority, status)
values
  ('70000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000002', 'Drawer short by ₹5',
   'Evening count came up ₹5 short of expected. Recounted twice. (synthetic)',
   'cash_mismatch', 'high', 'acknowledged');

insert into public.alert_responses (alert_id, responder_profile_id, message)
values
  ('70000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001',
   'Noted — write it off, keep an eye on the evening shift counts this week. (synthetic)');
