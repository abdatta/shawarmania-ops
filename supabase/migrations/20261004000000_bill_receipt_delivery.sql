-- #59: one automatic receipt submission per new paid bill. No browser sender,
-- no backfill, no phone/message copies, and no network dependency in payment.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table public.bill_receipt_delivery_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  enabled_at timestamptz
);
insert into public.bill_receipt_delivery_settings (id) values (true);
alter table public.bill_receipt_delivery_settings enable row level security;
revoke all on public.bill_receipt_delivery_settings from public, anon, authenticated;
grant all on public.bill_receipt_delivery_settings to service_role;

create table public.bill_receipt_deliveries (
  bill_id uuid primary key,
  outlet_id uuid not null references public.outlets(id),
  state text not null default 'queued' check
    (state in ('queued', 'sending', 'submitted', 'delivered', 'failed', 'unknown', 'skipped')),
  earned_points integer not null check (earned_points >= 0),
  balance_points integer not null,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  submitted_at timestamptz,
  reported_at timestamptz,
  provider_request_id text unique,
  failure_code text check (failure_code in
    ('provider_rejected', 'provider_failed', 'submission_unknown', 'bill_unavailable', 'invalid_points')),
  constraint bill_receipt_deliveries_bill_outlet_fkey foreign key (bill_id, outlet_id)
    references public.bills(id, outlet_id)
);
create index bill_receipt_deliveries_queue_idx
  on public.bill_receipt_deliveries(queued_at) where state = 'queued';
alter table public.bill_receipt_deliveries enable row level security;
revoke all on public.bill_receipt_deliveries from public, anon, authenticated;
grant select on public.bill_receipt_deliveries to authenticated;
grant all on public.bill_receipt_deliveries to service_role;
create policy bill_receipt_deliveries_read on public.bill_receipt_deliveries
  for select to authenticated using (
    public.app_account_active() and
    (public.app_is_owner() or public.app_has_role_at('franchise_admin', outlet_id))
  );

-- The wakeup contains no bill facts. pg_net only transmits after commit.
create function public.bill_receipt_wake() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.bill_receipt_delivery_settings where enabled)
    or not exists (select 1 from public.bill_receipt_deliveries where state = 'queued') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'receipt_delivery_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'receipt_delivery_worker_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-receipt-worker-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
exception when others then
  -- Durable work is still queued. The next cron wakeup recovers it. Never log
  -- the exception: HTTP diagnostics can contain the worker credential.
  return;
end;
$$;

create function public.bill_receipt_enqueue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_bill public.bills%rowtype; v_earned integer; v_balance integer;
begin
  select * into v_bill from public.bills where id = new.id;
  if v_bill.status <> 'settled' or v_bill.customer_id is null
    or not coalesce(v_bill.customer_phone ~ '^\+91[6-9][0-9]{9}$', false)
    or not exists (select 1 from public.bill_receipt_delivery_settings s
                    where s.enabled and v_bill.paid_at >= s.enabled_at) then return null; end if;
  select coalesce(sum(points) filter (where kind = 'earned'), 0)::integer into v_earned
    from public.customer_points_entries where bill_id = v_bill.id;
  select balance_after into v_balance from public.customer_points_entries
    where bill_id = v_bill.id and kind in ('earned', 'used')
    order by case when kind = 'earned' then 1 else 0 end desc, created_at desc limit 1;
  if v_balance is null then
    -- Even when this bill earned zero, its existing balance is still real.
    perform pg_advisory_xact_lock(hashtextextended(
      'points:' || v_bill.outlet_id::text || ':' || v_bill.customer_id::text, 0));
    select coalesce(sum(points), 0)::integer into v_balance from public.customer_points_entries
      where customer_id = v_bill.customer_id and outlet_id = v_bill.outlet_id;
  end if;
  insert into public.bill_receipt_deliveries(bill_id, outlet_id, earned_points, balance_points)
    values (v_bill.id, v_bill.outlet_id, v_earned, v_balance) on conflict (bill_id) do nothing;
  perform public.bill_receipt_wake();
  return null;
end;
$$;
-- Deferred constraints fire in trigger-name order for the INSERT event. 'receipt'
-- follows 'points', so all point rows exist before the SMS snapshot is written.
create constraint trigger bills_receipt_after_settle after insert on public.bills
  deferrable initially deferred for each row execute function public.bill_receipt_enqueue();

create function public.bill_receipt_claim(p_limit integer default 10)
returns table (bill_id uuid, mobile text, earned integer, balance integer, token text)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.bill_receipt_delivery_settings where enabled) then return; end if;
  update public.bill_receipt_deliveries d set state = 'skipped', failure_code = 'bill_unavailable'
    where d.state = 'queued' and not exists (
      select 1 from public.bills b join public.bill_public_links l on l.bill_id = b.id
      where b.id = d.bill_id and b.status = 'settled' and l.revoked_at is null);
  return query
    with candidates as (
      select d.bill_id from public.bill_receipt_deliveries d
      where d.state = 'queued' order by d.queued_at, d.bill_id
      for update skip locked limit greatest(1, least(coalesce(p_limit, 10), 10))
    ), claimed as (
      update public.bill_receipt_deliveries d set state = 'sending', claimed_at = clock_timestamp()
      from candidates c where d.bill_id = c.bill_id returning d.*
    )
    select c.bill_id, substring(b.customer_phone from 2), c.earned_points, c.balance_points, l.token
      from claimed c join public.bills b on b.id = c.bill_id
      join public.bill_public_links l on l.bill_id = c.bill_id;
