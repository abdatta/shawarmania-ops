-- Extensions and enums.
--
-- Every constrained value in the schema is a Postgres enum, so an invalid
-- value is a constraint violation rather than a bad row, and the generated
-- TypeScript types carry the unions into every mock downstream.

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('super_admin', 'franchise_admin', 'biller', 'employee');

create type public.payment_method as enum ('cash', 'upi', 'card', 'swiggy', 'zomato', 'other');

-- v1 always writes no_tax. The other values exist now so that when GST is
-- enabled, historical bills stay unambiguous instead of being silently
-- reinterpreted under new rules.
create type public.pricing_mode as enum ('no_tax', 'gst_inclusive', 'gst_exclusive');

create type public.bill_status as enum ('settled', 'void');

create type public.movement_type as enum ('added', 'used', 'wasted', 'correction');

create type public.inventory_unit as enum ('kg', 'litre', 'packet', 'piece');

create type public.expense_category as enum (
  'raw_materials', 'salaries', 'rent', 'electricity',
  'packaging', 'maintenance', 'marketing', 'other'
);

create type public.attendance_status as enum ('present', 'absent', 'half_day', 'leave');

create type public.check_in_source as enum ('phone', 'counter_tablet');

create type public.employment_status as enum ('active', 'inactive', 'terminated');

create type public.alert_category as enum (
  'inventory', 'equipment', 'cash_mismatch', 'employee', 'supplier', 'other'
);

create type public.alert_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.alert_status as enum ('open', 'acknowledged', 'resolved', 'closed');
