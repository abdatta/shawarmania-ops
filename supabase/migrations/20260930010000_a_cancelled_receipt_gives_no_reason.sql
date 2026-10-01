-- the-receipt-says-its-yours (#58), after release: a cancelled receipt says
-- cancelled and nothing more [owner, 2026-09-30].
--
-- `void_reason` is the outlet's own note on why a bill was cancelled ("Wrong
-- table", "Rung twice"). It is not the customer's business, and a public link can
-- reach a stranger, so the reader stops returning it at all rather than leaving a
-- renderer to decide not to print it -- the same rule #54 and #58 apply to the
-- name and the whole number. The receipt still says, unmistakably, that the bill
-- was cancelled: `status` is unchanged.
--
-- It also retires an edge #58 recorded: a phone number typed into a void reason
-- made the landing Worker's tripwire refuse that receipt. With no reason in the
-- payload, there is nothing for it to trip on.
--
-- The same function, replaced with the same signature, so its grants stand.
-- Nothing else in what it returns changes.

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
  'for a bill with a customer attached, and never the name, the whole number or '
  'the reason a bill was cancelled (#58). service_role only.';
