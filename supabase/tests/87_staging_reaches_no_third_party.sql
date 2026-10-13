-- #75 a-release-can-be-switched-off, design D19: staging reaches no third party.
--
-- Staging's Vault never receives the receipt sender's address or secret. This
-- proves that is enough: sending cannot be switched on without them, and even
-- with sending forced on and a receipt queued, neither the wake-up nor the
-- minute's recovery job makes a request — so a bill rung on staging can never
-- text a real phone number. The aggregator and dispatch functions are held by
-- `src/lib/third-parties-fail-closed.test.ts`.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

delete from vault.secrets where name in ('receipt_delivery_url', 'receipt_delivery_worker_secret');

select throws_ok($$select public.bill_receipt_configure(true)$$, '22023',
  'receipt sender not configured',
  'sending cannot be switched on while the sender is not configured');

-- The worst case staging could reach by hand: sending forced on, a receipt queued.
update public.bill_receipt_delivery_settings set enabled = true;
insert into public.bill_receipt_deliveries (bill_id, outlet_id, earned_points, balance_points)
select b.id, b.outlet_id, 0, 0
  from public.bills b
 where not exists (select 1 from public.bill_receipt_deliveries d where d.bill_id = b.id)
 limit 1;

select ok(exists (select 1 from public.bill_receipt_deliveries where state = 'queued'),
  'a receipt is queued');

create temp table requests_before as select count(*)::int as n from net.http_request_queue;
select public.bill_receipt_wake();
select public.bill_receipt_recover();

select is((select count(*)::int from net.http_request_queue), (select n from requests_before),
  'with no sender in the Vault, neither the wake-up nor recovery makes a request');
select ok(exists (select 1 from public.bill_receipt_deliveries where state = 'queued'),
  'and the receipt stays queued, sent to nobody');

-- The control: the same wake-up does make a request once the sender is
-- configured, so the silence above is the missing secret's and nothing else's.
-- Rolled back with everything else; nothing is transmitted before a commit.
select vault.create_secret('http://kong:8000/functions/v1/send-bill-receipts', 'receipt_delivery_url');
select vault.create_secret(repeat('s', 64), 'receipt_delivery_worker_secret');
select public.bill_receipt_wake();
select is((select count(*)::int from net.http_request_queue), (select n from requests_before) + 1,
  'configured, the same wake-up makes one request');

select * from finish();
rollback;
