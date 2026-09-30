-- the-receipt-says-its-yours (#58): the receipt shows the last four digits of the
-- number its customer gave, and whether they were gold at this outlet, and says
-- whether the bill was dine-in or takeaway. Never the name, never the whole
-- number, and never the table.
--
-- One function is replaced, with the same signature, so its grants stand: still
-- `security definer`, still `service_role` only, still one token in and one
-- receipt out. Three keys are added to what it returns and nothing is removed:
--
--   phone_last4     the last four digits of the bill's snapshotted phone, only
--                   when the bill has a customer attached; else null.
--   gold_at_outlet  the bill's snapshotted tier is gold, under the same
--                   condition; else false.
--   service_type    dine-in or takeaway, as the bill stored it (#60), or null.
--
-- **Not the table number** [owner, 2026-09-30]. A table is a temporary label for
-- the length of a meal, like the day's order number, which the receipt does not
-- show either; it says nothing a customer keeps a receipt for.
--
-- **The key names are chosen for the landing Worker's tripwire** (design D1). It
-- refuses to serve any payload carrying `customer`, `customer_name`,
-- `customer_phone`, `customer_id`, `biller_name` or `biller_profile_id`, at any
-- depth and whatever the value. None of these three is among them, so this can be
-- released before or after the Worker that renders them, and every receipt keeps
-- rendering either way. A nested `customer` object would have refused every
-- receipt and every counter pop-up until the Worker caught up.
--
-- **The condition is the customer link, not a date** (design D2). Every bill rung
-- before #56 has a null `customer_id` and often a typed name and phone (`As`,
-- `Kk`); it shows nothing. Since #56 the server sets the link exactly when the
-- sale carried a number.
--
-- **The mask is this function's projection**, not a renderer's choice: the whole
-- number never leaves the database in a receipt. Digits are stripped with a
-- character class rather than `\D`, which a client's string escaping can turn
-- into a bare `D`.
--
-- **Gold is the bill's own snapshot** (design D3): written at the moment of sale,
-- at the sale's outlet, and refused changes afterwards. A spell revoked tonight
-- leaves lunch's receipt saying gold, which is what lunch was.

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
    -- What the receipt says of its customer (#58): the last four digits and
    -- gold here, only for a bill with a customer attached. Never the name.
    'phone_last4', case
      when b.customer_id is not null
       and length(regexp_replace(coalesce(b.customer_phone, ''), '[^0-9]', '', 'g')) >= 4
      then right(regexp_replace(b.customer_phone, '[^0-9]', '', 'g'), 4)
    end,
    'gold_at_outlet', (b.customer_id is not null
                       and b.customer_tier is not distinct from 'gold'::public.customer_tier),
    -- Dine-in or takeaway (#60), as it stored it. Not the table: a label for the
    -- length of a meal, like the order number.
    'service_type', b.service_type,
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
    -- What this bill used and earned, and the balance it left: stored figures,
    -- and no name. Null for a bill with no points.
    'points', public.bill_public_points(b.id),
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

  -- Recorded only now that the token has resolved. Nothing about the customer
  -- goes here: the four digits on the page do not license them in the log.
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

comment on function public.bill_public_receipt(text, text, text) is
  'One receipt for one public token, or null for every refusal alike. Returns the '
  'last four digits of the bill''s snapshotted phone and gold at its outlet only '
  'for a bill with a customer attached, and never the name or the whole number '
  '(#58). service_role only.';