end;
$$;

create function public.bill_receipt_finish(p_bill uuid, p_state text,
  p_request_id text default null, p_failure_code text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('submitted', 'failed', 'unknown')
    or (p_state = 'submitted' and not coalesce(p_request_id ~ '^[A-Za-z0-9_-]{10,100}$', false)) then
    raise exception 'invalid receipt outcome' using errcode = '22023';
  end if;
  update public.bill_receipt_deliveries set state = p_state,
    provider_request_id = p_request_id, failure_code = p_failure_code,
    submitted_at = case when p_state = 'submitted' then clock_timestamp() else null end
    where bill_id = p_bill and state = 'sending';
  -- A final callback can arrive before this response; never overwrite it.
end;
$$;

create function public.bill_receipt_report(p_bill uuid, p_request_id text, p_state text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row public.bill_receipt_deliveries%rowtype;
begin
  if p_state not in ('delivered', 'failed')
    or not coalesce(p_request_id ~ '^[A-Za-z0-9_-]{10,100}$', false) then return false; end if;
  select * into v_row from public.bill_receipt_deliveries where bill_id = p_bill for update;
  if not found or v_row.state in ('queued', 'skipped')
    or (v_row.provider_request_id is not null and v_row.provider_request_id <> p_request_id) then
    return false;
  end if;
  if v_row.state = 'delivered' then return true; end if;
  if v_row.state = 'failed' and v_row.provider_request_id is null then return false; end if;
  update public.bill_receipt_deliveries set state = p_state, provider_request_id = p_request_id,
    reported_at = clock_timestamp(),
    submitted_at = coalesce(submitted_at, claimed_at),
    failure_code = case when p_state = 'failed' then 'provider_failed' else null end
    where bill_id = p_bill;
  return true;
end;
$$;

create function public.bill_receipt_recover() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bill_receipt_deliveries set state = 'unknown', failure_code = 'submission_unknown'
    where state = 'sending' and claimed_at < clock_timestamp() - interval '2 minutes';
  perform public.bill_receipt_wake();
end;
$$;

create function public.bill_receipt_configure(p_enabled boolean,
  p_url text default null, p_worker_secret text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_url text; v_secret text;
begin
  if p_url is not null then
    if p_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/send-bill-receipts$'
      and p_url !~ '^http://(host\.docker\.internal|kong):[0-9]+/functions/v1/send-bill-receipts$' then
      raise exception 'invalid receipt endpoint' using errcode = '22023';
    end if;
    select id into v_id from vault.secrets where name = 'receipt_delivery_url';
    if v_id is null then perform vault.create_secret(p_url, 'receipt_delivery_url');
    else perform vault.update_secret(v_id, p_url); end if;
  end if;
  if p_worker_secret is not null then
    if length(p_worker_secret) < 32 then
      raise exception 'invalid receipt credential' using errcode = '22023';
    end if;
    select id into v_id from vault.secrets where name = 'receipt_delivery_worker_secret';
    if v_id is null then perform vault.create_secret(p_worker_secret, 'receipt_delivery_worker_secret');
    else perform vault.update_secret(v_id, p_worker_secret); end if;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'receipt_delivery_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'receipt_delivery_worker_secret';
  if p_enabled and (v_url is null or v_secret is null) then
    raise exception 'receipt sender not configured' using errcode = '22023';
  end if;
  update public.bill_receipt_delivery_settings set
    enabled_at = case when p_enabled and not enabled then clock_timestamp() else enabled_at end,
    enabled = p_enabled where id;
end;
$$;

revoke all on function public.bill_receipt_wake() from public, anon, authenticated;
revoke all on function public.bill_receipt_enqueue() from public, anon, authenticated;
revoke all on function public.bill_receipt_claim(integer) from public, anon, authenticated;
revoke all on function public.bill_receipt_finish(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.bill_receipt_report(uuid, text, text) from public, anon, authenticated;
revoke all on function public.bill_receipt_recover() from public, anon, authenticated;
revoke all on function public.bill_receipt_configure(boolean, text, text) from public, anon, authenticated;
grant execute on function public.bill_receipt_claim(integer),
  public.bill_receipt_finish(uuid, text, text, text), public.bill_receipt_report(uuid, text, text),
  public.bill_receipt_configure(boolean, text, text), public.bill_receipt_recover() to service_role;

select cron.schedule('bill-receipt-recovery', '* * * * *', 'select public.bill_receipt_recover()');
