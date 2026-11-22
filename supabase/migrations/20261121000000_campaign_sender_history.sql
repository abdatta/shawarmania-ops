-- WhatsApp campaigns (#85): the laptop's history.
--
-- The owner, 2026-11-21: a way to see, on the laptop, everything that has gone
-- through the sender, tests included, and what is still to come. Asked, they
-- chose to read it from this database rather than keep a second copy on the
-- laptop, and to see each customer's **whole number** (proposal, decision 17).
--
-- One read, for the sender's own page, which runs on the owner's laptop and is
-- signed in as an owner:
--
--   * `tests_waiting`: the owners' test messages not yet sent, oldest first;
--   * `batches_ahead`: every batch not yet done of a campaign still going
--     (submitted or paused), with how many it holds and how many are still to
--     go, in the order the campaigns were submitted;
--   * `sent`: every message the laptop picked up, newest first: a customer's or
--     a test, with the campaign, the batch, the customer's saved name and whole
--     number, how it ended, and the receipts so far. A customer passed over at
--     their turn because they were stopped was picked up by nobody and is not
--     in it; the batch counts on the app's pages hold them.
--
-- **The second read that returns a whole number** (the first is the claim, at
-- the moment of sending). The number is the customer's as it is now, which is
-- the number a message to them would go to today. Only an owner's session may
-- call it, checked in its own body, as every campaign function is; the app's
-- pages never call it, and still show four digits.
--
-- Only adds: a new function, which no published build calls.

create function public.campaign_sender_history(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'history_invalid' using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object(
    'server_now', now(),
    'tests_waiting', coalesce((
      select jsonb_agg(jsonb_build_object(
               'campaign_name', c.name, 'phone', t.phone, 'queued_at', t.queued_at)
             order by t.seq)
        from public.marketing_campaign_tests t
        join public.marketing_campaigns c on c.id = t.campaign_id
       where t.state in ('waiting', 'sending')), '[]'::jsonb),
    'batches_ahead', coalesce((
      select jsonb_agg(jsonb_build_object(
               'campaign_id', c.id, 'campaign_name', c.name, 'campaign_state', c.state,
               'batch_no', b.batch_no, 'state', b.state,
               'recipients', n.recipients, 'to_go', n.to_go)
             order by c.scheduled_at, c.id, b.batch_no)
        from public.marketing_campaign_batches b
        join public.marketing_campaigns c on c.id = b.campaign_id
        cross join lateral (
          select count(*)::integer as recipients,
                 (count(*) filter (where r.state = 'waiting'))::integer as to_go
            from public.marketing_campaign_recipients r
           where r.campaign_id = b.campaign_id and r.batch_no = b.batch_no) n
       where c.state in ('scheduled', 'paused') and b.state <> 'done'), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(h.item order by h.at desc, h.tiebreak)
        from (
          select coalesce(r.sent_at, r.claimed_at) as at,
                 r.campaign_id::text || ':' || r."position"::text as tiebreak,
                 jsonb_build_object(
                   'kind', 'customer', 'at', coalesce(r.sent_at, r.claimed_at),
                   'campaign_name', c.name, 'batch_no', r.batch_no,
                   'name', cu.name, 'phone', cu.phone, 'state', r.state,
                   'delivered_at', r.delivered_at, 'read_at', r.read_at,
                   'failure_code', r.failure_code) as item
            from public.marketing_campaign_recipients r
            join public.marketing_campaigns c on c.id = r.campaign_id
            join public.customers cu on cu.id = r.customer_id
           where r.claimed_at is not null
          union all
          select coalesce(t.sent_at, t.claimed_at),
                 'test:' || t.seq::text,
                 jsonb_build_object(
                   'kind', 'test', 'at', coalesce(t.sent_at, t.claimed_at),
                   'campaign_name', c.name, 'batch_no', null,
                   'name', null, 'phone', t.phone, 'state', t.state,
                   'delivered_at', null, 'read_at', null,
                   'failure_code', t.failure_code)
            from public.marketing_campaign_tests t
            join public.marketing_campaigns c on c.id = t.campaign_id
           where t.claimed_at is not null
           order by 1 desc, 2
           limit p_limit) h), '[]'::jsonb)
  );
end;
$$;

comment on function public.campaign_sender_history(integer) is
  'The sender''s history page: tests waiting, batches still to go, and the newest '
  'messages the laptop picked up, with whole numbers. Owner only (decision 17).';

revoke execute on function public.campaign_sender_history(integer) from public, anon;
grant execute on function public.campaign_sender_history(integer) to authenticated;
