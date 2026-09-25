-- ===========================================================================
-- the-ledger-reads-fast-and-keeps-its-place, round three corrected: the two
-- new reads ask the payments view for a list of bills, not a subquery
--
-- Round three shipped both functions filtering `effective_bill_payments` with
-- `bill_id in (select …)`. Postgres does not carry that semi-join into the view's
-- two branches, so each call walked every payment the caller can see through
-- the policies: ~390 ms of database time, and on production (2026-09-26) both
-- screens got slower, not faster — Billing history 1.0 s → 2.1 s, the Drawer
-- 1.4 s → 1.9 s.
--
-- The same filter written as `bill_id = any(array(select …))` reaches both
-- branches as an index condition. Measured on production data, as the owner,
-- before this shipped: 6.7 ms against 390 ms for one day at Kalyani. The answers
-- are unchanged, and `supabase/tests/60_…` still holds both functions to the
-- reads they replace.
-- ===========================================================================

create or replace function public.billing_history_day_extras(p_outlet_id uuid, p_business_date date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'payments', coalesce((
      select jsonb_agg(to_jsonb(e))
        from public.effective_bill_payments e
       where e.bill_id = any(array(
         select b.id from public.bills b
          where b.outlet_id = p_outlet_id and b.business_date = p_business_date
       ))
    ), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', l.event_id, 'label', l.label))
        from public.billing_event_device_labels('bill', array(
          select b.id from public.bills b
           where b.outlet_id = p_outlet_id and b.business_date = p_business_date
        )) l
    ), '[]'::jsonb)
  )
$$;

create or replace function public.drawer_recent_cash_bills(p_outlet_id uuid, p_late_after timestamptz)
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
       and e.bill_id = any(array(select id from nearby union select id from late))
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
