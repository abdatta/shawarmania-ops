-- Swiggy names its cycle-level components; the Zomato-era vocabulary cannot.
--
-- aggregator_cycle_deductions.kind admitted exactly two values, both born on
-- the Zomato path: a TDS row and an accepted settlement difference. Swiggy's
-- annexure proves three more cycle-level facts that are NOT inside any order
-- payout: complaint and cancellation charges, growth investments in ads, and
-- other charges & refunds. Refusing them would force every reconciling Swiggy
-- cycle into a false dispute.
--
-- Forward-only, additive: existing Zomato rows keep their kinds, and the two
-- original values remain admitted unchanged.

alter table public.aggregator_cycle_deductions
  drop constraint aggregator_cycle_deductions_kind_known;

alter table public.aggregator_cycle_deductions
  add constraint aggregator_cycle_deductions_kind_known
  check (kind = any (array[
    'tax_deducted_at_source',
    'unexplained_settlement_difference',
    'complaint',
    'advertising',
    'other_adjustment'
  ]));
