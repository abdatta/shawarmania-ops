-- Every bill is linkable, from the moment the server has it.
--
-- The token lives in its own table rather than on `bills`, and that is the
-- load-bearing decision. `bills_void_only()` refuses every update to a bill
-- except `settled -> void` touching only the void columns; that trigger is the
-- append-only guarantee over the money. Putting the token on `bills` would mean
-- amending it to permit a column to be mutated so a link could be revoked --
-- weakening a financial invariant for a publishing concern. Here, revocation is
-- an ordinary update on a table that was never append-only.
--
-- It is also why `bills.id` is not the public key. `bills.id` is a CSPRNG UUID
-- and genuinely unguessable, so enumeration was never the objection. The
-- objections were that it offers no revocation at all, and that it would make a
-- primary key sometimes-secret -- safe today in a log line, an export or a
-- support message, and a disclosure forever afterwards, prevented only by
-- somebody remembering. This repo puts invariants in the database precisely so
-- nobody has to remember them.
--
-- The link is minted by a trigger, not by application code, which is what makes
-- "every bill is linkable with no share step" true. The counter is not
-- involved: it does not generate the token, does not wait for it, and never
-- sees it. A bill still sitting in a tablet's outbox has no link yet, which is
-- correct -- nobody can hand out a link to a bill the server has not accepted.

-- ---------------------------------------------------------------------------
-- The token.
--
-- Ten URL-safe characters, sixty bits. Truncating base64 is sound: every
-- character carries six independent bits of the underlying random bytes, so ten
-- characters are sixty uniform bits. `pgcrypto` lives in `extensions` and is
-- already installed in production.
--
-- The security of a capability URL is not its bit length, because an attacker
-- is not guessing one bill's token -- they are guessing *any* valid one, so
-- valid-token density subtracts: effective bits = token bits - log2(bills). At
-- ~17,000 bills a year and an assumed 10,000 requests/second, recovering one
-- random bill takes ~200 years today and years still at volumes this business
-- will not see soon. The prize at the end of that attack is one receipt showing
-- an order and no person.

create or replace function public.bill_public_link_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select left(
    translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/', '-_'),
    10)
$$;

-- ---------------------------------------------------------------------------
-- The table.
--
-- **No length check on `token`, deliberately.** If the business ever reaches
-- franchise scale the generator starts minting twelve or fourteen characters for
-- new bills and every link already in a customer's phone keeps working. That
-- makes the choice of ten reversible instead of a one-way door, and a
-- `check (length(token) = 10)` would quietly close it.
--
-- No `outlet_id`: the bill answers that question already, and a second answer is
-- a second place for it to be wrong. The table is child-scoped, classified as
-- such in `01_schema_coverage.sql`, and its isolation cases are explicit in
-- `50_public_bill_receipt_links.sql` because the catalog-driven matrix cannot
-- discover a table with no outlet column.

create table public.bill_public_links (
  bill_id uuid primary key references public.bills (id),
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index bill_public_links_live_idx
  on public.bill_public_links (token)
  where revoked_at is null;

alter table public.bill_public_links enable row level security;

-- Readable exactly where the bill is readable. The existing policies on `bills`
-- already resolve outlet scope, and restating that logic here would be a second
-- place for it to be wrong -- the same reasoning `bill_discounts` follows.
create policy bill_public_links_select on public.bill_public_links
  for select to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id));

grant select on public.bill_public_links to authenticated;
grant all on public.bill_public_links to service_role;
revoke insert, update, delete on public.bill_public_links from authenticated, anon;
revoke select on public.bill_public_links from anon;

-- A link row is never deleted. Revocation is the off switch, and it leaves a
-- row saying so; a deletion would leave a bill silently unshareable with
-- nothing recording that anybody meant it. Nothing deletes a bill either -- an
-- outlet carrying bills cannot be deleted -- so this closes the path rather
-- than blocking a real one.
create trigger bill_public_links_no_delete
  before delete on public.bill_public_links
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Minting, on every insert path.
--
-- On the table, not in the billing commands, because the path the counter
-- actually uses would otherwise be the one path without a link.

