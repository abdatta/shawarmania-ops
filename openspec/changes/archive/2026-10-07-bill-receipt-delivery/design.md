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
calls the sender. The original release left counter/outbox unchanged; D7 expands
the counter while retaining the existing command schema and money arithmetic.

## D6. Matching copy and release order

Providing a number opts into one receipt SMS per settled bill; skipping sends
nothing. There is no separate consent or suppression by explicit owner decision.
Landing pages remove separate-stop promises, keep help and the existing
customer-data removal request, and explain that SMS replies cannot reach us.
Pages deploy before activation.

Release installs migration and handlers, configures server secrets and MSG91
reports, then enables future bills. A real handset check uses only an explicitly
authorized number. Provider URL is fixed in code, never caller-chosen.

## D7. Number at payment — owner-approved follow-up

Paid opens the customer pad first if no valid number is attached, including a
number skipped at ordering. Its purpose is the receipt and points on the phone;
Skip is one tap and dismissal keeps the bill. An attached number is kept and
shown without asking twice. The order-time row remains available.

After identification or skip, checkout shows customer and Gold, available points
and redemption, then the recomputed total and existing tender pad. Customer or
points changes remount tender so an old allocation cannot pay a different total.
Only fresh balances allow additional redemption; existing holds remain usable.
Lookup failure never blocks payment. Corrections keep their original tender UI.

Direct bills use the existing customer/discount snapshots in `pay_now`. Saved
orders first durably accept `revise_order` when checkout changed, then accept
`pay_order` on the same dependency chain. A revision failure accepts no payment;
a payment-storage failure retains the revised order and shows the error in the
dialog. Retry pays that same order. Offline replay preserves both UUIDs, prices,
customer and points, and sends only the eventual bill's single receipt job.

Order-line IDs travel through both typed adapters, queued projections and the
captured packaging helper. Revisions reuse them, so server validation recognises
an existing captured price rather than comparing it to today's menu price. New
lines still mint new UUIDs. This also preserves prices across a cold offline start.

The owner approved this follow-up and authorized pushing on 4 October 2026.
Points investigation is read-only
in production: current Kalyani settings and both deferred triggers are enabled,
but the first genuine customer bill after receipt activation is still outstanding.
No historical points are retroactively awarded without evidence.

## D8. Each outlet chooses customer collection

`outlets.collect_customer_details` is a non-null boolean, default true for
existing and new outlets. The Orders settings tile is independent of dine-in,
takeaway, Gold and points. Owner and same-outlet active franchise admins save it
through the existing narrow service-settings RPC, extended with an optional
parameter whose omission preserves the stored value for older clients. Other
roles and other-outlet managers are refused by the database. Existing outlet RLS
continues to govern reads. No general outlet-write permission is broadened.

The typed service settings and cached menu snapshot carry the choice; older
caches without it default to true. Off hides customer controls in both composer
locations, removes the customer-decision prerequisite for orders, and opens
tender directly for direct and saved-order payment. Service questions still
apply. A saved customer remains attached, with existing benefits and SMS
eligibility; the switch controls collection, not erasure or message suppression.
Payment shows an existing identity read-only and retains points controls. Off
with no identity shows no empty customer block. The settings shimmer reserves
the extra tile. Saved-order checkout uses the counter's already loaded/cached
settings, so payment never waits for an additional network read. Standalone
pipeline views resolve settings before deciding whether to show the prompt.
The owner approved this UI together with checkout and authorized its release.

## D9. Customer entry is optional while ordering — reviewed for release

The composer enables Order and Save changes without a customer decision, whether
collection is on or off. Items, required service choices and local acceptance
still govern availability. The optional customer row stays where collection is
on; its dialog can still identify or clear a customer, but opening it or pressing
Skip is never a prerequisite for ordering. Existing customer snapshots and
loyalty behave as before.

Payment remains the collection checkpoint: missing or previously skipped numbers
open the receipt-and-points pad, and one-tap Skip opens tender. An attached number
is kept without another question. Collection off bypasses this checkpoint. This
changes only the footer's availability rule; the nullable snapshots, command
schema, queue, database policies, sender and layout are unchanged. No shimmer
geometry changes because no element moves or changes size.

The payment-time flow and collection switch are already deployed in `6d4dd594`.
The owner reviewed the fully verified ordering refinement and authorized
deployment on 4 October 2026. It is live in application `38522703`, build stamp
`3852270`. The active change stays open while the genuine production points
check remains pending.
