-- A short tender correction is an append, never a rewrite of a settled sale.

alter table public.billing_commands drop constraint billing_commands_command_type_check;
alter table public.billing_commands add constraint billing_commands_command_type_check
  check (command_type in (
    'create_order','revise_order','cancel_order','pay_order','pay_now',
    'correct_bill_payment','void_bill','manager_cancel_order','confirm_end_of_day'));

create table public.bill_payment_corrections (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique references public.billing_commands(id),
  bill_id uuid not null,
  outlet_id uuid not null references public.outlets(id),
  device_id uuid not null references public.counter_devices(id),
  shift_id uuid not null references public.counter_shifts(id),
  actor_id uuid not null references public.profiles(id),
  revision integer not null check (revision > 0),
  client_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint bill_payment_corrections_bill_outlet_fk
    foreign key (bill_id, outlet_id) references public.bills(id, outlet_id),
  constraint bill_payment_corrections_bill_revision_unique unique (bill_id, revision)
);

create table public.bill_payment_correction_allocations (
  correction_id uuid not null references public.bill_payment_corrections(id),
  outlet_id uuid not null references public.outlets(id),
  method public.payment_method not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  primary key (correction_id, method)
);

create index bill_payment_corrections_outlet_bill_idx
  on public.bill_payment_corrections(outlet_id, bill_id, revision desc);
create index bill_payment_correction_allocations_outlet_idx
  on public.bill_payment_correction_allocations(outlet_id, correction_id);

alter table public.bill_payment_corrections enable row level security;
alter table public.bill_payment_correction_allocations enable row level security;

create policy bill_payment_corrections_select
  on public.bill_payment_corrections for select to authenticated using (
    exists (select 1 from public.bills b where b.id=bill_id and b.outlet_id=outlet_id));
create policy bill_payment_correction_allocations_select
  on public.bill_payment_correction_allocations for select to authenticated using (
    exists (select 1 from public.bill_payment_corrections c
      where c.id=correction_id and c.outlet_id=outlet_id));

grant select on public.bill_payment_corrections,
  public.bill_payment_correction_allocations to authenticated;
grant all on public.bill_payment_corrections,
  public.bill_payment_correction_allocations to service_role;
revoke insert,update,delete on public.bill_payment_corrections,
  public.bill_payment_correction_allocations from authenticated,anon;

create or replace function public.billing_payment_correction_insert_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.billing_command',true) is distinct from '1' then
    raise exception 'payment corrections may be inserted only through billing commands'
      using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger bill_payment_corrections_command_insert
  before insert on public.bill_payment_corrections for each row
  execute function public.billing_payment_correction_insert_guard();
create trigger bill_payment_correction_allocations_command_insert
  before insert on public.bill_payment_correction_allocations for each row
  execute function public.billing_payment_correction_insert_guard();
create trigger bill_payment_corrections_immutable
  before update or delete on public.bill_payment_corrections for each row
  execute function public.reject_mutation();
create trigger bill_payment_correction_allocations_immutable
  before update or delete on public.bill_payment_correction_allocations for each row
  execute function public.reject_mutation();

create view public.effective_bill_payments
with (security_invoker = true)
as
with latest as (
  select distinct on (bill_id) id, bill_id, outlet_id, revision
    from public.bill_payment_corrections
   order by bill_id, revision desc
)
select bp.bill_id, bp.outlet_id, bp.method, bp.amount_paise, 0::integer as revision
  from public.bill_payments bp
 where not exists (select 1 from latest l where l.bill_id=bp.bill_id)
union all
select l.bill_id, l.outlet_id, a.method, a.amount_paise, l.revision
  from latest l
  join public.bill_payment_correction_allocations a on a.correction_id=l.id;

grant select on public.effective_bill_payments to authenticated,service_role;

