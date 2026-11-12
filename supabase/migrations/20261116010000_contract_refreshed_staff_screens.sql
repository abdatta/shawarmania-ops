-- retire-auto-approve-at-the-shop, 3.1: the contract half of
-- `refreshed-staff-screens`, after `expense-category-list`, which depended on
-- it, and before `auto-approve-at-the-shop`, which it depends on. Every build
-- since `106dd273` (first live in Deploy 0fe6beed, 3 November) shows the Today
-- pass, the month calendar and the expense lists' day headings without asking
-- the gate. Every registered device runs a build that contains it: on 12
-- November, Cafe Laptop, Conti Kitchen and Shawarma Kitchen on `8b6a567f`,
-- after eight services on it (4 to 11 November).
-- release: contract refreshed-staff-screens
--
-- Nothing in the database reads the key: no function, policy, trigger or view,
-- in production or in the migrations, on 12 November. The gate changed only
-- screens, so nothing only the off path used is left to drop. The row is
-- retired.

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'refreshed-staff-screens';
