# Verification: bill-receipt-delivery

**Current status, 4 October 2026:** the automatic SMS channel, payment-time
customer prompt and outlet collection setting are deployed. The latest optional
ordering refinement is implemented and fully verified locally. The owner reviewed
it and authorized deployment; release is in progress. Eleven of twelve numbered
tasks are complete. Task 8 still awaits
a genuine eligible production bill to confirm points earning. The dated sections
below retain the evidence for each phase; the latest section describes the current
refinement.

Verified locally on 3 October 2026 and released on 4 October 2026. Production
sending is enabled from 10:17:53 a.m. Asia/Kolkata.

| Gate | Evidence |
|---|---|
| Lint | Pass, no errors; 15 existing warnings |
| Format | Formatter run before gates; final `npm run format:check` passes |
| App types | `npm run typecheck` passes |
| Edge types | `npm run functions:typecheck` compiles both new handlers against generated schema |
| Unit/component | `npm test`: 165 files, 2,177 tests pass; adapter fixture rerun: 41 pass |
| Contrast | 64 pairs pass AA in both themes |
| Build | `npm run build` passes |
| Demo browser | `npm run test:e2e`: 284 pass, including no-real-data tripwire and offline paths |
| Database | Fresh reset; `npm run test:db`: 75 files, 2,973 assertions pass |
| HTTP/RLS | `npm run test:rls`: all six phases pass, 282 tests |
| Real-account browser | `npm run test:e2e:auth`: 34 pass, including real offline tablet settlement and both-theme manager views |
| Schema | Types regenerated from reset schema; expected additive delivery types only |
| Visual | Own preview on 7413: failed receipt with WhatsApp fallback in Customer details at 390×844 and 1024×768, light and dark; closed detail and list shimmer remain the same shape |
| Landing | Own preview on 7433: messaging, terms, privacy and links inspected; build, weight and no-secret checks pass |

## Receipt-specific proofs

- The real durable IndexedDB queue accepts a bill offline without a network call.
  Reconnection commits it through the real billing RPC; a deliberately lost
  response retries as a replay and drains the queue. Exactly one delivery job
  exists. Two concurrent service claims produce one job and one stubbed provider
  submission. The actual PostgREST embed is an array and the adapter maps it.
- Database checks freeze points after the bill ledger writes, retain existing
  balance on zero earn, exclude numberless/disabled/pre-activation bills, refuse
  other-outlet reads and browser claims/configuration/reports, skip revoked links,
  protect callback-before-response and never retry unknown or abandoned claims.
- Provider contract checks distinguish submission from delivery, serialize only
  approved variables and tracking UUIDs, reject demo URLs/invalid points, discard
  raw provider errors, authenticate distinct credentials and never retry a lost
  provider response. No real phone, key or message payload is logged or committed.

- Actual local Edge HTTP calls return 401 without the correct credential, 405
  for a worker GET, `{processed: 0}` for the authenticated disabled worker, and
  `{accepted: false}` with HTTP 200 for an authenticated unknown report.
  A real local submitted job becomes delivered through the report Edge Function;
  a later failed callback is acknowledged and cannot downgrade it.

## Issues found and corrected

The schema coverage audit needed the private settings table classified as
service-only. The HTTP fixture initially assumed a to-one delivery embed;
PostgREST returns an array for the composite foreign key, so both HTTP and adapter
fixtures now use that actual shape. The mapper already accepts both shapes.
Exact optional-property typing required omitted RPC arguments instead of explicit
`undefined`. The relevant checks were repeated after each correction.

## Production release evidence

The owner explicitly approved pushing both repositories, activation, MSG91
configuration and the real test SMS. The 12 earlier Ops commits were included;
the normal merge preserved both the remote #58 release IDs and later evidence.
Implementation `f1d107f8` and merge `493ea0bb` are pushed. Deploy run
`37177579707` passed every verification job, migration, all Edge Functions and
Pages publication. The live Ops entry bundle contains `493ea0bb` and answers 200.

Landing `c4e6092` passed Pages run `37177577578`. Live messaging, terms and privacy
each answer 200 with the approved copy, before Ops activation. Its release
evidence is recorded in `1ab29e4`. No Worker change or redeployment was required.

