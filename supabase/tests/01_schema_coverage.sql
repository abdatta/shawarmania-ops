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
      when tbl in (
        'bill_items', 'order_items', 'alert_responses',
        -- Scopes through `menu_discounts`, which carries the outlet. It holds
        -- only two foreign keys and adding an `outlet_id` to it would create a
        -- second answer to the question its parent already answers.
        'menu_discount_categories',
        -- Scopes through `bills`, for the same reason: the bill answers which
        -- outlet a receipt link belongs to, and a column here would be a second
        -- answer able to disagree. Because the catalog-driven matrix in
        -- `02_isolation_matrix.sql` can only discover tables carrying
        -- `outlet_id`, this one's cross-outlet cases are written out by hand in
        -- `50_public_bill_receipt_links.sql`.
        'bill_public_links'
      ) then 'child-scoped'
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
      -- `reserved_expense_categories` joins them for the same reason the other
      -- category tables did: which categories a person may not type is a fact
      -- about the business, not about an outlet, and reserving one retires a
      -- hand-entry path everywhere at once.
      when tbl in ('customers', 'expense_categories', 'expense_category_operations',
                   'reserved_expense_categories')
        then 'global'
      -- Tenant-less: belongs to no outlet at all, because the thing it counts
      -- happens before anybody has an outlet. Listed by name rather than
      -- inferred, so the next table with no outlet_id still has to be argued
      -- for here instead of quietly slipping through.
      when tbl in ('invite_redemption_attempts', 'email_sign_in_attempts',
                   'customer_lookup_attempts')
        then 'tenant-less'
      -- Service-only: belongs to no outlet, and to no signed-in account either.
      -- A stronger claim than 'global', which is reachable and merely not
      -- outlet-scoped. These two hold a live merchant session and a one-time
      -- password, so every client role is refused them outright — by having no
      -- grant AND no policy, proved in 34_aggregator_credentials_and_auth.sql
      -- the way section 6 below proves what the global exception costs.
      -- The public receipt's two: the kill switch with the salt that keeps the
      -- access record's address digests non-reversible, and the access record
      -- itself. Both `service-only` rather than `global`, because nothing in the
      -- app shows anybody who opened a receipt and nothing lets a client flip
      -- the switch -- the Worker's service credential is the only thing that
      -- reaches either. Their teeth are in `51_the_public_receipt_reader.sql`,
      -- including a column-list assertion on the access record so a later
      -- migration cannot quietly add something that identifies the customer.
      when tbl in ('public_receipt_settings', 'bill_public_link_views')
        then 'service-only'
      when tbl in ('aggregator_channel_credentials', 'aggregator_auth_requests')
        then 'service-only'
    end as class
  from tables
)
select is(
  coalesce(
    (select string_agg(tbl, ', ' order by tbl) from classified where class is null),
    ''),
  '',
  'every public table is classified outlet-scoped, child-scoped, person-scoped, global, tenancy-root, tenant-less, or service-only'
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
-- 7. The promoted expense record stays live; the notebook archive stays dark.

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'expenses'),
  3::bigint,
  'the promoted expense table carries select, insert and update policies');

select is(
  coalesce(
    (select string_agg(policyname, ', ' order by policyname)
       from pg_policies
      where schemaname = 'public'
        and tablename = 'expenses'
        and cmd = 'DELETE'),
    ''),
  '',
  'and no delete policy survives on the expense table, which would imply the '
  'verb is reachable');

select is(
  coalesce(
    (select string_agg(policyname, ', ' order by policyname)
      from pg_policies
      where schemaname = 'public'
        and tablename = 'expenses'
        and coalesce(qual, '') || coalesce(with_check, '') not like '%app_account_active%'),
    ''),
  '',
  'every expense policy ends access when the account is deactivated');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'expenses'
      and coalesce(qual, '') || coalesce(with_check, '') like '%app_has_role_at%'),
  3::bigint,
  'and all three expense policies carry the staff branch, so outlet staff keep '
  'the reach this capability exists to give them');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'archived_manual_ledger_days'),
  0::bigint,
  'the notebook archive has no client policy');

select ok(
  not has_table_privilege('authenticated', 'public.archived_manual_ledger_days', 'SELECT')
  and not has_table_privilege('authenticated', 'public.archived_manual_ledger_days', 'INSERT')
  and not has_table_privilege('authenticated', 'public.archived_manual_ledger_days', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.archived_manual_ledger_days', 'DELETE'),
  'the notebook archive grants authenticated clients no verb');

select * from finish();
rollback;
