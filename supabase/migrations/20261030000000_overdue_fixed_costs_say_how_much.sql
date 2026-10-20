-- fixed-costs-are-spread-over-the-month (#79): Needs attention says how much is
-- overdue, and on what, not only how many fixed costs (owner, 2026-10-20: a
-- salary unpaid must not look like an attendance approval waiting).
-- change-gate: pro-rata-pnl
--
-- `fixed_costs_unpaid` keeps every key it had (`count`, `months`) and adds
-- three: `paise`, what the ended months left uncovered; `categories`, how many
-- of the fixed costs behind it are salaries, rent, utilities and other; and
-- `today`, the latest business date among the outlets read, from which the
-- screen decides whether it is still the days salaries are paid in. A build
-- that reads only the first two reads them as before.

create or replace function public.fixed_costs_unpaid()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner boolean := coalesce(public.app_is_owner(), false);
begin
  if not coalesce(public.app_account_active(), false) then
    return jsonb_build_object('count', 0, 'months', '[]'::jsonb, 'paise', 0,
                              'categories', '{}'::jsonb, 'today', null);
  end if;
  return (
    with reach as (
      select c.id, c.category, t.today,
             public.fixed_cost_paid_paise(c.id, t.today) as paid_paise
        from public.fixed_costs c
        cross join lateral (select public.fixed_costs_today(c.outlet_id) as today) t
       where v_owner or c.outlet_id in (select public.app_outlets_for('franchise_admin'))
    ),
    -- First in, first out: an ended month is short where the running total of
    -- costs passes what has been paid, by the smaller of its cost and that gap.
    short as (
      select r.id, r.category, m.month,
             least(m.cost_paise, m.cumulative_paise - r.paid_paise) as short_paise
        from reach r
        cross join lateral public.fixed_cost_months(
          r.id, (date_trunc('month', r.today::timestamp) - interval '1 month')::date) m
       where m.cumulative_paise > r.paid_paise
    )
    select jsonb_build_object(
      'count', (select count(distinct short.id) from short),
      'months', coalesce((select jsonb_agg(distinct short.month order by short.month)
                            from short), '[]'::jsonb),
      'paise', (select coalesce(sum(short.short_paise), 0)::bigint from short),
      'categories', coalesce((
        select jsonb_object_agg(per.category, per.costs)
          from (select short.category, count(distinct short.id) as costs
                  from short group by short.category) per), '{}'::jsonb),
      'today', (select max(reach.today) from reach)));
end $$;
