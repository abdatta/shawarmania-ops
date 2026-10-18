-- billing-history-reads-what-it-shows
--
-- Two reads, and nothing else: no table, column, policy, trigger or changed
-- function, and no published build calls either. A revert leaves them unused.
--
-- `billing_history_bills` is one page of an outlet-day's bills as the Bills
-- tab's folded cards print them, sorted and filtered by the server over the
-- whole day (design D1). It runs as the caller, so `bills_select` decides what
-- is seen, exactly as the bills read it replaces did.
--
-- `billing_day_numbers` is everything Billing history shows about the day as a
-- figure (design D2): Cash and UPI by #76's revenue definition, the bill
-- counts, #78's Stats, the day's sync refusals and the newest command, the open
-- orders, and the day's tablets. It refuses everyone but the owner and the
-- outlet's franchise admins, with `billing_day_stats`'s guard.
--
-- Every read of `effective_bill_payments` here names its bills as an array.
-- With `bill_id in (select …)` the view does not push the predicate down and
-- scans every bill under `bills_select`: 1.1 s against 50 ms on production's
-- busiest day (design D13).

create function public.billing_history_bills(
  p_outlet_id uuid,
  p_business_date date,
  p_filter jsonb default '{}'::jsonb,
  p_limit integer default 30,
  p_after jsonb default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with args as (
    select coalesce(p_filter->>'sort', 'paid') as sort,
           coalesce((p_filter->>'descending')::boolean, true) as descending,
           array(select jsonb_array_elements_text(coalesce(p_filter->'kinds', '[]'))) as kinds,
           array(select jsonb_array_elements_text(coalesce(p_filter->'tenders', '[]'))) as tenders,
           coalesce(p_filter->>'customer', 'all') as customer,
           array(select jsonb_array_elements_text(coalesce(p_filter->'services', '[]'))) as services,
           array(select jsonb_array_elements_text(coalesce(p_filter->'traits', '[]'))) as traits,
           array(select jsonb_array_elements_text(coalesce(p_filter->'tablets', '[]'))) as tablets,
           (p_after->>'k')::bigint as after_k,
           (p_after->>'n')::integer as after_n,
           least(greatest(coalesce(p_limit, 30), 1), 100) as page
  ),
  day as materialized (
    select b.*
      from public.bills b
     where b.outlet_id = p_outlet_id and b.business_date = p_business_date
  ),
  pay as (
    select e.bill_id,
           jsonb_agg(to_jsonb(e) order by e.method) as payments,
           count(distinct e.method) as methods,
           min(e.method::text) as method,
           coalesce(max(e.revision), 0) as revision
      from public.effective_bill_payments e
     where e.bill_id = any(array(select d.id from day d))
     group by e.bill_id
  ),
  labels as (
    select l.event_id, l.label
      from public.billing_event_device_labels('bill', array(select d.id from day d)) l
  ),
  facts as (
    select d.id, d.bill_number, d.status, d.void_kind, d.paid_at, d.ordered_at, d.total_paise,
           d.entry_source, d.recorded_after_shift_end,
           -- A legacy bill with no payment rows names its tender on itself.
           coalesce(case when p.methods > 1 then 'mixed' else p.method end,
                    d.payment_method::text) as tender,
           coalesce(p.payments, '[]'::jsonb) as payments,
           coalesce(p.revision, 0) as payment_revision,
           (select pr.full_name from public.profiles pr where pr.id = d.biller_profile_id) as biller_name,
           l.label as till_label,
           -- #78's kinds: a void with no kind is a legacy manager's.
           case
             when d.status <> 'void' then 'paid'
             when d.void_kind = 'cancelled_after_paid' then 'cancelled_after_paid'
             when d.void_kind = 'counter_unpay' then 'payment_undone'
             else 'cancelled'
           end as kind,
           nullif(btrim(coalesce(d.customer_phone, '')), '') is not null as has_number,
           d.customer_tier,
           d.service_type,
           exists (select 1 from public.bill_discounts x where x.bill_id = d.id) as has_discount,
           exists (select 1 from public.bill_receipt_deliveries r
                    where r.bill_id = d.id and r.state = 'failed') as receipt_failed
      from day d
      left join pay p on p.bill_id = d.id
      left join labels l on l.event_id = d.id
  ),
  matching as (
    select f.*,
           -- The sort key in exact integers: microseconds for times and the
           -- wait, paise for the amount, so the cursor compares what ordered.
           case a.sort
             when 'ordered' then floor(extract(epoch from f.ordered_at) * 1000000)::bigint
             when 'amount' then f.total_paise::bigint
             when 'wait' then floor(extract(epoch from f.paid_at - f.ordered_at) * 1000000)::bigint
             else floor(extract(epoch from f.paid_at) * 1000000)::bigint
           end as k
      from facts f, args a
     where (cardinality(a.kinds) = 0 or f.kind = any(a.kinds))
       and (cardinality(a.tenders) = 0 or f.tender = any(a.tenders))
       and case a.customer
             when 'with_number' then f.has_number
             -- A name alone is no way to find a customer again.
             when 'without' then not f.has_number
             when 'gold' then f.customer_tier is not distinct from 'gold'
             else true
           end
       and (cardinality(a.services) = 0 or f.service_type::text = any(a.services))
       and (cardinality(a.traits) = 0
            or ('discount' = any(a.traits) and f.has_discount)
            or ('payment_changed' = any(a.traits) and f.payment_revision > 0)
            or ('receipt_failed' = any(a.traits) and f.receipt_failed))
       and (cardinality(a.tablets) = 0 or f.till_label = any(a.tablets))
  ),
  page as (
    select m.*
      from matching m, args a
     where a.after_k is null
        or (a.descending and (m.k, m.bill_number) < (a.after_k, a.after_n))
        or (not a.descending and (m.k, m.bill_number) > (a.after_k, a.after_n))
     order by case when a.descending then m.k end desc,
              case when a.descending then m.bill_number end desc,
              case when not a.descending then m.k end asc,
              case when not a.descending then m.bill_number end asc
     limit (select page from args)
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'bill_number', p.bill_number,
               'status', p.status,
               'void_kind', p.void_kind,
               'paid_at', p.paid_at,
               'ordered_at', p.ordered_at,
               'total_paise', p.total_paise,
               'tender', p.tender,
               'payments', p.payments,
               'payment_revision', p.payment_revision,
               'biller_name', p.biller_name,
               'till_label', p.till_label,
               'entry_source', p.entry_source,
               'recorded_after_shift_end', p.recorded_after_shift_end,
               'cursor', jsonb_build_object('k', p.k, 'n', p.bill_number))
             order by case when a.descending then p.k end desc,
                      case when a.descending then p.bill_number end desc,
                      case when not a.descending then p.k end asc,
                      case when not a.descending then p.bill_number end asc)
        from page p, args a
    ), '[]'::jsonb),
    'matching', (select count(*) from matching))
