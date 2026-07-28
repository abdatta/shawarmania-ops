-- Deleting an outlet. This migration makes `outlets` the first — and only —
-- client-deletable table in the schema, and it does so as a stated exception
-- rather than as a side effect of adding a button.
--
-- The rule it amends, from 20260726000010_grants_hygiene.sql: nothing in this
-- schema is client-deletable, because history is voided, soft-deleted or
-- corrected rather than removed. That rule protects *history*. An outlet
-- nothing references has none — no staff, no attendance, no bills, no stock,
-- no accounts — so removing it destroys no record of anything that happened.
-- That is the whole argument, and it bounds the exception to this one table.
-- A future table wanting the same treatment argues for itself.
--
-- `is_active` remains the answer for an outlet that traded. Nothing here
-- weakens it: closing is still what a real shop gets, and the app offers this
-- action only once an outlet is already closed.

-- ---------------------------------------------------------------------------
-- The grant, and the policy that decides which rows.
--
-- No `on delete cascade` is added anywhere, and none exists: seventeen columns
-- across the schema reference outlets(id) and not one of them cascades. That
-- absence is the safety property this change rests on — a populated outlet
-- refuses its own deletion in Postgres, with no flag to maintain and no list
-- of tables to keep in step. A migration that adds a cascade has inverted
-- this change.

grant delete on public.outlets to authenticated;  -- Super Admin, by policy

-- Mirrors outlets_insert and outlets_update: same helpers, same shape. The
-- absence of a button is convenience; this is the boundary.
create policy outlets_delete on public.outlets
  for delete to authenticated
  using (public.app_role() = 'super_admin' and public.app_account_active());

-- ---------------------------------------------------------------------------
-- What is still attached, when a delete is refused.
--
-- A refused delete arrives as a foreign-key violation naming a constraint,
-- which is not a sentence anybody can act on. This answers the question the
-- owner actually asked: what is still there?
--
-- The set of tables is read from the catalog rather than listed, so a table
-- added later is covered without anyone remembering to add it — the same
-- instinct that makes 01_schema_coverage.sql enumerate rather than remember.
-- (design D6 sketched this against information_schema; pg_catalog is what the
-- rest of this repo reads, and it carries the column pairing a composite key
-- would need.)
--
-- security definer because the counting must be true rather than
-- RLS-filtered: an owner deciding whether to delete needs the real number, not
-- the number their own visibility permits. It checks the caller's role itself
-- rather than trusting the grant, matching invite_failure_pressure().

create or replace function public.outlet_reference_counts(p_outlet uuid)
returns table (table_name text, row_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref record;
  v_count bigint;
begin
  if not public.app_account_active() or public.app_role() is distinct from 'super_admin' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  -- One row per referencing table, not per foreign key: a table that points at
  -- outlets from two columns is one thing attached, counted once.
  for v_ref in
    select cl.relname::text as tbl,
           c.conrelid as rel,
           string_agg(format('%I = $1', att.attname), ' or ') as predicate
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class cl on cl.oid = c.conrelid
      cross join lateral unnest(c.conkey, c.confkey) as k(local_attnum, ref_attnum)
      join pg_catalog.pg_attribute att
        on att.attrelid = c.conrelid and att.attnum = k.local_attnum
      join pg_catalog.pg_attribute ref
        on ref.attrelid = c.confrelid and ref.attnum = k.ref_attnum
     where c.contype = 'f'
       and c.confrelid = 'public.outlets'::regclass
       and ref.attname = 'id'
     group by cl.relname, c.conrelid
     order by cl.relname
  loop
    execute format('select count(*) from %s where %s', v_ref.rel::regclass, v_ref.predicate)
       into v_count
      using p_outlet;

    -- Only what is actually attached. The caller renders what it is given.
    if v_count > 0 then
      table_name := v_ref.tbl;
      row_count := v_count;
      return next;
    end if;
  end loop;
end;
$$;

revoke execute on function public.outlet_reference_counts(uuid) from public, anon;
grant execute on function public.outlet_reference_counts(uuid) to authenticated, service_role;
