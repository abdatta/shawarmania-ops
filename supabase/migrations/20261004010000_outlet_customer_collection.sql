-- #59: an outlet can remove customer entry from its counter workflow.
alter table public.outlets
  add column collect_customer_details boolean not null default true;

comment on column public.outlets.collect_customer_details is
  'Offer customer entry at ordering and ask at payment. Off preserves existing customer facts; it is not receipt suppression.';

-- Replace the signature rather than creating an ambiguous defaulted overload.
-- Older clients omit the new argument and preserve the stored choice.
drop function public.set_outlet_service_settings(
  uuid, boolean, boolean, boolean, public.packaging_mode, integer, boolean
);

create function public.set_outlet_service_settings(
  p_outlet uuid,
  p_dine_in_offered boolean,
  p_takeaway_offered boolean,
  p_table_numbers boolean,
  p_packaging_mode public.packaging_mode,
  p_packaging_price_paise integer,
  p_packaging_free_for_gold boolean,
  p_collect_customer_details boolean default null
)
returns public.outlets
language plpgsql security definer
set search_path = ''
as $$
declare
  v_outlet public.outlets;
begin
  if auth.uid() is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet)) then
    raise exception 'only the owner or this outlet''s manager may change how it serves'
      using errcode = 'insufficient_privilege';
  end if;

  update public.outlets
     set dine_in_offered = p_dine_in_offered,
         takeaway_offered = p_takeaway_offered,
         table_numbers = p_table_numbers,
         packaging_mode = p_packaging_mode,
         packaging_price_paise = p_packaging_price_paise,
         packaging_free_for_gold = p_packaging_free_for_gold,
         collect_customer_details = coalesce(p_collect_customer_details, collect_customer_details)
   where id = p_outlet
  returning * into v_outlet;
  if not found then
    raise exception 'no such outlet' using errcode = 'no_data_found';
  end if;
  return v_outlet;
end;
$$;

comment on function public.set_outlet_service_settings is
  'Owner or same-outlet active franchise admin writes only service and customer-collection settings. Omitting collection preserves it for older clients.';

revoke execute on function public.set_outlet_service_settings(
  uuid, boolean, boolean, boolean, public.packaging_mode, integer, boolean, boolean
) from public, anon;
grant execute on function public.set_outlet_service_settings(
  uuid, boolean, boolean, boolean, public.packaging_mode, integer, boolean, boolean
) to authenticated;
