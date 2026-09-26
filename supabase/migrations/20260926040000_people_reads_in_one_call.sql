-- people-shows-names-first, design D3.
--
-- Every account's identifier facts in one call, for the admin-accounts
-- function's `identifiers` action. It used to assemble them from the Auth user
-- list, three table reads and one fingerprint call per visible account, after
-- two more round trips to resolve the caller: four sequential waves at about
-- 0.3 s each, 2.4 s warm on production on 2026-09-26.
--
-- Service-only, like `account_state_fingerprint`: it reads auth.users and
-- returns every profile, and decides nothing about who may see which of them.
-- The edge function applies `mayManage` and the account-email rule to every row,
-- exactly as before.
--
-- The fingerprint is `account_state_fingerprint` itself, called per row, so the
-- list and every edit's stale-state check share one definition.

create function public.account_identifier_facts()
returns table (
  profile_id uuid,
  auth_email text,
  last_sign_in_at timestamptz,
  account_email text,
  invite_purpose text,
  invite_expires_at timestamptz,
  is_active boolean,
  live_assignments jsonb,
  state_fingerprint text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         u.email::text,
         u.last_sign_in_at,
         e.email,
         i.purpose::text,
         i.expires_at,
         p.is_active,
         coalesce((
           select jsonb_agg(
             jsonb_build_object('role', a.role, 'outlet_id', a.outlet_id) order by a.id
           )
             from public.assignments a
            where a.person_id = p.id
              and a.ended_on is null
         ), '[]'::jsonb),
         public.account_state_fingerprint(p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.account_emails e on e.profile_id = p.id
    -- At most one: account_invites_one_live_per_profile.
    left join public.account_invites i
      on i.profile_id = p.id
     and i.consumed_at is null
     and i.superseded_at is null
     and i.expires_at > now()
   order by p.id
$$;

alter function public.account_identifier_facts() set timezone = 'UTC';

revoke all on function public.account_identifier_facts() from public, anon, authenticated;
grant execute on function public.account_identifier_facts() to service_role;

comment on function public.account_identifier_facts() is
  'Service-only: every account''s sign-in alias, last sign-in, account email, live invite, active flag, live assignments and state fingerprint, in one call. The admin-accounts function filters every row by the caller''s authority.';