create or replace function public.correct_bill_payment(
  p_command_id uuid default null,p_schema_version integer default null,
  p_payload_hash text default null,p_created_at timestamptz default null,
  p_shift_id uuid default null,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text; v_context jsonb; v_claim jsonb; v_bill public.bills%rowtype;
  v_bill_id uuid; v_expected integer; v_current integer; v_correction uuid;
  v_result jsonb; v_same boolean;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','expectedRevision','payments']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'expectedRevision')<>'number'
     or (p_payload->>'expectedRevision') !~ '^[0-9]+$'
     or jsonb_typeof(p_payload->'payments')<>'array' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  begin
    v_bill_id:=(p_payload->>'billId')::uuid;
    v_expected:=(p_payload->>'expectedRevision')::integer;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;

  select * into v_bill from public.bills where id=v_bill_id for update;
  if not found or v_bill.outlet_id<>(v_context->>'outletId')::uuid
     or v_bill.counter_device_id<>auth.uid()
     or v_bill.counter_shift_id<>p_shift_id then
    return jsonb_build_object('status','authorization_refused');
  end if;

  v_claim:=public.billing_begin_command(p_command_id,'correct_bill_payment',p_schema_version,
    p_payload_hash,p_created_at,v_bill.outlet_id,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;

  if v_bill.status<>'settled' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  if p_created_at<v_bill.paid_at or p_created_at>=v_bill.paid_at+interval '5 minutes' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','payment_edit_expired','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  if not coalesce(public.billing_validate_payments(p_payload->'payments',v_bill.total_paise),false) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','arithmetic_invalid','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;

  select coalesce(max(revision),0) into v_current
    from public.bill_payment_corrections where bill_id=v_bill.id;
  if v_expected<>v_current then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','stale_revision','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  select not exists (
    (select method::text,amount_paise from public.effective_bill_payments where bill_id=v_bill.id
     except select payment->>'method',(payment->>'amountPaise')::bigint
       from jsonb_array_elements(p_payload->'payments') payment)
    union all
    (select payment->>'method',(payment->>'amountPaise')::bigint
       from jsonb_array_elements(p_payload->'payments') payment
     except select method::text,amount_paise from public.effective_bill_payments where bill_id=v_bill.id)
  ) into v_same;
  if v_same then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','arithmetic_invalid','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;

  perform set_config('app.billing_command','1',true);
  insert into public.bill_payment_corrections
    (command_id,bill_id,outlet_id,device_id,shift_id,actor_id,revision,client_created_at)
  values (p_command_id,v_bill.id,v_bill.outlet_id,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid,v_current+1,p_created_at)
  returning id into v_correction;
  insert into public.bill_payment_correction_allocations
    (correction_id,outlet_id,method,amount_paise)
  select v_correction,v_bill.outlet_id,(payment->>'method')::public.payment_method,
    (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,
    'billId',v_bill.id,'billNumber',v_bill.bill_number,'paymentRevision',v_current+1,
    'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,
    v_bill.business_date,v_bill.payment_business_date);
end;
$$;

grant execute on function public.correct_bill_payment(uuid,integer,text,timestamptz,uuid,jsonb)
  to authenticated;

create or replace function public.reject_open_payment_edit_at_finish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.bills b
    where b.counter_device_id=new.device_id and b.payment_business_date=new.business_date
      and b.status='settled' and b.paid_at+interval '5 minutes'>now()) then
    raise exception 'a recent payment is still editable' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger billing_end_of_day_payment_edit_guard
  before insert or update on public.billing_end_of_day_confirmations for each row
  execute function public.reject_open_payment_edit_at_finish();

create or replace function public.manual_ledger_counter_revenue(
  p_outlet_id uuid,p_from date,p_to date
)
returns table (business_date date,cash_revenue_paise bigint,upi_revenue_paise bigint)
language sql stable security invoker set search_path = '' as $$
  select b.payment_business_date,
    coalesce(sum(bp.amount_paise) filter(where bp.method='cash'),0)::bigint,
    coalesce(sum(bp.amount_paise) filter(where bp.method='upi'),0)::bigint
  from public.bills b
  join public.effective_bill_payments bp on bp.bill_id=b.id and bp.outlet_id=b.outlet_id
  join public.outlets o on o.id=b.outlet_id
  where b.outlet_id=p_outlet_id and b.status='settled' and o.billing_live_from is not null
    and b.payment_business_date>=greatest(p_from,o.billing_live_from)
    and b.payment_business_date<p_to
  group by b.payment_business_date order by b.payment_business_date;
$$;

create or replace function public.close_business_day(
  p_outlet_id uuid,p_business_date date,p_opening_cash_paise bigint,
  p_actual_closing_paise bigint,p_notes text default null
)
returns public.daily_cash_records
language plpgsql security definer set search_path = '' as $$
declare v_sales bigint; v_expenses bigint; v_withdrawn bigint; v_expected bigint;
  v_record public.daily_cash_records%rowtype;
begin
  if auth.uid() is null or not public.app_account_active()
     or not public.app_has_role_at('franchise_admin',p_outlet_id) then
    raise exception 'only an active franchise admin of this outlet may close its business day';
  end if;
  if p_opening_cash_paise is null or p_opening_cash_paise<0
     or p_actual_closing_paise is null or p_actual_closing_paise<0 then
    raise exception 'opening and counted closing cash must be non-negative paise amounts';
  end if;
  perform public.billing_assert_day_ready(p_outlet_id,p_business_date);
  select coalesce(sum(bp.amount_paise),0) into v_sales
    from public.effective_bill_payments bp join public.bills b on b.id=bp.bill_id
    where bp.outlet_id=p_outlet_id and b.payment_business_date=p_business_date
      and bp.method='cash' and b.status='settled';
  select coalesce(sum(amount_paise),0) into v_expenses from public.expenses
    where outlet_id=p_outlet_id and business_date=p_business_date and payment_method='cash';
  select coalesce(sum(amount_paise),0) into v_withdrawn from public.cash_withdrawals
    where outlet_id=p_outlet_id and business_date=p_business_date;
  v_expected:=p_opening_cash_paise+v_sales-v_expenses-v_withdrawn;
  insert into public.daily_cash_records(outlet_id,business_date,opening_cash_paise,
    cash_sales_paise,cash_expenses_paise,cash_withdrawn_paise,expected_closing_paise,
    actual_closing_paise,difference_paise,closed_by,notes)
  values(p_outlet_id,p_business_date,p_opening_cash_paise,v_sales,v_expenses,v_withdrawn,
    v_expected,p_actual_closing_paise,p_actual_closing_paise-v_expected,auth.uid(),p_notes)
  returning * into v_record;
  return v_record;
exception when unique_violation then
  raise exception 'business day % is already closed for this outlet',p_business_date;
end;
$$;
