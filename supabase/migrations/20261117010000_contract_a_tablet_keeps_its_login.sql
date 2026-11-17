-- retire-a-tablet-keeps-its-login, 3.1: the contract half of
-- `a-tablet-keeps-its-login`. Every build since `f632cc42` (first live in
-- Deploy 43190699464, 12 November, 14:51 IST) fences a tablet to its home and
-- refuses a person's sign-in over a tablet's session without asking the gate.
-- Every registered device runs a build that contains it: on 15 November, Cafe
-- Laptop, Conti Kitchen and Shawarma Kitchen on `960ce0f1`, after three
-- services on it (12 to 14 November).
-- release: contract a-tablet-keeps-its-login
--
-- Nothing in the database reads the key: no function, policy, trigger or view,
-- in production or in the migrations, on 15 November. The behaviour lived in
-- the client; the database's tablet proof always served both paths, so nothing
-- only the off path used is left to drop. The row is retired.

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'a-tablet-keeps-its-login';
