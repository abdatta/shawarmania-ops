-- retire-outside-tap-closes: the contract half. A tap outside a pop-up has
-- closed it on every build since `56d103cb` (first live in Deploy `f0b4c7c6`,
-- 16 October), and every registered device runs a build that contains it.
-- release: contract outside-tap-closes
--
-- Nothing in the schema belongs to this gate: no function, policy, trigger or
-- view reads it (searched in production and on a fresh reset, 21 October). So
-- the row is retired and nothing else changes.

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'outside-tap-closes';
