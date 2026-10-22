-- staff-roles-include-other-roles: the two tables it created say who may read
-- them, rather than relying on Supabase's default grants.
--
-- From 30 October 2026 Supabase stops granting new tables in `public` to the
-- Data API roles automatically, on existing projects and on every fresh schema:
-- new projects, preview branches and a local `supabase db reset`. The first
-- migration of this change created `staff_roles` and `staff_role_includes` with
-- read policies for `authenticated` and revoked only the writes, so it relied on
-- the default SELECT grant. Every other table since
-- 20260726000010_grants_hygiene.sql grants explicitly, table by table; these two
-- now do as well. Reads only: a staff role and an includes row are added by a
-- migration, never by a client, and `anon` reads nothing.
--
-- Additive: a grant changes nothing a published build relies on, and the
-- definer helpers that read these tables are unaffected either way.

grant select on public.staff_roles to authenticated;
grant select on public.staff_role_includes to authenticated;

-- The service role is granted table by table, as every table since
-- 20260726000010_grants_hygiene.sql is: the dashboard and the test cleanup use it.
grant all on public.staff_roles to service_role;
grant all on public.staff_role_includes to service_role;