create or replace function public.bill_public_link_mint()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.bill_public_links (bill_id, token)
  values (new.id, public.bill_public_link_token());
  return new;
end;
$$;

create trigger bills_mint_public_link
  after insert on public.bills
  for each row execute function public.bill_public_link_mint();

-- ---------------------------------------------------------------------------
-- Revoking, and issuing a fresh one afterwards.
--
-- Revocation is permanent for the token: reissuing mints a new one, so the
-- revoked token thereafter names no row and can never be revived. A customer
-- who still needs a receipt is not permanently refused one.
--
-- Both are `security definer` and executable by the service role only. There is
-- no UI for either; they are ops actions, and `docs/OPERATIONS.md` carries the
-- runbook.

create or replace function public.revoke_bill_public_link(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bill_public_links
     set revoked_at = now()
   where bill_id = p_bill_id
     and revoked_at is null;
end;
$$;

create or replace function public.reissue_bill_public_link(p_bill_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  update public.bill_public_links
     set token = public.bill_public_link_token(),
         created_at = now(),
         revoked_at = null
   where bill_id = p_bill_id
  returning token into v_token;

  if v_token is null then
    raise exception 'no public link exists for bill %', p_bill_id;
  end if;

  return v_token;
end;
$$;

revoke all on function public.revoke_bill_public_link(uuid) from public, anon, authenticated;
revoke all on function public.reissue_bill_public_link(uuid) from public, anon, authenticated;
grant execute on function public.revoke_bill_public_link(uuid) to service_role;
grant execute on function public.reissue_bill_public_link(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The backfill.
--
-- Every bill rung before this migration gets a link, so no bill is unshareable
-- for having been rung too early. Production held 1,035 bills on 2026-09-03,
-- and the count is read rather than written down, because a hard-coded number
-- would be a lie the day after.
--
-- The assertion is the point: a partial backfill aborts the migration whole
-- rather than leaving some bills silently unlinkable.

-- A function rather than a bare statement, for one reason: **the migration is
-- the only place this would ever run, and production is the only database where
-- it does anything.** A fresh `db:reset` applies migrations before the seed, so
-- every seeded bill gets its link from the trigger and the backfill matches
-- nothing — which means a bare statement here would ship to production having
-- never once been executed against a bill that needed it. As a function it is
-- called by the migration below and exercised for real in
-- `50_public_bill_receipt_links.sql`, which takes links away and puts them back.
--
-- It is also idempotent, so re-running it is safe if a future restore ever needs
-- it.

create or replace function public.backfill_bill_public_links()
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_minted bigint;
  v_bills bigint;
  v_links bigint;
begin
  insert into public.bill_public_links (bill_id, token)
  select b.id, public.bill_public_link_token()
    from public.bills b
   where not exists (
     select 1 from public.bill_public_links l where l.bill_id = b.id);

  get diagnostics v_minted = row_count;

  -- The assertion is the point. A partial backfill aborts whole rather than
  -- leaving some bills silently unshareable, which is the failure nobody would
  -- notice until a customer asked for a receipt that could not be produced.
  select count(*) into v_bills from public.bills;
  select count(*) into v_links from public.bill_public_links;

  if v_bills <> v_links then
    raise exception
      'public link backfill is incomplete: % bills, % links', v_bills, v_links;
  end if;

  if exists (
    select 1 from public.bill_public_links
     group by token having count(*) > 1)
  then
    raise exception 'public link backfill produced a duplicate token';
  end if;

  return v_minted;
end;
$$;

revoke all on function public.backfill_bill_public_links() from public, anon, authenticated;
grant execute on function public.backfill_bill_public_links() to service_role;

select public.backfill_bill_public_links();
