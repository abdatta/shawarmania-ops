-- The public receipt reader.
--
-- This is the first unauthenticated reader in the system, and the whole design
-- is about it not becoming a door.
--
-- **`anon` gains no grant anywhere.** No policy is added to `bills`,
-- `bill_items`, `bill_payments`, `bill_discounts` or `bill_public_links` to let
-- an anonymous role read by token. Such a policy would mean `anon` holds
-- `select` on bills, and one policy mistake would then be a full disclosure.
-- Instead the Cloudflare Worker holds the service-role key as a Worker secret,
-- server-side, never reaching a browser -- the standing rule, unchanged -- and
-- may call exactly one function.
--
-- **The outlet boundary is not weakened, because the reader never resolves an
-- outlet at all.** Its only input names one bill. It cannot enumerate, cannot
-- widen, and cannot be pointed at a neighbouring outlet's rows.
--
-- **Every refusal is one refusal.** Unknown, malformed, revoked and
-- switched-off all return null, so a caller learns nothing about which case
-- occurred, and nothing about whether any bill exists.

-- ---------------------------------------------------------------------------
-- The switch, and the salt.
--
-- One row for the whole business. `enabled` is the kill switch: flipping it
-- disables every receipt at once, at the database, for every caller, with no
-- deploy -- which is the property that matters at the moment somebody needs it.
--
-- `viewer_salt` keeps the access record's address digests non-reversible. An
-- unsalted hash of an IPv4 address is walkable in seconds, so a bare digest
-- would be the address. Held here rather than in the Worker so the digest
-- cannot be reproduced by anybody holding the Worker's source.
--
-- Classified `service-only` in `01_schema_coverage.sql`: no grant and no policy
-- for any client role, which is a stronger claim than `global`.

create table public.public_receipt_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  viewer_salt text not null default encode(extensions.gen_random_bytes(32), 'hex')
);

insert into public.public_receipt_settings (id) values (true);

alter table public.public_receipt_settings enable row level security;
grant all on public.public_receipt_settings to service_role;
revoke all on public.public_receipt_settings from authenticated, anon;

-- ---------------------------------------------------------------------------
-- The access record.
--
-- Enough to make a harvesting attempt visible after the fact, and nothing more.
-- It records the *token*, not the bill, so a row does not even name the sale;
-- and a salted digest of the client address, never the address. The column list
-- is asserted in `51_the_public_receipt_reader.sql`, the way
-- `customer_lookup_attempts` is, so a later migration adding a column has to
-- argue with that assertion rather than slip past it.
--
-- Also `service-only`: nothing in the app shows anybody who opened a receipt,
-- so no client role holds a privilege on it and there is no outlet question to
-- answer.

create table public.bill_public_link_views (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  viewed_at timestamptz not null default now(),
  client_address_digest text,
  user_agent text
);

create index bill_public_link_views_token_idx
  on public.bill_public_link_views (token, viewed_at desc);
create index bill_public_link_views_client_idx
  on public.bill_public_link_views (client_address_digest, viewed_at desc);

alter table public.bill_public_link_views enable row level security;
grant all on public.bill_public_link_views to service_role;
revoke all on public.bill_public_link_views from authenticated, anon;

-- ---------------------------------------------------------------------------
-- One token in, one receipt out.
--
-- **On the arguments.** The token is the only thing that selects. The address
-- and user agent are observability: they are written to the access record and
-- cannot affect which bill comes back, which is asserted directly. Nothing here
-- accepts an outlet, a bill id, a bill number, a date, a range or a limit, and
-- there is no second overload -- both facts asserted from the catalog, because
-- an argument that does not exist cannot be passed.
--
-- **The customer's absence is this projection's doing.** `customer_name`,
-- `customer_phone` and `customer_id` are never selected, so a page cannot
-- render them by mistake and a future page cannot render them on purpose
-- without changing this function. All 1,035 bills in production carry a
-- placeholder name typed to satisfy a UI-only name-or-phone rule, so rendering
-- them would show a customer garbage -- but the reason it is refused is that a
-- link which leaks, is forwarded or is misdelivered should expose an order and
-- never a person. Misdelivery is the realistic failure here, not brute force,
-- and no token length defends against it.
--
-- **The discount rows are grouped here, in SQL, so the page does no
-- arithmetic.** A menu discount is stored on each line it reduced, and the row
-- a person reads combines the lines carrying the same value -- which is a sum,
-- and a receipt that computes disagreeing with a bill that stored is the worst
-- bug available. So the database sums it, by the same rule the counter's bill
-- column uses in `src/features/billing/bill-discount-rows.tsx`, and the two are
-- held together by an agreement test rather than by hope.
--
-- **It is read fresh, every time.** A void writes `voided_at`; a tender
-- correction rewrites the split. Both must be visible to a customer opening a
-- link they were sent an hour ago, which is the second reason nothing is stored
-- as a file.

