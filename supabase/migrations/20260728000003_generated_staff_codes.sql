-- The staff code is issued by the database, not invented at a keyboard.
--
-- `employees.employee_code` has been a required free-text field since the table
-- was created, and nobody at Shawarmania has a staff ID to enter. So the value
-- was invented on the spot, on a phone, while onboarding somebody — against a
-- convention the app supplies as a placeholder (`e.g. KAL-05`) and then
-- declines to apply. It is unique per outlet, so an admin who reasonably types
-- `1` twice meets a constraint violation over a value that never mattered.
--
-- It never mattered because nothing keys on it: `attendance.employee_id`
-- references the roster row's UUID, there is no foreign key on `employee_code`,
-- and no query looks a person up by it. Its whole job is telling two people
-- with the same name apart in three lists — which is exactly the shape of thing
-- a system should issue rather than ask for.
--
-- Four moving parts:
--
--   1. `outlets.staff_code_prefix` — the three characters every code at that
--      outlet begins with. A real, unique column rather than a truncation
--      computed at insert time, because `kalyani` and a future `kalimpong` both
--      truncate to `KAL`, and by then there are already `KAL-` codes belonging
--      to somebody else. A derivation that can collide retroactively is not a
--      derivation, it is a latent conflict.
--   2. `random_staff_suffix()` — four characters of Crockford base32.
--   3. `issue_employee_code()` — fills a blank code on insert, and only then.
--   4. `employee_code_guard()` / `outlet_prefix_guard()` — who may change what
--      afterwards, enforced here because `employees_update` is a row policy and
--      a row policy permits every column on a row it permits. A restriction
--      that lived only in the form would be decoration.
--
-- No existing staff code changes. `employees_code_not_blank` and
-- `employees_code_unique_per_outlet` are untouched.

-- ---------------------------------------------------------------------------
-- 1. The prefix.
--
-- Added nullable, backfilled, then constrained. That order is the only one that
-- works on a table that already has rows.

alter table public.outlets add column staff_code_prefix text;

