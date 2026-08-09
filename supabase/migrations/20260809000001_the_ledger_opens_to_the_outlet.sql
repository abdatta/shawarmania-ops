-- The ledger opens to the outlet.
--
-- 20260804000001_manual_ledger_stopgap.sql wrote eight policies whose sole
-- predicate is `app_is_owner()`, and said in a comment that the absence of an
-- outlet-role predicate was deliberate because "no outlet role has any access to
-- grant". Both halves of that sentence stop being true here.
--
--   * **Staff record their own spends.** Something runs out, somebody at the
--     counter buys it, and the figure currently reaches the app by memory at
--     closing time through one of two owners. Seven of the nine recorded
--     expenses are deliveries the owner books; the other two are exactly the
--     kind somebody at the counter makes.
--
--   * **The owner-only rule described production, not a decision.** Both Super
--     Admins hold no Franchise Admin assignment at either outlet, so the owners
--     *are* the managers. A real manager who counts the drawer nightly but
--     cannot read whether the month covered its costs is running half a shop.
--
-- Both halves are one migration because they are the same edit to the same eight
-- policies. Splitting them would mean rewriting these policies twice a fortnight
-- apart, with the second pass having to reason about what the first did.
--
-- Written against the post-#37 schema: `category` is free text and the capture
-- trigger already mints suggestion words for anyone who may record an expense —
-- #37's `expense_categories_insert` policy was deliberately written for the
-- reader set this change establishes, so nothing there needs touching.
--
-- What the day table does NOT get is as deliberate as what the expense table
-- does. `manual_ledger_days` opens to Franchise Admins and stops. No staff
-- branch of any kind, on any verb (design D1, D5).

-- ---------------------------------------------------------------------------
-- 1. Void, replacing delete on the expense row.
--
-- #36 granted DELETE on these tables and stated the reason outright: they are
-- "a notebook with exactly one reader and one writer", where a row typed wrong
-- is a mistake with no story worth keeping. That premise is what this change
-- removes. Once several people write here, a row that can vanish without trace
-- defeats the only reason to open the surface up: the first question the owner
-- asks is "where did the ₹4,000 go", and a deleted row has no answer.

alter table public.manual_ledger_expenses
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles (id),
  add column voided_reason text;