create or replace function public.bill_public_receipt(
  p_token text,
  p_client_address text default null,
  p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill_id uuid;
  v_salt text;
  v_receipt jsonb;
begin
  select s.viewer_salt into v_salt
    from public.public_receipt_settings s
   where s.enabled;

  -- Switched off, or the row is somehow gone: refuse, in the same words as
  -- every other refusal.
  if v_salt is null then
    return null;
  end if;

  -- The only selection in the function. A malformed or empty token simply
  -- matches nothing, which is why there is no separate validation branch to
  -- answer differently.
  select l.bill_id into v_bill_id
    from public.bill_public_links l
   where l.token = p_token
     and l.revoked_at is null;

  if v_bill_id is null then
    -- **No write.** A flood of invalid tokens must not become a flood of
    -- inserts; that amplification is the edge's to absorb, and a write here
    -- would hand an attacker the lever.
    return null;
  end if;

  select jsonb_build_object(
    'outlet', jsonb_build_object('name', o.name),
    'bill_number', b.bill_number,
    'business_date', b.business_date,
    'sold_at', b.created_at,
    'status', b.status,
    'void_reason', b.void_reason,
    'totals', jsonb_build_object(
      'subtotal_paise', b.subtotal_paise,
      'discount_paise', b.discount_paise,
      'tax_paise', b.tax_paise,
      'rounding_paise', b.rounding_paise,
      'total_paise', b.total_paise),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_name', i.item_name,
               'quantity', i.quantity,
               'unit_price_paise', i.unit_price_paise,
               'line_total_paise', i.line_total_paise)
             order by i.item_name)
        from public.bill_items i
       where i.bill_id = b.id), '[]'::jsonb),
    'discount_rows', public.bill_public_discount_rows(b.id),
    -- `effective_bill_payments`, not `bill_payments`, and that is the whole of
    -- "a corrected tender reads corrected". A correction is an append -- a new
    -- revision with its own allocations -- rather than a rewrite of a settled
    -- sale, so the original rows are still there and reading them directly
    -- would serve a customer the split that was corrected away. The view
    -- resolves the latest revision, and the manager's own bill detail reads it
    -- for the same reason.
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method', p.method,
               'amount_paise', p.amount_paise)
             order by p.method)
        from public.effective_bill_payments p
       where p.bill_id = b.id), '[]'::jsonb))
    into v_receipt
    from public.bills b
    join public.outlets o on o.id = b.outlet_id
   where b.id = v_bill_id;

  -- Recorded only now that the token has resolved.
  insert into public.bill_public_link_views (token, client_address_digest, user_agent)
  values (
    p_token,
    case when p_client_address is null then null
         else encode(
                extensions.digest(v_salt || ':' || p_client_address, 'sha256'),
                'hex')
    end,
    p_user_agent);

  return v_receipt;
end;
$$;

-- ---------------------------------------------------------------------------
-- The discount rows a person reads.
--
-- Two cases for the menu rows, taken from the counter's bill column so the
-- receipt reads the way the till read:
--
--   several categories at one value -> one row listing them
--   different values                -> a row each
--
-- The counter has a third case -- every category on the menu covered reads as
-- one phrase rather than a list -- and the receipt deliberately does not. It is
-- a claim about what the menu contained at the moment of sale, and this reader
-- opens a bill months later with no menu history to check it against. The
-- manager's bill detail declined it for exactly this reason (`categoryCount` is
-- infinity there), so a receipt naming the categories it actually carried is
-- the answer this repo has already given rather than a second one.
--
-- Grouped by what the customer was actually given: a percentage groups by that
-- percentage, and a rupee discount by its per-unit amount, because two lines at
-- "twenty rupees off each" are one discount however different their totals.
--
-- Menu rows first, then the bill-level rows, which is the order the counter
-- draws them in and the order the reduction happened in.

create or replace function public.bill_public_discount_rows(p_bill_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with menu as (
    select
      case when i.discount_percent_bp is not null
           then 'p' || i.discount_percent_bp::text
           else 'a' || round(i.discount_paise::numeric / greatest(1, i.quantity))::text
      end as grouping_key,
      min(i.discount_percent_bp) as value_bp,
      case when min(i.discount_percent_bp) is not null then null
           else round(min(i.discount_paise)::numeric
                      / greatest(1, min(i.quantity)))::bigint
      end as value_paise,
      array_remove(array_agg(distinct i.category_name), null) as categories,
      sum(i.discount_paise)::bigint as amount_paise
    from public.bill_items i
   where i.bill_id = p_bill_id
     and i.discount_paise > 0
   group by 1, i.discount_percent_bp
  ),
  menu_rows as (
    select jsonb_build_object(
      'source', 'menu',
      'basis', case when value_bp is not null then 'percent' else 'amount' end,
      'value_bp', value_bp,
      'value_paise', value_paise,
      'categories', to_jsonb(categories),
      'amount_paise', amount_paise) as row,
      grouping_key as sort_key
    from menu
  ),
  bill_rows as (
    select jsonb_build_object(
      'source', 'bill',
      'basis', d.basis,
      'value_bp', d.value_bp,
      'value_paise', d.value_paise,
      'categories', '[]'::jsonb,
      'amount_paise', d.amount_paise) as row,
      d.created_at::text as sort_key
    from public.bill_discounts d
   where d.bill_id = p_bill_id
  )
  select coalesce(jsonb_agg(row order by source_rank, sort_key), '[]'::jsonb)
    from (
      select row, sort_key, 0 as source_rank from menu_rows
      union all
      select row, sort_key, 1 as source_rank from bill_rows
    ) ordered;
$$;

-- ---------------------------------------------------------------------------
-- The service role, and nobody else.
--
-- Not `anon`, which is the point of the whole shape: the public reader is a
-- Worker holding a server-side credential, not a browser holding a key. Not
-- `authenticated` either -- a signed-in session reads bills through its own
-- policies, and a `security definer` function that ignores those has no
-- business being reachable from one.

revoke all on function public.bill_public_receipt(text, text, text)
  from public, anon, authenticated;
revoke all on function public.bill_public_discount_rows(uuid)
  from public, anon, authenticated;
grant execute on function public.bill_public_receipt(text, text, text) to service_role;
grant execute on function public.bill_public_discount_rows(uuid) to service_role;
