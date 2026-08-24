-- Carry every typed Swiggy fact into legacy provenance, losslessly.
--
-- Task 9.1 of swiggy-settlement-sync: before any column is removed and before
-- any authoritative write lands, each recorded Swiggy revenue and commission
-- figure on manual_ledger_days becomes an immutable aggregator_channel_days
-- row with origin 'legacy_typed' - never 'supplied_by_hand', because no
-- operator-issued statement proved it.
--
-- The migration refuses to complete unless row-for-row counts, sums and every
-- individual value survive identically. A partial carry is not a carry.

do $$
declare
  v_src_count bigint;
  v_src_rev bigint;
  v_src_comm bigint;
  v_dst_count bigint;
  v_dst_rev bigint;
  v_dst_comm bigint;
  v_mismatched text;
begin
  select count(*),
         coalesce(sum(d.swiggy_revenue_paise), 0),
         coalesce(sum(d.swiggy_commission_paise), 0)
    into v_src_count, v_src_rev, v_src_comm
  from public.manual_ledger_days d
 where d.swiggy_revenue_paise is not null
    or d.swiggy_commission_paise is not null;

  if v_src_count = 0 then
    -- A database whose history holds no typed Swiggy figures carries nothing,
    -- which ties trivially; production refuses only a PARTIAL carry below.
    raise notice 'no typed Swiggy facts found to carry';
    return;
  end if;

  insert into public.aggregator_channel_days
    (outlet_id, channel, business_date, revenue_paise, commission_paise,
     net_paise, settlement_state, origin, source_ref)
  select d.outlet_id,
         'swiggy',
         d.business_date,
         d.swiggy_revenue_paise,
         d.swiggy_commission_paise,
         d.swiggy_revenue_paise - d.swiggy_commission_paise,
         'settled',
         'legacy_typed',
         'manual:' || d.business_date::text
  from public.manual_ledger_days d
 where d.swiggy_revenue_paise is not null
    or d.swiggy_commission_paise is not null;

  select count(*),
         coalesce(sum(c.revenue_paise), 0),
         coalesce(sum(c.commission_paise), 0)
    into v_dst_count, v_dst_rev, v_dst_comm
  from public.aggregator_channel_days c
 where c.channel = 'swiggy'
   and c.origin = 'legacy_typed';

  if v_dst_count is distinct from v_src_count
     or v_dst_rev is distinct from v_src_rev
     or v_dst_comm is distinct from v_src_comm then
    raise exception
      'legacy Swiggy carry does not tie: % rows vs %, revenue % vs % paise, commission % vs % paise',
      v_dst_count, v_src_count, v_dst_rev, v_src_rev, v_dst_comm, v_src_comm
      using errcode = '23514';
  end if;

  select string_agg(src.business_date::text || '@' || left(src.outlet_id::text, 8), ', ')
    into v_mismatched
  from (
    select d.outlet_id, d.business_date, d.swiggy_revenue_paise, d.swiggy_commission_paise
      from public.manual_ledger_days d
     where d.swiggy_revenue_paise is not null
        or d.swiggy_commission_paise is not null
  ) src
  join public.aggregator_channel_days c
    on c.outlet_id = src.outlet_id
   and c.channel = 'swiggy'
   and c.business_date = src.business_date
   and c.origin = 'legacy_typed'
  where c.revenue_paise is distinct from src.swiggy_revenue_paise
     or c.commission_paise is distinct from src.swiggy_commission_paise;

  if v_mismatched is not null then
    raise exception 'carried values differ on: %', v_mismatched
      using errcode = '23514';
  end if;
end
$$;
