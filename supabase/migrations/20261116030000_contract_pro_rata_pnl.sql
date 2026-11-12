-- retire-pro-rata-pnl, 3.1: the contract half of `pro-rata-pnl`. Every build
-- since `e871b2b4` (first live in Deploy c83ec673, 2 November) reads the
-- month's fixed costs beside Overview's month without asking the gate. Every
-- registered device runs a build that contains it: on 12 November, Cafe
-- Laptop, Conti Kitchen and Shawarma Kitchen on `8b6a567f`, after nine services
-- on it (3 to 11 November).
-- release: contract pro-rata-pnl
--
-- Nothing in the database reads the key: no function, policy, trigger or view,
-- in production or in the migrations, on 12 November, and its one dependency
-- row went with `20261101010000_pro_rata_pnl_stands_alone`. The fixed costs'
-- read always served both paths, so nothing only the off path used is left to
-- drop. The row is retired.

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'pro-rata-pnl';
