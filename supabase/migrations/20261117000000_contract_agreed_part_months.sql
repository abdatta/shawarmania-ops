-- retire-agreed-part-months, 3.1: the contract half of `agreed-part-months`.
-- Every build since `f632cc42` (first live in Deploy 43190699464, 12 November,
-- 14:51 IST) stops a fixed cost through `stop_fixed_cost_v3` and asks for a
-- mid-month first month without asking the gate. Every registered device runs
-- a build that contains it: on 15 November, Cafe Laptop, Conti Kitchen and
-- Shawarma Kitchen on `960ce0f1`, after three services on it (12 to 14
-- November). Fixed costs are the owner's and managers' screens, whose phones
-- reload the app before this is promoted.
-- release: contract agreed-part-months
--
-- Nothing in the database reads the key: no function, policy, trigger or view,
-- in production or in the migrations, on 15 November. `fixed_cost_month_cost`
-- keeps its day-share fallback for a month with no agreed figure, which both
-- paths read.
--
-- `stop_fixed_cost` and `stop_fixed_cost_v2` stay: no build since the
-- retirement calls them, but a Republish to an older one would, and neither
-- reads the gate. The same choice `auto-approve-at-the-shop`'s contract made
-- for the check-in's v1 and v2. The row is retired.

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'agreed-part-months';