Production project `iefcidjbfnmsiqithqbj` has migration `20261004000000`, both
handlers, the three server secrets, the Vault endpoint/worker credential and
one active minute recovery job. Both unauthenticated handlers return 401.
The authenticated disabled worker returned 200 with zero processed; the
authenticated unknown report returned 200 with `accepted: false`.

The MSG91 `de16` webhook is enabled for On Report Received, POST JSON to the
report handler, with its distinct private header and only bill UUID, request ID
and status. No mobile or message body is included. Sending was enabled at
`2026-10-04T04:47:53.179311Z` (10:17:53 a.m. IST). History produced zero jobs.

One explicitly authorized test SMS used the shared production submission
contract and the existing Kalyani Cafe bill 199 receipt, with its actual zero
earned points and zero balance, addressed only to the owner's approved number.
It did not manufacture a sale or backfill a customer delivery. MSG91 accepted
request `366a646a7135507942345945` at 04:47:57Z and its filtered log reports
**Delivered** at 04:48:01Z, sender DEDTTL and the approved DLT template. The real
authenticated delivery callback reached the production report handler at
04:48:17.916Z and received 200. Since this manual connection test has no delivery
job, it is acknowledged without attaching it to a customer's history.

The SMS receipt URL, counter view and PDF all returned 200; the PDF is a real
`application/pdf` response. The owner supplied a handset screenshot of the
received SMS and explicitly confirmed: "Yes, received and opens." The screenshot
is kept outside Git. New-bill settlement, offline replay, competing claims
and terminal delivery persistence were proved against the real local backend.
No eligible new production bill existed at the release check, and no synthetic
production sale was added. The first genuine eligible sale will exercise that
same automatic path in production.

## Local checkout expansion — 4 October 2026

The owner authorized the expanded implementation and explicitly reserved UI
review before finalization or deployment. This follow-up remains unstaged and
uncommitted on top of `1fbe7f23`; nothing from it was pushed, deployed or archived.
The original SMS release above remains the production release.

Checkout now asks for a missing number, including one skipped at ordering,
before membership, points, the final total and tender. An attached number is
kept and shown. Skip stays one tap, dismissal leaves the bill unpaid, and the
order-time customer row remains. Customer or points changes clear allocated
tender. Saved orders durably enqueue their revision before payment, retain the
revised order if payment storage fails, and keep captured line identities and
prices across an offline restart and a later menu price change.

| Gate | Local expansion evidence |
| --- | --- |
| Lint | Pass, no errors; 15 existing warnings |
| Format | Formatter ran before gates; final format check passes |
| App and Edge types | Both typecheck commands pass |
| Unit/component | 165 files, 2,181 tests pass; final checkout label adjustment verified by 63 counter tests |
| Contrast | 64 pairs pass in both themes |
| Build | Final production build passes |
| Demo browser | 286 pass, including number at payment, retained number, demo isolation and offline paths |
| Database | Fresh reset; 75 files, 2,973 assertions pass |
| HTTP/RLS | All six phases pass, 283 tests |
| Real-account browser | 34 pass, including real offline tablet settlement |
| Schema | Regenerated from reset schema; generated types have no diff |
| Visual | Own production preview on 7413; number and tender steps checked at 390×844 and 1024×768, light and dark; temporary viewport reset and original dark theme restored |

The added real-backend case queues anonymous creation, customer revision and
payment in IndexedDB. It changes the local menu price after creation, then
reconnects, loses the committed payment response and retries it. The queue drains
with exactly one ₹270 bill, one 6-point earning entry and one receipt job freezing
6 earned points and a balance of 6. This uses synthetic fixtures and a local
backend, with provider submission stubbed; it sends no real SMS. The captured-line
regression was separately proved red with UUID retention removed, then green
after restoring the fix.

Read-only production checks confirmed enabled points and receipt triggers,
Kalyani Cafe's 5-per-₹200 settings and the installed earning function. At
07:06 UTC, bill 199 remained the only identified customer bill; no genuine
post-activation customer bill existed to settle task 8. Its historical missing
earning row remains unexplained: enabling points after that sale is plausible,
but the settings table has no activation timestamp proving it. No production
sale, ledger adjustment, backfill or additional SMS was created for this check.
Task 8 remains pending that first genuine bill, and task 9 remains pending owner
UI review.

