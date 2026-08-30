-- ===========================================================================
-- The drawer explains its figures
--
-- Two additions, and neither widens what anybody may reach.
--
--   1. Two grouped readers beside the three `cash-is-counted-not-closed` (#11)
--      shipped. They answer the same question those three answer, one `group
--      by` apart: how much cash came in, and how much left as an expense, in
--      `(p_from, p_to]` — **partitioned by business date through the outlet's
--      own cutover**.
--
--      That partition has to happen here rather than in TypeScript, for three
--      reasons that are all the same reason. The adapter carried
--      `const CUTOVER = '04:00'`, which is a guess that happens to be right at
--      both outlets today; reading `outlets.business_day_cutover` deletes the
--      guess. The tile totals come from `drawer_cash_receipts_paise` and
--      `drawer_cash_expenses_paise`, so a breakdown computed from a different
--      predicate could disagree with the figure it explains, which is worse
--      than no breakdown at all. And the row counts stated beside those tiles
--      were wrong — one counted a list capped at twelve, the other was the
--      literal nought — which these fix on the way past, because the reads are
--      already happening.
--
--   2. `edit_drawer_observation` gains the counted instant, and stops wiping
--      the note.
--
--      `cash-drawer` says an observation is **fully editable** until a later
--      one anchors on it, and the function edited one field. The instant is
--      the interval's upper bound, so moving it genuinely changes which bills
--      were in the drawer — and an expected total that survived a moved
--      instant unchanged would measure a count against cash that was never
--      there. The recomputation **calls** the same three readers
--      `record_drawer_observation` calls, in the same order, rather than
--      restating their arithmetic.
--
--      The note was assigned unconditionally from a parameter the adapter
--      never sent, so every amount correction silently cleared it. Null now
--      means "leave it"; an empty string is how a caller clears one on purpose.
--
-- **Nothing is dropped, revoked or narrowed.** `drawer_cash_out` keeps its
-- `kind`, its constraints, its policies and its grants, and `record_drawer_cash_out`
-- keeps its grant, even though the application stops offering the two controls
-- that reached them. Two production rows exist and must keep reading, the
-- `spend` branch still binds anything that arrives by any path, and re-offering
-- a spend is then a matter of adding a control rather than writing a migration.

-- ===========================================================================
-- 1. The grouped readers.
--
-- Siblings of the three in #11 section 8: same `(p_from, p_to]` convention,
-- same `security definer` posture, same `app_may_reach_drawer()` guard the
-- 2026-08-28 migration gave all three — so a Biller or an Employee reads
-- nothing through them, at their own outlet or anybody else's, exactly as they
-- read nothing through the scalar readers.
--
-- Each is `create or replace` on a name that has never existed, written that
-- way so a later change re-issuing the file behaves the same as this one.

create or replace function public.drawer_cash_receipts_by_day(
  p_outlet_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (business_date date, paise bigint, bills int)
language sql
stable
security definer
set search_path = ''
as $$
  -- The predicate is `drawer_cash_receipts_paise` verbatim: the latest accepted
  -- EFFECTIVE Cash allocation of settled bills, at the bill's own `paid_at`. A
  -- superseded allocation and an earlier correction revision contribute
  -- nothing; UPI, Swiggy and Zomato never appear. Sum this reader's `paise`
  -- over any interval and you have that reader's answer, which is the property
  -- the breakdown exists to be able to assert.
  --
  -- `count(distinct b.id)`, not `count(*)`: a bill settled across two cash
  -- allocations is one bill on the counter and must be one bill here.
  select public.app_business_date(b.paid_at, o.business_day_cutover),
         coalesce(sum(e.amount_paise), 0)::bigint,
         count(distinct b.id)::int
    from public.bills b
    join public.effective_bill_payments e on e.bill_id = b.id
    join public.outlets o on o.id = b.outlet_id
   where b.outlet_id = p_outlet_id
     and b.status = 'settled'
     and e.method = 'cash'
     and (p_from is null or b.paid_at > p_from)
     and b.paid_at <= p_to
     and public.app_may_reach_drawer(p_outlet_id)
   group by 1
   order by 1 desc
$$;

create or replace function public.drawer_cash_expenses_by_day(
  p_outlet_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (business_date date, paise bigint, rows int)
language sql
stable
security definer
set search_path = ''
as $$
  -- `drawer_cash_expenses_paise` verbatim, one `group by` apart: the live
  -- expense record wherever it lives, `coalesce(occurred_at, created_at)` so a
  -- backdated cash expense lands in the interval it belongs to, and only cash
  -- moves the drawer. A voided row never reaches the view, so it never reaches
  -- a group either.
  select public.app_business_date(
           coalesce(x.occurred_at, x.created_at), o.business_day_cutover),
         coalesce(sum(x.amount_paise), 0)::bigint,
         count(*)::int
    from public.effective_expenses x
    join public.outlets o on o.id = x.outlet_id
   where x.outlet_id = p_outlet_id
     and x.is_cash
     and (p_from is null or coalesce(x.occurred_at, x.created_at) > p_from)
     and coalesce(x.occurred_at, x.created_at) <= p_to
     and public.app_may_reach_drawer(p_outlet_id)
   group by 1
   order by 1 desc
$$;

revoke execute on function
  public.drawer_cash_receipts_by_day(uuid, timestamptz, timestamptz),
  public.drawer_cash_expenses_by_day(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function
  public.drawer_cash_receipts_by_day(uuid, timestamptz, timestamptz),
  public.drawer_cash_expenses_by_day(uuid, timestamptz, timestamptz)
  to authenticated;

comment on function public.drawer_cash_receipts_by_day(uuid, timestamptz, timestamptz) is
  'The cash receipts of (p_from, p_to], partitioned by business date through '
  'the outlet''s own business_day_cutover, newest first. Same relation, '
  'predicate and interval convention as drawer_cash_receipts_paise, so the '
  'groups sum to it exactly. The oldest group is a FRAGMENT of its business '
  'date wherever p_from falls after that date''s cutover. Refuses an outlet '
  'the caller may not reach.';

comment on function public.drawer_cash_expenses_by_day(uuid, timestamptz, timestamptz) is
  'The cash expenses of (p_from, p_to], partitioned by business date through '
  'the outlet''s own business_day_cutover, newest first. Same relation, '
  'predicate and interval convention as drawer_cash_expenses_paise, so the '
  'groups sum to it exactly. Refuses an outlet the caller may not reach.';

-- ===========================================================================
-- 2. edit_drawer_observation() — the whole observation, instant included.
--
-- Dropped and recreated rather than replaced, because the signature grows a
-- parameter. Two overloads of one name reachable from PostgREST is an
-- ambiguity, not a migration path.

drop function if exists public.edit_drawer_observation(uuid, bigint, text);

create or replace function public.edit_drawer_observation(
  p_observation_id uuid,
  p_counted_total_paise bigint,
  p_note text default null,
  -- Null means "leave the instant where it is". This is the amount-only edit,
  -- which is what nearly every correction is.
  p_counted_at timestamptz default null
)
returns public.drawer_observations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_observation public.drawer_observations%rowtype;
  v_previous public.drawer_observations%rowtype;
  v_has_previous boolean;
  v_later_count integer;
  v_earliest timestamptz;
  v_counted_at timestamptz;
  v_expected bigint;
  v_row public.drawer_observations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_observation
    from public.drawer_observations where id = p_observation_id;
  if not found then
    raise exception 'no such observation';
  end if;

  if not public.app_may_reach_drawer(v_observation.outlet_id) then
    raise exception 'you may not edit this outlet''s counts' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_observation.outlet_id::text, 0));

  select count(*) into v_later_count
    from public.drawer_observations
   where outlet_id = v_observation.outlet_id
     and counted_at > v_observation.counted_at;

  -- **The lock, in one sentence.** The next observation read this figure as its
  -- own stored opening, which is the moment it became load-bearing. Changing it
  -- now would break the chain the surface promises to report rather than
  -- repair — so from here a correction is an attributed adjustment.
  --
  -- It runs FIRST, before any bound on the instant, so a caller correcting an
  -- anchored count is told the one thing that matters rather than being sent
  -- round a clock check they were never going to pass.
  if v_later_count > 0 then
    raise exception
      'a later count at this outlet has already anchored on this one; post an adjustment instead';
  end if;

  if p_counted_total_paise is null or p_counted_total_paise < 0 then
    raise exception 'the counted total must be a non-negative paise amount';
  end if;

  v_counted_at := coalesce(p_counted_at, v_observation.counted_at);
  v_expected := v_observation.expected_paise;

  -- ── A moved boundary genuinely changes which cash was in the drawer ──────
  --
  -- The comment this replaces said the interval did not move, only what was
  -- found in the drawer. That is true of an amount-only edit and false the
  -- moment the instant moves, because the instant IS the interval's upper
  -- bound. #11's whole thesis is that a count at 22:00 is measured against cash
  -- received up to 22:00; a count recorded at 23:30 and corrected to 22:00
  -- without recomputing would keep ninety minutes of bills that were never in
  -- the drawer, and the only remaining knob would be the physical count.
  if v_counted_at is distinct from v_observation.counted_at then
    select * into v_previous
      from public.drawer_observations
     where outlet_id = v_observation.outlet_id
       and counted_at < v_observation.counted_at
     order by counted_at desc
     limit 1;
    v_has_previous := found;

    -- The recording bounds, unchanged and re-asserted: a corrected instant is
    -- an instant, and nothing about arriving through this path makes it freer
    -- than one arriving through `record_drawer_observation`. Each refusal names
    -- what it collided with, because a person who has just moved a time needs
    -- to know which edge they hit.
    if v_counted_at > v_now then
      raise exception
        'a count cannot be taken in the future: % is later than the server clock at %',
        v_counted_at, v_now;
    end if;

    if v_has_previous and v_counted_at <= v_previous.counted_at then
      raise exception
        'this outlet was already counted at %; a count cannot be moved into a settled interval',
        v_previous.counted_at;
    end if;

    v_earliest := public.drawer_earliest_activity(v_observation.outlet_id);
    if v_earliest is not null and v_counted_at < v_earliest then
      raise exception
        'this outlet had no drawer activity before %; a count cannot precede it',
        v_earliest;
    end if;

    -- The same three readers `record_drawer_observation` calls, in the same
    -- order, over `(the previous count's instant, the new instant]`. **Called,
    -- never restated** — that rule is what keeps the database's arithmetic and
    -- `src/domain/drawer.ts` in agreement.
    --
    -- The stored opening does not move: it is the PREVIOUS count's
    -- carry-forward, and nothing about this observation's own instant changes
    -- what that count found. An anchor has no interval at all, so it keeps its
    -- null expected total and its null difference.
    --
    -- `p_exclude_observation` is this observation, not the previous one. At
    -- recording time the row does not exist yet and the previous one's
    -- movements are excluded by the interval's own open lower bound; here the
    -- row exists and carries its own collection, which belongs to the following
    -- opening and must not be subtracted from the total it is measured against.
    if v_observation.is_anchor then
      v_expected := null;
    else
      v_expected :=
          v_observation.opening_paise
        + public.drawer_cash_receipts_paise(
            v_observation.outlet_id, v_previous.counted_at, v_counted_at)
        - public.drawer_cash_expenses_paise(
            v_observation.outlet_id, v_previous.counted_at, v_counted_at)
        - public.drawer_cash_out_paise(
            v_observation.outlet_id, v_previous.counted_at, v_counted_at,
            v_observation.id);
    end if;
  end if;

  update public.drawer_observations
     set counted_total_paise = p_counted_total_paise,
         counted_at = v_counted_at,
         expected_paise = v_expected,
         difference_paise = case
           when is_anchor then null
           else p_counted_total_paise - v_expected
         end,
         -- **Null leaves it alone.** The parameter defaulted to null and was
         -- assigned unconditionally, so every amount correction cleared a note
         -- the caller never mentioned. Clearing one on purpose is an empty
         -- string, which is a thing a caller can only send deliberately.
         note = case
           when p_note is null then note
           when btrim(p_note) = '' then null
           else p_note
         end,
         corrected_by = case
           when auth.uid() is distinct from recorded_by then auth.uid()
           else corrected_by
         end
   where id = p_observation_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function
  public.edit_drawer_observation(uuid, bigint, text, timestamptz)
  from public, anon;
grant execute on function
  public.edit_drawer_observation(uuid, bigint, text, timestamptz)
  to authenticated;

comment on function public.edit_drawer_observation(uuid, bigint, text, timestamptz) is
  'The full correction of a count nothing has anchored on: its total, its note '
  'and its counted instant. A moved instant is bounded exactly as a recorded '
  'one is and forces the expected total and the difference to be recomputed by '
  'CALLING the same three interval readers record_drawer_observation calls. A '
  'null note leaves the stored one; an empty string clears it.';
