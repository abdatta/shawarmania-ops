-- Where an uploaded statement is kept, reachable only from the outlets it names.
--
-- This is the first use of Supabase Storage in the repo, and it carries the same
-- rule the database enforces everywhere else: a file about one outlet is not
-- another outlet's to read. The rule lives where the file is stored, on
-- `storage.objects`, so a guessed path is refused by the database rather than by
-- the absence of a link on a screen.
--
-- The path is `<outlet_id>/<channel>/<uploaded>-<name>`, so the first folder IS
-- the outlet, and the policy reads it straight from the object name. Entitlement
-- is the ledger's own: the owner everywhere, a manager where they are assigned.
-- A statement covers a period's revenue, so this is the ledger boundary rather
-- than the wider expenses one — the same authority that may upload a Zomato file.

insert into storage.buckets (id, name, public)
values ('operator-statements', 'operator-statements', false)
on conflict (id) do nothing;

-- The outlet a stored object belongs to: its first path segment, as a uuid, or
-- null if the name is not shaped like one — which no policy then grants.
create or replace function public.operator_statement_outlet(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $outlet$
  select case
    when (storage.foldername(object_name))[1] ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[1])::uuid
    else null
  end;
$outlet$;

-- May the caller reach a statement about this outlet? The owner may reach any;
-- a manager, only the outlets they hold. Null outlet — a malformed path — is
-- reachable by nobody.
create or replace function public.may_reach_operator_statement(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $may$
  select case
    when public.operator_statement_outlet(object_name) is null then false
    when public.app_is_owner() then true
    else public.app_person_assigned_at(
           (select auth.uid()),
           public.operator_statement_outlet(object_name))
  end;
$may$;

revoke execute on function public.may_reach_operator_statement(text) from public, anon;
grant execute on function public.may_reach_operator_statement(text) to authenticated;

create policy operator_statements_readable
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'operator-statements'
    and public.may_reach_operator_statement(name)
  );

create policy operator_statements_writable
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'operator-statements'
    and public.may_reach_operator_statement(name)
  );

-- No update and no delete policy: a statement is evidence, kept as supplied. A
-- wrong upload is superseded by a right one, not edited in place.
