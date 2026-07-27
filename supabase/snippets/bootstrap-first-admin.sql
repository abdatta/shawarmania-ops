-- Bootstrap: the first Super Admin on a fresh hosted project.
--
-- WHY THIS EXISTS
--
-- Account provisioning is deliberately closed: `admin-accounts` derives the
-- caller's authority from their own profile row, and `public.profiles` has no
-- client insert path at all (the verb is revoked, not merely policy-gated).
-- That is the correct design everywhere except on an empty database, where it
-- means nobody is an admin and nothing can make one. Exactly one account has
-- to be created out-of-band; every account after it goes through the app.
--
-- HOW TO USE IT
--
-- 1. Dashboard → Authentication → Users → Add user → Create new user.
--    Tick **Auto Confirm User**. Use a real address and a password you choose;
--    no mail is ever sent by this system, so an unconfirmed user simply
--    cannot sign in.
-- 2. Copy that user's UUID from the users list.
-- 3. Run this in the SQL Editor with the UUID and name filled in.
-- 4. Sign in to the app. If the shell looks empty, sign out and in again —
--    claims are stamped at token issue, and the profile has to exist first.
--
-- Safe to re-run: it will not create a second owner, and it will not
-- silently overwrite an existing one.

begin;

do $$
declare
  -- ─────────── fill these two in ───────────
  -- Paste the UUID from Authentication → Users, in quotes.
  v_user_id uuid := null;
  v_full_name text := null;
  -- ─────────────────────────────────────────
begin
  -- Null rather than a placeholder UUID on purpose: a placeholder appears
  -- twice (the value and the check), so replacing every occurrence — the
  -- obvious thing to do — would defeat the check it exists to power.
  if v_user_id is null or v_full_name is null then
    raise exception 'Fill in v_user_id and v_full_name at the top of this snippet first';
  end if;

  if not exists (select 1 from auth.users u where u.id = v_user_id) then
    raise exception 'No auth user %. Create it in the dashboard first, with Auto Confirm ticked.', v_user_id;
  end if;

  if exists (select 1 from public.profiles p where p.id = v_user_id) then
    raise notice 'Profile % already exists — nothing to do.', v_user_id;
    return;
  end if;

  if exists (select 1 from public.profiles p where p.role = 'super_admin' and p.is_active) then
    raise exception
      'An active Super Admin already exists. Create further accounts through People in the app, '
      'not here — this snippet is only for an empty database.';
  end if;

  -- outlet_id is null because a Super Admin is outlet-less; the schema
  -- constraint enforces that pairing, so there is nothing to choose.
  insert into public.profiles (id, full_name, phone, role, outlet_id, is_active)
  values (v_user_id, v_full_name, null, 'super_admin', null, true);

  raise notice 'Super Admin % created. Sign in, then add everyone else from People.', v_full_name;
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- NEXT: outlets.
--
-- A Franchise Admin, Biller or Employee cannot exist without one — the schema
-- requires an outlet for every role except Super Admin — and attendance is
-- meaningless without real coordinates. The Outlets screen arrives with
-- `outlet-onboarding` (#14), so until then outlets are inserted here too.
--
-- ⚠ CAPTURE THE COORDINATES STANDING AT THE COUNTER. Do not take them from a
-- map search: the geofence is computed against them, and a wrong fix either
-- blocks staff who are present or admits staff who are not.
--
-- insert into public.outlets
--   (code, name, location_label, address_line1, city, district, pincode, phone,
--    latitude, longitude, geofence_radius_m, business_day_cutover)
-- values
--   ('kalyani', 'Shawarmania Kalyani', 'Kalyani — Central Park',
--    '<address>', 'Kalyani', 'Nadia', '<pincode>', '<phone>',
--    <latitude>, <longitude>, 150, time '04:00');
