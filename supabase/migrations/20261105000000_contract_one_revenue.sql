-- retire-one-revenue: the contract half. Overview, the Ledger and Analytics
-- have read revenue one way on every build since `aa82e161` (live in Deploy
-- `aa82e161`, 22 October), and every registered device runs a build that
-- contains it; Kalyani Cafe has traded nine services on it.
-- release: contract one-revenue
--
-- No function, policy, trigger or view reads the key (searched in production
-- and on a fresh reset, 30 October). The five reads below were the off path's
-- only: the old Overview card's three, and Analytics' first two, which
-- `sales_analytics_v2` and `sales_analytics_series_v2` replaced. Each called
-- only its own sibling, and nothing else in the schema calls any of them.

drop function public.overview_revenue(uuid, date, date);
drop function public.overview_sales(uuid, date, date);
drop function public.overview_expenses(uuid, date, date);
drop function public.sales_analytics_series(uuid, date, date, integer, text, text);
drop function public.sales_analytics(uuid, date, date, text, integer);

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'one-revenue';
