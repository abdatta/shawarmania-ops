-- retire-dish-ticks, 3.2: the contract half of `kitchen-ready`. The kitchen has
-- marked food Done on every build since `aabc97b7` (first live in Deploy
-- `ac4ce56d`, 18 October), and every registered device runs a build that
-- contains it.
-- release: contract kitchen-ready
--
-- After `instant-saves`, which depended on it, and before `dish-ticks`, which
-- it depends on. Nothing in the schema reads this gate (searched in production
-- and on a fresh reset, 21 October), so only the row is retired.

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'kitchen-ready';
