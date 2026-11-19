-- a-campaign-goes-out-on-whatsapp (#85): the database for WhatsApp campaigns.
--
-- No gate (proposal, Change gate): Campaigns is a new surface the registry
-- holds back, away from the counter and kitchen, with a clean revert.
--
-- The app never sends. It writes rows: a campaign, its recipients cut into
-- batches, a stopped list. A program on the owner's laptop, the sender, signs
-- in as the owner and asks this database what to do, one recipient at a time.
-- So the promises are kept here, where neither half can skip them:
--
--   * nobody but an owner reaches any of it. Five business-wide tables with
--     RLS on, no policy and no client privilege, as `customers` is; every read
--     and write is a security-definer function that checks the owner itself;
--   * a recipient row holds no phone and no name. The number is read at the
--     moment one recipient is handed to the sender, by `campaign_claim_next`
--     and by nothing else;
--   * a batch sends nothing until an owner releases it, one batch at a time
--     across every campaign, one recipient at a time, and only inside the
--     sending window as THIS database's clock reads it;
--   * a recipient left in hand becomes unsure and is never handed over again;
--   * test numbers are the one exception to "no number is stored": up to five
--     numbers an owner types onto a campaign (their own, a friend's), which
--     the sender sends to by itself, with no release and outside the window,
--     ahead of any customer [owner, 2026-11-18]. Customers' numbers are still
--     stored nowhere here.
--
-- Everything here is new: six tables, their functions, one storage bucket. No
-- existing table, function, policy or row is altered, so every published build
-- runs exactly as it does today (design D14). The two statements the migration
-- lint would otherwise refuse are the bucket's own row and its two policies,
-- each admitted where it stands with the reason.
--
-- The sender's seven functions answer as `tools/campaign-sender/src/core/
-- rehearsal-queue.ts` does. That file is the model the sending loop's tests run
-- against; `supabase/tests/99_a_campaign_goes_out_on_whatsapp.sql` holds this
-- file to the same answers.

-- ---------------------------------------------------------------------------
-- 1. The words.

create type public.marketing_campaign_state as enum
  ('draft', 'scheduled', 'paused', 'stopped', 'done');

comment on type public.marketing_campaign_state is
  'Where a campaign is. The pages say "submitted" for scheduled (proposal, '
  'decision 11); the rows keep the design''s word.';

create type public.marketing_batch_state as enum ('waiting', 'released', 'done');

-- `sent` is handed to WhatsApp, not accepted by it: a refusal arrives later as
-- a receipt and turns the row to `failed` (design D6).
create type public.marketing_recipient_state as enum
  ('waiting', 'sending', 'sent', 'unsure', 'failed', 'not_on_whatsapp', 'stopped');

create type public.marketing_stop_source as enum ('reply', 'owner');

create type public.marketing_sender_status as enum
  ('idle', 'sending', 'outside_hours', 'not_linked', 'halted');

-- ---------------------------------------------------------------------------
-- 2. The tables (design D5).

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- As written, with `{name}` still in it. The sender renders it for each
  -- customer with the same function the composer's bubble uses.
  body text not null default '',
  -- A path in the `campaign-images` bucket, under this campaign's own folder.
  image_path text,
  -- The outlet, the filters and the sort as chosen: the app's own document,
  -- read by `marketing_audience`. Null on a draft with nobody chosen yet.
  audience jsonb,
  -- Snapshotted when the campaign is submitted; null while a draft.
  batch_size integer,
  state public.marketing_campaign_state not null default 'draft',
  -- Set when the sender paused the campaign itself.
  paused_reason text,
  -- Numbers an owner typed to try the message on: their own, a friend's. Not
  -- customers, and the one place this database keeps a full number on a
  -- campaign [owner, 2026-11-18]. `+` and digits, at most five.
  test_phones text[] not null default '{}',
  -- When the sender told the owner who submitted it that it had finished
  -- (task 4.7). Null until then.
  finish_notice_sent_at timestamptz,
  -- Never set by the app (proposal, decision 11: a campaign has no start
  -- time). Kept from the design and honoured where a row carries one.
  not_before timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  scheduled_by uuid references public.profiles (id),
  scheduled_at timestamptz,
  finished_at timestamptz,
  constraint marketing_campaigns_name_given
    check (btrim(name) <> '' and char_length(name) <= 120),
  constraint marketing_campaigns_body_bounded check (char_length(body) <= 4096),
  constraint marketing_campaigns_batch_size_range
    check (batch_size is null or batch_size between 1 and 1000),
  constraint marketing_campaigns_submitted_is_complete
    check (state = 'draft'
           or (audience is not null and batch_size is not null
               and scheduled_by is not null and scheduled_at is not null)),
  constraint marketing_campaigns_reason_only_while_paused
    check (paused_reason is null or state = 'paused'),
  constraint marketing_campaigns_test_phones_bounded
    check (cardinality(test_phones) <= 5)
);

comment on table public.marketing_campaigns is
  'A WhatsApp campaign: what is said, to whom, and how far it has got. '
  'Business-wide like `customers`, and reachable only through owner-only '
  'security-definer functions.';

create table public.marketing_campaign_batches (
  campaign_id uuid not null references public.marketing_campaigns (id),
  batch_no integer not null,
  state public.marketing_batch_state not null default 'waiting',
  released_by uuid references public.profiles (id),
  released_at timestamptz,
  finished_at timestamptz,
  primary key (campaign_id, batch_no),
  constraint marketing_campaign_batches_numbered_from_one check (batch_no >= 1)
);

-- One batch sending at a time across every campaign (design D7). An index, so
-- it is the table's rule and not only the release function's habit.
create unique index marketing_campaign_batches_one_released
  on public.marketing_campaign_batches ((true)) where state = 'released';

comment on table public.marketing_campaign_batches is
  'A campaign''s recipients in the batches they were cut into. A batch sends '
  'nothing until an owner releases it on the sender''s own page.';

create table public.marketing_campaign_recipients (
  campaign_id uuid not null references public.marketing_campaigns (id),
  customer_id uuid not null references public.customers (id),
  batch_no integer not null,
  "position" integer not null,
  state public.marketing_recipient_state not null default 'waiting',
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  wa_message_id text,
  failure_code text,
  primary key (campaign_id, customer_id),
  constraint marketing_campaign_recipients_position_key unique (campaign_id, "position"),
  constraint marketing_campaign_recipients_batch_fkey
    foreign key (campaign_id, batch_no)
    references public.marketing_campaign_batches (campaign_id, batch_no),
  constraint marketing_campaign_recipients_numbered_from_one check ("position" >= 1)
);

-- Strictly one recipient in hand at a time, everywhere. The sender's loop is
-- one at a time already; this makes it true whatever calls the claim.
create unique index marketing_campaign_recipients_one_in_hand
  on public.marketing_campaign_recipients ((true)) where state = 'sending';

create index marketing_campaign_recipients_batch_idx
  on public.marketing_campaign_recipients (campaign_id, batch_no, "position");
create index marketing_campaign_recipients_customer_idx
  on public.marketing_campaign_recipients (customer_id);
-- Receipts arrive keyed by message id, a day later included.
create index marketing_campaign_recipients_message_idx
  on public.marketing_campaign_recipients (wa_message_id) where wa_message_id is not null;
create index marketing_campaign_recipients_sent_idx
  on public.marketing_campaign_recipients (sent_at) where sent_at is not null;

comment on table public.marketing_campaign_recipients is
  'One customer in one campaign. **No phone and no name**: the row points at '
  'the customer, and the number is read at the moment of sending, so a number '
  'corrected or a customer stopped after submitting is honoured.';

-- One message to one test number: queued by Send test or by submitting, and
-- sent by the sender as soon as it is connected, with no release, outside the
-- sending window, and ahead of any customer [owner, 2026-11-18]. It carries
-- the message as it stood when it was queued, so a draft edited afterwards
-- does not change a test already on its way. Not counted in a campaign's
-- figures, and the stopped list does not apply: these are the owners' own.
create table public.marketing_campaign_tests (
  id uuid primary key default gen_random_uuid(),
  -- The order they go out in: queued first, and within one press the order
  -- the numbers were typed. Not the time, which one statement gives them all.
  seq bigint generated always as identity,
  campaign_id uuid not null references public.marketing_campaigns (id),
  phone text not null,
  body text not null,
  image_path text,
  state public.marketing_recipient_state not null default 'waiting',
  queued_by uuid not null references public.profiles (id),
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  wa_message_id text,
  failure_code text,
  constraint marketing_campaign_tests_phone_is_full
    check (phone ~ '^\+[1-9][0-9]{7,14}$')
);

-- One message in hand at a time among the tests too; the claims also look at
-- each other's table, so it is one at a time across both.
create unique index marketing_campaign_tests_one_in_hand
  on public.marketing_campaign_tests ((true)) where state = 'sending';
create index marketing_campaign_tests_waiting_idx
  on public.marketing_campaign_tests (seq) where state = 'waiting';
create index marketing_campaign_tests_campaign_idx
  on public.marketing_campaign_tests (campaign_id, seq);

comment on table public.marketing_campaign_tests is
  'A campaign message to one of the owners'' own test numbers. Sent with no '
  'release and outside the window; not a customer, not counted, not stopped.';

create table public.marketing_stopped (
  customer_id uuid primary key references public.customers (id),
  stopped_at timestamptz not null default now(),
  source public.marketing_stop_source not null,
  -- The campaign a reply of STOP answered.
  campaign_id uuid references public.marketing_campaigns (id),
  -- The owner who added them by hand.
  recorded_by uuid references public.profiles (id)
);

create index marketing_stopped_campaign_idx
  on public.marketing_stopped (campaign_id) where campaign_id is not null;

comment on table public.marketing_stopped is
  'Customers who must not be sent campaigns. In no audience, and passed over '
  'at their turn. Removing one deletes the row. Receipts and points do not '
  'read this table.';

create table public.marketing_sender (
  id boolean primary key default true,
  last_seen_at timestamptz,
  status public.marketing_sender_status not null default 'not_linked',
  halt_reason text,
  linked_number_last4 text,
  -- Which installation is the sender. A second one is told to stand down
  -- while this one was seen recently (design D12).
  installation_id text,
  batch_size integer not null default 100,
  window_start time not null default '10:00',
  window_end time not null default '21:00',
  min_gap_seconds integer not null default 45,
  max_gap_seconds integer not null default 90,
  constraint marketing_sender_one_row check (id),
  constraint marketing_sender_last4_is_four_digits
    check (linked_number_last4 is null or linked_number_last4 ~ '^[0-9]{4}$'),
  constraint marketing_sender_batch_size_range check (batch_size between 1 and 1000),
  constraint marketing_sender_gaps_in_order
    check (min_gap_seconds >= 5 and max_gap_seconds >= min_gap_seconds
           and max_gap_seconds <= 3600),
  constraint marketing_sender_window_is_a_span
    check (window_start < time '24:00' and window_start <> window_end)
);

comment on table public.marketing_sender is
  'One row: what the sender last said about itself, and the owner''s settings '
  '(batch size, the sending window in Asia/Kolkata, the gap between messages). '
  'Nothing about linking, which never passes through the database (design D9).';

insert into public.marketing_sender default values;

-- Nobody reads or writes a table. RLS with no policy says it once and the
-- revoked grant says it again, which is what `01_schema_coverage.sql` asks of a
-- business-wide table.
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_batches enable row level security;
alter table public.marketing_campaign_recipients enable row level security;
alter table public.marketing_stopped enable row level security;
alter table public.marketing_sender enable row level security;
alter table public.marketing_campaign_tests enable row level security;

revoke all privileges on public.marketing_campaigns from authenticated, anon;
revoke all privileges on public.marketing_campaign_batches from authenticated, anon;
revoke all privileges on public.marketing_campaign_recipients from authenticated, anon;
revoke all privileges on public.marketing_stopped from authenticated, anon;
revoke all privileges on public.marketing_sender from authenticated, anon;
revoke all privileges on public.marketing_campaign_tests from authenticated, anon;

grant all on public.marketing_campaigns to service_role;
grant all on public.marketing_campaign_batches to service_role;
grant all on public.marketing_campaign_recipients to service_role;
grant all on public.marketing_stopped to service_role;
grant all on public.marketing_sender to service_role;
grant all on public.marketing_campaign_tests to service_role;

-- ---------------------------------------------------------------------------
-- 3. The sending window, on the customers' clock (design D8).
--
-- The same arithmetic as `core/sending-window.ts`: the start is inside and the
-- end is not, and a window whose end is before its start runs through
-- midnight. Asked of the database's clock, so a wrong clock on the laptop
-- cannot message anybody at night.

create function public.marketing_window_at(p_at timestamptz, p_start time, p_end time)
returns table (is_open boolean, opens_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with clock as (
    select (p_at at time zone 'Asia/Kolkata') as local_at
  ),
  reading as (
    select c.local_at,
           case
             when p_start < p_end
               then c.local_at::time >= p_start and c.local_at::time < p_end
             when p_start = p_end then false
             else c.local_at::time >= p_start or c.local_at::time < p_end
           end as inside
      from clock c
  )
  select r.inside,
         case
           when r.inside then null
           when r.local_at::date + p_start > r.local_at
             then (r.local_at::date + p_start) at time zone 'Asia/Kolkata'
           else (r.local_at::date + 1 + p_start) at time zone 'Asia/Kolkata'
         end
    from reading r
$$;

-- ---------------------------------------------------------------------------
-- 4. Who a campaign goes to.
--
-- **One definition**, read by the count, the list and submitting, so what is
-- counted, what is listed and what is cut cannot disagree.
--
-- The audience is the app's own document (`CampaignAudience` in
-- `src/data-access/campaigns.ts`): an outlet, five filters, a sort, and who is
-- picked. A key this function does not know is refused, never ignored: a
-- filter dropped in silence would send to everybody.
--
--   * everybody in it has a settled, uncancelled bill at the outlet, and is
--     not on the stopped list, whatever else is asked;
--   * "within N days" is counted on `bills.business_date` against the outlet's
--     current business date, never on a timestamp, and includes the date
--     exactly N back (the spec's own scenario);
--   * orders are settled bills, and spend is integer paise summed over them;
--   * "sent a campaign" is `sent_at`, handed to WhatsApp, N whole days back
--     from now.
--
-- **The list and the campaign are two readings of it** (proposal, decision
-- 12). The list is everybody the filters match, whoever is ticked, narrowed by
-- a search when one is given. The campaign goes to who is picked: `all` is
-- everybody the filters match but the ones unticked (Select all); `only` is
-- exactly the customers ticked one by one, whatever the filters say now. An
-- audience that does not say who is picked has picked nobody.
--
-- It returns the last four digits of a number and never the number.

create function public.marketing_audience_whole(p_value jsonb, p_max bigint)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then
    raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
  end if;
  v := (p_value #>> '{}')::numeric;
  if v <> trunc(v) or v < 0 or v > p_max then
    raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
  end if;
  return v::bigint;
end;
$$;

-- `p_picked`: true for who the campaign goes to, false for what the list
-- shows. `p_search` narrows the list by the Customers page's rules
-- (`src/domain/customer-search.ts`): three or more digits as one run anywhere
-- in the ten-digit number, or three or more characters anywhere in the saved
-- name, exactly or in order with gaps. Fewer than three narrows nothing.
create function public.marketing_audience(p_audience jsonb, p_picked boolean, p_search text)
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
    if v_kind is null or v_kind not in ('any', 'within', 'not_within') then
      raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
    end if;
    v_ordered := v_kind;
    if v_kind <> 'any' then
      v_ordered_days := public.marketing_audience_whole(v_filter -> 'days', 3650)::integer;
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
           max(b.business_date) as last_date
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
           ((v_ordered = 'any'
             or (a.last_date >= v_today - v_ordered_days) = (v_ordered = 'within'))
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

-- How many customers a campaign would go to now: the picked, the stopped left
-- out.
create function public.campaign_audience_count(p_audience jsonb)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  return (select count(*)::integer from public.marketing_audience(p_audience, true, null));
end;
$$;

-- A page of the list in sending order: everybody the filters match, whoever is
-- ticked, narrowed by a search when one is given. Twenty-one rows come back so
-- the caller knows whether there is a next page without a count.
create function public.campaign_audience_list(
  p_audience jsonb, p_offset integer default 0, p_search text default null)
returns table (customer_id uuid, name text, phone_last4 text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'audience_invalid' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select a.customer_id, a.name, a.phone_last4
      from public.marketing_audience(p_audience, false, p_search) a
     order by a.seq
    offset p_offset limit 21;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. What finishes by itself, and what waits.

-- A released batch with nobody waiting and nobody in hand is done, and a
-- submitted campaign whose every batch is done is done. Called wherever a
-- recipient comes to something.
create function public.marketing_settle_finished()
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.marketing_campaign_batches b
     set state = 'done', finished_at = now()
   where b.state = 'released'
     and not exists (
       select 1 from public.marketing_campaign_recipients r
        where r.campaign_id = b.campaign_id
          and r.batch_no = b.batch_no
          and r.state in ('waiting', 'sending'));

  update public.marketing_campaigns c
     set state = 'done', finished_at = now()
   where c.state = 'scheduled'
     and not exists (
       select 1 from public.marketing_campaign_batches b
        where b.campaign_id = c.id and b.state <> 'done');
end;
$$;

-- The next batch an owner could release: the lowest waiting batch of the
-- campaign submitted first, and none at all while any batch is released.
create function public.marketing_next_waiting_batch()
returns table (campaign_id uuid, batch_no integer, campaign_name text, recipients integer)
language sql
stable
set search_path = ''
as $$
  select b.campaign_id, b.batch_no, c.name,
         (select count(*)::integer from public.marketing_campaign_recipients r
           where r.campaign_id = b.campaign_id and r.batch_no = b.batch_no)
    from public.marketing_campaign_batches b
    join public.marketing_campaigns c on c.id = b.campaign_id
   where b.state = 'waiting'
     and c.state = 'scheduled'
     and (c.not_before is null or c.not_before <= now())
     and not exists (
       select 1 from public.marketing_campaign_batches x where x.state = 'released')
   order by c.scheduled_at, c.id, b.batch_no
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 6. What the pages read: one read for the list, one for a campaign.
--
-- One request each, because Supabase's log allowance is mostly request lines
-- and a campaign's page asks again every minute while a batch is going.

create function public.marketing_sender_reading()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'status', s.status,
    'last_seen_at', s.last_seen_at,
    'halt_reason', s.halt_reason,
    'linked_number_last4', s.linked_number_last4,
    -- The database's own clock: whether the sender is online is never judged
    -- by the phone's.
    'server_now', now(),
    'batch_size', s.batch_size,
    'window_start', s.window_start,
    'window_end', s.window_end,
    'min_gap_seconds', s.min_gap_seconds,
    'max_gap_seconds', s.max_gap_seconds)
    from public.marketing_sender s
$$;

-- Counts over a campaign's recipients, or over one batch of them. Every
-- recipient is counted once by what they came to; delivered and read are
-- receipts beside that. `stopped` is who was already stopped at their turn and
-- who replied STOP to this campaign: somebody who got the message and then
-- said stop is counted in `sent` too, because both happened.
create function public.marketing_campaign_counts(p_campaign_id uuid, p_batch_no integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'recipients', count(*),
    'sent', count(*) filter (where r.state = 'sent'),
    'to_go', count(*) filter (where r.state in ('waiting', 'sending')),
    'delivered', count(*) filter (where r.delivered_at is not null),
    'read', count(*) filter (where r.read_at is not null),
    'not_on_whatsapp', count(*) filter (where r.state = 'not_on_whatsapp'),
    'failed', count(*) filter (where r.state = 'failed'),
    'unsure', count(*) filter (where r.state = 'unsure'),
    'stopped', count(*) filter (where r.state = 'stopped' or s.customer_id is not null))
    from public.marketing_campaign_recipients r
    left join public.marketing_stopped s
      on s.customer_id = r.customer_id and s.campaign_id = r.campaign_id
   where r.campaign_id = p_campaign_id
     and (p_batch_no is null or r.batch_no = p_batch_no)
$$;

create function public.marketing_campaign_summary(p_campaign_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'state', c.state,
    'paused_reason', c.paused_reason,
    'not_before', c.not_before,
    'recipients', (select count(*) from public.marketing_campaign_recipients r
                    where r.campaign_id = c.id),
    'sent', (select count(*) from public.marketing_campaign_recipients r
              where r.campaign_id = c.id and r.state = 'sent'),
    -- The batch released and not yet finished, and the one that would be
    -- released next when none is. Only while the campaign is still going.
    'sending_batch_no', case when c.state in ('scheduled', 'paused') then (
        select b.batch_no from public.marketing_campaign_batches b
         where b.campaign_id = c.id and b.state = 'released') end,
    'next_batch_no', case when c.state in ('scheduled', 'paused') and not exists (
        select 1 from public.marketing_campaign_batches b
         where b.campaign_id = c.id and b.state = 'released') then (
        select min(b.batch_no) from public.marketing_campaign_batches b
         where b.campaign_id = c.id and b.state = 'waiting') end,
    'created_at', c.created_at,
    'scheduled_at', c.scheduled_at,
    'finished_at', c.finished_at)
    from public.marketing_campaigns c
   where c.id = p_campaign_id
$$;

-- The list: the sender line, every campaign newest first, and how many
-- customers are stopped.
create function public.campaigns_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'sender', public.marketing_sender_reading(),
    'campaigns', coalesce((
      select jsonb_agg(public.marketing_campaign_summary(c.id)
                       order by c.created_at desc, c.id)
        from public.marketing_campaigns c), '[]'::jsonb),
    'stopped_count', (select count(*) from public.marketing_stopped));
end;
$$;

-- One campaign's page, or null where there is no campaign by that id. The
-- picture is a path: the page asks storage for a signed address with the
-- owner's own session, as the sender does.
create function public.campaign_reading(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaign public.marketing_campaigns;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select * into v_campaign from public.marketing_campaigns c where c.id = p_campaign_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'sender', public.marketing_sender_reading(),
    'campaign', public.marketing_campaign_summary(v_campaign.id) || jsonb_build_object(
      'body', v_campaign.body,
      'image_path', v_campaign.image_path,
      'audience', v_campaign.audience,
      'batch_size', v_campaign.batch_size,
      'counts', public.marketing_campaign_counts(v_campaign.id, null),
      'batches', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'batch_no', b.batch_no, 'state', b.state,
                   'released_at', b.released_at, 'finished_at', b.finished_at)
                 || public.marketing_campaign_counts(b.campaign_id, b.batch_no)
                 order by b.batch_no)
          from public.marketing_campaign_batches b
         where b.campaign_id = v_campaign.id), '[]'::jsonb),
      'scheduled_by_name', (select p.full_name from public.profiles p
                             where p.id = v_campaign.scheduled_by),
      'test_phones', to_jsonb(v_campaign.test_phones),
      -- The last twenty test sends, newest first.
      'tests', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'phone', t.phone, 'state', t.state,
                 'queued_at', t.queued_at, 'sent_at', t.sent_at,
                 'failure_code', t.failure_code)
                 order by t.seq desc)
          from (select * from public.marketing_campaign_tests t
                 where t.campaign_id = v_campaign.id
                 order by t.seq desc limit 20) t), '[]'::jsonb)),
    -- Another campaign's batch is out, so this one waits its turn.
    'behind_campaign_name', case when v_campaign.state in ('scheduled', 'paused') then (
        select c.name
          from public.marketing_campaign_batches b
          join public.marketing_campaigns c on c.id = b.campaign_id
         where b.state = 'released'
           and b.campaign_id <> v_campaign.id
           and c.state in ('scheduled', 'paused')) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Writing a campaign, and submitting it.
--
-- A refusal's message is the word the page reads (`CampaignActionError` in
-- `src/data-access/campaigns.ts`): `name_required`, `not_a_draft`,
-- `nobody_matches` and the rest.

-- Create a draft, or change one. The id is the page's own, so a save sent
-- twice writes one campaign.
create function public.save_campaign_draft(
  p_campaign_id uuid, p_name text, p_body text, p_audience jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_body text := coalesce(p_body, '');
  v_audience jsonb := case when jsonb_typeof(p_audience) = 'null' then null else p_audience end;
  v_changed integer;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_campaign_id is null then
    raise exception 'not_found' using errcode = 'invalid_parameter_value';
  end if;
  if v_name = '' then
    raise exception 'name_required' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'name_too_long' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_body) > 4096 then
    raise exception 'body_too_long' using errcode = 'invalid_parameter_value';
  end if;
  -- An audience is checked when it is saved, so a draft never holds one that
  -- submitting would refuse to read.
  if v_audience is not null then
    perform count(*) from public.marketing_audience(v_audience, true, null);
  end if;

  insert into public.marketing_campaigns (id, name, body, audience, created_by)
  values (p_campaign_id, v_name, v_body, v_audience, auth.uid())
  on conflict (id) do nothing;

  update public.marketing_campaigns c
     set name = v_name, body = v_body, audience = v_audience
   where c.id = p_campaign_id and c.state = 'draft';
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception 'not_a_draft' using errcode = 'object_not_in_prerequisite_state';
  end if;
end;
$$;

-- Put one picture on a draft, or take it off with null. The path is one the
-- page uploaded to the bucket, under this campaign's own folder.
create function public.set_campaign_image(p_campaign_id uuid, p_image_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.marketing_campaign_state;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select c.state into v_state
    from public.marketing_campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_state <> 'draft' then
    raise exception 'not_a_draft' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if p_image_path is not null
     and p_image_path !~ ('^' || p_campaign_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$') then
    raise exception 'image_path_invalid' using errcode = 'invalid_parameter_value';
  end if;
  update public.marketing_campaigns c
     set image_path = p_image_path where c.id = p_campaign_id;
end;
$$;

-- Fix the audience and cut it into batches. Who is picked is read once, here,
-- from the stored audience, in the chosen order, at the batch size set at this
-- moment; the stopped list is left out here and again at each claim. **Nothing is sent**: every
-- batch waits to be released on the sender's own page.
--
-- It takes no start time (proposal, decision 11).
create function public.schedule_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.marketing_campaigns;
  v_size integer;
  v_count integer;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select * into v_campaign
    from public.marketing_campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_campaign.state <> 'draft' then
    raise exception 'not_a_draft' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_campaign.body !~ '\S' then
    raise exception 'body_required' using errcode = 'invalid_parameter_value';
  end if;
  -- The longest message that goes out is 1,024 characters with the stop line
  -- (`shared/campaign-message.ts`, which is the judge the composer uses). A
  -- body already past that as written cannot fit, whoever it greets.
  if char_length(v_campaign.body) > 1024 then
    raise exception 'body_too_long' using errcode = 'invalid_parameter_value';
  end if;
  if v_campaign.audience is null then
    raise exception 'audience_required' using errcode = 'invalid_parameter_value';
  end if;

  select s.batch_size into v_size from public.marketing_sender s;

  -- One statement, so the batches and the recipients are cut from the same
  -- reading of the audience.
  with picked as materialized (
    select a.customer_id, a.seq
      from public.marketing_audience(v_campaign.audience, true, null) a
  ),
  cut as (
    insert into public.marketing_campaign_batches (campaign_id, batch_no)
    select p_campaign_id, g.batch_no
      from generate_series(
             1, (select ceil(count(*)::numeric / v_size)::integer from picked)) as g (batch_no)
  )
  insert into public.marketing_campaign_recipients
    (campaign_id, customer_id, batch_no, "position")
  select p_campaign_id, p.customer_id, ((p.seq - 1) / v_size) + 1, p.seq
    from picked p;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'nobody_matches' using errcode = 'invalid_parameter_value';
  end if;

  update public.marketing_campaigns c
     set state = 'scheduled', batch_size = v_size,
         scheduled_by = auth.uid(), scheduled_at = now()
   where c.id = p_campaign_id;

  -- The test numbers get it first, by themselves [owner, 2026-11-18]: each
  -- one that has no test of this campaign still on its way, so a Send test
  -- not yet sent is not doubled.
  perform public.marketing_queue_tests(
    p_campaign_id,
    array(select p.phone
            from unnest(v_campaign.test_phones) with ordinality as p (phone, n)
           where not exists (
             select 1 from public.marketing_campaign_tests t
              where t.campaign_id = p_campaign_id and t.phone = p.phone
                and t.state in ('waiting', 'sending'))
           order by p.n),
    v_campaign.body, v_campaign.image_path);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Releasing, pausing, stopping (design D7).

-- Called from the sender's own page on the laptop, with the owner's token
-- (`BatchReleaser` in the sender's contracts). The app has no release control.
--
-- True when this call released the batch. False when it released nothing,
-- because the batch is not waiting any more, an earlier batch of the campaign
-- still is, another batch is sending, or the campaign is paused, stopped or
-- not yet due. A second press, or a press on a stale page, is therefore an
-- answer and not an error.
create function public.release_campaign_batch(p_campaign_id uuid, p_batch_no integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.marketing_campaigns;
  v_state public.marketing_batch_state;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  -- One release and one claim at a time: both take the sender's row first.
  perform 1 from public.marketing_sender s for update;

  select * into v_campaign
    from public.marketing_campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_campaign.state <> 'scheduled'
     or (v_campaign.not_before is not null and v_campaign.not_before > now()) then
    return false;
  end if;

  select b.state into v_state
    from public.marketing_campaign_batches b
   where b.campaign_id = p_campaign_id and b.batch_no = p_batch_no;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_state <> 'waiting'
     or exists (
       select 1 from public.marketing_campaign_batches b
        where b.campaign_id = p_campaign_id and b.batch_no < p_batch_no and b.state = 'waiting')
     or exists (
       select 1 from public.marketing_campaign_batches b where b.state = 'released') then
    return false;
  end if;

  update public.marketing_campaign_batches b
     set state = 'released', released_by = auth.uid(), released_at = now()
   where b.campaign_id = p_campaign_id and b.batch_no = p_batch_no;
  return true;
end;
$$;

-- One pause for both callers (design D6: the sender "calls the same pause the
-- owners use, with a reason").
--
--   * an owner, with no reason: refused unless the campaign is going, so the
--     page can say so;
--   * the sender, with its reason: never an error for a campaign that is not
--     going. It may arrive after an owner's own pause or stop, and the sending
--     loop reads a refusal as the database being unreachable.
create function public.pause_campaign(p_campaign_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.marketing_campaign_state;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is not null and p_reason <> 'three_in_a_row' then
    raise exception 'reason_unknown' using errcode = 'invalid_parameter_value';
  end if;
  select c.state into v_state
    from public.marketing_campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_state <> 'scheduled' then
    if p_reason is null then
      raise exception 'wrong_state' using errcode = 'object_not_in_prerequisite_state';
    end if;
    return;
  end if;
  update public.marketing_campaigns c
     set state = 'paused', paused_reason = p_reason
   where c.id = p_campaign_id;
end;
$$;

create function public.resume_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.marketing_campaign_state;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select c.state into v_state
    from public.marketing_campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_state <> 'paused' then
    raise exception 'wrong_state' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update public.marketing_campaigns c
     set state = 'scheduled', paused_reason = null
   where c.id = p_campaign_id;
  -- Its last batch may have finished while it was paused.
  perform public.marketing_settle_finished();
end;
$$;

-- Final. The recipients still waiting stay as they are and read as not sent.
-- The released batch is closed, so another campaign's can be released.
create function public.stop_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.marketing_campaign_state;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select c.state into v_state
    from public.marketing_campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_state not in ('scheduled', 'paused') then
    raise exception 'wrong_state' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update public.marketing_campaigns c
     set state = 'stopped', paused_reason = null, finished_at = now()
   where c.id = p_campaign_id;
  update public.marketing_campaign_batches b
     set state = 'done', finished_at = now()
   where b.campaign_id = p_campaign_id and b.state = 'released';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The stopped list.

-- Who is on it, as the page shows them: a name and four digits.
create function public.marketing_stopped_rows(p_customer_id uuid)
returns table (
  customer_id uuid, name text, phone_last4 text, stopped_at timestamptz,
  source public.marketing_stop_source, campaign_name text, recorded_by_name text)
language sql
stable
set search_path = ''
as $$
  select s.customer_id, c.name, right(c.phone, 4), s.stopped_at, s.source, k.name, p.full_name
    from public.marketing_stopped s
    join public.customers c on c.id = s.customer_id
    left join public.marketing_campaigns k on k.id = s.campaign_id
    left join public.profiles p on p.id = s.recorded_by
   where p_customer_id is null or s.customer_id = p_customer_id
   order by s.stopped_at desc, s.customer_id
$$;

create function public.marketing_stopped_list()
returns table (
  customer_id uuid, name text, phone_last4 text, stopped_at timestamptz,
  source public.marketing_stop_source, campaign_name text, recorded_by_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.marketing_stopped_rows(null);
end;
$$;

-- By complete number, for a customer who asks at the counter. Somebody already
-- on the list is answered with the row they have.
create function public.marketing_stopped_add(p_phone text)
returns table (
  customer_id uuid, name text, phone_last4 text, stopped_at timestamptz,
  source public.marketing_stop_source, campaign_name text, recorded_by_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical text;
  v_customer uuid;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  v_canonical := public.normalize_indian_phone(p_phone);
  if v_canonical is null then
    raise exception 'phone_incomplete' using errcode = 'invalid_parameter_value';
  end if;
  select c.id into v_customer from public.customers c where c.phone = v_canonical;
  if not found then
    raise exception 'no_such_customer' using errcode = 'no_data_found';
  end if;
  insert into public.marketing_stopped (customer_id, source, recorded_by)
  values (v_customer, 'owner', auth.uid())
  on conflict on constraint marketing_stopped_pkey do nothing;
  return query select * from public.marketing_stopped_rows(v_customer);
end;
$$;

-- They may be in a later audience again. Somebody not on the list is not an
-- error.
create function public.marketing_stopped_remove(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  delete from public.marketing_stopped s where s.customer_id = p_customer_id;
end;
$$;

-- A reply of STOP, as the sender reports it (design D11). The sender holds no
-- list of recipients, so this is where "a recipient of a campaign in the last
-- 30 days" is decided: somebody a message was handed to WhatsApp for, or who
-- was left unsure, which more often than not means it arrived. Anybody else
-- saying the word is not stopped by it. True when the customer is now on the
-- list.
create function public.campaign_record_stop(p_phone text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical text;
  v_customer uuid;
  v_campaign uuid;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  v_canonical := public.normalize_indian_phone(p_phone);
  if v_canonical is null then
    return false;
  end if;
  select c.id into v_customer from public.customers c where c.phone = v_canonical;
  if not found then
    return false;
  end if;
  select r.campaign_id into v_campaign
    from public.marketing_campaign_recipients r
   where r.customer_id = v_customer
     and coalesce(r.sent_at, case when r.state = 'unsure' then r.claimed_at end)
         > now() - interval '30 days'
   order by coalesce(r.sent_at, r.claimed_at) desc
   limit 1;
  if not found then
    return false;
  end if;
  insert into public.marketing_stopped (customer_id, source, campaign_id)
  values (v_customer, 'reply', v_campaign)
  on conflict (customer_id) do nothing;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. The owner's settings.

create function public.update_marketing_sender_settings(
  p_batch_size integer, p_window_start time, p_window_end time,
  p_min_gap_seconds integer, p_max_gap_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_batch_size is null or p_batch_size not between 1 and 1000
     or p_window_start is null or p_window_end is null
     or p_window_start >= time '24:00' or p_window_start = p_window_end
     or p_min_gap_seconds is null or p_max_gap_seconds is null
     or p_min_gap_seconds < 5 or p_max_gap_seconds < p_min_gap_seconds
     or p_max_gap_seconds > 3600 then
    raise exception 'settings_invalid' using errcode = 'invalid_parameter_value';
  end if;
  update public.marketing_sender s
     set batch_size = p_batch_size,
         window_start = p_window_start,
         window_end = p_window_end,
         min_gap_seconds = p_min_gap_seconds,
         max_gap_seconds = p_max_gap_seconds
   -- The one row. Said, because PostgREST's sessions refuse an UPDATE with no
   -- WHERE (pg_safeupdate), which psql and pgTAP never meet.
   where s.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. The sender's seven (design D6), one for one with `CampaignQueue` in
--     `tools/campaign-sender/src/core/contracts.ts`.

-- The heartbeat and the question. Two things ride on it that the loop does not
-- pass and its adapter does: which installation this is (design D12) and the
-- linked number's last four digits.
create function public.campaign_sender_tick(
  p_status public.marketing_sender_status,
  p_halt_reason text default null,
  p_installation_id text default null,
  p_linked_number_last4 text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender public.marketing_sender;
  v_installation text := nullif(btrim(coalesce(p_installation_id, '')), '');
  v_stand_down boolean;
  v_open boolean;
  v_opens_at timestamptz;
  v_released jsonb;
  v_waiting jsonb;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_status is null or v_installation is null or char_length(v_installation) > 64
     or (p_linked_number_last4 is not null and p_linked_number_last4 !~ '^[0-9]{4}$') then
    raise exception 'tick_invalid' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_sender from public.marketing_sender s for update;

  -- Two senders at once are refused here: a second installation, while the
  -- first was seen in the last ten minutes, is told to stand down, and what the
  -- first last said is left as it is.
  v_stand_down := v_sender.installation_id is not null
    and v_sender.installation_id <> v_installation
    and v_sender.last_seen_at is not null
    and v_sender.last_seen_at > now() - interval '10 minutes';

  if not v_stand_down then
    update public.marketing_sender s
       set last_seen_at = now(),
           status = p_status,
           halt_reason = left(nullif(btrim(coalesce(p_halt_reason, '')), ''), 200),
           installation_id = v_installation,
           linked_number_last4 = case
             when p_status = 'not_linked' then null
             else coalesce(p_linked_number_last4, s.linked_number_last4) end
     -- The one row: see update_marketing_sender_settings.
     where s.id;
    perform public.marketing_settle_finished();

    select jsonb_build_object('campaign_id', b.campaign_id, 'batch_no', b.batch_no)
      into v_released
      from public.marketing_campaign_batches b
      join public.marketing_campaigns c on c.id = b.campaign_id
     where b.state = 'released' and c.state = 'scheduled';

    select jsonb_build_object(
             'campaign_id', w.campaign_id, 'batch_no', w.batch_no,
             'campaign_name', w.campaign_name, 'recipients', w.recipients)
      into v_waiting
      from public.marketing_next_waiting_batch() w;
  end if;

  select w.is_open, w.opens_at into v_open, v_opens_at
    from public.marketing_window_at(now(), v_sender.window_start, v_sender.window_end) w;

  return jsonb_build_object(
    'contract_version', 1,
    'stand_down', v_stand_down,
    'min_gap_seconds', v_sender.min_gap_seconds,
    'max_gap_seconds', v_sender.max_gap_seconds,
    'window', jsonb_build_object('open', v_open, 'opens_at', v_opens_at),
    'released', v_released,
    'waiting_for_release', v_waiting,
    'campaigns_open', exists (
      select 1 from public.marketing_campaigns c where c.state in ('scheduled', 'paused')),
    -- India's day: the figure the laptop shows beside Send batch.
    'sent_today', (
      select count(*) from public.marketing_campaign_recipients r
       where r.sent_at >= date_trunc('day', now() at time zone 'Asia/Kolkata')
                          at time zone 'Asia/Kolkata'),
    'last_batch_finished_at', (
      select max(b.finished_at) from public.marketing_campaign_batches b),
    -- Test messages the sender sends by itself, before anything else.
    'tests_waiting', (
      select count(*) from public.marketing_campaign_tests t
        join public.marketing_campaigns c on c.id = t.campaign_id
       where t.state = 'waiting' and c.state <> 'stopped'));
end;
$$;

-- Marks the next waiting recipient as being sent to and hands them over.
-- **The one place a phone number leaves the database**: one at a time, to an
-- owner's session, read from the customer's record at this moment.
--
-- Answers one of three ways: a recipient; nothing, when nobody is left waiting
-- in the batch; or refused, with why.
create function public.campaign_claim_next(p_campaign_id uuid, p_batch_no integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender public.marketing_sender;
  v_campaign public.marketing_campaigns;
  v_batch_state public.marketing_batch_state;
  v_open boolean;
  v_opens_at timestamptz;
  v_customer uuid;
  v_position integer;
  v_phone text;
  v_name text;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  -- One claim at a time: every claim takes the sender's row first.
  select * into v_sender from public.marketing_sender s for update;

  select * into v_campaign from public.marketing_campaigns c where c.id = p_campaign_id;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  select b.state into v_batch_state
    from public.marketing_campaign_batches b
   where b.campaign_id = p_campaign_id and b.batch_no = p_batch_no;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;

  if v_campaign.state = 'paused' then
    return jsonb_build_object('kind', 'refused', 'why', 'paused');
  end if;
  if v_campaign.state = 'stopped' then
    return jsonb_build_object('kind', 'refused', 'why', 'stopped');
  end if;
  if v_campaign.state = 'done' or v_batch_state = 'done' then
    return jsonb_build_object('kind', 'nothing');
  end if;
  if v_batch_state <> 'released' then
    return jsonb_build_object('kind', 'refused', 'why', 'not_released');
  end if;

  select w.is_open, w.opens_at into v_open, v_opens_at
    from public.marketing_window_at(now(), v_sender.window_start, v_sender.window_end) w;
  if not v_open then
    return jsonb_build_object(
      'kind', 'refused', 'why', 'outside_window', 'opens_at', v_opens_at);
  end if;

  -- Strictly one at a time: a recipient or a test still in hand blocks the next.
  if exists (
    select 1 from public.marketing_campaign_recipients r where r.state = 'sending'
  ) or exists (
    select 1 from public.marketing_campaign_tests t where t.state = 'sending'
  ) then
    return jsonb_build_object('kind', 'refused', 'why', 'claim_in_flight');
  end if;

  select r.customer_id, r."position" into v_customer, v_position
    from public.marketing_campaign_recipients r
   where r.campaign_id = p_campaign_id
     and r.batch_no = p_batch_no
     and r.state = 'waiting'
     and not exists (
       select 1 from public.marketing_stopped s where s.customer_id = r.customer_id)
   order by r."position"
   limit 1;

  -- Whoever was passed over on the way is on the stopped list now: stopped
  -- after submitting, before their turn. They are sent nothing.
  update public.marketing_campaign_recipients r
     set state = 'stopped'
   where r.campaign_id = p_campaign_id
     and r.batch_no = p_batch_no
     and r.state = 'waiting'
     and (v_position is null or r."position" < v_position)
     and exists (
       select 1 from public.marketing_stopped s where s.customer_id = r.customer_id);

  if v_customer is null then
    perform public.marketing_settle_finished();
    return jsonb_build_object('kind', 'nothing');
  end if;

  update public.marketing_campaign_recipients r
     set state = 'sending', claimed_at = now()
   where r.campaign_id = p_campaign_id and r.customer_id = v_customer;

  select c.phone, c.name into v_phone, v_name
    from public.customers c where c.id = v_customer;

  return jsonb_build_object(
    'kind', 'claimed',
    'recipient', jsonb_build_object(
      'campaign_id', p_campaign_id,
      'batch_no', p_batch_no,
      'customer_id', v_customer,
      'position', v_position,
      -- Digits with the country code, as the sender's link takes them.
      'phone', ltrim(v_phone, '+'),
      'name', v_name,
      'body', v_campaign.body,
      'image_path', v_campaign.image_path));
end;
$$;

-- Records what happened to the recipient in hand, and says whether it did.
-- The same report arriving twice is accepted: its first answer may have been
-- lost on the way back. A report for a row that is not in hand is refused and
-- changes nothing.
create function public.campaign_report_result(
  p_campaign_id uuid,
  p_customer_id uuid,
  p_state public.marketing_recipient_state,
  p_message_id text default null,
  p_failure_code text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.marketing_campaign_recipients;
  v_message text := left(nullif(btrim(coalesce(p_message_id, '')), ''), 128);
  v_code text := left(nullif(btrim(coalesce(p_failure_code, '')), ''), 64);
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_state is null
     or p_state not in ('sent', 'failed', 'not_on_whatsapp')
     or (p_state = 'sent' and v_message is null)
     or (p_state = 'failed' and v_code is null) then
    raise exception 'report_invalid' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row
    from public.marketing_campaign_recipients r
   where r.campaign_id = p_campaign_id and r.customer_id = p_customer_id
     for update;
  if not found then
    return false;
  end if;
  if v_row.state <> 'sending' then
    return v_row.state = p_state
       and (p_state <> 'sent' or v_row.wa_message_id = v_message);
  end if;

  update public.marketing_campaign_recipients r
     set state = p_state,
         wa_message_id = case when p_state = 'sent' then v_message end,
         sent_at = case when p_state = 'sent' then now() end,
         failure_code = case when p_state = 'failed' then v_code end
   where r.campaign_id = p_campaign_id and r.customer_id = p_customer_id;
  perform public.marketing_settle_finished();
  return true;
end;
$$;

-- Resume: every recipient still marked as being sent to becomes unsure, and is
-- never handed over again by any path. Returns how many.
create function public.campaign_release_stale_claims()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_tests integer;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  update public.marketing_campaign_recipients r
     set state = 'unsure'
   where r.state = 'sending';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.marketing_settle_finished();
  end if;
  update public.marketing_campaign_tests t
     set state = 'unsure'
   where t.state = 'sending';
  get diagnostics v_tests = row_count;
  return v_count + v_tests;
end;
$$;

-- Receipts, keyed by message id, whenever they come: a batch that finished
-- yesterday included. A read with no delivered before it fills both. A
-- rejected turns the row from sent to failed, with WhatsApp's code. An id
-- nobody holds is ignored.
create function public.campaign_report_receipts(p_receipts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id text;
  v_status text;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array'
     or jsonb_array_length(p_receipts) > 500 then
    raise exception 'receipts_invalid' using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select t.value from jsonb_array_elements(p_receipts) as t (value)
  loop
    v_id := case when jsonb_typeof(v_item) = 'object'
                 then nullif(btrim(coalesce(v_item ->> 'message_id', '')), '') end;
    v_status := case when jsonb_typeof(v_item) = 'object' then v_item ->> 'status' end;
    if v_id is null or v_status is null
       or v_status not in ('delivered', 'read', 'rejected') then
      raise exception 'receipts_invalid' using errcode = 'invalid_parameter_value';
    end if;

    if v_status = 'rejected' then
      update public.marketing_campaign_recipients r
         set state = 'failed',
             failure_code = left(
               coalesce(nullif(btrim(coalesce(v_item ->> 'code', '')), ''), 'rejected'), 64)
       where r.wa_message_id = v_id;
    else
      update public.marketing_campaign_recipients r
         set delivered_at = coalesce(r.delivered_at, now()),
             read_at = case when v_status = 'read'
                            then coalesce(r.read_at, now()) else r.read_at end
       where r.wa_message_id = v_id;
    end if;
  end loop;
end;
$$;

-- The ids of campaign messages a receipt could still change: sent, not yet
-- read, and sent within the last thirty days, so the list cannot grow for ever
-- with every customer who keeps read receipts off. One value, not rows: a
-- batch of unread messages is past PostgREST's row limit.
create function public.campaign_outstanding_message_ids()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select array_agg(r.wa_message_id order by r.sent_at, r.wa_message_id)
      from public.marketing_campaign_recipients r
     where r.state = 'sent'
       and r.read_at is null
       and r.wa_message_id is not null
       and r.sent_at > now() - interval '30 days'), '{}'::text[]);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11b. Test numbers [owner, 2026-11-18].
--
-- An owner types up to five numbers onto a campaign. Send test, and submitting,
-- queue one message to each, carrying the message as it stands then. The sender
-- sends them as soon as it is connected: no release, outside the sending
-- window, ahead of any batch, one at a time like everything else. Numbers used
-- on earlier campaigns are offered again.

-- A typed number as the database keeps it: `+` and digits. **The same rule as
-- `checkTestNumber` in `shared/campaign-test-number.ts`**, which the composer
-- uses, so what the page accepts is what is kept: spaces, dashes, dots and
-- brackets dropped; a leading 00 read as +; with a plus, 8 to 15 digits not
-- starting 0, and one starting 91 must be an Indian mobile; without a plus,
-- only an Indian mobile, with or without its 91. Null for anything else.
create function public.marketing_test_phone(p_input text)
returns text
language sql
immutable
set search_path = ''
as $$
  with stripped as (
    select regexp_replace(coalesce(p_input, ''), '[[:space:]().-]', '', 'g') as s
  ),
  plussed as (
    select case when s like '00%' then '+' || substr(s, 3) else s end as s from stripped
  )
  select case
    when s ~ '^\+91' then case when s ~ '^\+91[6-9][0-9]{9}$' then s end
    when s ~ '^\+[1-9][0-9]{7,14}$' then s
    when s ~ '^[6-9][0-9]{9}$' then '+91' || s
    when s ~ '^91[6-9][0-9]{9}$' then '+' || s
    else null
  end
  from plussed
$$;

-- One message to each number, as the message stands now. How many.
create function public.marketing_queue_tests(
  p_campaign_id uuid, p_phones text[], p_body text, p_image_path text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.marketing_campaign_tests
    (campaign_id, phone, body, image_path, queued_by)
  select p_campaign_id, p.phone, p_body, p_image_path, auth.uid()
    from unnest(coalesce(p_phones, '{}')) with ordinality as p (phone, n)
   order by p.n;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Replace a campaign's test numbers. Returns them as kept. Any campaign still
-- going may have them changed: they are nobody's audience.
create function public.set_campaign_test_numbers(p_campaign_id uuid, p_phones text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.marketing_campaign_state;
  v_phones text[];
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select c.state into v_state
    from public.marketing_campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_state in ('stopped', 'done') then
    raise exception 'campaign_finished' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_phones, '{}')) p (typed)
     where public.marketing_test_phone(p.typed) is null
  ) then
    raise exception 'phone_incomplete' using errcode = 'invalid_parameter_value';
  end if;
  -- In the order typed, each number once.
  select coalesce(array_agg(k.phone order by k.first), '{}') into v_phones
    from (select public.marketing_test_phone(p.typed) as phone, min(p.n) as first
            from unnest(coalesce(p_phones, '{}')) with ordinality as p (typed, n)
           group by 1) k;
  if cardinality(v_phones) > 5 then
    raise exception 'too_many_test_numbers' using errcode = 'invalid_parameter_value';
  end if;
  update public.marketing_campaigns c set test_phones = v_phones where c.id = p_campaign_id;
  return v_phones;
end;
$$;

-- Send test: the message as it stands now, to every test number. How many.
create function public.send_campaign_test(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.marketing_campaigns;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select * into v_campaign
    from public.marketing_campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_campaign.state in ('stopped', 'done') then
    raise exception 'campaign_finished' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if cardinality(v_campaign.test_phones) = 0 then
    raise exception 'no_test_numbers' using errcode = 'invalid_parameter_value';
  end if;
  if v_campaign.body !~ '\S' then
    raise exception 'body_required' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_campaign.body) > 1024 then
    raise exception 'body_too_long' using errcode = 'invalid_parameter_value';
  end if;
  -- One round at a time: a second press while the first is still on its way
  -- would only queue the same message again.
  if exists (
    select 1 from public.marketing_campaign_tests t
     where t.campaign_id = p_campaign_id and t.state in ('waiting', 'sending')
  ) then
    raise exception 'test_already_waiting' using errcode = 'object_not_in_prerequisite_state';
  end if;
  return public.marketing_queue_tests(
    p_campaign_id, v_campaign.test_phones, v_campaign.body, v_campaign.image_path);
end;
$$;

-- Numbers used on earlier campaigns, most recently used first, ten at most:
-- they are mostly the same few every time [owner, 2026-11-18].
create function public.campaign_test_number_suggestions()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select array_agg(u.phone order by u.last_used desc, u.phone)
      from (select p.phone, max(c.created_at) as last_used
              from public.marketing_campaigns c,
                   unnest(c.test_phones) as p (phone)
             group by p.phone
             order by max(c.created_at) desc, p.phone
             limit 10) u), '{}'::text[]);
end;
$$;

-- The sender's claim for a test: the oldest waiting test message, whatever the
-- window says and whether or not any batch is released. Nothing when none is
-- waiting; refused while anything is in hand. A stopped campaign's tests are
-- marked stopped and sent nothing.
create function public.campaign_claim_next_test()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.marketing_campaign_tests;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  -- The same lock every claim takes first, so claims are one at a time.
  perform 1 from public.marketing_sender s for update;

  update public.marketing_campaign_tests t
     set state = 'stopped'
    from public.marketing_campaigns c
   where c.id = t.campaign_id and c.state = 'stopped' and t.state = 'waiting';

  if exists (
    select 1 from public.marketing_campaign_recipients r where r.state = 'sending'
  ) or exists (
    select 1 from public.marketing_campaign_tests t where t.state = 'sending'
  ) then
    return jsonb_build_object('kind', 'refused', 'why', 'claim_in_flight');
  end if;

  select * into v_test
    from public.marketing_campaign_tests t
   where t.state = 'waiting'
   order by t.seq
   limit 1;
  if not found then
    return jsonb_build_object('kind', 'nothing');
  end if;

  update public.marketing_campaign_tests t
     set state = 'sending', claimed_at = now()
   where t.id = v_test.id;

  return jsonb_build_object(
    'kind', 'claimed',
    'recipient', jsonb_build_object(
      'test_id', v_test.id,
      'campaign_id', v_test.campaign_id,
      'phone', ltrim(v_test.phone, '+'),
      'body', v_test.body,
      'image_path', v_test.image_path));
end;
$$;

-- What happened to the test in hand. As `campaign_report_result`: the same
-- report twice is accepted, one for a test not in hand is refused.
create function public.campaign_report_test_result(
  p_test_id uuid,
  p_state public.marketing_recipient_state,
  p_message_id text default null,
  p_failure_code text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.marketing_campaign_tests;
  v_message text := left(nullif(btrim(coalesce(p_message_id, '')), ''), 128);
  v_code text := left(nullif(btrim(coalesce(p_failure_code, '')), ''), 64);
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_state is null
     or p_state not in ('sent', 'failed', 'not_on_whatsapp')
     or (p_state = 'sent' and v_message is null)
     or (p_state = 'failed' and v_code is null) then
    raise exception 'report_invalid' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_row from public.marketing_campaign_tests t where t.id = p_test_id for update;
  if not found then
    return false;
  end if;
  if v_row.state <> 'sending' then
    return v_row.state = p_state
       and (p_state <> 'sent' or v_row.wa_message_id = v_message);
  end if;
  update public.marketing_campaign_tests t
     set state = p_state,
         wa_message_id = case when p_state = 'sent' then v_message end,
         sent_at = case when p_state = 'sent' then now() end,
         failure_code = case when p_state = 'failed' then v_code end
   where t.id = p_test_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11c. The campaign finished [spec: the owner who scheduled it is sent those
-- totals on WhatsApp if their account carries a phone].
--
-- The sender asks once it has nothing else to do; it sends each owner one
-- message with the totals and says so, and is not asked again for that
-- campaign. Only campaigns finished in the last week: a sender switched on
-- after a month away does not send a pile of old news. **The one other place
-- a full number leaves the database**, to an owner's session: the owner's own
-- number, from their own account.
create function public.campaign_finish_notices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'campaign_id', c.id,
             'name', c.name,
             'phone', n.phone,
             'counts', public.marketing_campaign_counts(c.id, null))
             order by c.finished_at, c.id)
      from public.marketing_campaigns c
      join public.profiles p on p.id = c.scheduled_by
      cross join lateral (
        select case
                 when d ~ '^[0-9]{10}$' then '91' || d
                 when d ~ '^[1-9][0-9]{7,14}$' then d
               end as phone
          from (select regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') as d) digits
      ) n
     where c.state = 'done'
       and c.finish_notice_sent_at is null
       and c.finished_at > now() - interval '7 days'
       and n.phone is not null), '[]'::jsonb);
end;
$$;

-- The sender told the owner. True when this call recorded it.
create function public.campaign_mark_finish_notice(p_campaign_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  update public.marketing_campaigns c
     set finish_notice_sent_at = now()
   where c.id = p_campaign_id and c.state = 'done' and c.finish_notice_sent_at is null;
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Who may call what.
--
-- The internal pieces take arguments that would let a caller skip the owner
-- check, so no client may call them. The rest are granted to signed-in
-- sessions, with the owner check inside each. Nothing is granted to `anon`.

revoke execute on function public.marketing_window_at(timestamptz, time, time)
  from public, anon, authenticated;
revoke execute on function public.marketing_audience_whole(jsonb, bigint)
  from public, anon, authenticated;
revoke execute on function public.marketing_audience(jsonb, boolean, text)
  from public, anon, authenticated;
revoke execute on function public.marketing_settle_finished()
  from public, anon, authenticated;
revoke execute on function public.marketing_next_waiting_batch()
  from public, anon, authenticated;
revoke execute on function public.marketing_sender_reading()
  from public, anon, authenticated;
revoke execute on function public.marketing_campaign_counts(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.marketing_campaign_summary(uuid)
  from public, anon, authenticated;
revoke execute on function public.marketing_stopped_rows(uuid)
  from public, anon, authenticated;
revoke execute on function public.marketing_test_phone(text)
  from public, anon, authenticated;
revoke execute on function public.marketing_queue_tests(uuid, text[], text, text)
  from public, anon, authenticated;

revoke execute on function public.campaign_audience_count(jsonb) from public, anon;
revoke execute on function public.campaign_audience_list(jsonb, integer, text)
  from public, anon;
revoke execute on function public.campaigns_overview() from public, anon;
revoke execute on function public.campaign_reading(uuid) from public, anon;
revoke execute on function public.save_campaign_draft(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.set_campaign_image(uuid, text) from public, anon;
revoke execute on function public.schedule_campaign(uuid) from public, anon;
revoke execute on function public.release_campaign_batch(uuid, integer) from public, anon;
revoke execute on function public.pause_campaign(uuid, text) from public, anon;
revoke execute on function public.resume_campaign(uuid) from public, anon;
revoke execute on function public.stop_campaign(uuid) from public, anon;
revoke execute on function public.marketing_stopped_list() from public, anon;
revoke execute on function public.marketing_stopped_add(text) from public, anon;
revoke execute on function public.marketing_stopped_remove(uuid) from public, anon;
revoke execute on function public.campaign_record_stop(text) from public, anon;
revoke execute on function public.update_marketing_sender_settings(
  integer, time, time, integer, integer) from public, anon;
revoke execute on function public.campaign_sender_tick(
  public.marketing_sender_status, text, text, text) from public, anon;
revoke execute on function public.campaign_claim_next(uuid, integer) from public, anon;
revoke execute on function public.campaign_report_result(
  uuid, uuid, public.marketing_recipient_state, text, text) from public, anon;
revoke execute on function public.campaign_release_stale_claims() from public, anon;
revoke execute on function public.campaign_report_receipts(jsonb) from public, anon;
revoke execute on function public.campaign_outstanding_message_ids() from public, anon;
revoke execute on function public.set_campaign_test_numbers(uuid, text[]) from public, anon;
revoke execute on function public.send_campaign_test(uuid) from public, anon;
revoke execute on function public.campaign_test_number_suggestions() from public, anon;
revoke execute on function public.campaign_claim_next_test() from public, anon;
revoke execute on function public.campaign_finish_notices() from public, anon;
revoke execute on function public.campaign_mark_finish_notice(uuid) from public, anon;
revoke execute on function public.campaign_report_test_result(
  uuid, public.marketing_recipient_state, text, text) from public, anon;

grant execute on function public.campaign_audience_count(jsonb) to authenticated;
grant execute on function public.campaign_audience_list(jsonb, integer, text)
  to authenticated;
grant execute on function public.campaigns_overview() to authenticated;
grant execute on function public.campaign_reading(uuid) to authenticated;
grant execute on function public.save_campaign_draft(uuid, text, text, jsonb) to authenticated;
grant execute on function public.set_campaign_image(uuid, text) to authenticated;
grant execute on function public.schedule_campaign(uuid) to authenticated;
grant execute on function public.release_campaign_batch(uuid, integer) to authenticated;
grant execute on function public.pause_campaign(uuid, text) to authenticated;
grant execute on function public.resume_campaign(uuid) to authenticated;
grant execute on function public.stop_campaign(uuid) to authenticated;
grant execute on function public.marketing_stopped_list() to authenticated;
grant execute on function public.marketing_stopped_add(text) to authenticated;
grant execute on function public.marketing_stopped_remove(uuid) to authenticated;
grant execute on function public.campaign_record_stop(text) to authenticated;
grant execute on function public.update_marketing_sender_settings(
  integer, time, time, integer, integer) to authenticated;
grant execute on function public.campaign_sender_tick(
  public.marketing_sender_status, text, text, text) to authenticated;
grant execute on function public.campaign_claim_next(uuid, integer) to authenticated;
grant execute on function public.campaign_report_result(
  uuid, uuid, public.marketing_recipient_state, text, text) to authenticated;
grant execute on function public.campaign_release_stale_claims() to authenticated;
grant execute on function public.campaign_report_receipts(jsonb) to authenticated;
grant execute on function public.campaign_outstanding_message_ids() to authenticated;
grant execute on function public.set_campaign_test_numbers(uuid, text[]) to authenticated;
grant execute on function public.send_campaign_test(uuid) to authenticated;
grant execute on function public.campaign_test_number_suggestions() to authenticated;
grant execute on function public.campaign_claim_next_test() to authenticated;
grant execute on function public.campaign_finish_notices() to authenticated;
grant execute on function public.campaign_mark_finish_notice(uuid) to authenticated;
grant execute on function public.campaign_report_test_result(
  uuid, public.marketing_recipient_state, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. The pictures: a private bucket only an owner reaches (design D5).
--
-- Private, JPEG and PNG only: the two WhatsApp shows as a photo. A read and an
-- upload, and no update or delete: a picture a submitted campaign points at
-- must still be there when its batch is sent.
--
-- **Capped at 1 MB, to keep storage and egress inside the free plan** [owner,
-- 2026-11-18]. WhatsApp shrinks a photo to a few hundred kilobytes before it
-- sends it, so anything larger costs storage and download and shows nobody
-- anything more. The page shrinks a phone photo before uploading it (task
-- 3.2); the cap is what holds if it does not.
--
-- The sender and the page each ask storage for a signed address with the
-- owner's own session, which the read policy allows. The claim hands over the
-- path, not an address: signing one in SQL would need the project's JWT secret
-- inside the database. **The path never changes once a campaign is
-- submitted**, so each reader downloads a picture once and keeps it: the sender
-- once per campaign, not once per message, and the page once per visit, not
-- on every minute's refresh (design, The database, built).

-- release-lint: allow data — the bucket's own row, which is how a bucket is made; no published build reads or writes a bucket by this name, and the design (D5) asks for it; the owner agreed on 2026-11-18 (design, The database, built)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-images', 'campaign-images', false, 1048576, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- release-lint: allow policy-ungated — permissive and scoped to the new campaign-images bucket alone, so it changes nothing a published build can read or write in storage; the design (D5) asks for it; the owner agreed on 2026-11-18 (design, The database, built)
create policy campaign_images_readable
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'campaign-images'
    and public.app_is_owner()
    and public.app_account_active()
  );

-- release-lint: allow policy-ungated — permissive and scoped to the new campaign-images bucket alone, so it changes nothing a published build can read or write in storage; the design (D5) asks for it; the owner agreed on 2026-11-18 (design, The database, built)
create policy campaign_images_writable
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'campaign-images'
    and public.app_is_owner()
    and public.app_account_active()
  );
