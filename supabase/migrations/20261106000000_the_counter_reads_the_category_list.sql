-- a-check-in-at-the-shop-approves-itself (#81), design D11: the counter tablet
-- reads the owners' category list.
-- change-gate: expense-category-list
--
-- A counter or kitchen tablet signs in as its own identity, which has no
-- profile, so `app_account_active()` is false for it and the list's one read
-- policy returned nothing. The counter's expense form then fell back to the
-- typed field, as it does when the list cannot load (production, 2026-10-30).
-- The list is business-wide and holds nothing secret, so a live, proven tablet
-- reads it in the shape `change_gates` already uses. A second permissive
-- policy, admitting only while the gate is on: the first is untouched, and
-- only the gate's on path reads the table.

create policy expense_category_choices_select_tablet on public.expense_category_choices
  for select to authenticated
  using (
    (select public.app_change_gate('expense-category-list'))
    and public.app_device_ok()
    and public.app_counter_device() is not null
  );