The review tab is left open on the local checkout. Browser proof images are kept
outside Git in the temporary directory as `receipt-payment-review-light.png`
and `receipt-payment-review-dark.png`. Private handset attachments and `.env`
are neither staged nor committed.

## Local outlet collection setting — 4 October 2026

Task 10 is implemented and verified locally. Eight of the ten numbered tasks are
complete; production points confirmation (8) and owner UI review (9) remain open.
The owner authorized the switch for both owner and franchise admin, with the
existing no-deployment instruction retained. No commit, push, production migration,
deployment, new production sale or additional SMS was performed.

Orders settings now offers default-on **Collect customer details**, independently
of service types and loyalty. Off removes composer/edit entry, permits anonymous
ordering without Skip, and skips direct/saved-order checkout prompts. Already
attached customers, captured prices and benefits remain intact. The counter hands
its cached settings directly to saved-order checkout; a test makes any extra menu
read hang and still reaches payment without making that read. A real IndexedDB
close/reopen followed by an unavailable backend keeps collection off through the
live menu adapter. Missing older-cache choices remain default-on.

Migration `20261004010000` adds the default-on outlet column and extends the
narrow service-settings RPC. Its optional argument preserves the stored value
when omitted by older clients. SQL proves owner and assigned franchise-admin
writes, cross-outlet refusal/read isolation, lower-role and deactivated-manager
refusal, and no anonymous execute grant. The REST adapter test verifies a real
manager saving off and the outlet tablet reading it through its menu. General
outlet-write policies were not widened.

| Gate | Final local setting evidence |
| --- | --- |
| Lint | Pass; no errors, 15 existing warnings |
| Format | Formatter run before gates; final format check passes |
| App/Edge types | Both pass against the regenerated schema |
| Unit/component | 165 files, 2,186 tests pass after cached-settings adjustment |
| Contrast | 64 pairs pass AA in both themes |
| Build | Explicit final production build passes |
| Demo browser | Final run: 290 pass; both owner/admin switch flows reach anonymous ordering and saved-order payment without Skip |
| Database | Fresh migration/reset; 76 files, 2,990 assertions pass |
| HTTP/RLS | All six phases pass, 283 tests |
| Real-account browser | 34 pass, including real offline and two-tablet settlement |
| Schema parity | Regeneration produces the identical SHA-256 file hash; expected diff is only the new column and optional RPC argument |
| Visual | Own final build on 7413, 390×844 and 1024×768 in both themes; switch saved off/on; no console errors; viewport and original dark theme restored |

Browser proof files remain outside Git: `customer-collection-review-light.png`
and `customer-collection-review-dark.png` in the local temporary directory. The
review tab and own preview remain open. The latest read-only production check
still returned only historical identified bill 199 with no earned entry, so task
8 was not marked complete or corrected speculatively. The separate recommendation
to make order-time identification optional while collection is on has not been
implemented; this task implements the requested per-outlet switch.

## Owner approval and release — 4 October 2026

After reviewing the expanded checkout and outlet setting, the owner stated
"Lgtm, you can push". Task 9 is complete and release is authorized. Nine of the
ten numbered tasks are complete; task 8 awaits a genuine eligible production
bill. The local evidence above describes the approved application bytes; only
approval documentation changed afterwards. Production release evidence follows
below. This change remains active and is not archived.

