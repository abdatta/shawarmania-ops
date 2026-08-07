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
-- catalog (they carry outlet_id); child tables scope through their parent FK;
-- person-scoped tables scope through the person's assignments; outlets is the
-- tenancy root itself. Anything else is a failure.

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
      -- Person-scoped: no outlet_id of its own, because the row is about a
      -- PERSON and a person may be at several outlets (multi-outlet-people).
      -- Reach is decided by the person's assignments — `app_may_see_person`
      -- and `app_may_manage_person` — rather than by a column on the row.
      -- Listed by name for the same reason 'tenant-less' is: the next table
      -- with no outlet_id has to be argued for here, not slip through.
      when tbl in ('profiles', 'account_invites', 'account_emails')
        then 'person-scoped'
      when tbl = 'outlets' then 'tenancy-root'
      -- Global: ONE row for the whole business, on purpose. The single
      -- deliberate exception to outlet scoping (global-customer-identity), and
      -- named here rather than inferred so that a second one has to be argued
      -- for in this file. Classification alone proves nothing, which is why
      -- section 6 below tests what the exception actually costs: no outlet
      -- role holds any privilege on it at all.
      when tbl in ('customers', 'expense_categories', 'expense_category_operations')
        then 'global'
      -- Tenant-less: belongs to no outlet at all, because the thing it counts
      -- happens before anybody has an outlet. Listed by name rather than
      -- inferred, so the next table with no outlet_id still has to be argued
      -- for here instead of quietly slipping through.
      when tbl in ('invite_redemption_attempts', 'email_sign_in_attempts',
                   'customer_lookup_attempts')
        then 'tenant-less'
    end as class
  from tables
)
select is(
  coalesce(
    (select string_agg(tbl, ', ' order by tbl) from classified where class is null),
    ''),
  '',
  'every public table is classified outlet-scoped, child-scoped, person-scoped, global, tenancy-root, or tenant-less'
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

-- ---------------------------------------------------------------------------
-- 6. What the one global table costs.
--
-- `customers` is the single table in this schema that belongs to no outlet, so
-- it is the single table where a mistake leaks the whole business at once. The
-- classification above is a label; these are the teeth. Every one of them is a
-- catalog fact, so a later migration that quietly re-grants the table fails
-- here by name rather than in whichever isolation test somebody remembered to
-- write.

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'customers'),
  0::bigint,
  'customers carries no policy: reads go through the two functions or nowhere'
);

select ok(
  not has_table_privilege('authenticated', 'public.customers', 'SELECT')
  and not has_table_privilege('authenticated', 'public.customers', 'INSERT')
  and not has_table_privilege('authenticated', 'public.customers', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.customers', 'DELETE'),
  'no client session holds any privilege on the global customer table'
);

select ok(
  not has_table_privilege('authenticated', 'public.customer_lookup_attempts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.customer_lookup_attempts', 'INSERT'),
  'the lookup counter is readable and writable by nobody but the server'
);

-- The counter records WHO asked and WHEN. A phone column here — raw or hashed,
-- a hash of ten digits being reversible in seconds — would turn a rate limiter
-- into a log of every number anybody ever asked about.
select is(
  coalesce(
    (select string_agg(a.attname, ', ' order by a.attname)
       from pg_attribute a
      where a.attrelid = 'public.customer_lookup_attempts'::regclass
        and a.attnum > 0 and not a.attisdropped
        and a.attname not in ('id', 'caller_id', 'attempted_at')),
    ''),
  '',
  'the lookup counter stores who and when, and nothing about what was asked'
);

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'expense_categories'),
  2::bigint,
  'the business-wide category list has explicit select and insert policies'
);

select ok(
  has_table_privilege('authenticated', 'public.expense_categories', 'SELECT')
  and has_table_privilege('authenticated', 'public.expense_categories', 'INSERT')
  and not has_table_privilege('authenticated', 'public.expense_categories', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.expense_categories', 'DELETE'),
  'category suggestions expose only the two verbs their policy set governs'
);

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'expense_category_operations'),
  2::bigint,
  'the category operation log has explicit owner select and insert policies'
);

select ok(
  has_table_privilege('authenticated', 'public.expense_category_operations', 'SELECT')
  and has_table_privilege('authenticated', 'public.expense_category_operations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.expense_category_operations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.expense_category_operations', 'DELETE'),
  'the category operation log cannot be edited or deleted by a client'
);

-- Security definer is what lets these read a table the caller cannot. Losing
-- it would not fail loudly — it would just start returning nothing.
select is(
  coalesce(
    (select string_agg(p.proname, ', ' order by p.proname)
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('customer_lookup_by_phone', 'customer_create_or_get',
                          'customer_directory', 'app_may_look_up_customer')
        and not p.prosecdef),
    ''),
  '',
  'every customer access function is security definer'
);

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('customer_lookup_by_phone', 'customer_create_or_get',
                        'customer_directory', 'normalize_indian_phone',
                        'app_may_look_up_customer')),
  5::bigint,
  'all five customer identity functions exist'
);

-- ---------------------------------------------------------------------------
-- 7. What the owner-only tables cost.
--
-- The manual ledger's two tables carry `outlet_id`, so section 2 classifies them
-- outlet-scoped and the sweep in 02 proves the ordinary cross-outlet claim about
-- them. Neither notices that they are a stronger case: **no outlet role has any
-- access at all**, at any outlet, including its own. That is stated as a catalog
-- fact here, on the same terms the global customer table is, so a later migration
-- that quietly adds a Franchise Admin branch fails by name rather than in
-- whichever test somebody remembered to write. What the branch would actually
-- permit is proved in 21_manual_ledger.sql.

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('manual_ledger_days', 'manual_ledger_expenses')),
  8::bigint,
  'both manual-ledger tables carry one policy per verb: select, insert, update, delete');

select is(
  coalesce(
    (select string_agg(policyname, ', ' order by policyname)
       from pg_policies
      where schemaname = 'public'
        and tablename in ('manual_ledger_days', 'manual_ledger_expenses')
        and coalesce(qual, '') || coalesce(with_check, '') not like '%app_is_owner%'),
    ''),
  '',
  'every manual-ledger policy is predicated on app_is_owner()');

-- The absence that matters. An outlet predicate here would be the first step by
-- which a notebook the owner alone writes into becomes a surface a manager can
-- reach, and it would do so without failing any other test in this suite.
select is(
  coalesce(
    (select string_agg(policyname, ', ' order by policyname)
       from pg_policies
      where schemaname = 'public'
        and tablename in ('manual_ledger_days', 'manual_ledger_expenses')
        and (coalesce(qual, '') || coalesce(with_check, '') like '%app_outlet_id%'
             or coalesce(qual, '') || coalesce(with_check, '') like '%app_has_role_at%'
             or coalesce(qual, '') || coalesce(with_check, '') like '%app_outlets_for%'
             or coalesce(qual, '') || coalesce(with_check, '') like '%app_role()%')),
    ''),
  '',
  'no manual-ledger policy carries an outlet-role predicate of any kind');

select * from finish();
rollback;
