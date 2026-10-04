# Design: bill-receipt-delivery

## D1. The bill is the event; the tablet never sends SMS

A deferred INSERT trigger ordered after `bills_points_on_settle` creates one
`bill_receipt_deliveries` row keyed by bill UUID, after items, discounts and points
exist. It snapshots earned points and the outlet's balance after that bill. A
zero-earned bill retains the existing balance. The phone stays in the bill's
existing snapshot; no phone is copied into the delivery table or logs.

Eligibility requires enabled delivery, a settled bill, a canonical Indian mobile,
and `paid_at >= enabled_at`. This excludes pre-launch offline bills too. No
backfill. Preparation and tender corrections never create sends.

Rejected: React/outbox sends, which miss closed tabs and multiply on replay;
sending on Prepared, which delays the receipt; computing points in JavaScript,
which duplicates the settlement rules.

## D2. Async wakeup plus durable recovery

`pg_net` wakes a secret-authenticated Edge Function after commit. Its failure
cannot roll back payment. Vault holds the function URL and worker secret.
`pg_cron` wakes pending work every minute and marks abandoned claims uncertain.
Configuration starts disabled and is service-only. Enabling starts future bills
only; disabling pauses pending work. No external dependency enters the bill write.

## D3. At most one automatic provider submission

Workers claim pending rows with `FOR UPDATE SKIP LOCKED`, committing `sending`
before HTTP. Each bill is submitted once with its UUID as correlation metadata.
Replay/concurrency cannot claim it again. MSG91's documented UUID/CRQID are
correlation fields, not a documented idempotency contract.

A timeout, lost response or abandoned claim becomes `unknown`, never requeued.
This prefers an observable missing receipt over a duplicate SMS. Exactly-once
handset delivery cannot be guaranteed across a provider with no documented
idempotency key. Rejection is `failed`; success is `submitted`, not `delivered`.
Manual WhatsApp remains the fallback.

## D4. Authenticated, idempotent reports

A separate secret authenticates MSG91 callbacks. The known bill UUID and provider
request ID identify a delivery. Delivered reports dominate duplicates and older
failures. A report arriving before the HTTP response retains its provider ID and
terminal state; the worker cannot overwrite it. No phone, message body or raw
provider error is persisted. Failures map to fixed non-identifying codes.

## D5. Tenancy, typed seam and UI

Jobs carry `outlet_id`, a bill/outlet FK, RLS and a SELECT policy for the active
owner or that outlet's managers. Clients cannot insert, claim, finish, configure
or report. Service functions are revoked from PUBLIC, anon and authenticated.
The billing adapter embeds status and failure code. Manager Customer details
shows it inside the existing closed disclosure: the outer history layout and
collapsed-row shimmer remain accurate. Demo has typed local statuses and never
calls the sender. Counter/outbox and money arithmetic remain unchanged.

## D6. Matching copy and release order

Providing a number opts into one receipt SMS per settled bill; skipping sends
nothing. There is no separate consent or suppression by explicit owner decision.
Landing pages remove separate-stop promises, keep help and the existing
customer-data removal request, and explain that SMS replies cannot reach us.
Pages deploy before activation.

Release installs migration and handlers, configures server secrets and MSG91
reports, then enables future bills. A real handset check uses only an explicitly
authorized number. Provider URL is fixed in code, never caller-chosen.
