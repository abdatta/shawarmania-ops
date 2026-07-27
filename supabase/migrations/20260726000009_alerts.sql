-- Alerts — the one place a Franchise Admin deliberately writes data the
-- Super Admin reads, and the only cross-role write path in the system.

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  raised_by uuid not null references public.profiles (id),
  subject text not null,
  message text not null,
  category public.alert_category not null,
  priority public.alert_priority not null default 'normal',
  status public.alert_status not null default 'open',
  created_at timestamptz not null default now()
);

create index alerts_outlet_id_idx on public.alerts (outlet_id);

alter table public.alerts enable row level security;

create table public.alert_responses (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts (id),
  responder_profile_id uuid not null references public.profiles (id),
  message text not null,
  created_at timestamptz not null default now()
);

create index alert_responses_alert_id_idx on public.alert_responses (alert_id);

alter table public.alert_responses enable row level security;

revoke update, delete on public.alert_responses from authenticated, anon;

-- Status is the only mutable thing about an alert; the report itself is a
-- record, not a draft.
create or replace function public.alerts_status_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'only an alert''s status may change after it is raised';
  end if;
  return new;
end;
$$;

create trigger alerts_status_only
  before update on public.alerts
  for each row execute function public.alerts_status_only();

-- ---------------------------------------------------------------------------
-- Policies. Franchise Admin raises and reads own outlet's thread; Super
-- Admin reads everything, responds, and works the status.

create policy alerts_select on public.alerts
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy alerts_insert on public.alerts
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_role() = 'franchise_admin'
    and outlet_id = public.app_outlet_id()
    and raised_by = auth.uid()
  );

create policy alerts_update on public.alerts
  for update to authenticated
  using (public.app_account_active() and public.app_role() = 'super_admin')
  with check (public.app_account_active() and public.app_role() = 'super_admin');

-- Responses: visibility flows through the parent alert.
create policy alert_responses_select on public.alert_responses
  for select to authenticated
  using (exists (select 1 from public.alerts a where a.id = alert_id));

create policy alert_responses_insert on public.alert_responses
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_role() = 'super_admin'
    and responder_profile_id = auth.uid()
    and exists (select 1 from public.alerts a where a.id = alert_id)
  );
