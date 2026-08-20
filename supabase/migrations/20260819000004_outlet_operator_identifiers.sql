-- Which operator outlet a statement's own rows belong to.
--
-- A Zomato restaurant id and the Hyperpure delivery address are facts about an
-- outlet, so they live on the outlet row rather than in an environment variable
-- the parser would have to be trusted to read correctly. The statement parser
-- reads this to turn a res id or a delivery into an operator outlet, and it reads
-- it through the service role narrowed to the caller's own outlets, so a
-- statement can never be booked against an outlet the caller does not hold.

alter table public.outlets
  add column zomato_res_id text,
  -- Both kitchens draw on one Hyperpure inventory delivered to a single address,
  -- so exactly one outlet is the delivery outlet a Hyperpure purchase books
  -- against as a shared cost.
  add column hyperpure_delivery boolean not null default false;

comment on column public.outlets.zomato_res_id is
  'The Zomato restaurant id whose order-history and settlement rows are this outlet''s. Null until the outlet is linked.';
comment on column public.outlets.hyperpure_delivery is
  'True for the single outlet a Hyperpure delivery is booked against as a shared cost, because the whole account delivers to one address.';

-- A res id identifies one outlet, so it is unique where present.
create unique index outlets_zomato_res_id_key
  on public.outlets (zomato_res_id)
  where zomato_res_id is not null;

-- At most one delivery outlet, for the same reason a Hyperpure purchase books
-- once: a second would double-count the account's supply spend.
create unique index outlets_one_hyperpure_delivery
  on public.outlets ((true))
  where hyperpure_delivery;

-- The production values, from the reconnaissance on 2026-08-18: Kalyani is
-- Zomato 21917311, Kanchrapara is 22675834, and Hyperpure delivers everything to
-- the Kanchrapara address, so it is the shared-cost delivery outlet. Matched by
-- the outlet name the seed and production both use.
update public.outlets set zomato_res_id = '21917311' where lower(name) like '%kalyani%';
update public.outlets set zomato_res_id = '22675834' where lower(name) like '%kanchrapara%';
update public.outlets set hyperpure_delivery = true where lower(name) like '%kanchrapara%';
