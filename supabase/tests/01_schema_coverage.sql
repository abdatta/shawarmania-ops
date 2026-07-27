-- Coverage is enumerated, not remembered. Every table in public must be
-- classified (outlet-scoped / child-scoped / tenancy-root), must have RLS
-- enabled, and every outlet-scoped table must either carry policies or be
-- fully revoked from clients. A new table that nobody thought about fails
-- here, by name, before it can leak anything.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- 1. Row-Level Security is enabled on every table in public.

select is(
  coalesce(
    (select string_agg(tablename, ', ' order by tablename)
       from pg_tables
      where schemaname = 'public' and not rowsecurity),
    ''),
  '',
  'every table in public has row level security enabled (offenders listed on failure)'
);

-- ---------------------------------------------------------------------------
-- 2. Every table is classified. Outlet-scoped tables are discovered from the
-- catalog (they carry outlet_id); the two child tables scope through their
-- parent FK; outlets is the tenancy root itself. Anything else is a failure.

with tables as (
  select c.relname as tbl, c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
classified as (
  select tbl, oid,
    case
      when exists (
        select 1 from pg_attribute a
         where a.attrelid = oid and a.attname = 'outlet_id' and not a.attisdropped
      ) then 'outlet-scoped'
      when tbl in ('bill_items', 'alert_responses') then 'child-scoped'
      when tbl = 'outlets' then 'tenancy-root'
      -- Tenant-less: belongs to no outlet at all, because the thing it counts
      -- happens before anybody has an outlet. Listed by name rather than
      -- inferred, so the next table with no outlet_id still has to be argued
      -- for here instead of quietly slipping through.
      when tbl in ('invite_redemption_attempts') then 'tenant-less'
    end as class
  from tables
)
select is(
  coalesce(
    (select string_agg(tbl, ', ' order by tbl) from classified where class is null),
    ''),
  '',
  'every public table is classified outlet-scoped, child-scoped, tenancy-root, or tenant-less'
);

-- ---------------------------------------------------------------------------
-- 3. Every outlet-scoped and child-scoped table is covered: it either has at
-- least one policy, or clients hold no privilege on it at all (deny-all, the
-- treatment bill_number_counters gets).

with tables as (
  select c.relname as tbl, c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
scoped as (
  select tbl, oid from tables
   where tbl <> 'outlets'
),
uncovered as (
  select tbl from scoped
   where not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = tbl)
     and (
       has_table_privilege('authenticated', oid, 'SELECT')
       or has_table_privilege('authenticated', oid, 'INSERT')
       or has_table_privilege('authenticated', oid, 'UPDATE')
       or has_table_privilege('authenticated', oid, 'DELETE')
     )
)
select is(
  coalesce((select string_agg(tbl, ', ' order by tbl) from uncovered), ''),
  '',
  'every scoped table has policies or is fully revoked from clients'
);

-- ---------------------------------------------------------------------------
-- 4. anon has no privileges anywhere in public: this app has no anonymous
-- surface at all.

with tables as (
  select c.relname as tbl, c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
open_to_anon as (
  select tbl from tables
   where has_table_privilege('anon', oid, 'SELECT')
      or has_table_privilege('anon', oid, 'INSERT')
      or has_table_privilege('anon', oid, 'UPDATE')
      or has_table_privilege('anon', oid, 'DELETE')
)
select is(
  coalesce((select string_agg(tbl, ', ' order by tbl) from open_to_anon), ''),
  '',
  'anon holds no table privileges in public'
);

-- ---------------------------------------------------------------------------
-- 5. The two seeded outlets exist with the owner-confirmed parameters. The
-- isolation suite is meaningless with fewer than two outlets.

select is(
  (select count(*) from public.outlets where code in ('kalyani', 'kanchrapara')),
  2::bigint,
  'both real outlets are seeded'
);

-- Named rather than counted across the table: the claim is about the two real
-- shops, and outlets are creatable in the app now, so a bare count would also
-- be answering "has anything else made an outlet on this database" — a
-- different question with a different answer on every run.
select is(
  (select count(*) from public.outlets
    where id in ('00000000-0000-4000-a000-000000000001',
                 '00000000-0000-4000-a000-000000000002')
      and business_day_cutover = time '04:00' and geofence_radius_m = 150),
  2::bigint,
  'owner-confirmed cutover 04:00 and 150 m geofence on both outlets'
);

select * from finish();
rollback;
