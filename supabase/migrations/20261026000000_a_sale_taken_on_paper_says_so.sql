-- a-sale-taken-on-paper-says-so (#77): a bill nobody rang.
--
-- A sale taken on paper (a pop-up stall, a counter-down day) is entered
-- afterwards as an ordinary settled bill that names who entered it and when,
-- and names no tablet, shift or biller, because none took it. There is no
-- change gate (proposal, Change gate): nothing calls record_paper_bill but the
-- paper-sales script, run deliberately by the owner or a manager, and the
-- Paper mark renders only on bills it wrote.
--
-- Everything here adds. The two `drop not null`s loosen columns a published
-- build always fills; every published build keeps writing a tablet and a
-- biller, takes the 'counter' default, and satisfies the new check.

-- ── How a bill was entered ─────────────────────────────────────────────────

alter table public.bills
  add column entry_source text not null default 'counter',
  add column entered_by uuid references public.profiles (id),
  add column entered_at timestamptz,
  -- The canonical hash of what the enterer sent, so the same written order
  -- sent again is recognised and different content under its id is refused.
  add column entry_payload_hash text;

alter table public.bills alter column counter_device_id drop not null;
alter table public.bills alter column biller_profile_id drop not null;

-- The pairing, held by the database for every writer (owner's agreement, Q12).
-- release-lint: allow constraint — every published build writes a counter_device_id and a biller and takes the 'counter' default, so no write it makes can fail this; the owner agreed on 2026-10-15 (a-sale-taken-on-paper-says-so, Q12)
alter table public.bills add constraint bills_entry_source_attribution check (
  (entry_source = 'counter'
     and counter_device_id is not null and biller_profile_id is not null
     and entered_by is null and entered_at is null and entry_payload_hash is null)
  or (entry_source = 'paper'
     and counter_device_id is null and biller_profile_id is null
     and counter_shift_id is null and shift_id is null and order_id is null
     and entered_by is not null and entered_at is not null
     and entry_payload_hash is not null));

create index bills_paper_entries_idx
  on public.bills (outlet_id, business_date)
  where entry_source = 'paper';

-- ── record_paper_bill ──────────────────────────────────────────────────────
--
-- One written order per call, so a sheet of five hundred is five hundred small
-- idempotent calls and a refusal stops at one order. The payload is compact:
--
--   { "businessDate": "2026-10-19",
--     "orderedAt": "2026-10-19T19:40:00+05:30",
--     "lines": [{ "menuItemId": "…", "quantity": 2,
--                 "unitPricePaise": 15000,   -- optional: the menu's price
--                 "discountPaise": 0 }],     -- optional
--     "discountPaise": 0,                    -- optional, a flat bill discount
--     "payments": [{ "method": "cash", "amountPaise": 30000 }],
--     "customerPhone": null, "customerName": null }
--
-- The server takes each dish's name and category from the outlet's menu, works
-- out the totals, and runs the counter's own validators over the full payload
-- it builds, so a paper bill passes exactly the checks a counter bill does.
-- A paper bill never spends points (there is no field for it) and never sends
-- a receipt: a bill with a customer gets its delivery row written here, already
-- skipped, so bill_receipt_enqueue meets the conflict at commit and does
-- nothing, and bill_receipt_claim never sees it.

create function public.record_paper_bill(p_bill_id uuid, p_outlet_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet public.outlets%rowtype;
  v_hash text;
  v_existing public.bills%rowtype;
  v_date date;
  v_at timestamptz;
  v_line jsonb;
  v_name text;
  v_category text;
  v_menu_price bigint;
  v_qty integer;
  v_price bigint;
  v_line_total bigint;
  v_line_discount bigint;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_line_discounts bigint := 0;
  v_bill_discount bigint;
  v_discounts jsonb := '[]'::jsonb;
  v_raw bigint;
  v_rounding bigint;
  v_total bigint;
  v_paid bigint;
  v_phone text;
  v_customer_name text;
  v_full jsonb;
  v_customer uuid;
  v_summary public.payment_method;
  v_number bigint;
begin
  -- ── Who ──────────────────────────────────────────────────────────────────
  -- A person's own session, active, and the owner or a manager of this outlet.
  -- A counter tablet has no profile, so app_account_active() refuses it.
  if auth.uid() is null or not public.app_account_active() then
    raise exception 'not authorised to record paper sales' using errcode = '42501';
  end if;
  select * into v_outlet from public.outlets where id = p_outlet_id;
  if not found
     or not ((select public.app_is_owner())
             or public.app_has_role_at('franchise_admin', p_outlet_id)) then
    raise exception 'not authorised to record paper sales at this outlet' using errcode = '42501';
  end if;
  if p_bill_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'a paper bill needs an id and a payload' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('businessDate', 'orderedAt', 'lines', 'discountPaise',
                              'payments', 'customerPhone', 'customerName')) then
    raise exception 'the payload carries a field a paper bill does not take' using errcode = '22023';
  end if;

  -- ── The same written order again ─────────────────────────────────────────
  v_hash := public.billing_payload_hash(
    jsonb_build_object('outletId', p_outlet_id, 'bill', p_payload));
  select * into v_existing from public.bills where id = p_bill_id;
  if found then
    if v_existing.entry_source = 'paper' and v_existing.entry_payload_hash = v_hash then
      return jsonb_build_object('status', 'accepted', 'billId', v_existing.id,
        'billNumber', v_existing.bill_number, 'totalPaise', v_existing.total_paise,
        'replayed', true);
    end if;
    raise exception 'bill % is already recorded with different content', p_bill_id
      using errcode = '23505';
  end if;

  -- ── When ─────────────────────────────────────────────────────────────────
  begin
    v_date := (p_payload ->> 'businessDate')::date;
    v_at := (p_payload ->> 'orderedAt')::timestamptz;
  exception when others then
    raise exception 'businessDate and orderedAt must be a date and a time' using errcode = '22023';
  end;
  if v_date is null or v_at is null then
    raise exception 'a paper bill needs its business date and its time' using errcode = '22023';
  end if;
  if v_at > now() then
    raise exception 'a paper bill cannot be in the future' using errcode = '22023';
  end if;
  if public.app_business_date(v_at, v_outlet.business_day_cutover) is distinct from v_date then
    raise exception '% belongs to business date %, not %', v_at,
      public.app_business_date(v_at, v_outlet.business_day_cutover), v_date
      using errcode = '22023';
  end if;

  -- ── What ─────────────────────────────────────────────────────────────────
  if jsonb_typeof(p_payload -> 'lines') <> 'array'
     or jsonb_array_length(p_payload -> 'lines') = 0
     or jsonb_array_length(p_payload -> 'lines') > 100 then
    raise exception 'a paper bill needs between 1 and 100 lines' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_payload -> 'lines')
  loop
    if jsonb_typeof(v_line) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_line) k
                   where k not in ('menuItemId', 'quantity', 'unitPricePaise', 'discountPaise'))
       or jsonb_typeof(v_line -> 'menuItemId') <> 'string'
       or jsonb_typeof(v_line -> 'quantity') <> 'number'
       or (v_line ->> 'quantity') !~ '^[0-9]{1,3}$'
       or (v_line -> 'unitPricePaise' is not null and jsonb_typeof(v_line -> 'unitPricePaise') <> 'null'
           and ((v_line ->> 'unitPricePaise') !~ '^[0-9]{1,9}$'))
       or (v_line -> 'discountPaise' is not null and jsonb_typeof(v_line -> 'discountPaise') <> 'null'
           and ((v_line ->> 'discountPaise') !~ '^[0-9]{1,9}$')) then
      raise exception 'a line must name a menu item and a whole quantity, in whole paise'
        using errcode = '22023';
    end if;
    select m.name, m.price_paise, c.name into v_name, v_menu_price, v_category
      from public.menu_items m
      left join public.menu_categories c on c.id = m.category_id
     where m.id::text = v_line ->> 'menuItemId'
       and m.outlet_id = p_outlet_id
       and m.is_active;
    if not found then
      raise exception 'menu item % is not on this outlet''s menu', v_line ->> 'menuItemId'
        using errcode = '22023';
    end if;
    v_qty := (v_line ->> 'quantity')::integer;
    v_price := coalesce((v_line ->> 'unitPricePaise')::bigint, v_menu_price);
    v_line_discount := coalesce((v_line ->> 'discountPaise')::bigint, 0);
    v_line_total := v_price * v_qty;
    if v_qty < 1 or v_price < 1 or v_line_discount > v_line_total then
      raise exception '% × %: a quantity of at least 1, a price of at least 1 paisa, and no more discount than the line',
        v_qty, v_name using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'menuItemId', v_line ->> 'menuItemId',
      'itemName', v_name,
      'unitPricePaise', v_price,
      'quantity', v_qty,
      'lineTotalPaise', v_line_total,
      'discountPaise', v_line_discount,
      -- A whole line given away is the waiver shape the counter already reads.
      'discountPercentBp', case when v_line_discount > 0 and v_line_discount = v_line_total
                                then 10000 end,
      'categoryName', v_category,
      'kind', 'item'));
    v_subtotal := v_subtotal + v_line_total;
    v_line_discounts := v_line_discounts + v_line_discount;
  end loop;

  if p_payload -> 'discountPaise' is not null and jsonb_typeof(p_payload -> 'discountPaise') <> 'null'
     and (jsonb_typeof(p_payload -> 'discountPaise') <> 'number'
          or (p_payload ->> 'discountPaise') !~ '^[0-9]{1,9}$') then
    raise exception 'discountPaise must be whole paise' using errcode = '22023';
  end if;
  v_bill_discount := coalesce((p_payload ->> 'discountPaise')::bigint, 0);
  if v_bill_discount > 0 then
    v_discounts := jsonb_build_array(jsonb_build_object(
      'basis', 'amount', 'valueBp', null, 'valuePaise', v_bill_discount,
      'amountPaise', v_bill_discount, 'source', 'biller'));
  end if;

  -- The counter's arithmetic: rounded up to the rupee, and never under ₹1. An
  -- order given away entirely cannot be a bill, here or at the counter.
  v_raw := v_subtotal - v_line_discounts - v_bill_discount;
  if v_raw < 1 then
    raise exception 'a bill must come to at least ₹1; an order given away entirely cannot be recorded as a bill'
      using errcode = '22023';
  end if;
  v_rounding := (100 - v_raw % 100) % 100;
  v_total := v_raw + v_rounding;

  select coalesce(sum((p ->> 'amountPaise')::bigint), 0) into v_paid
    from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'payments') = 'array'
                                   then p_payload -> 'payments' else '[]'::jsonb end) p
   where (p ->> 'amountPaise') ~ '^[0-9]{1,12}$';
  if not coalesce(public.billing_validate_payments(p_payload -> 'payments', v_total), false) then
    raise exception 'payments must be cash and/or UPI, once each, adding up to the total of % paise (they add up to %)',
      v_total, v_paid using errcode = '22023';
  end if;

  -- ── Who bought it ────────────────────────────────────────────────────────
  v_phone := nullif(btrim(coalesce(p_payload ->> 'customerPhone', '')), '');
  v_customer_name := nullif(btrim(coalesce(p_payload ->> 'customerName', '')), '');
  if v_phone is not null then
    v_phone := public.normalize_indian_phone(v_phone);
    if v_phone is null then
      raise exception 'customerPhone % is not an Indian mobile number', p_payload ->> 'customerPhone'
        using errcode = '22023';
    end if;
  end if;

  -- ── The counter's own checks, over the payload a till would have sent ────
  v_full := jsonb_build_object(
    'customerId', null, 'customerName', v_customer_name, 'customerPhone', v_phone,
    'subtotalPaise', v_subtotal, 'discountPaise', v_line_discounts + v_bill_discount,
    'taxPaise', 0, 'roundingPaise', v_rounding, 'totalPaise', v_total,
    'pricingMode', 'no_tax', 'payments', p_payload -> 'payments',
    'lines', v_lines, 'discounts', v_discounts);
  if not (public.billing_content_payload_well_typed(v_full)
          and public.billing_points_shape_ok(v_full, 4)
          and coalesce(public.billing_validate_totals(v_full), false)
          and coalesce(public.billing_validate_discounts(v_full), false)) then
    raise exception 'the bill does not pass the counter''s checks' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload -> 'payments') = 1 then
    v_summary := ((p_payload -> 'payments' -> 0) ->> 'method')::public.payment_method;
  end if;

  v_customer := case when v_phone is not null
                     then public.customer_resolve_for_sale(v_phone, v_customer_name) end;

  -- ── Write it ─────────────────────────────────────────────────────────────
  perform set_config('app.billing_command', '1', true);
  begin
    insert into public.bills (
      id, outlet_id, business_date, payment_business_date, ordered_at, paid_at, order_id,
      biller_profile_id, counter_device_id, counter_shift_id, shift_id,
      customer_id, customer_name, customer_phone,
      subtotal_paise, discount_paise, tax_paise, rounding_paise, total_paise, pricing_mode,
      payment_method, status, created_at, synced_at,
      entry_source, entered_by, entered_at, entry_payload_hash)
    values (
      p_bill_id, p_outlet_id, v_date, v_date, v_at, v_at, null,
      null, null, null, null,
      v_customer, v_customer_name, v_phone,
      v_subtotal, v_line_discounts + v_bill_discount, 0, v_rounding, v_total, 'no_tax',
      v_summary, 'settled', now(), now(),
      'paper', auth.uid(), now(), v_hash)
    returning bill_number into v_number;
  exception when unique_violation then
    -- The same id arrived twice at once: whichever wrote first stands.
    select * into v_existing from public.bills where id = p_bill_id;
    if found and v_existing.entry_source = 'paper' and v_existing.entry_payload_hash = v_hash then
      return jsonb_build_object('status', 'accepted', 'billId', v_existing.id,
        'billNumber', v_existing.bill_number, 'totalPaise', v_existing.total_paise,
        'replayed', true);
    end if;
    raise exception 'bill % is already recorded with different content', p_bill_id
      using errcode = '23505';
  end;

  insert into public.bill_payments (bill_id, outlet_id, method, amount_paise)
    select p_bill_id, p_outlet_id, (payment ->> 'method')::public.payment_method,
           (payment ->> 'amountPaise')::bigint
      from jsonb_array_elements(p_payload -> 'payments') payment;
  insert into public.bill_items
    (id, bill_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise,
     discount_paise, discount_percent_bp, category_name, kind)
    select (line ->> 'id')::uuid, p_bill_id, (line ->> 'menuItemId')::uuid, line ->> 'itemName',
           (line ->> 'unitPricePaise')::bigint, (line ->> 'quantity')::integer,
           (line ->> 'lineTotalPaise')::bigint, (line ->> 'discountPaise')::bigint,
           nullif(line ->> 'discountPercentBp', '')::integer,
           nullif(line ->> 'categoryName', ''), 'item'::public.line_kind
      from jsonb_array_elements(v_lines) line;
  insert into public.bill_discounts (bill_id, outlet_id, basis, value_bp, value_paise, amount_paise, source)
    select p_bill_id, p_outlet_id, (d ->> 'basis')::public.discount_basis,
           nullif(d ->> 'valueBp', '')::integer, nullif(d ->> 'valuePaise', '')::bigint,
           (d ->> 'amountPaise')::bigint, 'biller'::public.discount_row_source
      from jsonb_array_elements(v_discounts) d;

  if v_customer is not null then
    insert into public.bill_receipt_deliveries (bill_id, outlet_id, state, earned_points, balance_points)
    values (p_bill_id, p_outlet_id, 'skipped', 0, 0);
  end if;

  return jsonb_build_object('status', 'accepted', 'billId', p_bill_id,
    'billNumber', v_number, 'totalPaise', v_total, 'replayed', false);
end;
$$;

revoke all on function public.record_paper_bill(uuid, uuid, jsonb) from public, anon;
grant execute on function public.record_paper_bill(uuid, uuid, jsonb) to authenticated;
