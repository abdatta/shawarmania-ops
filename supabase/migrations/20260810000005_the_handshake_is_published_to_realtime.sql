-- The two handshake tables are published, so a phone can be told rather than ask.
--
-- Realtime delivers nothing for a table that is not in this publication, so
-- without these two lines the subscription in `supabase-adapters/counter.ts`
-- would connect, report itself healthy, and never fire. That is the worst of the
-- available failures: the surfaces degrade correctly when the channel is *down*,
-- and not at all when it is up and silent.
--
-- **This publishes rows, not permission.** Realtime applies the same row-level
-- security to a change event that it applies to a read, so a subscriber receives
-- only what `counter_shift_requests_select` and `counter_shifts_select` would
-- have returned to them anyway: the tablet gets its own, the person gets theirs,
-- and the outlet's manager gets shifts at their outlet. The client-side filter on
-- `person_id` is a narrowing on top of that, never the boundary.
--
-- `counter_device_setup_codes` is deliberately absent. Nothing waits on a setup
-- code arriving — the admin is holding it — and a table no client role may read
-- has no business being offered to a channel.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'counter_shift_requests'
  ) then
    alter publication supabase_realtime add table public.counter_shift_requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'counter_shifts'
  ) then
    alter publication supabase_realtime add table public.counter_shifts;
  end if;
end;
$$;

-- An UPDATE event carries only the changed columns unless the row's identity is
-- replicated in full. A request resolving is an UPDATE, and the subscriber has to
-- see which row resolved, so both tables replicate their whole row.
--
-- `code_hash` is on that wire for `counter_shift_requests`, and that is the one
-- thing worth being explicit about: Realtime filters the payload by the same
-- column grants as a read, and `code_hash` is granted to no client role, so it is
-- dropped before delivery exactly as it is dropped from a select.
alter table public.counter_shift_requests replica identity full;
alter table public.counter_shifts replica identity full;
