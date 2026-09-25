-- ===========================================================================
-- the-ledger-reads-fast-and-keeps-its-place, round three: Billing history and
-- the Drawer stop waiting
--
-- Measured on production on 2026-09-26, read-only, as the owner. Two kinds of
-- cost were left on these two screens, and neither changes a policy, a figure,
-- or who can read what.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes for reads that return almost nothing.
--
-- The manager's open-orders read asks for open orders and paid ones not yet
-- prepared. Production holds none — and finding that out put all 1,468 of
-- Kalyani's orders through the policy first, 80 ms, because the only outlet
-- index led with the business date. This index holds only the rows that read
-- can return.
create index if not exists orders_pipeline_idx
  on public.orders (outlet_id, ordered_at desc)
  where status = 'open' or (status = 'paid' and prepared_at is null);

-- The Drawer's "last forty settled bills" and "the ones that synced late" both
-- order settled bills by `paid_at` and keep forty. Without this they walked every
-- settled bill at the outlet through the policy (80 ms and 60 ms); with it they
-- walk newest first and stop.
create index if not exists bills_settled_recent_idx
  on public.bills (outlet_id, paid_at desc)
  where status = 'settled';

-- ---------------------------------------------------------------------------
-- 2. Billing history's day extras, alongside the bills rather than after them.
--
-- The screen read the day's bills, then waited one more round trip for their
-- effective payments and their historical till labels, both asked for by bill
-- id. This asks for both by outlet and business date instead, so it needs
-- nothing first.
--
-- Security INVOKER, deliberately: it reads `bills` and the payments view as the
-- caller, so RLS decides exactly what it decided for the two reads this
-- replaces, and the till labels come through `billing_event_device_labels`,
-- which keeps its own checks. Nothing here can show a reader more than those
-- reads did.

create function public.billing_history_day_extras(p_outlet_id uuid, p_business_date date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with day as (
    select b.id
      from public.bills b
     where b.outlet_id = p_outlet_id
       and b.business_date = p_business_date
  )
  select jsonb_build_object(
    'payments', coalesce((
      select jsonb_agg(to_jsonb(e))
        from public.effective_bill_payments e
       where e.bill_id in (select id from day)
    ), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', l.event_id, 'label', l.label))
        from public.billing_event_device_labels('bill', array(select id from day)) l
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.billing_history_day_extras(uuid, date) from public;
grant execute on function public.billing_history_day_extras(uuid, date) to authenticated;

comment on function public.billing_history_day_extras(uuid, date) is
  'The effective payments and historical till labels of one outlet-day''s bills, '
  'asked for by outlet and date so Billing history need not wait for bill ids. '
  'Security invoker: RLS decides what it returns.';

-- ---------------------------------------------------------------------------
-- 3. The Drawer's recent bills arrive with their cash.
--
-- The same two reads the Drawer made — the forty most recent settled bills, and
-- the forty most recent settled bills that synced after `p_late_after` — with
-- each bill's cash summed from the effective payments, so the round trip that
-- used to follow for the cash split goes. Security invoker, for the same reason.

create function public.drawer_recent_cash_bills(p_outlet_id uuid, p_late_after timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with nearby as (
    select b.id, b.bill_number, b.paid_at
      from public.bills b
     where b.outlet_id = p_outlet_id and b.status = 'settled'
     order by b.paid_at desc
     limit 40
  ),
  late as (
    select b.id, b.bill_number, b.paid_at, b.synced_at
      from public.bills b
     where b.outlet_id = p_outlet_id and b.status = 'settled'
       and b.synced_at > p_late_after
     order by b.paid_at desc
     limit 40
  ),
  cash as (
    select e.bill_id, sum(e.amount_paise)::bigint as cash_paise
      from public.effective_bill_payments e
     where e.method = 'cash'
       and e.bill_id in (select id from nearby union select id from late)
     group by e.bill_id
  )
  select jsonb_build_object(
    'nearby', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'bill_number', n.bill_number, 'paid_at', n.paid_at,
               'cash_paise', coalesce(c.cash_paise, 0))
             order by n.paid_at desc)
        from nearby n left join cash c on c.bill_id = n.id
    ), '[]'::jsonb),
    'late', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'bill_number', l.bill_number, 'paid_at', l.paid_at,
               'synced_at', l.synced_at, 'cash_paise', coalesce(c.cash_paise, 0))
             order by l.paid_at desc)
        from late l left join cash c on c.bill_id = l.id
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.drawer_recent_cash_bills(uuid, timestamptz) from public;
grant execute on function public.drawer_recent_cash_bills(uuid, timestamptz) to authenticated;

comment on function public.drawer_recent_cash_bills(uuid, timestamptz) is
  'The Drawer''s forty most recent settled bills and forty most recent late-synced '
  'ones, each with its cash from the effective payments. Security invoker: RLS '
  'decides what it returns.';
