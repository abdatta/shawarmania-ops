-- retire-dish-ticks, 3.1: the contract half of `instant-saves`. The counter has
-- drawn its own saves at once on every build since `aabc97b7` (first live in
-- Deploy `ac4ce56d`, 18 October), and every registered device runs a build
-- that contains it.
-- release: contract instant-saves
--
-- Children first: `instant-saves` depends on `kitchen-ready` and `dish-ticks`,
-- whose contracts follow. Nothing in the schema reads this gate (searched in
-- production and on a fresh reset, 21 October), so only the row is retired.

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'instant-saves';
