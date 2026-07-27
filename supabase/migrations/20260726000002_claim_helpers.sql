-- Claim helpers.
--
-- RLS policies read scope from JWT claims injected by the access-token hook,
-- never by sub-querying profiles per row — that is both a per-row cost and
-- the recursion trap documented in docs/ARCHITECTURE.md. These two functions
-- are the only way policies look at the claims, so the claim names live in
-- exactly one place.

create or replace function public.app_role()
returns public.app_role
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'app_role', '')::public.app_role
$$;

create or replace function public.app_outlet_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'app_outlet_id', '')::uuid
$$;

-- Business-date resolution: shift the timestamp into Asia/Kolkata (the app's
-- fixed display zone) and subtract the outlet's cutover. A bill rung at 00:20
-- with an 04:00 cutover lands on the previous date. This is the single
-- definition used by validation triggers and seeds; the client implements the
-- same rule in the domain layer.
create or replace function public.app_business_date(ts timestamptz, cutover time)
returns date
language sql
stable
set search_path = ''
as $$
  select ((ts at time zone 'Asia/Kolkata') - (cutover - time '00:00'))::date
$$;

-- Generic updated_at maintenance.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Generic append-only guard: attached as an update/delete trigger to tables
-- whose history must never change (bill items, inventory movements, …).
create or replace function public.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'raise_exception';
end;
$$;

revoke execute on function public.app_role() from public, anon;
revoke execute on function public.app_outlet_id() from public, anon;
revoke execute on function public.app_business_date(timestamptz, time) from public, anon;
grant execute on function public.app_role() to authenticated;
grant execute on function public.app_outlet_id() to authenticated;
grant execute on function public.app_business_date(timestamptz, time) to authenticated;