Application commit `6d4dd5948ef3f57e0058e0ca8879bdbe3028eaa5` was pushed to
`main`. [Deploy run 37192024200](https://github.com/abdatta/shawarmania-ops/actions/runs/37192024200)
passed every verification, build, migration, functions and publication job.
Pages reported success at **2026-10-04 09:32:58 UTC / 15:02:58 IST**.
The production build stamp is `6d4dd59` (CI uses Git's seven-character default).

CI observed 2,186 unit/component tests, 2,990 database assertions, the complete
HTTP/RLS suite, 34 real-account browser tests, schema parity, lint, formatting,
types, contrast and build passing. Demo browser results were **288 passed and
2 flaky**, both billing-history layout checks passing on retry. The final local
demo run above passed all 290 without retries. The CI retry evidence is retained
here rather than described as an entirely clean first attempt.

Read-only production verification confirmed migration `20261004010000`, the
non-null default-true column, and collection on for all three existing outlets.
The installed RPC has one optional argument, denies anonymous execution, checks
active account plus owner/outlet assignment, and preserves an omitted choice.
Receipt sending remains enabled. The live HTML and asset return HTTP 200; asset
`/assets/index-B1t11kAb.js` contains the new setting, payment prompt and expected
production project. Edge's real owner session shows **Collect customer details**
on for Kalyani Cafe and **Build 6d4dd59** in its account panel, with no console
errors. No production setting was changed during verification.

The final read-only points query still returned only historical identified bill
199, with no earning entry. Task 8 remains open for a genuine eligible bill; this
release created no production sale, backfill, ledger adjustment or extra SMS.

## Optional customer entry while ordering — 4 October 2026

The owner authorized making customer entry optional for Order and Save changes,
including when outlet collection is on. Both now use the existing non-empty,
not-busy and required-service guards. Customer entry stays available; checkout
still asks for a missing number when collection is on, before benefits and tender,
and offers one-tap Skip there. Attached customers and the collection-off path are
preserved. No schema, adapter, money, outbox or layout change is needed.

The active proposal, design, receipt delta, new counter-billing delta and current
screen/limitations docs describe this rule. Task 11 records implementation and
task 12 records the owner's requested quick review before release. The previous
review approval applies to the deployed phase, not this new refinement.

Before the footer change, the two updated component regressions failed because
Order was disabled beside untouched customer entry. After the change, tests
exercise anonymous ordering and quantity edits without Skip, then either attach
a customer or Skip at payment. Existing last-line reset coverage now expects the
untouched customer control without disabling an otherwise valid order.

The browser tests track the durable order UUID after sync, rather than its
temporary awaiting-number test id. Initial runs exposed that selector race after
editing/payment; the final complete run passes without retries. Application
behavior was not changed to accommodate the selector. All payment/customer
assertions remain, including the collection-off owner/admin cases.

| Gate | Latest local refinement evidence |
| --- | --- |
| Lint | Pass; no errors, 15 existing warnings |
| Format | Formatter run before gates; final format check passes |
| App/Edge types | Both pass |
| Unit/component | 165 files, 2,187 tests pass |
| Contrast | 64 pairs pass AA in both themes |
| Build | Explicit final production build passes, including generated PWA assets |
| Demo browser | 294 pass without retries; untouched order/edit followed by identify or Skip passes on phone and desktop |
| Database | Fresh reset; 76 files, 2,990 assertions pass |
| HTTP/RLS | All six phases pass, 283 tests; existing real offline/replay receipt and points proof remains green |
| Real-account browser | 34 pass, including real offline and two-tablet settlement |
| Schema parity | Regenerated content matches the tracked schema exactly; no schema file changes |
| Visual | Own preview on 7413; 390×844 and 1024×768 in light and dark; optional composer and missing-number payment prompt inspected; normal viewport and original dark theme restored |

The read-only production points check still returned only historical identified
bill 199, without an earned entry or automatic receipt job. Task 8 remains open;
no synthetic production sale, adjustment, backfill or extra SMS was created.
Browser proof images are outside Git as `optional-ordering-review-light.png`
and `optional-ordering-review-dark.png` in the temporary directory. The review
tab was then reloaded onto the explicit final build (`index-B2qGphvU.js`), where
untouched customer entry and an enabled Order were confirmed with no console
errors. `optional-ordering-review-final.png` captures that final review state.
This latest
refinement remains local for review; no commit, push or deployment was performed.

## Optional ordering approval and release — 4 October 2026

After reviewing the verified local preview, the owner stated "Looks good to me,
we can deploy". Task 12 is complete and commit, push and gated deployment are
authorized. Eleven of twelve numbered tasks are complete; task 8 still awaits a
genuine eligible production bill. The local evidence above applies to the
approved application bytes; only approval documentation changed afterwards.
Production release evidence will be recorded after the gated deployment succeeds.

At the owner's request, the two earlier session commits carrying a generic
Codex GPT-6 trailer were corrected to Codex GPT-6.1 Sol before this release:
`6d4dd594` is now `c36de00c`, and `69816892` is now `f194da57`. Their file trees,
author/committer facts and dates are identical; only the trailers and resulting
commit identities changed. Earlier deployed build stamps and CI links above
retain the original identities because those are what production actually ran.
The receipt and landing commits from this session already carried the requested
attribution. Other agents' commits were not reattributed.
