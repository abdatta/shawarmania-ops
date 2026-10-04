# Proposal seed: receipt-sms-status-and-manual-resend

> **Model**: Opus · **Wave**: F · **Depends on**: #59 · **Gate**: exploratory seed only; review a broader trading sample and settle the owner's answers before defining a biller's receipt SMS status and any deliberate resend policy. Billing stays non-blocking, outlet isolation holds, and a repeated action cannot become an unintended extra charge. Timing, attempt limits, wording, visibility and release scope remain open.

> **Seeded at the owner's request on 2026-10-04. Not apply-ready.** This is a
> separate follow-up to `bill-receipt-delivery`, not an expansion of its current
> release or a reason to hold its archive. The owner asked to wait a couple more
> trading days for evidence and to be asked thorough questions before this seed
> becomes a full proposal. No design, implementation tasks or spec delta is
> approved by this document. Do not silently turn its options into requirements.

## Why

A customer can pay and receive an automatic receipt SMS today, but the biller
cannot see whether that receipt was submitted, delivered or failed. The owner
and the outlet's franchise admins can inspect Receipt SMS in a bill's customer
details in Billing history; there is no dedicated failed-SMS list or biller
resend action.

MSG91 accepts a submission promptly and reports delivery later through a separate
callback. The app's send request does not wait for that report. A missing delivery
report after a minute can mean a message is still on its way, rather than that it
failed. Conversely, an operator failure may be reported hours after the customer
has left.

The owner wants a practical way to help a customer who says the receipt has not
arrived, without automatically spending several submission charges on every
bill. This seed explores visibility and deliberate manual resend together, with
the option to deliver visibility first or decide that resend is unnecessary.

## What the owner has said

- Providing a phone number at payment is the receipt SMS opt-in. This follow-up
  does not reopen a separate consent or SMS suppression preference.
- Failed requests appeared to be charged in MSG91. The owner is concerned that
  automatic retries during a widespread failure could multiply costs for every
  bill. Confirm the applicable charging rules before promising a cost in the UI.
- A spinner while sending, a status on the biller screen, and a manual resend
  action are possible improvements. These are ideas, not a settled layout.
- For a customer who wants their receipt, receiving it twice or even three times
  can be preferable to receiving nothing. Deliberate duplicate risk is acceptable;
  that does not authorize automatic retries or choose a maximum attempt count.
- One minute without confirmed delivery was suggested as a possible threshold.
  The owner is happy to wait a couple more trading days if the data does not yet
  support roughly 95% coverage. No threshold is selected yet.
- One additional manual attempt was suggested in discussion, but the owner has
  explicitly left whether to start with that limit open.

## Evidence at seeding — a small sample, not a service guarantee

Read-only production inspection on 2026-10-04 found 36 eligible receipt
submissions at Kalyani Cafe for business date 2026-10-04: 35 reported delivered
and one reported failed. No job in that inspected cohort remained pending.
There was one automatic submission per bill and no duplicate job per bill.

Among the 35 delivered messages, elapsed time from stored provider submission
to the accepted delivery report was:

| Measure | Observed elapsed time |
| --- | --- |
| Minimum | 6.4 seconds |
| Median | 16.5 seconds |
| Mean | 3 minutes 50.9 seconds |
| 90th percentile | 67.6 seconds |
| 95th percentile | 38 minutes 28.8 seconds |
| Maximum | 45 minutes 34.3 seconds |
| Confirmed within one minute | 31 of 35 delivered messages, about 89% |

Relative to **all 36 submissions**, 31 were confirmed within a minute, about
86%. A one-minute button would therefore have become eligible for five messages:
four eventually delivered and one eventually failed. Three successful messages
had reports more than 15 minutes after submission. The failed message's stored
report was roughly 3 hours 20 minutes after submission.

These are **app-observed report timings**, not measured handset arrival times.
The current failed-report timestamp can be overwritten by a repeated failure
callback, so it does not establish the first failure instant. A single outlet's
small sample cannot establish a reliable 95th percentile or predict another
outlet's experience. Refresh the evidence before expanding this seed; do not
copy these percentages into a permanent policy.

## Questions to ask the owner before expansion

### 1. What problem should the first release solve?

- Is the priority helping a customer still at the counter, discovering failures
  after they leave, or both? Would visible status alone be a useful first release?
- Should resend be offered only when a customer asks, or can staff proactively
  use it? Is a late failure worth staff action when nobody has asked for a receipt?
- Should this be on the paid ticket, Bills this shift, View receipt, or somewhere
  else? Can a biller find the bill after it leaves the active order list?
- Do we also need a manager failure filter or list, with outlet, business date
  and bill references? Is that in this change or a separate follow-up?

### 2. When does a resend become available?

- Do we keep one minute, choose another delay after reviewing more data, or
  initially allow resend only after an explicit failure report?
- Is the desired target roughly 95% of successful delivery reports, 95% of all
  eligible submissions, or a tolerable customer waiting time regardless of that
  percentage? These lead to different decisions.
- Does the waiting clock start at provider acceptance, server queueing, or
  payment? An offline bill may reach the server much later; payment time cannot
  by itself mean the provider has had a minute to deliver it.
- Should an explicit failure allow an immediate resend? Which failures are
  retryable, and which need configuration, wallet or number correction first?
- Should uncertain submission also allow a deliberate resend? The first request
  may already have been accepted even though the app could not confirm it.
- Is the delay fixed for everyone or configurable per outlet? If configurable,
  who edits it and what bounds apply?

### 3. How many extra attempts, and at whose discretion?

- Start with one extra manual attempt per bill, allow two, or choose another
  limit? Does the limit apply across devices and shifts, rather than per screen?
