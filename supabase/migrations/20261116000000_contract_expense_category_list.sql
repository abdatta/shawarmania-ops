-- retire-auto-approve-at-the-shop, 3.1: the contract half of
-- `expense-category-list`, first of the three because it depends on
-- `refreshed-staff-screens`, which depends on `auto-approve-at-the-shop`.
-- Every build since `106dd273` (first live in Deploy 0fe6beed, 3 November)
-- draws the category tiles without asking the gate. Every registered device
-- runs a build that contains it: on 12 November, Cafe Laptop, Conti Kitchen
-- and Shawarma Kitchen on `8b6a567f`, after eight services on it (4 to 11
-- November).
-- release: contract expense-category-list
--
-- What reads the key, in production and in the migrations on 12 November: the
-- policy `expense_category_choices_select_tablet`, and nothing else. It keeps
-- its on branch, a live, proven tablet reads the list, before the row is
-- retired, so no moment has the counter's tiles answering off. Nothing in the
-- database served only the off path: the typed field's suggestions read
-- `expense_categories`, which stays. The row is retired.

alter policy expense_category_choices_select_tablet on public.expense_category_choices
  using (
    public.app_device_ok()
    and public.app_counter_device() is not null
  );

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'expense-category-list';