-- The completeness shape is `attendance_approval_complete`'s, and so is the
-- reasoning behind the optional reason [owner, 2026-08-09]. That constraint
-- dropped a mandatory reason when approving-on-site arrived, because demanding
-- one "would turn the honest path into eight identical entries of 'ok' a
-- month". Voiding is the same shape of act: the fastest correction on a surface
-- used entirely with thumbs, answering a failure — a row disappearing — that
-- the moment and the account already answer in full.
--
-- So the actor and the time travel together, a reason may only exist beside a
-- void, and a reason that exists is never blank (blank-is-not-a-value, #19).
alter table public.manual_ledger_expenses
  add constraint manual_ledger_expenses_void_complete
  check ((voided_by is null) = (voided_at is null));
alter table public.manual_ledger_expenses
  add constraint manual_ledger_expenses_void_reason_needs_void
  check (voided_reason is null or voided_by is not null);
alter table public.manual_ledger_expenses
  add constraint manual_ledger_expenses_void_reason_not_blank
  check (voided_reason is null or length(btrim(voided_reason)) > 0);

comment on column public.manual_ledger_expenses.voided_at is
  'When this expense was withdrawn. A voided row stays visible and struck '
  'through, and stops counting toward the day''s expected cash and the month.';
comment on column public.manual_ledger_expenses.voided_reason is
  'Optional. The trace answers who and when without it; demanding a reason on '
  'the fastest correction path would collect a column of "mistake".';

-- ---------------------------------------------------------------------------
-- 2. Attribution: who corrected it, beside who recorded it.
--
-- #36 froze `recorded_by` so the business's other owner could correct a day
-- without either forging the attribution or being refused by it. With managers
-- added, the same row has more plausible correctors, and a day the owner
-- recorded and a manager later fixed still reads as the owner's. `updated_by`
-- is the missing half: stamped by the guard, never settable by a caller, null
-- until somebody corrects the row (design D6).

alter table public.manual_ledger_days
  add column updated_by uuid references public.profiles (id);
alter table public.manual_ledger_expenses
  add column updated_by uuid references public.profiles (id);

comment on column public.manual_ledger_days.updated_by is
  'The account that last corrected this row, stamped by manual_ledger_guard(). '
  'Null until corrected, so an untouched row names one account and does not '
  'imply a second party.';
comment on column public.manual_ledger_expenses.updated_by is
  'The account that last corrected this row, stamped by manual_ledger_guard().';

-- ---------------------------------------------------------------------------
-- 3. Was this recorded by somebody who was not at the outlet?
--
-- `outlet-expenses` marks an owner's remote entry on the live surface, and can
-- afford to mark every one of them because that path refuses a remote cash
-- expense outright: its remote entries are mathematically incapable of moving a
-- drawer. **This notebook has no such refusal** — the owner may write any figure
-- at any outlet — so a drawer expense entered from elsewhere genuinely changes
-- what the people counting that drawer should expect to find. The marking is
-- what tells them, and the surface shows it only where `is_cash` is true, since
-- a non-cash entry from away moves nothing and the recorder's name is the whole
-- story (design D9) [owner, 2026-08-09].
--
-- **Stamped at insert, not derived on read.** Assignments end. Deriving this
-- from today's assignments would make a manager's old rows silently become
-- "from away" the week they leave, which is a statement about now dressed up as
-- a fact about then. It is frozen afterwards for the same reason `recorded_by`
-- is.

alter table public.manual_ledger_expenses
  add column recorded_away boolean not null default false;

-- The nine rows already stored were all written by an owner holding no
-- assignment at either outlet, so this backfill marks them true. It reads
-- current assignments because no assignment history predating them exists to
-- read; it is the best available answer for rows recorded before the column,
-- and every row written after this migration gets the fact stamped at the
-- moment it was true.
update public.manual_ledger_expenses e
   set recorded_away = not exists (
     select 1
       from public.assignments a
      where a.person_id = e.recorded_by
        and a.outlet_id = e.outlet_id
        and a.ended_on is null);

comment on column public.manual_ledger_expenses.recorded_away is
  'True when the recording account held no live assignment at this outlet at '
  'the moment it recorded the row. Surfaced only on drawer expenses, where it '
  'explains why expected cash moved without anybody at the outlet spending it.';

-- ---------------------------------------------------------------------------
-- 4. The guard, extended.
--
-- Three rules land here rather than in a policy, each because a policy cannot
-- express it:
--
--   * **`updated_by` is stamped, not accepted.** A policy can compare a column
--     to `auth.uid()` but cannot set it.
--   * **A voided row is final.** This compares NEW against OLD.
--   * **Staff write on the current business date only.** This resolves the
--     outlet's own cutover through `app_business_date`, which in a policy would
--     be a correlated subquery per row (design D2, D3).
--
-- "Staff" here means an account that holds a Biller or Employee assignment at
-- this outlet and is neither an owner nor a manager of it. A person who is both
-- an Employee and the Franchise Admin at an outlet is a manager: the wider
-- authority wins, exactly as it does in the policies below.

create or replace function public.manual_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutover time;
  v_today date;
  v_is_staff boolean;
begin
  if tg_op = 'UPDATE' then
    if new.outlet_id is distinct from old.outlet_id
       or new.business_date is distinct from old.business_date
       or new.recorded_by is distinct from old.recorded_by then
      raise exception
        'a manual ledger row''s identity (outlet, business date, recorder) is immutable';
    end if;
  end if;

  select business_day_cutover into v_cutover
    from public.outlets
   where id = new.outlet_id;

  if v_cutover is null then
    raise exception 'unknown outlet %', new.outlet_id;
  end if;

  v_today := public.app_business_date(now(), v_cutover);

  if new.business_date > v_today then
    raise exception
      'manual ledger business date % is in the future (today is % at this outlet)',
      new.business_date, v_today;
  end if;

  -- The correcting account is the database's answer. A caller may leave it as
  -- it was or name itself; naming anybody else is a forgery and is refused
  -- rather than silently overwritten, so a client doing it learns that it is
  -- wrong instead of appearing to succeed.
  if tg_op = 'INSERT' then
    if new.updated_by is not null then
      raise exception
        'a manual ledger row cannot be recorded as already corrected';
    end if;
  else
    if new.updated_by is distinct from old.updated_by
       and new.updated_by is distinct from auth.uid() then
      raise exception
        'a manual ledger row''s correcting account is stamped by the database, not supplied';
    end if;
    new.updated_by := auth.uid();
  end if;

  -- Expense-only rules. The day table has no void state and no staff reach, so
  -- neither block can fire for it; both are written against the expense table
  -- by name so that stays readable rather than inferred.
  if tg_table_name = 'manual_ledger_expenses' then
    if tg_op = 'INSERT' then
      -- Stamped from the assignment as it stands right now, then frozen.
      new.recorded_away :=
        not public.app_person_assigned_at(new.recorded_by, new.outlet_id);
    else
      if new.recorded_away is distinct from old.recorded_away then
        raise exception
          'whether an expense was recorded from away is stamped once and never edited';
      end if;

      -- A voided row is final: no edit, no second void, no un-void. One test
      -- rather than three, because "already voided" is the only state any of
      -- them can start from.
      if old.voided_at is not null then
        raise exception
          'this expense was withdrawn on % and cannot be changed; record a new one instead',
          old.voided_at;
      end if;

      -- Withdrawing it: the actor is stamped from the session so a client never
      -- has to know its own id, and a client that names somebody else is
      -- refused rather than corrected. The moment is stamped for the same
      -- reason a bill's void time is: a clock the client controls is not
      -- evidence of when something happened.
      if new.voided_at is not null then
        if new.voided_by is null then
          new.voided_by := auth.uid();
        elsif new.voided_by is distinct from auth.uid() then
          raise exception
            'an expense is withdrawn by the account doing it, and cannot be attributed elsewhere';
        end if;
        new.voided_at := now();
      end if;
    end if;

    -- Staff date rules, and **only on this table**. Staff hold no policy branch
    -- on the day record at all, so applying these there would raise a confusing
    -- P0001 about expenses in front of the 42501 that is the real answer — the
    -- refusal a reader needs to see is "you have no reach here", not "not on
    -- that date". Short-circuited so an owner pays for none of these lookups,
    -- which is the common case tonight and the only case before this change.
    v_is_staff := not (select public.app_is_owner())
      and not public.app_has_role_at('franchise_admin', new.outlet_id)
      and (
        public.app_has_role_at('biller', new.outlet_id)
        or public.app_has_role_at('employee', new.outlet_id)
      );

    if v_is_staff then
      if tg_op = 'INSERT' then
        if new.business_date <> v_today then
          raise exception
            'an expense noticed later belongs to the manager or the owner to add; '
            'this outlet''s trading day is %', v_today;
        end if;
      elsif old.business_date <> v_today then
        raise exception
          'this expense''s day (%) has closed; a manager or the owner can still correct it',
          old.business_date;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants. DELETE leaves the expense table.
--
-- 20260726000010_grants_hygiene.sql states the rule — history is voided,
-- soft-deleted or corrected, never removed — and names its exceptions
-- explicitly. This removes one of them. The revoke is the layer that decides
-- which verbs a session may even attempt, so dropping the policy alone would
-- leave a grant with nothing behind it, which reads as an oversight to the next
-- person auditing the grant list.
--
-- The trigger is the second belt: a service-role mistake or a future migration
-- that re-grants DELETE still cannot remove a row.
--
-- `manual_ledger_days` keeps DELETE. A day typed against the wrong date is
-- still a mistake with no story worth keeping, and only owners and managers can
-- reach that table at all (design D3).

revoke delete on public.manual_ledger_expenses from authenticated;

create trigger manual_ledger_expenses_no_delete
  before delete on public.manual_ledger_expenses
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- 6. The eight policies.
--
-- Seven are rewritten and one — DELETE on the expense table — is dropped
-- outright, which is why the count is eight.
--
-- The shape is the one #22 established, and the two subquery conventions are
-- documented in 20260729000004_multi_outlet_people.sql: `app_outlets_for` is
-- set-returning, so `outlet_id in (select ...)` is a non-correlated subquery
-- Postgres hoists to a hashed SubPlan; `app_is_owner()` takes no argument, so
-- `(select ...)` makes it an InitPlan. Both are evaluated once per query rather
-- than once per row.
--
-- The staff branch is written as two `app_has_role_at` clauses rather than one
-- combined test. There is no `staff` role — Biller and Employee are separate
-- assignments that happen to need the same reach here — and two clauses stay
-- greppable when one of them changes.

drop policy manual_ledger_days_select on public.manual_ledger_days;
drop policy manual_ledger_days_insert on public.manual_ledger_days;
drop policy manual_ledger_days_update on public.manual_ledger_days;
drop policy manual_ledger_days_delete on public.manual_ledger_days;
drop policy manual_ledger_expenses_select on public.manual_ledger_expenses;
drop policy manual_ledger_expenses_insert on public.manual_ledger_expenses;
drop policy manual_ledger_expenses_update on public.manual_ledger_expenses;
drop policy manual_ledger_expenses_delete on public.manual_ledger_expenses;

-- The day record: owners everywhere, managers where they are assigned, and
-- **nobody else anywhere**.
--
-- The refusal of outlet staff protects two different things and both are
-- load-bearing. On the write side it protects the drawer: an account that could
-- set `counted_cash_paise`, `opening_cash_paise` or `cash_removed_paise` could
-- make any drawer reconcile, and the nightly count is the only control the
-- business has over cash. On the read side it protects any past business date,
-- any month's total, the other outlet, and every figure net of commission —
-- none of which can be observed from behind a counter.
--
-- It does NOT protect the takings of a shift somebody worked at the outlet they
-- worked it in [owner, 2026-08-08]. They stand where the sales happen and could
-- tally them. The policy refuses that row anyway, with no roster check, because
-- the concession is a limit on what the system may claim and not an instruction
-- to open a hole (design D5). `docs/LIMITATIONS.md` carries the distinction so
-- #11 and #13 inherit it rather than re-arguing it.

create policy manual_ledger_days_select on public.manual_ledger_days
  for select to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

create policy manual_ledger_days_insert on public.manual_ledger_days
  for insert to authenticated
  with check (
    public.app_account_active()
    and recorded_by = auth.uid()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

-- No `recorded_by = auth.uid()` on the UPDATE branch, deliberately and for the
-- reason #36 gave: the guard freezes that column, so a second owner — and now a
-- manager — may correct a day without either forging the attribution or being
-- refused by it. `updated_by` is what records who did.
create policy manual_ledger_days_update on public.manual_ledger_days
  for update to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

create policy manual_ledger_days_delete on public.manual_ledger_days
  for delete to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

-- The expense record: everyone at the outlet reads it, whoever recorded it.
--
-- **No date predicate here, deliberately.** The staff surface opens on the last
-- two business days, and that is where it opens rather than a boundary.
-- Enforcing the window would mean resolving each outlet's cutover through
-- `app_business_date` per row, to protect an expense row — which is not a
-- revenue figure, and has nothing to protect by being old. A rule that costs a
-- correlated subquery to enforce something nobody needs enforced is the wrong
-- rule (design D2).
create policy manual_ledger_expenses_select on public.manual_ledger_expenses
  for select to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or public.app_has_role_at('biller', outlet_id)
      or public.app_has_role_at('employee', outlet_id)
    )
  );