$$;

revoke all on function public.billing_history_bills(uuid, date, jsonb, integer, jsonb)
  from public, anon;
grant execute on function public.billing_history_bills(uuid, date, jsonb, integer, jsonb)
  to authenticated;

create function public.billing_day_numbers(p_outlet_id uuid, p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutover time;
  v_figures jsonb;
  v_result jsonb;
begin
  if p_outlet_id is null
     or not public.app_device_ok()
     or not public.app_account_active()
     or not (public.app_is_owner()
             or p_outlet_id in (select public.app_outlets_for('franchise_admin'))) then
    raise exception 'only the owner or this outlet''s managers read its day'
      using errcode = '42501';
  end if;
  if p_business_date is null then
    raise exception 'Choose a day' using errcode = 'invalid_parameter_value';
  end if;

  select o.business_day_cutover into v_cutover from public.outlets o where o.id = p_outlet_id;
  v_figures := public.revenue_figures(p_outlet_id, p_business_date, p_business_date);

  with day_bills as materialized (
    select b.id, b.status
      from public.bills b
     where b.outlet_id = p_outlet_id and b.business_date = p_business_date
  ),
  refusals as (
    -- A command belongs to the business day it was received on, through the
    -- outlet's cutover: `business_date` is null on commands about no bill or
    -- order. The window around the day keeps the read on the outlet's index.
    select c.id, c.command_type, c.result_category, c.received_at,
           case when jsonb_typeof(c.result->'orderNumber') = 'number'
                then (c.result->>'orderNumber')::integer end as order_number
      from public.billing_commands c
     where c.outlet_id = p_outlet_id
       and c.received_at >= p_business_date - interval '1 day'
       and c.received_at < p_business_date + interval '2 days'
       and public.app_business_date(c.received_at, v_cutover) = p_business_date
       and c.result_category not in ('accepted', 'replay', 'applied', 'corrected', 'discarded')
  ),
  day_orders as (
    select o.status, o.total_paise
      from public.orders o
     where o.outlet_id = p_outlet_id
       and o.business_date = p_business_date
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
  )
  select jsonb_build_object(
    'cashPaise', (v_figures->>'cashPaise')::bigint,
    'upiPaise', (v_figures->>'upiPaise')::bigint,
    'settledBills', (select count(*) from day_bills where status = 'settled'),
    'bills', (select count(*) from day_bills),
    'stats', public.billing_day_stats(p_outlet_id, p_business_date),
    'refusals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'command_type', r.command_type,
               'result_category', r.result_category,
               'received_at', r.received_at,
               'order_number', r.order_number)
             order by r.received_at desc)
        from refusals r), '[]'::jsonb),
    'newestCommandAt', (
      select c.received_at from public.billing_commands c
       where c.outlet_id = p_outlet_id
       order by c.received_at desc limit 1),
    'openOrders', (select count(*) from day_orders),
    'unpaidPaise', (select coalesce(sum(total_paise), 0)::bigint from day_orders where status = 'open'),
    'tablets', coalesce((
      select jsonb_agg(distinct l.label order by l.label)
        from public.billing_event_device_labels('bill', array(select d.id from day_bills d)) l
       where l.label is not null), '[]'::jsonb))
    into v_result;
  return v_result;
end $$;

revoke all on function public.billing_day_numbers(uuid, date) from public, anon;
grant execute on function public.billing_day_numbers(uuid, date) to authenticated;