- Is there a cooldown after each additional attempt? When is another one useful
  if the previous attempt still has no report?
- Do owner and franchise admins get the same limit, a separate override, or no
  resend action in Billing history initially?
- Does a confirmed delivery on **any** attempt end eligibility, even if another
  attempt later reports failure? If the customer disputes a Delivered report,
  should staff still have a way to resend?
- What counts toward the allowance: an accepted request, an uncertain request,
  or any provider request that might incur a charge? How are definitely unmade
  requests treated?
- Should a clear provider-wide problem disable resend or show an explanation?
  Is an outlet/day spending cap necessary, or would that overcomplicate V1?

### 4. What should the biller see and read?

- Should the spinner cover only queueing/submission, followed by a quiet
  "Waiting for delivery confirmation" state? A long spinner could suggest
  payment is still in progress.
- Which words distinguish provider acceptance from confirmed delivery?
  Candidate copy includes "SMS submitted", "SMS delivered" and
  "Delivery not confirmed yet". Elapsed time alone must not claim failure.
- Should the action say **Resend SMS**, **Send receipt again**, or **Retry SMS**?
  Does "Retry" incorrectly imply we know the first message failed?
- Is duplicate/charge information inline, in a confirmation, or shown only the
  first time? Candidate copy: "The earlier SMS may still arrive. Sending again
  may deliver a duplicate and incur another SMS charge." Exact wording is open.
- Should the UI show attempt count, last submitted time, countdown or remaining
  attempts? How much information helps staff during a queue of customers?
- How do status updates arrive without refreshing? What do stale status, offline
  state and a failed status refresh look like? These must not appear as SMS failure.
- What should happen when a late callback arrives after a resend, or after the
  operator has moved to the next customer? Is an unobtrusive update enough?

### 5. Which bills, people and message contents are eligible?

- Is this only for the enrolled counter with a live shift, or also a biller's
  personal session? Which outlet-scoped owner/admin actions are wanted?
- Are previous shifts' bills eligible? How old may a bill be, and are bills from
  before sender activation deliberately excluded?
- What happens for skipped jobs, invalid numbers, cancelled bills, revoked
  receipt links, or delivery disabled at the outlet/provider? Distinguish a
  temporary failure from a receipt that should not be sent.
- Does resend always use the original bill's number, receipt link, earned points
  and frozen balance? It must not earn points again or alter the settled bill.
- If the number was mistyped, is number correction explicitly outside V1, or
  should a separately authorized correction flow precede resend? Do not quietly
  turn a settled bill snapshot into editable customer data.
- If customer collection is later disabled, can staff resend a receipt already
  attached to a valid number? What does the owner expect?

### 6. What makes an intentional extra send safe to operate?

- How should one deliberate resend differ from a double tap, two tablets racing,
  or a lost HTTP response being replayed? Intentional extra attempts need a
  bounded server record; replays of the same action must not purchase more sends.
- Should manual resend require being online, or may it be queued? If queued,
  what if the original is delivered before connectivity returns or the customer
  has left? Decide whether that queued intent expires or needs reconfirmation.
- How are original and extra attempts shown together without a late report
  overwriting another attempt's truth? Should we retain an attempt history and
  safe failure reason, without copying phones or raw provider errors into logs?
- What demonstration states would let the owner review pending, delivered,
  failed and uncertain outcomes, limits and duplicate warnings without real SMS?

## Evidence and conversation required to expand

Wait for a couple more complete trading days, then review the timing distribution
and failure mix with the owner. Decide together what sample is sufficient;
"two more days" is a review opportunity, not proof of a percentile by itself.
Use business dates and outlet-scoped, non-PII aggregates. Include successful,
failed, uncertain and still-pending submissions rather than quietly dropping
the slow unfinished messages. Separate queue/submission latency from report
latency, and distinguish first report from repeated callback timestamps.

Bring counts, one-minute/two-minute coverage and useful percentiles, including
the long tail. Validate the relevant MSG91 charge behavior before estimating
extra cost. No production SMS needs to be sent merely to gather this evidence.

The next proposal session must **ask the owner these questions and record their
answers before selecting policy**. It may narrow or split the work. Only then
write design, spec deltas, tasks and a concrete phase gate, including owner UI
review before final release. Invocation of a proposal workflow alone must not
convert unanswered questions into defaults.

## Non-goals

- No implementation, migration, production setting change or deployment now.
- No automatic retry loop, automatic resend at one minute, or assumed three-send
  policy. Timing and limits remain questions.
- No delay to payment, order placement, offline settlement or the next customer.
- No new loyalty earning, bill mutation, historical backfill or marketing SMS.
- No customer phone numbers, receipt tokens or raw provider payloads in this
  document, diagnostics or analytics.
- No archive of #59, and no changes to its current one-automatic-submission
  contract. A future manual exception needs its own explicit specification.

## Docs to update if this proceeds, before archiving

- `docs/SCREENS.md`: chosen counter/history location, status wording and actions.
- `docs/DATA_MODEL.md`: delivery attempts and report semantics, if introduced.
- `docs/ROLES_AND_PERMISSIONS.md`: precise resend/read authority and outlet scope.
- `docs/OFFLINE_AND_SYNC.md`: status freshness and the chosen manual action policy.
- `docs/OPERATIONS.md`: failure diagnosis, provider configuration and charge rules.
- `docs/SECURITY_AND_PRIVACY.md`: phone handling and safe delivery diagnostics.
- `docs/LIMITATIONS.md`: delayed reports, possible duplicates and attempt limits.
- `docs/DEMO_MODE.md` and `docs/TESTING.md`: reviewable states and verification of
  replay, races, late callbacks, offline behavior and both themes.