create policy manual_ledger_expenses_insert on public.manual_ledger_expenses
  for insert to authenticated
  with check (
    public.app_account_active()
    and recorded_by = auth.uid()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or public.app_has_role_at('biller', outlet_id)
      or public.app_has_role_at('employee', outlet_id)
    )
  );

-- Staff correct their own rows; owners and managers correct anything at the
-- outlets they reach. The **current-day** half of the staff limit is the
-- guard's, not this policy's: it needs the outlet's cutover, and a policy that
-- resolved it would pay for a correlated subquery on every row it filtered.
create policy manual_ledger_expenses_update on public.manual_ledger_expenses
  for update to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        recorded_by = auth.uid()
        and (
          public.app_has_role_at('biller', outlet_id)
          or public.app_has_role_at('employee', outlet_id)
        )
      )
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        recorded_by = auth.uid()
        and (
          public.app_has_role_at('biller', outlet_id)
          or public.app_has_role_at('employee', outlet_id)
        )
      )
    )
  );

-- No delete policy on public.manual_ledger_expenses. The grant is revoked and a
-- trigger refuses it; a policy here would imply the verb is reachable.

-- ---------------------------------------------------------------------------
-- 7. The names behind the attribution.
--
-- "Every expense names the account that recorded it" is a requirement, and
-- `profiles` cannot answer it for the two readers this change adds. Its select
-- policy resolves through `app_may_see_person`, which requires a **shared
-- outlet assignment** and a caller whose own role is `franchise_admin` or
-- `biller`. Two consequences, both fatal to a list that has to name its rows:
--
--   * An **Employee sees nobody**, because their role is not in that list.
--   * **Nobody at an outlet sees an owner**, because a Super Admin's assignment
--     carries `outlet_id = null` and so shares an outlet with no one — and the
--     owner is precisely who recorded most of the rows already stored.
--
-- Widening `app_may_see_person` would be the wrong fix: it governs every
-- profile read in the app, and it would hand outlet staff their colleagues'
-- phone numbers to solve a caption on an expense row.
--
-- So this returns names, and only names, and only for accounts that actually
-- wrote in a ledger the caller may already read. It grants no reach the caller
-- did not have; it makes the reach they have legible.
--
-- **The predicates below deliberately mirror the policies above.** They have to
-- agree, and nothing in the database enforces that they do, so
-- supabase/tests/21_manual_ledger.sql asserts the agreement rather than trusting
-- it: a name reachable here that the row itself is not is the drift to catch.

create or replace function public.manual_ledger_people()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
    from public.profiles p
   where public.app_account_active()
     and (
       exists (
         select 1
           from public.manual_ledger_expenses e
          where p.id in (e.recorded_by, e.updated_by, e.voided_by)
            and (
              (select public.app_is_owner())
              or e.outlet_id in (select public.app_outlets_for('franchise_admin'))
              or public.app_has_role_at('biller', e.outlet_id)
              or public.app_has_role_at('employee', e.outlet_id)
            )
       )
       or exists (
         select 1
           from public.manual_ledger_days d
          where p.id in (d.recorded_by, d.updated_by)
            and (
              (select public.app_is_owner())
              or d.outlet_id in (select public.app_outlets_for('franchise_admin'))
            )
       )
     )
$$;

revoke execute on function public.manual_ledger_people() from public, anon;
grant execute on function public.manual_ledger_people() to authenticated;
