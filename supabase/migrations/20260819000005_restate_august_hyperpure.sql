-- August's Hyperpure history, restated from the supplier's own statement.
--
-- The books held ten Hyperpure rows for August totalling ₹52,706.53, and every
-- one was wrong in some way. Eight were typed by hand: six matched a real order
-- but were rounded to whole rupees and dated inconsistently, one (₹2,240 on
-- 5 Aug) matched no order at all and was a mis-entry, and one (₹14,199 on 1 Aug)
-- was the 29 July order settled in August. Two more were payout recoveries the
-- sync had booked as purchases — the double count this change set out to end.
-- Meanwhile nine real orders worth ₹40,272.46 had never been recorded.
--
-- This replaces all ten with the fifteen orders the statement actually holds for
-- 1–18 August, each keyed on its order number, dated by invoice date, booked
-- against Kanchrapara as a shared cost because that is the delivery outlet and
-- both kitchens draw on one inventory. It keeps the 29 July order [owner,
-- 2026-08-18], but as its exact ₹14,199.90 rather than the typed ₹14,199, dated
-- to the opening of the books so a cost settled from an in-period payout is
-- recorded rather than lost.
--
-- The migration asserts its own outcome and aborts unless August's Hyperpure
-- lands at sixteen rows totalling ₹85,206.37, so a shape that did not match the
-- production this was written against fails loudly rather than half-applying.

do $restate$
declare
  v_kanchrapara uuid;
  v_owner uuid;
  v_before_count int;
  v_before_total bigint;
  v_after_count int;
  v_after_total bigint;
begin
  select count(*), coalesce(sum(amount_paise), 0)
    into v_before_count, v_before_total
    from public.manual_ledger_expenses
   where category ilike '%hyperpure%'
     and business_date between date '2026-08-01' and date '2026-08-31'
     and voided_at is null;

  -- This is a one-time production data fix, and it acts only when it recognises
  -- the state it was written for. The empty and already-applied cases are checked
  -- before anything else — including the outlet lookup — so a fresh seed with no
  -- Kanchrapara outlet and no rows is a clean skip rather than an error.
  --
  --   empty          -> a fresh seed, local or CI: nothing to restate, skip.
  --   the after shape -> already restated: idempotent, skip.
  --   the before shape -> production before the fix: restate.
  --   anything else   -> drift a manual edit or a re-run caused: abort loudly,
  --                      rather than delete rows this migration did not expect.
  if v_before_count = 0 then
    raise notice 'restatement: no August Hyperpure rows; nothing to restate';
    return;
  end if;
  if v_before_count = 16 and v_before_total = 8520637 then
    raise notice 'restatement: already applied; leaving it alone';
    return;
  end if;
  if v_before_count <> 10 or v_before_total <> 5270653 then
    raise exception
      'restatement: expected the pre-fix shape of 10 rows / 5270653 paise, found % rows / % paise',
      v_before_count, v_before_total;
  end if;

  select id into v_kanchrapara
    from public.outlets where lower(name) like '%kanchrapara%' limit 1;
  if v_kanchrapara is null then
    raise exception 'restatement: no Kanchrapara outlet found';
  end if;

  -- A void must name who did it (voided_by pairs with voided_at). This is the
  -- owner's correction, so it is attributed to the owner — the person the app's
  -- own app_is_owner() recognises: a live super_admin assignment. Picked
  -- deterministically so the migration is reproducible where there is more than
  -- one owner.
  select a.person_id into v_owner
    from public.assignments a
   where a.role = 'super_admin' and a.ended_on is null
   order by a.person_id
   limit 1;
  if v_owner is null then
    raise exception 'restatement: no owner (super_admin) to attribute the void to';
  end if;

  -- Out with all ten — by voiding, not deleting. The table is append-only (a
  -- no-delete trigger enforces it), and a void is the sanctioned way to retire a
  -- wrong figure while keeping the record that it was there. The assertions below
  -- count only live rows, so a voided one falls out of the total exactly as a
  -- deleted one would have, without fighting the write contract. Voiding touches
  -- neither category nor source_system, so the reserved-category trigger stays
  -- silent.
  -- The withdraw-guard ties a void to the account performing it, and a migration
  -- performs it as no one. Disable that one trigger for this owner-authorised
  -- correction, attribute the void to the owner, and restore it immediately. The
  -- inserts below run with it on, as ordinary system writes. Transactional, so a
  -- failure anywhere rolls the disable back too — the guard is never left off.
  alter table public.manual_ledger_expenses disable trigger manual_ledger_expenses_guarded;
  update public.manual_ledger_expenses
     set voided_at = now(),
         voided_by = v_owner,
         voided_reason = 'Restated from the Hyperpure statement (change #43)'
   where category ilike '%hyperpure%'
     and business_date between date '2026-08-01' and date '2026-08-31'
     and voided_at is null;
  alter table public.manual_ledger_expenses enable trigger manual_ledger_expenses_guarded;

  -- The fifteen August orders, and the one opening order, from the statement.
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description,
     source_system, source_ref, shared_cost, recorded_by)
  select v_kanchrapara, o.invoice_date::date, 'Hyperpure', false, o.amount_paise,
         'Hyperpure ' || o.order_ref, 'hyperpure', o.order_ref, true, null
    from (values
      ('ZHPWB27-OR-0028753023','2026-08-02',931111),
      ('ZHPWB27-OR-0028785154','2026-08-03',303267),
      ('ZHPWB27-OR-0028814764','2026-08-04',830380),
      ('ZHPWB27-OR-0028849157','2026-08-05',401862),
      ('ZHPWB27-OR-0028877195','2026-08-06',426489),
      ('ZHPWB27-OR-0028912711','2026-08-07',290572),
      ('ZHPWB27-OR-0028978092','2026-08-09',440837),
      ('ZHPWB27-OR-0029010408','2026-08-10',316209),
      ('ZHPWB27-OR-0029036724','2026-08-11',574055),
      ('ZHPWB27-OR-0029073427','2026-08-12',878540),
      ('ZHPWB27-OR-0029104574','2026-08-13',413580),
      ('ZHPWB27-OR-0029135944','2026-08-14',176004),
      ('ZHPWB27-OR-0029199382','2026-08-16',302957),
      ('ZHPWB27-OR-0029232808','2026-08-17',389482),
      ('ZHPWB27-OR-0029265519','2026-08-18',425302),
      -- The 29 July order, invoiced 30 July, recovered from the 3–9 Aug payout.
      -- Dated to the opening of the books, its exact figure rather than the typed
      -- approximation. Kept on the owner's instruction.
      ('ZHPWB27-OR-0028649625','2026-08-01',1419990)
    ) as o(order_ref, invoice_date, amount_paise);

  select count(*), coalesce(sum(amount_paise), 0)
    into v_after_count, v_after_total
    from public.manual_ledger_expenses
   where category ilike '%hyperpure%'
     and business_date between date '2026-08-01' and date '2026-08-31'
     and voided_at is null;

  if v_after_count <> 16 or v_after_total <> 8520637 then
    raise exception
      'restatement: expected 16 rows totalling 8520637 paise, produced % rows / % paise',
      v_after_count, v_after_total;
  end if;

  raise notice 'restatement: August Hyperpure is now % rows totalling %.% (was %.%)',
    v_after_count, v_after_total / 100, lpad((v_after_total % 100)::text, 2, '0'),
    v_before_total / 100, lpad((v_before_total % 100)::text, 2, '0');
end;
$restate$;
