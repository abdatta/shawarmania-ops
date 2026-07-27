-- Tenancy and identity: outlets, profiles, counter devices, the status
-- helpers that make deactivation and revocation bite immediately, and the
-- access-token hook that injects claims.
--
-- Convention carried through the whole schema: a profile's id IS its
-- auth.users id, and a counter device's id IS its machine auth user's id.
-- One identity, one uuid.

-- ---------------------------------------------------------------------------
-- outlets — the isolation unit.

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location_label text not null,
  address_line1 text,
  address_line2 text,
  city text,
  district text,
  pincode text,
  phone text,
  latitude double precision,
  longitude double precision,
  geofence_radius_m integer not null default 150 check (geofence_radius_m > 0),
  business_day_cutover time not null default time '04:00',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.outlets enable row level security;

-- ---------------------------------------------------------------------------
-- profiles — one row per app login, id matching auth.users.id. The auth
-- mirror, not the HR roster (that is `employees`; the seam is deliberate).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text unique,
  role public.app_role not null,
  outlet_id uuid references public.outlets (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Only the Super Admin is outlet-less; every scoped role must be scoped.
  constraint profiles_outlet_matches_role check ((role = 'super_admin') = (outlet_id is null))
);

create index profiles_outlet_id_idx on public.profiles (outlet_id);

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- counter_devices — enrolled tablets. id = the device's machine auth user.

create table public.counter_devices (
  id uuid primary key references auth.users (id) on delete cascade,
  outlet_id uuid not null references public.outlets (id),
  label text not null,
  enrolled_by uuid references public.profiles (id),
  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_seen_at timestamptz
);

create index counter_devices_outlet_id_idx on public.counter_devices (outlet_id);

alter table public.counter_devices enable row level security;

-- ---------------------------------------------------------------------------
-- Status helpers. Claims refresh with the token; these two checks must not
-- wait for that. security definer so the lookup bypasses RLS without
-- recursing into the very policies that call it.

create or replace function public.app_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_active from public.profiles p where p.id = auth.uid()),
    false
  )
$$;

-- True for personal sessions (no device row), true for an unrevoked device,
-- false the moment revoked_at is set. Checked by policies on billing tables.
create or replace function public.app_device_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select d.revoked_at is null from public.counter_devices d where d.id = auth.uid()),
    true
  )
$$;

-- Does this profile exist, hold this role, belong to this outlet, and remain
-- active? Used by write policies to validate attribution references without
-- granting the writer read access to profiles.
create or replace function public.app_profile_has(profile uuid, required public.app_role, outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = profile
      and p.role = required
      and p.outlet_id = outlet
      and p.is_active
  )
$$;

revoke execute on function public.app_account_active() from public, anon;
revoke execute on function public.app_device_ok() from public, anon;
revoke execute on function public.app_profile_has(uuid, public.app_role, uuid) from public, anon;
grant execute on function public.app_account_active() to authenticated;
grant execute on function public.app_device_ok() to authenticated;
grant execute on function public.app_profile_has(uuid, public.app_role, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Access-token hook: injects app_role and app_outlet_id into every JWT at
-- issue time. Registered in supabase/config.toml. Only the auth service may
-- call it.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  p record;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  select role, outlet_id
    into p
    from public.profiles
   where id = (event ->> 'user_id')::uuid;

  if found then
    claims := jsonb_set(claims, '{app_role}', to_jsonb(p.role::text));
    claims := jsonb_set(
      claims,
      '{app_outlet_id}',
      coalesce(to_jsonb(p.outlet_id::text), 'null'::jsonb)
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies.

-- outlets: Super Admin manages; every scoped role may read its own outlet row
-- (cutover and geofence parameters live here), but never the list.
create policy outlets_select on public.outlets
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (public.app_role() = 'super_admin' or id = public.app_outlet_id())
  );

create policy outlets_insert on public.outlets
  for insert to authenticated
  with check (public.app_role() = 'super_admin' and public.app_account_active());

create policy outlets_update on public.outlets
  for update to authenticated
  using (public.app_role() = 'super_admin' and public.app_account_active())
  with check (public.app_role() = 'super_admin' and public.app_account_active());

-- profiles: self-read; Super Admin all; Franchise Admin and the counter
-- device read their own outlet's profiles (staff management, shift
-- attribution). No client writes — provisioning is a privileged operation.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      id = auth.uid()
      or public.app_role() = 'super_admin'
      or (
        public.app_role() in ('franchise_admin', 'biller')
        and outlet_id = public.app_outlet_id()
      )
    )
  );

-- counter_devices: Super Admin all, Franchise Admin own outlet, device
-- self-read. No client writes — enrolment and revocation are privileged.
create policy counter_devices_select on public.counter_devices
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or id = auth.uid()
    )
  );

-- Defence in depth: the tables with no client write path lose the write
-- grants entirely, so a future policy mistake cannot quietly open them.
revoke insert, update, delete on public.profiles from authenticated, anon;
revoke insert, update, delete on public.counter_devices from authenticated, anon;
