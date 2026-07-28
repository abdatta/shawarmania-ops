-- Grants. The local stack's hardened defaults grant clients no data
-- privileges on new tables at all, so every client capability below is an
-- explicit, deliberate grant — the manifest of what a session may even
-- attempt. RLS then decides which rows; this layer decides which verbs.
--
-- DELETE appears nowhere below, and appears exactly once in the whole schema.
-- History is voided, soft-deleted, or corrected — never removed.
--
-- The one exception, added by 20260728000001_outlet_deletion.sql: `outlets` is
-- deletable by the Super Admin, and only while nothing anywhere references it.
-- An outlet with no staff, no attendance, no bills, no stock and no accounts
-- has no history for this rule to protect; the seventeen foreign keys pointing
-- at outlets(id) — none of which cascades — are what enforce the precondition.
-- Every other table in this schema is still client-deletable by nobody.

-- Reads.
grant select on public.outlets,
                public.profiles,
                public.counter_devices,
                public.menu_categories,
                public.menu_items,
                public.customers,
                public.shifts,
                public.bills,
                public.bill_items,
                public.inventory_items,
                public.inventory_movements,
                public.expenses,
                public.employees,
                public.attendance,
                public.cash_withdrawals,
                public.daily_cash_records,
                public.alerts,
                public.alert_responses
  to authenticated;

-- Writes, per surface. What is absent is as deliberate as what is present:
-- no client writes profiles, counter_devices, customers, or
-- daily_cash_records; nothing touches bill_number_counters.
grant insert, update on public.outlets to authenticated;          -- Super Admin, by policy
-- delete on outlets is granted in 20260728000001_outlet_deletion.sql, the
-- single exception described at the top of this file.
grant insert, update on public.menu_categories to authenticated;
grant insert, update on public.menu_items to authenticated;
grant insert, update on public.shifts to authenticated;
grant insert, update on public.bills to authenticated;            -- update = the void transition
grant insert on public.bill_items to authenticated;
grant insert on public.inventory_items to authenticated;
-- The cache column and the outlet are deliberately missing here: the ledger
-- trigger maintains the one, nothing moves the other.
grant update (name, unit, purchase_cost_paise, low_stock_threshold, is_active)
  on public.inventory_items to authenticated;
grant insert on public.inventory_movements to authenticated;
grant insert on public.expenses to authenticated;
grant insert, update on public.employees to authenticated;
grant insert, update on public.attendance to authenticated;
grant insert on public.cash_withdrawals to authenticated;
grant insert, update on public.alerts to authenticated;
grant insert on public.alert_responses to authenticated;

-- The privileged server-side role (Edge Functions, admin API) holds full
-- data privileges; it bypasses RLS by design and never reaches a browser.
grant all on all tables in schema public to service_role;

-- This app has no anonymous surface at all.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
