-- An exact create-order retry is decided from its compact receipt before
-- validation consults rows written by the first accepted attempt.
--
-- The first call inserts order_items. On a lost response the identical retry
-- used to feed those now-existing line ids back through create-only collision
-- validation, which returned arithmetic_invalid before billing_begin_command
-- could return replay. The early receipt read repeats that function's complete
-- identity comparison without claiming new work; a not-yet-seen command still
-- validates first and uses billing_begin_command as its concurrency boundary.

create or replace function public.create_billing_order(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text;
  v_context jsonb;
  v_claim jsonb;
  v_existing public.billing_commands%rowtype;
  v_outlet uuid;
  v_actor uuid;
  v_order uuid;
  v_customer uuid;
  v_date date;
  v_number bigint;
  v_result jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id, p_schema_version,
    p_payload_hash, p_created_at, p_payload, array[
      'orderId','businessDate','customerId','customerName','customerPhone',
      'subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines']);
  if v_error is not null then return jsonb_build_object('status', v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;

  v_context := public.billing_device_context(p_shift_id, p_created_at);
  if v_context ->> 'status' <> 'ok' then return v_context; end if;
  v_outlet := (v_context ->> 'outletId')::uuid;
  v_actor := (v_context ->> 'actorId')::uuid;

  -- Do not ask mutable order/menu state whether an immutable command already
  -- succeeded. The receipt carries every non-payload fact billing_begin_command
  -- compares, while retaining no customer or line content.
  select * into v_existing
    from public.billing_commands
   where id = p_command_id;
  if found then
    if v_existing.command_type is distinct from 'create_order'
       or v_existing.schema_version is distinct from p_schema_version
       or v_existing.payload_hash is distinct from p_payload_hash
       or v_existing.client_created_at is distinct from p_created_at
       or v_existing.outlet_id is distinct from v_outlet
       or v_existing.device_id is distinct from auth.uid()
       or v_existing.shift_id is distinct from p_shift_id
       or v_existing.actor_id is distinct from v_actor then
      return jsonb_build_object('status','identity_conflict','commandId',p_command_id);
    end if;
    if v_existing.result_category = 'accepted' then
      return jsonb_set(v_existing.result, '{status}', '"replay"'::jsonb, true);
    end if;
    return v_existing.result;
  end if;

  begin
    v_order := (p_payload ->> 'orderId')::uuid;
    v_customer := nullif(p_payload ->> 'customerId', '')::uuid;
    v_date := (p_payload ->> 'businessDate')::date;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;

  if v_order is null or v_date is null
     or not public.billing_content_payload_well_typed(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;

  if v_date is distinct from (select public.app_business_date(
      p_created_at, business_day_cutover) from public.outlets where id = v_outlet) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if not coalesce(public.billing_validate_totals(p_payload),false)
     or not coalesce(public.billing_validate_lines(p_payload -> 'lines', v_outlet),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;

  v_claim := public.billing_begin_command(p_command_id, 'create_order', p_schema_version,
    p_payload_hash, p_created_at, v_outlet, auth.uid(), p_shift_id, v_actor);
  if v_claim ->> 'status' <> 'claimed' then return v_claim; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_outlet::text||':'||v_date::text,0));
  perform set_config('app.billing_command','1',true);
  begin
    v_number := public.billing_next_order_number(v_outlet, v_date);
    insert into public.orders (
      id, outlet_id, order_number, device_id, created_by, created_shift_id,
      ordered_at, business_date, customer_id, customer_name, customer_phone,
      subtotal_paise, discount_paise, tax_paise, total_paise, pricing_mode)
    values (
      v_order, v_outlet, v_number, auth.uid(), v_actor, p_shift_id,
      p_created_at, v_date, v_customer,
      nullif(p_payload ->> 'customerName',''), nullif(p_payload ->> 'customerPhone',''),
      (p_payload ->> 'subtotalPaise')::bigint,
      (p_payload ->> 'discountPaise')::bigint,
      (p_payload ->> 'taxPaise')::bigint,
      (p_payload ->> 'totalPaise')::bigint,
      (p_payload ->> 'pricingMode')::public.pricing_mode);

    insert into public.order_items
      (id, order_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise)
    select (line ->> 'id')::uuid, v_order, nullif(line ->> 'menuItemId','')::uuid,
      line ->> 'itemName', (line ->> 'unitPricePaise')::bigint,
      (line ->> 'quantity')::integer, (line ->> 'lineTotalPaise')::bigint
      from jsonb_array_elements(p_payload -> 'lines') line;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id), v_date);
  end;
  v_result := jsonb_build_object('status','accepted','commandId',p_command_id,
    'orderId',v_order,'orderNumber',v_number,'delayed',(v_context ->> 'delayed')::boolean);
  return public.billing_finish_command(p_command_id, v_result, v_date);
end;
$$;
