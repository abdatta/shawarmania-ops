-- WhatsApp campaigns (#85): ordered between two dates, and not since.
--
-- The owner, 2026-11-20: "we might occasionally wanna send campaigns to people
-- from a specific date range from the past, and may even further filter down
-- to those who have not visited us again since then. basically we wanna
-- increase revisits."
--
-- So the audience's "Last ordered" filter gains a third reading beside
-- "within N days" and "not for N days":
--
--   {"kind": "between", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "notSince": bool}
--
--   * a settled bill at the outlet with a business date from `from` to `to`,
--     both included, counted on `bills.business_date` like every other
--     recency here, never on a timestamp;
--   * with `notSince`, and no settled bill after `to`: a cancelled bill is
--     not a visit;
--   * a first date after the second, a date that does not exist, a date
--     written any other way, or a key the stretch does not have is
--     `audience_invalid`, never ignored.
--
-- It narrows together with the other filters, and the count, the list and
-- submitting still read this one function, so they cannot disagree.
--
-- **Replaced, not added beside** (design, *Ordered between two dates*): the
-- function the app's three reads and submitting already call is the one that
-- learns the new kind, with today's body otherwise verbatim. Every audience a
-- published build sends has a kind it already knew and takes today's path,
-- and no production build calls it yet: #85 is on staging, not promoted. The
-- owner agreed on 2026-11-20.

-- release-lint: allow function-change — today's body verbatim plus a `between` kind only the new audience sheet writes; every audience a published build sends takes today's path, and #85 has reached no production build yet; the owner agreed on 2026-11-20 (design, Ordered between two dates)
create or replace function public.marketing_audience(p_audience jsonb, p_picked boolean, p_search text)
returns table (customer_id uuid, name text, phone_last4 text, seq integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
  v_today date;
  v_filter jsonb;
  v_list jsonb;
  v_kind text;
  v_ordered text := 'any';
  v_ordered_days integer;
  v_from date;
  v_to date;
  v_not_since boolean := false;
  v_date_shape constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_orders text := 'any';
  v_orders_count bigint;
  v_gold text := 'any';
  v_spend bigint;
  v_campaigns text := 'any';
  v_campaign_days integer;
  v_sort text := 'most_orders';
  v_pick text := 'only';
  v_pick_ids uuid[] := '{}';
  v_query text := regexp_replace(coalesce(p_search, ''), '^\s+|\s+$', '', 'g');
  v_digits text;
  v_loose text;
  v_uuid constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' then
    raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_audience) as k (key)
     where k.key not in ('outletId', 'ordered', 'orders', 'gold', 'spentAtLeastPaise',
                         'campaigns', 'sort', 'picked')
  ) then
    raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_typeof(p_audience -> 'outletId') is distinct from 'string'
     or (p_audience ->> 'outletId') !~ v_uuid then
    raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
  end if;
  v_outlet := (p_audience ->> 'outletId')::uuid;
  select public.app_business_date(now(), o.business_day_cutover) into v_today
    from public.outlets o where o.id = v_outlet;
  if not found then
    raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
  end if;

  v_filter := p_audience -> 'ordered';
  if v_filter is not null and jsonb_typeof(v_filter) <> 'null' then
    v_kind := case when jsonb_typeof(v_filter) = 'object' then v_filter ->> 'kind' end;
    if v_kind is null or v_kind not in ('any', 'within', 'not_within', 'between') then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    v_ordered := v_kind;
    if v_kind in ('within', 'not_within') then
      v_ordered_days := public.marketing_audience_whole(v_filter -> 'days', 3650)::integer;
    elsif v_kind = 'between' then
      -- Two business dates, written YYYY-MM-DD, the first no later than the
      -- second, and a "not since" that is true or false. A key the stretch
      -- does not have is refused, like any other.
      if exists (
           select 1 from jsonb_object_keys(v_filter) as k (key)
            where k.key not in ('kind', 'from', 'to', 'notSince'))
         or jsonb_typeof(v_filter -> 'from') is distinct from 'string'
         or jsonb_typeof(v_filter -> 'to') is distinct from 'string'
         or (v_filter ->> 'from') !~ v_date_shape
         or (v_filter ->> 'to') !~ v_date_shape
         or (v_filter ? 'notSince'
             and jsonb_typeof(v_filter -> 'notSince') not in ('boolean', 'null')) then
        raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
      end if;
      begin
        v_from := (v_filter ->> 'from')::date;
        v_to := (v_filter ->> 'to')::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
      end;
      if v_from > v_to then
        raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
      end if;
      v_not_since := coalesce((v_filter ->> 'notSince')::boolean, false);
    end if;
  end if;

  v_filter := p_audience -> 'orders';
  if v_filter is not null and jsonb_typeof(v_filter) <> 'null' then
    v_kind := case when jsonb_typeof(v_filter) = 'object' then v_filter ->> 'kind' end;
    if v_kind is null or v_kind not in ('any', 'at_least', 'at_most') then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    v_orders := v_kind;
    if v_kind <> 'any' then
      v_orders_count := public.marketing_audience_whole(v_filter -> 'count', 1000000);
    end if;
  end if;

  v_filter := p_audience -> 'gold';
  if v_filter is not null and jsonb_typeof(v_filter) <> 'null' then
    if jsonb_typeof(v_filter) <> 'string'
       or (v_filter #>> '{}') not in ('any', 'gold', 'not_gold') then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    v_gold := v_filter #>> '{}';
  end if;

  v_filter := p_audience -> 'spentAtLeastPaise';
  if v_filter is not null and jsonb_typeof(v_filter) <> 'null' then
    v_spend := public.marketing_audience_whole(v_filter, 100000000000);
  end if;

  v_filter := p_audience -> 'campaigns';
  if v_filter is not null and jsonb_typeof(v_filter) <> 'null' then
    v_kind := case when jsonb_typeof(v_filter) = 'object' then v_filter ->> 'kind' end;
    if v_kind is null or v_kind not in ('any', 'never', 'not_within') then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    v_campaigns := v_kind;
    if v_kind = 'not_within' then
      v_campaign_days := public.marketing_audience_whole(v_filter -> 'days', 3650)::integer;
    end if;
  end if;

  v_filter := p_audience -> 'sort';
  if v_filter is not null and jsonb_typeof(v_filter) <> 'null' then
    if jsonb_typeof(v_filter) <> 'string'
       or (v_filter #>> '{}') not in ('most_orders', 'most_recent', 'longest_away') then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    v_sort := v_filter #>> '{}';
  end if;

  -- Who is picked: a kind and a list of customer ids. More ids than any outlet
  -- has customers is not a pick, it is a mistake.
  v_filter := p_audience -> 'picked';
  if v_filter is not null and jsonb_typeof(v_filter) <> 'null' then
    v_kind := case when jsonb_typeof(v_filter) = 'object' then v_filter ->> 'kind' end;
    if v_kind is null or v_kind not in ('all', 'only') then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    v_list := coalesce(
      v_filter -> (case when v_kind = 'all' then 'except' else 'ids' end), '[]'::jsonb);
    if jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) > 5000 then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_list) as e (value)
       where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ v_uuid
    ) then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    select coalesce(array_agg((e.value #>> '{}')::uuid), '{}'::uuid[]) into v_pick_ids
      from jsonb_array_elements(v_list) as e (value);
    v_pick := v_kind;
  end if;

  -- The search. Digits first: `+91` is the country, never part of what is
  -- looked for. Whatever is typed reaches LIKE escaped, so a `%` in a search
  -- is a percent sign and not a wildcard.
  if v_query ~ '^[+0-9[:space:]-]+$' then
    v_digits := regexp_replace(v_query, '[^0-9]', '', 'g');
    if (v_query like '+%' or length(v_digits) > 10) and v_digits like '91%' then
      v_digits := substr(v_digits, 3);
    end if;
    if length(v_digits) < 3 then
      v_digits := null;
    end if;
  elsif length(v_query) >= 3 then
    select '%' || string_agg(
             replace(replace(replace(s.ch, '\', '\\'), '%', '\%'), '_', '\_'), '%' order by s.n)
           || '%'
      into v_loose
      from regexp_split_to_table(lower(v_query), '') with ordinality as s (ch, n);
  end if;

  return query
  with activity as (
    -- One settled bill is one order; a cancelled bill counts for nothing.
    select b.customer_id as cid,
           count(*) as orders,
           sum(b.total_paise)::bigint as spend,
           max(b.business_date) as last_date,
           -- A settled bill inside the stretch, when one is asked for.
           coalesce(bool_or(b.business_date between v_from and v_to), false) as in_stretch
      from public.bills b
     where b.outlet_id = v_outlet
       and b.customer_id is not null
       and b.status = 'settled'
     group by b.customer_id
  ),
  handed as (
    select r.customer_id as cid, max(r.sent_at) as last_sent
      from public.marketing_campaign_recipients r
     where r.sent_at is not null
     group by r.customer_id
  ),
  matched as (
    select c.id as cid, c.name as cname, c.phone as cphone, a.orders, a.last_date,
           -- Whether the filters match. Picks are not filters.
           ((case v_ordered
               when 'any' then true
               -- Not since: no settled bill after the stretch's last date.
               when 'between' then a.in_stretch and (not v_not_since or a.last_date <= v_to)
               else (a.last_date >= v_today - v_ordered_days) = (v_ordered = 'within')
             end)
            and (v_orders <> 'at_least' or a.orders >= v_orders_count)
            and (v_orders <> 'at_most' or a.orders <= v_orders_count)
            and (v_gold = 'any'
                 or public.customer_is_member(c.id, v_outlet) = (v_gold = 'gold'))
            and (v_spend is null or a.spend >= v_spend)
            and (v_campaigns <> 'never' or h.last_sent is null)
            and (v_campaigns <> 'not_within'
                 or h.last_sent is null
                 or h.last_sent < now() - make_interval(days => v_campaign_days))) as passes
      from activity a
      join public.customers c on c.id = a.cid
      left join handed h on h.cid = c.id
     where not exists (select 1 from public.marketing_stopped s where s.customer_id = c.id)
  ),
  picked as (
    select m.cid, m.cname, right(m.cphone, 4) as last4, m.orders, m.last_date
      from matched m
     where case
             when not p_picked then m.passes
             when v_pick = 'only' then m.cid = any (v_pick_ids)
             else m.passes and not (m.cid = any (v_pick_ids))
           end
       and (v_digits is null or right(m.cphone, 10) like '%' || v_digits || '%')
       and (v_loose is null or lower(coalesce(m.cname, '')) like v_loose escape '\')
  )
  -- Every order is total, down to the id, so two pages of one list neither
  -- repeat nor skip anybody.
  select p.cid, p.cname, p.last4,
         (row_number() over (
            order by
              case when v_sort = 'most_orders' then p.orders end desc nulls last,
              case when v_sort = 'longest_away' then p.last_date end asc nulls last,
              case when v_sort <> 'longest_away' then p.last_date end desc nulls last,
              p.cid))::integer
    from picked p
   order by 4;
end;
$$;