-- The backfill is derived, with the two known outlets named explicitly.
--
-- Naming them matters: production's outlet codes are `skalyani` and `skpa`,
-- while the local seed uses `kalyani` and `kanchrapara`. A backfill written
-- against either pair alone leaves the other's rows null, and the `set not
-- null` below then aborts the migration — in production, having passed locally.
-- The owner chose `KAL` and `KAN` (2026-07-28), which are the place names
-- rather than what derivation would produce from the production codes (`SKA`,
-- `SKP`).
--
-- Everything else falls back to the same rule the outlet form uses: the first
-- three alphanumeric characters of the code, uppercased, with a numeric suffix
-- if that prefix is already taken. So an outlet this migration has never heard
-- of still gets a prefix rather than blocking the deploy.
update public.outlets
   set staff_code_prefix = case
     when code in ('kalyani', 'skalyani') then 'KAL'
     when code in ('kanchrapara', 'skpa') then 'KAN'
     else upper(substring(regexp_replace(code, '[^a-zA-Z0-9]', '', 'g') from 1 for 3))
   end;

-- Resolve any collision the fallback produced, deterministically by creation
-- order: the older outlet keeps the plain prefix.
do $$
declare
  v_row record;
  v_candidate text;
  v_n integer;
begin
  for v_row in
    select id, staff_code_prefix
      from public.outlets o
     where exists (
       select 1 from public.outlets other
        where other.staff_code_prefix = o.staff_code_prefix
          and other.created_at < o.created_at
     )
     order by created_at
  loop
    v_n := 1;
    loop
      v_candidate := substring(v_row.staff_code_prefix from 1 for 2) || v_n::text;
      exit when not exists (
        select 1 from public.outlets where staff_code_prefix = v_candidate
      );
      v_n := v_n + 1;
      if v_n > 9 then
        raise exception 'could not derive a unique staff code prefix for outlet %', v_row.id;
      end if;
    end loop;
    update public.outlets set staff_code_prefix = v_candidate where id = v_row.id;
  end loop;
end;
$$;

alter table public.outlets
  alter column staff_code_prefix set not null;

alter table public.outlets
  add constraint outlets_staff_code_prefix_unique unique (staff_code_prefix);

-- Three uppercase alphanumerics — deliberately NOT restricted to the Crockford
-- alphabet the suffix uses.
--
-- The design (D4) said Crockford for both, and that is wrong in a way its own
-- task list exposed: it names `KAL` as Kalyani's backfill value, and `KAL`
-- contains `L`, which Crockford excludes. The two halves of a code are not the
-- same kind of string, which is why one alphabet cannot serve both.
--
-- The suffix is random. Hearing `7KQ2` down a phone, a listener has to
-- transcribe it exactly and has nothing to reconstruct it from, so an `O`/`0`
-- confusion loses real information. That is the failure Crockford prevents, and
-- `random_staff_suffix()` keeps it.
--
-- The prefix is a fixed, meaningful abbreviation of the outlet's name, shared
-- by everyone who works there. Nobody spells `KAL` character by character —
-- they read it as "Kalyani". Forbidding `L` here would ban the natural
-- abbreviation of a real outlet's actual name to protect against a confusion
-- that cannot occur, and the owner chose `KAL` and `KAN` explicitly
-- (2026-07-28) having seen them written.
alter table public.outlets
  add constraint outlets_staff_code_prefix_shape
  check (staff_code_prefix ~ '^[A-Z0-9]{3}$');

comment on column public.outlets.staff_code_prefix is
  'The three characters every staff code at this outlet begins with. Unique '
  'across outlets, and frozen once any roster row exists — every code already '
  'issued reads from it.';

-- A prefix is derived when none is supplied, for the same reason a staff code
-- is: the column is `not null` and unique, so without this every existing
-- caller that inserts an outlet — the app, the seed, every pgTAP file that
-- creates one — would have to compute a unique value itself and would break the
-- moment it did not. The form still pre-fills the field and the owner can still
-- correct it (D4); this is what makes "an outlet has a prefix" a property of
-- the table rather than a habit of one caller.
--
-- First three alphanumerics of the code, uppercased, with a numeric suffix if
-- that is taken. `regexp_replace` first, so a code like `new-shop` yields `NEW`
-- rather than `NEW-`.
create or replace function public.derive_staff_code_prefix(p_code text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 1;
begin
  v_base := upper(substring(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g')
                            from 1 for 3));
  -- A code with fewer than three usable characters still needs three.
  v_base := rpad(nullif(v_base, ''), 3, 'X');
  if v_base is null then
    v_base := 'XXX';
  end if;

  v_candidate := v_base;
  while exists (select 1 from public.outlets where staff_code_prefix = v_candidate) loop
    if v_n > 99 then
      raise exception 'could not derive a free staff code prefix from %', p_code;
    end if;
    v_candidate := substring(v_base from 1 for 3 - length(v_n::text)) || v_n::text;
    v_n := v_n + 1;
  end loop;

  return v_candidate;
end;
$$;

create or replace function public.issue_outlet_prefix()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(btrim(new.staff_code_prefix), '') = '' then
    new.staff_code_prefix := public.derive_staff_code_prefix(new.code);
  end if;
  return new;
end;
$$;

create trigger outlets_issue_prefix
  before insert on public.outlets
  for each row execute function public.issue_outlet_prefix();

-- An empty-string default on both issued columns, as a sentinel the triggers
-- above always replace before the row lands.
--
-- This is not cosmetic. `supabase gen types` reads column defaults to decide
-- what an Insert may omit, and it cannot see a trigger — so without these, a
-- `not null` column with no default is typed as **required**, and every
-- TypeScript caller is forced to invent the very value this change exists to
-- stop them inventing. The check constraints still run after the triggers, so
-- a sentinel that somehow survived would be refused rather than stored.
alter table public.employees alter column employee_code set default '';
alter table public.outlets alter column staff_code_prefix set default '';

-- ---------------------------------------------------------------------------
-- 2. The suffix.
--
-- Crockford base32: the digits and letters minus I, L, O and U. Not an
-- aesthetic choice — these codes are read aloud across a counter and dictated
-- down a phone during a shift, and 0/O and 1/I/L are the confusions this
-- alphabet exists to prevent. The same alphabet as `invite-code.ts`; do not
-- introduce a second one.
--
-- Four characters is 32^4 — about a million codes per outlet, against ten
-- thousand for four digits, for the same length.

create or replace function public.random_staff_suffix()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substring('0123456789ABCDEFGHJKMNPQRSTVWXYZ'
              from (floor(random() * 32)::int + 1) for 1),
    '')
    from generate_series(1, 4);
$$;

-- ---------------------------------------------------------------------------
-- 3. Issuing, on insert only.

create or replace function public.issue_employee_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text;
  v_code text;
  v_attempt integer := 0;
begin
  -- Blank and absent are the same thing here: null, '' and '   ' all mean
  -- "issue me one". A code that was actually supplied is stored unchanged,
  -- which keeps the seed working as written and leaves #14 outlet-onboarding
  -- free to import a franchise's own scheme.
  --
  -- On *update* the same blankness is refused instead, by leaving
  -- `employees_code_not_blank` exactly as it is. The row already has a code;
  -- clearing the field is a mistake, not a request. Re-issuing there would turn
  -- "I cleared this by accident" into "the app renamed this person".
  if coalesce(btrim(new.employee_code), '') <> '' then
    return new;
  end if;

  select staff_code_prefix into v_prefix
    from public.outlets where id = new.outlet_id;

  if v_prefix is null then
    raise exception 'outlet % has no staff code prefix', new.outlet_id;
  end if;

  -- Bounded, because a loop that can spin is not acceptable in a trigger.
  -- Against fifty staff in a million-code space one collision is already
  -- unlikely and ten in a row does not occur; the bound exists so the failure
  -- mode is a clear error rather than a hang.
  -- `employees_code_unique_per_outlet` remains the backstop for the tiny window
  -- between one transaction's check and another's commit.
  loop
    v_attempt := v_attempt + 1;
    v_code := v_prefix || '-' || public.random_staff_suffix();

    exit when not exists (
      select 1 from public.employees
       where outlet_id = new.outlet_id and employee_code = v_code
    );

    if v_attempt >= 10 then
      raise exception
        'could not issue a unique staff code for outlet % after % attempts',
        new.outlet_id, v_attempt;
    end if;
  end loop;

  new.employee_code := v_code;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Who may change a code afterwards.
--
-- `employees_update` permits a Franchise Admin every row at their own outlet,
-- and a row policy permits every column on a row it permits — so today they can
-- change `employee_code`. Postgres policies cannot gate columns, and splitting
-- the policy to express one rule about one column would fracture something the
-- whole roster depends on. Hence a trigger, exactly as `attendance_guard()`
-- freezes attendance's identity columns in `20260726000007`.
--
-- The `auth.uid() is not null` wrapper is what keeps seeds and service-role
-- writes working: they carry no role claim, and without it seeding breaks.

create or replace function public.employee_code_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.employee_code is distinct from old.employee_code
     and auth.uid() is not null
     and public.app_role() is distinct from 'super_admin' then
    raise exception 'only the owner may change a staff code'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- A prefix change re-points every code already issued beneath it: `KAL-7KQ2`
-- names a prefix, and if Kalyani becomes `KLY` that code reads from something
-- that no longer exists. Before the first hire, changing it is free — which is
-- exactly when an owner notices they would rather have `KLY`.
create or replace function public.outlet_prefix_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.staff_code_prefix is distinct from old.staff_code_prefix
     and exists (select 1 from public.employees where outlet_id = old.id) then
    raise exception
      'staff codes have already been issued from this outlet''s prefix'
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

create trigger employees_issue_code
  before insert on public.employees
  for each row execute function public.issue_employee_code();

create trigger employees_code_guarded
  before update on public.employees
  for each row execute function public.employee_code_guard();

create trigger outlets_prefix_guarded
  before update on public.outlets
  for each row execute function public.outlet_prefix_guard();
