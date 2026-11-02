-- retire-tablet-health, 3.1: the contract half of `tablet-health`. Every build
-- since `01f82d0a` (first live in Deploy 41164443637, 31 October) counts its
-- requests and reports them each minute without asking the gate. Every
-- registered device runs a build that contains it: on 3 November, Cafe Laptop,
-- Conti Kitchen and Shawarma Kitchen on `c83ec673`, after three services on it
-- (31 October, 1 and 2 November).
-- release: contract tablet-health
--
-- After `fewer-requests`, whose old path was the one that read this gate.
--
-- Nothing in the database reads the key: no function, policy, trigger or view,
-- in production or on a fresh reset, on 3 November. The health table and both
-- report functions were always written whatever the gate said, so nothing only
-- the off path used is left to drop. The row is retired.

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'tablet-health';
