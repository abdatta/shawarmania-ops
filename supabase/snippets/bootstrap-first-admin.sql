-- Bootstrap the first Super Admin on a fresh hosted project.
--
-- Account provisioning is deliberately closed: admin-accounts derives the
-- caller from an existing live assignment, while profiles/account emails have
-- no client insert path. On an empty database exactly one owner must therefore
-- be created out of band. Every later account goes through People.
--
-- HOW TO USE IT
--
-- 1. Choose the owner's canonical username and real account email.
-- 2. Dashboard -> Authentication -> Users -> Add user. In the email field use
--      <username>@login.shawarmania.invalid
--    and tick Auto Confirm User. Set a strong temporary password without
--    sending any provider mail.
-- 3. Copy that Auth user's UUID, fill the four values below, and run this in
--    the SQL Editor.
-- 4. Sign in to the app with the username (not the alias) and temporary
--    password, then change it through a one-time link when convenient.
--
-- Safe to re-run for the same completed owner. It refuses a different or
-- partially created account rather than repairing silently.

begin;

do $$
declare
  -- --------------------- fill these four in ---------------------
  v_user_id uuid := null;
  v_full_name text := null;
  v_username text := null;
  v_account_email text := null;
  -- --------------------------------------------------------------
  v_expected_alias text;
  v_current_alias text;
  v_has_profile boolean;
  v_has_owner_assignment boolean;
  v_has_account_email boolean;
begin
  if v_user_id is null
     or btrim(coalesce(v_full_name, '')) = ''
     or not public.app_username_valid(v_username)
     or not public.app_account_email_valid(v_account_email) then
    raise exception
      'Fill in a user UUID, name, canonical username, and valid account email';
  end if;

  v_username := public.app_normalize_username(v_username);
  v_account_email := public.app_normalize_account_email(v_account_email);
  v_expected_alias := v_username || '@login.shawarmania.invalid';

  select lower(u.email) into v_current_alias
    from auth.users u
   where u.id = v_user_id;
  if not found then
    raise exception 'No Auth user %. Create it first at %.', v_user_id, v_expected_alias;
  end if;
  if v_current_alias is distinct from v_expected_alias then
    raise exception
      'Auth user % has alias %, expected %',
      v_user_id, v_current_alias, v_expected_alias;
  end if;

  select exists (
    select 1 from public.profiles p where p.id = v_user_id
  ) into v_has_profile;
  select exists (
    select 1
      from public.assignments a
     where a.person_id = v_user_id
       and a.role = 'super_admin'
       and a.ended_on is null
  ) into v_has_owner_assignment;
  select exists (
    select 1
      from public.account_emails c
     where c.profile_id = v_user_id
       and c.email = v_account_email
  ) into v_has_account_email;

  if v_has_profile and v_has_owner_assignment and v_has_account_email then
    raise notice 'Super Admin % already exists; nothing to do.', v_full_name;
    return;
  end if;
  if v_has_profile or v_has_owner_assignment or v_has_account_email then
    raise exception
      'Bootstrap target % is partial; inspect it rather than repairing silently',
      v_user_id;
  end if;
  if exists (
    select 1
      from public.assignments a
     where a.role = 'super_admin'
       and a.ended_on is null
  ) then
    raise exception
      'A live Super Admin already exists. Create further owners through People.';
  end if;

  insert into public.profiles (id, full_name, phone, is_active, role_title)
  values (v_user_id, btrim(v_full_name), null, true, null);

  -- The deferred Super Admin requirement sees both rows at commit.
  insert into public.account_emails (profile_id, email)
  values (v_user_id, v_account_email);

  insert into public.assignments (person_id, role, outlet_id, started_on)
  values (v_user_id, 'super_admin', null, current_date);

  raise notice 'Super Admin % created at username %.', v_full_name, v_username;
end;
$$;

commit;

-- NEXT: create outlets in Super Admin -> Outlets, capture each geofence while
-- standing at its counter, then create every other person through People.
