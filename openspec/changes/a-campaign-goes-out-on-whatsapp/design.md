# Design: a-campaign-goes-out-on-whatsapp

Read `proposal.md` first. This file is how, what was rejected, and the reasons
the owner gave, because the session that builds this will not have the
conversation that designed it.

## The shape in one paragraph

The app never sends. It writes rows: a campaign, its recipients cut into
batches, and a few settings. A program on the owner's laptop, **the sender**,
signs in to Supabase as the owner, holds a WhatsApp linked-device connection
through Baileys, and once a minute asks the database what to do. When the owner
releases a batch on the laptop, the sender takes one recipient at a time,
sends, and reports. The app's pages read those rows. The queue is the contract
between the two; neither knows anything else about the other.

## D1. Why the sender is outside Supabase

Baileys is a WhatsApp Web client: one long-lived WebSocket, held for as long as
messages are being sent, with key material that changes as it is used. A
Supabase Edge Function is stopped after a few minutes of wall time. A campaign
batch is 100 minutes. So the sender cannot be a function, and the free plan has
nothing else that runs.

## D2. Where the sender runs: rejected alternatives

The owner chose their own everyday Windows laptop (proposal, decision 2). What
was considered, in the order it came up:

| Alternative | Why not |
|---|---|
| A Supabase Edge Function | D1. |
| A script the owner runs by hand when the partner sends material | The owner's own "last resort". It works, and it is what the sender is underneath; the app half is what makes it the partner's tool and not the owner's chore. |
| A spare laptop left on | The owner cannot keep one reliably on, and did not want a second machine to mind. |
| An old Android phone (Termux) on a charger | Kept as the fallback. The owner has one (Android 11 or 12). Fiddlier to set up; Android kills background work. |
| GitHub Actions started by the app | Cloud addresses look less like a person; this repository's logs are public, so every number would need masking; jobs end at six hours; arguably outside GitHub's terms for Actions. |
| A free cloud VM | A cloud address again, and the WhatsApp login would sit on a machine nobody watches. |
| The partner's laptop, as a packaged program | The owner's "later" (decision 8). The partner works from a phone. It becomes the first thing to try if sending from Los Angeles goes badly (proposal, open question C), so D12 keeps the sender portable. |
| The partner's phone browser as the sender | A browser cannot open WhatsApp's socket: it refuses other origins. |

## D3. The sender is a separate package in this repository

`tools/campaign-sender/`, with its own `package.json` and lockfile. Baileys and
its dependencies never enter the PWA's dependency tree or bundle. The parts
with decisions in them (the state machine, pacing, the sending window, resume,
halt, STOP matching, message rendering) are plain TypeScript modules behind two
interfaces, `WhatsAppLink` and `CampaignQueue`, so the root `npm test` covers
them with fakes and CI never needs WhatsApp. The Baileys adapter is the thin
part nothing in CI runs; it is exercised by the staging rehearsal (tasks 6).

**Check Baileys' current documentation before writing the adapter**, not
memory: the package name, the pairing-code call, the auth-state store, the
disconnect reason codes and the receipt events have all changed between major
versions.

`shared/` already holds code both the app and the database tests use. The
message renderer (`{name}`, the stop line, WhatsApp formatting to preview HTML)
goes there, so the bubble the partner sees and the text the sender sends are
one function.

## D4. The sender signs in as the owner, with no new kind of credential

`scripts/paper-sales.mjs` already does this: it signs in as the person entering,
so authority is the caller's own token and the record of who did it is true by
construction. The sender does the same. On first run it asks for the owner's
username and password in its terminal, and supabase-js keeps the session in a
file in the sender's data folder. Every database call is then an owner call,
refused for anybody else by `app_is_owner()`.

Rejected:

- **The service-role key on the laptop.** It would work and is far more than a
  sender needs. AGENTS.md keeps that key in Edge Functions.
- **A sender secret checked by functions granted to `anon`.** A new credential
  type and an unauthenticated door onto customers' numbers, to save typing a
  password once.
- **A device session like the counter tablet's.** The right idea for a machine
  that is not a person's. This machine is a person's, and decision 8's second
  sender would be the partner's own, signed in as the partner.

The data folder (`%LOCALAPPDATA%\shawarmania-campaign-sender\`) holds the
Supabase session and the WhatsApp auth state. **Whoever copies the WhatsApp
auth state has the business account.** It is never in the repository, never
synced to a cloud drive (the runbook says to check OneDrive is not mirroring
it), and never logged.

## D5. Data model

All new. All business-wide, not outlet-scoped: a campaign belongs to the
business and its audience is drawn from the one global customer directory. Each
is classified in `supabase/tests/01_schema_coverage.sql` beside `customers`,
with RLS enabled, **no policy for any client role**, and every read and write
through `security definer` functions that begin with `app_is_owner()`. That is
the pattern `customers` already uses and for the same reason: a policy on a
business-wide table is one predicate away from a manager reading it.

- **`marketing_campaigns`** — `id`, `name`, `body`, `image_path` (nullable),
  `audience` (jsonb: the outlet, the filters and the sort as chosen),
  `batch_size` (snapshotted at scheduling), `state` (`draft`, `scheduled`,
  `paused`, `stopped`, `done`), `paused_reason` (nullable; set when the sender
  pauses the campaign itself, D6), `not_before` (timestamptz, nullable),
  `created_by`, `created_at`, `scheduled_by`, `scheduled_at`, `finished_at`.
- **`marketing_campaign_batches`** — `campaign_id`, `batch_no`, `state`
  (`waiting`, `released`, `done`), `released_by`, `released_at`, `finished_at`.
- **`marketing_campaign_recipients`** — `campaign_id`, `customer_id`,
  `batch_no`, `position`, `state` (`waiting`, `sending`, `sent`, `unsure`,
  `failed`, `not_on_whatsapp`, `stopped`), `claimed_at`, `sent_at`,
  `delivered_at`, `read_at`, `wa_message_id`, `failure_code`. Unique on
  (`campaign_id`, `customer_id`).
  **No phone and no name column.** #59's delivery jobs hold neither, and the
  same argument applies: the row points at the customer, and the number is read
  at the moment of sending. A number corrected or a customer stopped between
  scheduling and sending is then honoured without anybody remembering to
  re-cut the audience.
- **`marketing_stopped`** — `customer_id` (primary key), `stopped_at`, `source`
  (`reply`, `owner`), `campaign_id` (nullable), `recorded_by` (nullable).
  Removing a customer from the list deletes the row; the list is small and its
  history is not worth a table.
- **`marketing_sender`** — one row. What the sender last said about itself:
  `last_seen_at`, `status` (`idle`, `sending`, `outside_hours`, `not_linked`,
  `halted`), `halt_reason`, `linked_number_last4`. Nothing about linking is
  kept here: the QR code is shown by the sender's own page and never passes
  through the database (D9). And the owner's settings: `batch_size`
  (default 100), `window_start`, `window_end` (default 10:00 and 21:00,
  Asia/Kolkata), `min_gap_seconds`, `max_gap_seconds` (default 45 and 90).
- **Storage bucket `campaign-images`**, private, owner-only, as the statement
  bucket is. The claim hands the sender the image's path, and the sender asks
  storage for a short-lived signed address with the owner's own session (see
  *The database, built*: the database cannot sign one itself).

The audience at scheduling: `schedule_campaign` evaluates the filters once,
inserts one recipient row per matching customer in the chosen order, numbers
the batches, and stores how it was asked. What the partner saw counted is what
was cut. Customers on the stopped list are excluded there, and again at claim.

## D6. The sender's loop, and what "resume" means exactly

*Rewritten on 2026-11-17, when the loop was built and rehearsed (task 4.2). The
loop is `tools/campaign-sender/src/core/sending-loop.ts`; what it asks of the
database is the `CampaignQueue` interface in `core/contracts.ts`, and **the
functions below are that interface, one for one.** The first version of this
section listed four of the seven and left out what three of them return.*

One function, `campaign_sender_tick(status, halt_reason)`, is the heartbeat and
the question. It records `last_seen_at` and the status, and returns:

- the contract version (D14) and whether this installation must stand down
  (D12);
- the two gap settings;
- **the sending window as the database's clock reads it**: open or not, and if
  not, the instant it next opens. The sender never asks its own clock whether
  it is daytime in India; it uses its clock only to count down to that instant;
- the batch that is released and may be sent now, if any. A paused or stopped
  campaign has none;
- **the next batch waiting to be released, if any**, with its campaign's name
  and how many people are in it. This is what the laptop's notification is
  about and what its Send batch page shows (D7); the sender learns of a new
  campaign from this and from nowhere else. None while a batch is released;
- how many messages were sent today, India's day, and when the last batch
  finished: the two figures D7 puts beside Send batch;
- whether any campaign is scheduled or paused.

It is asked **once before every recipient** while a batch is sending (which is
about once a minute), once a minute while a campaign is scheduled or paused
and nothing is released, and once every five minutes otherwise: nothing open,
or outside the window. It is not asked at all while WhatsApp is disconnected,
so the app then reads the sender as last seen some minutes ago, which is true
of its ability to send. Supabase's log allowance is mostly request lines
(`supabase-log-volume`, October 2026), so the idle rate is deliberately slow,
a recipient costs three requests (tick, claim, report), and there is no
realtime subscription.

Within a released batch, per recipient:

1. The sender waits out the gap (step 6) and only then ticks, so the answer it
   acts on is fresh: a pause, a stop or the window closing during the wait is
   obeyed before the next message.
2. `campaign_claim_next(campaign_id, batch_no)` — in one statement, picks the
   lowest-position `waiting` row, skips and marks `stopped` anybody now on the
   stopped list, sets `sending` and `claimed_at`, and returns the row's
   reference (campaign, batch, customer, position), the customer's phone and
   name, the body and the image's path. It answers one of three ways:
   a recipient; *nothing*, when nobody is left waiting in the batch; or
   *refused*, with why: `paused`, `stopped`, `not_released`, `outside_window`
   (with the instant it opens) or `claim_in_flight` (a row is already
   `sending`, so strictly one at a time is the database's rule and not only
   the sender's habit). **This is the only place a phone leaves the database**,
   one at a time, to an owner's session.
3. The sender checks the number is on WhatsApp; if not, reports
   `not_on_whatsapp` and moves on without waiting.
4. It sends.
5. `campaign_report_result(recipient, state, message_id or failure_code)`
   records `sent`, `failed` or `not_on_whatsapp` on a row that is `sending`,
   and says whether it did. The same report arriving twice is accepted (its
   first answer may have been lost on the way back); a report for a row that
   is not this claim's is refused and changes nothing.
6. It waits a random gap between the two settings. **The gap is also waited
   before the first message of a run and after every reconnect**: the sender
   cannot know how long ago the last message went once it has restarted, and a
   reconnect is not a licence to send at once.

What a claimed recipient can come to:

| What happened | Recorded as | Wait before the next |
|---|---|---|
| The number is not on WhatsApp | `not_on_whatsapp` | none |
| The lookup failed, or the message could not be put together (the image would not download) | `failed`, `lookup_failed` or `compose_failed`: nothing left the laptop | none |
| WhatsApp took the message | `sent`, with its id | the gap |
| It is certain the message did not go (the image upload failed) | `failed`, with a short code | the gap |
| The send failed and nobody can say whether it went | nothing: the row stays `sending`, and becomes `unsure` before anybody else is claimed | the gap |
| WhatsApp refused the message after taking it | `sent` first, then `failed` with WhatsApp's code, by `campaign_report_receipts` | — |

**`sent` means handed to WhatsApp, not accepted by it.** Baileys returns from a
send as soon as the message is written to the connection; WhatsApp's answer
comes afterwards. A refusal arrives as a receipt, `rejected`, with a code, and
`campaign_report_receipts` then turns that row from `sent` to `failed`.

**Resume.** Whenever the sender cannot be sure it holds no unsettled recipient,
it calls `campaign_release_stale_claims()` before claiming anybody: every row
still `sending` becomes `unsure`, and the function says how many. That is on
start, on every reconnect, after a send nobody can vouch for, after a claim
whose answer was lost on the way back, and when a claim is refused as
`claim_in_flight`. There can be at most one such row, because the loop is
strictly one at a time. The sender then continues with the next `waiting` row.
It never retries an `unsure` row, and no button does either [owner agreed: one
customer missing an offer is better than one getting it twice].

**A result the database could not be told is not thrown away.** If the message
went and the report failed because the network was down, the sender keeps the
result, retries it with growing waits, and asks the database nothing else
until it is recorded. Only a process that dies between the send and the report
leaves that recipient `unsure`.

Rejected: asking WhatsApp whether the message arrived before deciding. The
linked-device protocol gives no dependable answer for a message whose send was
interrupted, and a wrong "no" is a duplicate.

**Three sends in a row that went wrong pause the campaign**, and the sender is
what pauses it: it calls the same pause the owners use, with a reason
(`three_in_a_row`) that the campaign's page shows. "Went wrong" is a `failed`,
a send nobody can vouch for, or a message refused after it was taken; a number
not on WhatsApp is neither trouble nor a success and does not count either
way. The count is the sender's own and starts again when it restarts. That
pattern is more likely trouble than bad numbers.

Delivery and read receipts arrive later as events, and so do refusals. The
sender reports them in small groups (`campaign_report_receipts`), keyed by
message id, each time it is about to tick and once more as it stops. A `read`
may arrive with no `delivered` before it, so a `read` also fills
`delivered_at` when that is empty. They are counts for the owners, not proof. **It reports only receipts for campaign
messages one could still change**, which it learns by asking
`campaign_outstanding_message_ids()` each time WhatsApp connects: the ids of
`sent` rows not yet read. Everything else WhatsApp says about the account's
messages, which is nearly all of it, is dropped on the laptop.

## D7. Releasing, pausing, stopping

- **Release is the sender's page only** [owner, decision 5]. The sender serves
  one page on `127.0.0.1` at a fixed port (add it to `ports.ts`; not the
  linking page's port, D9). It shows the
  sender's state, the waiting campaign and batch, how many were sent today and
  when the last batch finished, and **Send batch**. Pressing it calls
  `release_campaign_batch` with the owner's token. The app's campaign page
  shows that a batch is waiting and says where it is released; it has no
  release button. This is what makes "the owner is in the loop for every
  hundred" true whoever else is an owner.
- **A pinned card and a tray icon, not a Windows notification** [owner,
  2026-11-18; the first version of this point said a toast was enough]. An
  ordinary notification slides away in seconds and, raised from a script, is
  labelled "Windows PowerShell". So the sender has a small helper of its own
  (`windows/tray.ps1`, Windows' own WinForms, nothing installed). It keeps an
  icon in the tray for as long as the sender runs, coloured by what the sender
  is doing, and pins a card above the taskbar when a batch is waiting for
  release, when a batch finishes, when the sender pauses a campaign, and when
  it halts. **The card stays until Open or Later is pressed**, sits on top of
  everything and never takes the keyboard. Later puts that one piece of news
  away; the next brings the card back, and a click on the icon brings the
  current one back at any time. **The card has no Send button**: Open goes to
  the page, and the button is there, so a stray click on a card that is always
  on top cannot send a hundred messages. No icon means no sender.
- **Start with Windows**: a Task Scheduler task at logon, created by the
  sender's install command. The laptop is not asked to stay awake; sleeping is
  the normal case.
- **Pause and Stop** are functions any owner calls from the app. Pause is
  undone by Resume. Stop is final for that campaign: its remaining `waiting`
  rows stay as they are and are reported as not sent.
- **One batch at a time across all campaigns.** A second campaign scheduled
  while one is sending waits its turn.

## D8. The sending window and two time zones

The window is the customers' clock: 10:00 to 21:00 Asia/Kolkata, checked in the
database at claim, so a wrong clock on the laptop cannot message anybody at
night. For the owner in Los Angeles that is roughly 20:30 to 07:30 Pacific in
winter. A batch released in the owner's evening lands in India's late morning,
which suits a food offer. The sender's page shows India's time beside the
window and, outside it, when it next opens. A batch released outside the window
simply starts when it opens, if the laptop is awake then.

## D9. Linking with the phone in another country

*Rewritten on 2026-11-18, the day the business number was linked. The first
version of this section linked by a pairing code the partner types, shown on
the Campaigns page. That is gone: see* The business number, linked by QR code
*at the end, and the proposal's decision 9.*

**Linking is by QR code, and only by QR code** [owner, 2026-11-18]. The
business phone is with the partner in India; the laptop is with the owner in
Los Angeles. The partner cannot see the laptop's screen, and WhatsApp replaces
a QR code every 20 to 60 seconds, so a picture of one is stale before he can
open it. So the code is shown on a page that keeps up, and the page is what is
shared.

Flow: `npm run link` asks WhatsApp for a QR code and serves one page on
`127.0.0.1` (port `campaignSenderLink` in `ports.ts`), which it opens in the
laptop's browser. The page shows the current code and reloads itself every two
seconds; the sender replaces what it shows each time WhatsApp issues a new
code, and replaces the code with the word Linked the moment the link is made.
Somebody with the phone in the same room scans it off the screen. **For a phone
somewhere else, the owner points a temporary tunnel at that port and sends the
partner its address**; he opens it on any other screen and scans. The tunnel is
closed as soon as the link is made.

- **Whoever scans the code links *their own* WhatsApp account to this laptop.**
  A stranger who found the page could not take the business account, but could
  put a wrong account on the sender. So the page is on the laptop only, a
  tunnel to it is deliberate and short, and its address goes to one person.
- **The linking page has a port of its own and must keep it.** A tunnel makes a
  whole port public. The page where a batch is released (D7) is a different
  page on a different port, so that showing somebody a QR code can never also
  show them a Send button.
- **Nothing about linking passes through the database or the app.** The
  Campaigns page says whether the sender is linked and that linking is done on
  the laptop; it shows no code. Showing the QR inside the Campaigns page, so
  that no tunnel is needed, is possible later and is not built or decided.
- A run of `npm run link` keeps offering codes for about twenty minutes, then
  stops and asks to be started again.

The same flow re-links after WhatsApp drops the device (it does after long
disuse, or when the phone removes it).

## D10. Stopping for good, and what a ban looks like

The sender treats three things as "stop and stay stopped": WhatsApp closing the
connection as logged out, as forbidden or banned, and any restriction notice
Baileys surfaces. On any of them it sets `halted` with the reason, in its own
data folder first and then in the database, raises the notification, and
refuses every claim until the owner presses **Restart sender** on its page and
confirms. An ordinary dropped connection is not a halt; it reconnects with
growing waits.

Why local first: a halted sender that cannot reach Supabase must still not
send when it wakes.

**A restriction does not close the connection**, so it is not one of the
closes above (found in Baileys' source, 2026-11-17; see *The sending loop,
rehearsed*). WhatsApp says it in one of two ways while the connection stays
up: a notice that the account may not send (`reachoutTimeLock`), or a refusal
of one message with code 463. On either, the sender closes the connection
itself and halts with the reason `restricted`.

The runbook (tasks 7) records what the owner was told on 2026-11-16, labelled
as belief and to be checked against WhatsApp's own help pages when written: a
first restriction is usually temporary with a countdown on the phone and
nothing to do but wait and not reconnect an unofficial client; a permanent ban
shows *Request a review* on the phone; a refused review has no real appeal.
Before the first campaign: chat backup on, on the business phone.

## D11. A linked device sees the account's chats

*Superseded in part on 2026-11-20 (No stop line, below): the sender now reads
no incoming message at all.*

WhatsApp delivers the account's incoming messages to every linked device. The
sender is configured not to sync history, keeps no message store, logs no
message content and no number, and inspects an incoming message only to answer
one question: is this a text from a customer who is a recipient of a campaign
in the last 30 days, and is it the word STOP (trimmed, any case)? If so it
calls `campaign_record_stop(phone)`, which resolves the customer in the
database. Everything else is dropped unread. The number itself is passed to the
database and not written to the laptop.

`{name}`: a customer's saved name is the customer's own name (#56), so it is
safe to greet with. Customers saved before #56 may carry an order label; the
audience look-through shows names so the partner sees what would be sent, and a
campaign may be written without `{name}`.

## D12. Moving the sender

Everything a sender is lives in its data folder and one package. Installing on
another Windows machine is: clone, `npm ci` in `tools/campaign-sender`, run the
install command, sign in, link. Two senders at once are refused by the
database: `campaign_sender_tick` carries an installation id, and a second id
while the first was seen in the last ten minutes gets told to stand down. That
is the whole of what decision 8 needs later.

## D13. Tenancy, money, offline

- **RLS.** Five business-wide tables with RLS on and no client policy;
  owner-only `security definer` functions with a fixed `search_path`; execute
  revoked from `anon` and granted to `authenticated` with the owner check
  inside. `supabase/tests/01_schema_coverage.sql` classifies each. A hand-made
  request from a Franchise Admin, a Biller, an Employee and a counter device is
  refused on every table and every function, in pgTAP and in `test:rls`.
  **The audience functions are the first to list customers by behaviour**, so
  their tests also assert they return nothing that is not asked for: counts,
  and for the look-through a page of names with the last four digits, never a
  full number. A full number is returned only by `campaign_claim_next`.
- **Money.** The spend filter compares integer paise summed from settled,
  uncancelled bills at the chosen outlet. Nothing is stored and nothing is
  divided.
- **Offline.** The Campaigns pages are online-only and say so; there is no
  outbox work. The sender's offline behaviour is D6.
- **Business dates.** "Within N days" is counted on `bills.business_date`
  against the outlet's current business date, never on a timestamp.

## D14. Version skew

Every database object here is new: five tables, their functions, one bucket.
A build published before this change calls none of them and reads none of
them, so it runs unchanged whether or not the migration is applied. Nothing
existing is replaced, altered, dropped or given a trigger or policy; no
existing row is updated. The audience functions read `customers`, `bills` and
`customer_memberships` and write nothing to them.

There is no change gate (proposal, *Change gate*). Reverting the build leaves
the tables and any campaign rows in place, read by nothing; a campaign that was
mid-batch stays as its rows say, and the sender, which is not part of the web
build, would still act on a released batch. So **the revert procedure is two
steps and the runbook says so: Stop the campaign in the app or quit the sender,
then revert.** A sender older or newer than the database is handled by
`campaign_sender_tick` returning a contract version; a sender that does not
recognise it stops and says it needs updating.

## D15. Demo

The surface ships `demo` first with a mock adapter typed from the generated
schema types: three campaigns (one done with receipts, one mid-batch, one
draft), a sender line that can be shown online, offline since yesterday, and
halted, and audience counts over the demo's existing customers. The demo sends
nothing and links nothing, and shows no code of any kind. The owner approves
the pages there before the live adapter is written, as #81 and #83 did.

## UI notes for the session that builds it

Phone first; the partner uses nothing else. Follow the owner's conventions
recorded for earlier owner pages: a list page and a page of its own per
campaign, as Team does; tiles for figures and no sentences where a tile will
do; buttons that are one verb; no subtitle under a heading; a coloured dot only
for a live state (the sender line qualifies). One centred column,
`mx-auto max-w-2xl`. Shared pieces before new ones: `FormSheet` for the
filters, `ConfirmDialog` for Schedule and Stop, the toast, the loading shimmer
shaped like the page it stands in for.

```
Campaigns                                  [+]
● Sender online · batch 3 waiting on the laptop

Diwali offer            sending  300 / 1,000
Weekend combo           done     412 / 418
New menu                draft

Stopped (7)                                 ›
```

```
‹ Diwali offer                       [Pause]
[ 300 sent ][ 700 to go ][ 4 stopped ]

Batch 1   done      98 delivered · 61 read
Batch 2   done      97 delivered · 55 read
Batch 3   waiting   release on the laptop
Batch 4   waiting
```

The composer shows the message as a WhatsApp bubble under the text box, updated
as it is typed, in both themes. The WhatsApp green already has an AA-passing
token from #63; add no colour.

## Baileys as found (task 0.2, 2026-11-17)

Read from the installed package's own types and source, because the project's
documentation site was returning 404 for its migration and connecting pages on
the day.

- **Package and version.** `baileys` on npm, pinned exactly at `7.0.0-rc14`
  (published 2026-07-29). `@whiskeysockets/baileys` is the same code from the
  same repository under a second name. It is ESM only and needs Node 20 or
  later; the sender asks for 22.6 or later so it can run its TypeScript
  directly. 7.x has been a release candidate for a long time and is what the
  project's own README describes; `6.7.24` is the `legacy` tag.
- **A completed link is `creds.account`**, which only a successful pairing
  sets. `creds.registered` and `creds.me` are both written earlier, while a
  code is still waiting to be typed, so neither says the device is linked.
- *(The next two points are about linking by pairing code, which was removed
  on 2026-11-18. Linking is by QR code: D9.)*
- **A pairing code is asked for once the socket has offered its first QR
  reference**, with the number as digits and country code. The references run
  out after about two and a half minutes and the socket closes with 408; the
  sender then offers a fresh code, four attempts at most.
- **Each pairing attempt must start from an empty login.** Asking for a code
  writes `creds.me`, and Baileys opens every later connection for a login that
  has `me` as a *login*, which WhatsApp refuses until the code is typed. The
  first version of the sender reused the login, so a second code would have
  been refused and read as "logged out". Found in review, before any phone was
  linked. A refusal while pairing is a failed attempt, never a halt.
- **WhatsApp closes with 515 straight after a link** and expects a reconnect.
  That is the one `restart`; it is not a drop and not a halt.
- **What halts is decided by who closed the connection, not by the number**
  (D10). Baileys reports **500 for any fault it cannot name** — a Wi-Fi sign-in
  page answering the connection, a wrong clock after waking, a TLS fault — and
  passes a proxy's own HTTP 403 through as 403. The first version halted on
  the number and would have told the owner to unlink a healthy link from a
  hotel network. So `core/disconnect.ts` reads the wording Baileys gives each
  origin: `Connection Failure` is WhatsApp refusing the login (401, 403 and any
  other 4xx halt; 5xx reconnects); `Stream Errored` is WhatsApp ending a live
  connection (401, 403 and 440 halt; 515 restarts); **anything from the socket,
  the network or a timer reconnects, whatever its number.** 440 halts although
  Baileys' README reconnects on it: it means another program holds this
  device's login, and two senders reconnecting each other is the loop to avoid.
  No halt message tells the owner to unlink without first checking Linked
  devices on the phone.
- **The built-in WhatsApp version is used**, as WAP Brain does. If WhatsApp
  refuses it (405), the sender looks up the current one once and retries; a
  second refusal says the sender needs updating. On 2026-11-17 the built-in
  version was accepted from this laptop (`npm run check`).
- **A connection must stay up a minute before the next drop resets the wait**,
  so a login WhatsApp accepts and then closes is not retried every two seconds.
- **`markOnlineOnConnect: false`** is set. Left at its default, a linked device
  marks the account online and the business phone stops notifying for
  customers' messages. Nobody had asked for this; the partner would have found
  out by missing messages.
- **History.** `syncFullHistory: false`, and the recent-history sync left at
  Baileys' default. Turning it off entirely was tried and withdrawn: Baileys
  warns that it then never learns the account's LID mappings, "leading to
  instability and session errors". So recent history does pass through the
  sender's memory. **This narrows D11's "discards unread" to "keeps nothing":**
  no listener receives it, no message store exists, and the logger is silent.
- **The login file is the thing to protect** (lesson from the owner's WAP Brain
  project, `make-live-sync-trustworthy`, met there on a real device). Baileys
  writes `creds.json` in place, and a process killed mid-write leaves it empty,
  which forces a re-link. The sender never calls Baileys' `saveCreds`. It keeps
  the login in memory across reconnects, saves it by writing a temporary file
  and renaming it over the real one, copies it to `creds.json.bak` each time a
  connection opens, and restores from that copy on start if the file is
  missing or unreadable (`core/creds-file.ts`). Baileys still writes its
  signal-key files in place; a damaged one reads as absent and costs a
  re-negotiated session, not the link.
- **`printQRInTerminal` is deprecated** and unused.
- **Version 7 addresses people by LID as well as by phone number.** An incoming
  message may name its sender by a LID, with the phone number in an alternate
  field. D11's STOP matching must resolve the sender through what Baileys gives
  for that (the alternate JID on the message key, or its LID mapping), and
  `campaign_record_stop` must be given a phone number, never a LID. **Not yet
  read in detail; task 4.3 must, before any STOP handling is written.**
- **Its README says, in its own words, that the maintainers discourage bulk or
  automated messaging.** That is the risk the owner accepted (proposal,
  decision 3), restated by the library itself.

**As built for task 0.3**, in `tools/campaign-sender/`: `core/` holds the
decisions (what a disconnect means, reconnect waits, the pairing-code text
rules, the data folder and the halt record) and is covered by the root
`npm test` and `npm run typecheck`. `whatsapp-link.ts` is the Baileys adapter
and `main.ts` the command line (`check`, `link`, `start`, `status`, `restart`,
`unlink`); both are type-checked by the package's own `npm run typecheck`,
which CI does not run because CI does not install the package. **Nothing in it
can send a message or reads one.** The pairing code is printed in the terminal
for now; showing it in the app is D9 and comes with the database. `check`
opens a connection with a throwaway login and hangs up when WhatsApp offers to
pair: it proves the laptop and the version are accepted without touching any
account. Only one of `link`, `start` and `unlink` runs at a time
(`core/single-instance.ts`).

**Reviewed twice before any phone was linked** (2026-11-17): by the author
against Baileys' source and WAP Brain's client, then by a separate reviewer
given the code and no conclusions. The second found the 500 misreading above,
an unreadable halt record advising an unlink, a two-second retry loop,
`status` writing to the login folder while another window was connected, and a
lock a closed window never released. All are fixed and pinned by tests in
`core/`. **Rehearse the link on the owner's own WhatsApp number first** [owner,
2026-11-17: the partner is not to be asked for a code twice].

## The rehearsal on the owner's own number (2026-11-17)

Run before the partner is asked for anything, on the owner's personal WhatsApp,
with the agent reading the terminal. What it proved, and what it changed:

| Tried | Result |
|---|---|
| `check` from this laptop | WhatsApp accepted the built-in version and offered to pair |
| First link, plain device name | Linked on the first code; login and backup saved; no temporary file left |
| Ctrl+C, then `start` | Stopped cleanly; reconnected with no code |
| Device removed on the phone while connected | `HALTED`, reason logged out; a second `start` refused |
| `unlink` | Login, backup and halt gone |
| Code left untyped | A new code issued by itself, after roughly four minutes rather than the two and a half the QR timers suggest |
| Link with the device named "Shawarmania Ops" | **Four codes in a row refused by the phone** |
| Link again with the plain name | Linked on the first code |

- *(This point and the next were written while linking was by pairing code,
  which was removed on 2026-11-18: D9. The name is still the plain one, and a
  custom name by QR code has not been tried.)*
- **The device name must stay `Browsers.windows('Chrome')`.** The owner asked
  for the phone to show which link this is. Baileys sends the first element of
  `browser` as free text and WAP Brain sets its own there, but WAP Brain links
  by QR. By pairing code, the plain name linked on the first code twice and the
  custom name was refused four times out of four, same number, same laptop,
  same evening. Pairing code is the only way to link a phone in another country
  (D9), so the phone shows "Google Chrome (Windows)" and that is accepted
  [owner told, 2026-11-17]. Not established: whether another standard name
  would also pair. Nobody should find out on the partner's phone.
- **A refused code is not retried.** A code typed wrongly once was then refused
  when typed correctly. Whether WhatsApp spends a code on a wrong attempt was
  not established; the terminal now says to wait for the next code, and prints
  when each was issued.
- **The sender's folder does hold phone numbers. D4 and D11 said it would
  not.** With history sync at Baileys' default, Baileys wrote about 2,400
  `lid-mapping-*` files for the owner's account, which pair each contact's
  phone number with WhatsApp's internal id for them. For the business account
  that is its customers and everyone else it has chatted with. Baileys needs
  them (see *History* above), and task 4.3's STOP matching will too. So the
  rule is restated: **the sender writes no number, name or message of its own
  and logs none; Baileys' login folder holds the account's contact-id mappings,
  and is guarded as the login is** — on the laptop only, outside the
  repository and any synced folder, removed whole by `unlink`.
  `docs/SECURITY_AND_PRIVACY.md` must say this when it is written (task 6.1).
- **Also passed, after the table above was written:** a closed lid for some
  minutes (on waking, `Connection lost (428)`, reconnected two seconds later
  with no code), and the terminal window closed while connected (the process
  killed with no warning: login and backup both intact, the lock it left behind
  taken over, reconnected with no code).
- **Still to run on the owner's number before the business link:** a night left
  alone.

## The first real sends (2026-11-17)

From the owner's personal number, linked as above, to the owner's own second
number in India, through `npm run test-send`: one fixed message to one typed
number, sent only after the word SEND is typed. Three messages in all, one of
them an image with a caption. All three arrived.

- **Text with WhatsApp formatting and an image with a caption both send** with
  `sendMessage`, to the address `onWhatsApp` returns for the number.
- **A receipt can arrive in a later run, and before the connection reads as
  open.** The first two messages went to a phone that was offline; neither
  reported anything in 45 seconds. Both reported `delivered` at the very start
  of the next run, ahead of the `open` event. So: the status listener is
  attached when the socket is made and holds what arrives until something asks
  for it; and **the campaign must match receipts by message id against the
  database, whenever they come, including for a batch that finished yesterday**
  (`campaign_report_receipts`, D6, already keyed that way). A per-batch
  "delivered" count is therefore a figure that keeps rising after the batch is
  done, and the page should not present it as final.
- **`read` was not exercised.** It needs the other phone to open the chat with
  read receipts on.
- **`libsignal` prints key material.** Underneath Baileys it reports with
  `console.*`, round Baileys' silenced logger, and on the first send printed a
  closed session's record, private keys included, to the terminal. `main.ts`
  now replaces every `console` method with a no-op before anything runs, and
  prints only through its own `say`. **Any other entry point to the sender (the
  local page in D7, a test harness) must do the same**, or run the sender as a
  child whose output it discards.
- **A number is sent to as a phone-number address even though version 7 knows
  the contact by LID.** That worked here. Incoming messages, which STOP needs,
  carry the sender as `key.remoteJid`, with the phone-number form in
  `key.remoteJidAlt` when the first is a LID, and
  `signalRepository.lidMapping.getPNForLID` as the fallback. Read from the
  types; not yet exercised (task 4.3).
- `CAMPAIGN_SENDER_TRACE=receipts` prints each status event as the last four
  characters of a message id and its numbers, for the next time a receipt is
  not counted.
- **`read` works, and needs read receipts on at both ends** (tested later the
  same evening, after the owner turned them on in both accounts for the test):
  a message reported `delivered` at 22:07 and `read` at 22:09, when the chat
  was opened on the other phone. With them off on either phone nothing past
  `delivered` ever arrives. **So the campaign page's Read figure is a floor,
  not a count**: it is nought if the business account has read receipts off,
  and it leaves out every customer who has them off. `delivered` is the figure
  to rely on. The page should say so beside the tile, and the runbook should
  have the partner check the business account's setting (Settings → Privacy →
  Read receipts) before the first campaign.
- **Most status events are not about campaign messages.** In that one run
  WhatsApp sent about 3,800 `read` events for messages other people had sent
  the account, plus dozens for the account's own old messages, against two for
  the test message. The listener already drops everything not sent from this
  account; **task 4.3 must also drop every id that is not a campaign message
  still awaiting a receipt, on the laptop, before anything is reported to the
  database** — by asking the database for the outstanding ids, not by sending
  it every id seen.

## The sending loop, rehearsed (2026-11-17)

Task 4.2, with the part of 4.3 it needed. Built tests first, then run for real
from the owner's personal number, still linked as above, to the owner's own
second number and to nobody else. Ten messages in all.

**As built.** `core/contracts.ts` declares the two interfaces D3 names.
`WhatsAppLink` is the linked device: hold it, be told each time a connection
opens or closes, and through an open one look a number up, send, and hear
receipts. `CampaignQueue` is the database, function for function as D6 now
lists them. `core/sending-loop.ts` is the loop, driven by those two, a clock
and a source of randomness, and it has no way to print or to write a file (a
test reads its source to hold it to that). `whatsapp-link.ts` gives the loop
the real link through `whatsAppLink`. **No real queue exists yet**, so nothing
can send a campaign.

**`npm run rehearse`** runs that loop over the real link against
`core/rehearsal-queue.ts`: a stand-in for the database kept in one file,
`REHEARSAL-QUEUE.json`, in the sender's folder. It answers as D6 says the
database will, and the loop's unit tests run against the same code held in
memory, so it is the fake task 5.3 means when it says to fix the fakes. Three
things keep a rehearsal from ever being a campaign:

- the queue file holds no phone number. Every row is sent to the one number in
  `test-recipient.txt` in the sender's folder, read at the moment of the claim;
- `core/rehearsal-guard.ts` sits between the loop and WhatsApp and lets a
  message go to that number only, whatever the queue asks for;
- it refuses to run on a laptop signed in to the real queue (the sign-in file
  of task 4.4, whose name is fixed now in `core/data-folder.ts` so this can
  ask).

The queue file is read afresh for every question, so changing its campaign's
state by hand while a rehearsal runs is how that campaign is paused, resumed
or stopped. An `absent` row looks up a number from the range kept for fiction
and sends nothing.

**What was run on the real link**, each as its own queue:

| Tried | Result |
|---|---|
| A batch released four minutes before its window opened | Connected, said it was outside the window and when it would open in India's time, sent nothing; sent the first message in the minute it opened, with nobody touching it |
| Text, then an image with a caption, then a number not on WhatsApp, then text | Three sent, 24 s and 18 s apart; the lookup answered "not on WhatsApp", was recorded, and the next message went with no wait |
| Process killed outright after two of four, during the wait between sends | Queue read sent, sent, waiting, waiting. Started again: took over the dead process's lock, reconnected with no code, waited a gap, sent the third |
| Campaign paused in the file after the third, for a minute | Nothing sent in that minute. Resumed: the fourth went on the next question, and the run finished and stopped by itself |
| Process killed in the instant after its second message went, before that was recorded | Queue read sent, *sending*, waiting. Started again: "1 recipient left mid-send, marked unsure", then the third. The second was never sent to again |
| A run with nothing left to send | Connected, found nothing, stayed 40 s for receipts, stopped by itself, lock released |
| The same again the next morning (2026-11-18), once the second phone was online | **Nine `read` receipts arrived at once, for the nine messages recorded as sent, every one of them sent by an earlier run.** Each was matched by its id against the queue's outstanding ids and recorded. Six statuses about the account's other messages came with them and were dropped |

After all of it, including two outright kills while connected, `npm run status`
reads linked and not halted.

**What the rehearsal did not show.**

- **A receipt arriving while its batch is still sending.** The second phone
  was offline through every sending run, so no receipt came during one; all
  nine came together the next morning, in a run that sent nothing. That is
  the harder case (a later run, a different process) and it worked. The
  ordinary one, a receipt a few seconds after its message, is covered by the
  unit tests and is for task 5.2 to see on a device.
- **That none of the ten arrived twice is for the owner to read on the second
  phone.** The receipts say all nine recorded messages were read, not how many
  copies there were. Each message says which queue it belongs to (the time the
  queue was made) and its number in it: 1, 2 and 4 of 4, the second with a
  picture; 1 to 4 of 4; 1 to 3 of 3. That is ten, and the one the sender calls
  unsure is "2 of 3", which should be there once.
- **A first message to a number the account has never chatted with.** The one
  recipient is an old chat. A campaign is almost nothing but first messages,
  and that is the case the restriction below exists for. The first campaign to
  a few dozen regulars (task 7.3) is where it is first seen.
- A closed lid while the loop is sending, a night left alone, and anything to
  do with STOP.

**What the receipts showed.**

- **A `read` can come with no `delivered` before it.** All nine came as
  `read` alone: the phone was opened on the chat as it came online. So
  `campaign_report_receipts` must fill `delivered_at` from a `read` when it
  is empty, as the stand-in queue does; a Delivered figure counted only from
  `delivered` receipts would have read nought here beside nine read.
- **The message the sender calls unsure very likely arrived, and stays
  unsure.** A tenth `read` came for an id the queue does not hold, which fits
  the message that went in the instant before the process was killed: its id
  was never recorded, so nothing can match it. That is the rule working as
  agreed. It also means an `unsure` on the campaign's page is more often a
  customer who got the message than one who did not.

**Found in Baileys' source while building, not on a device.** Each changed the
design above.

- **A send returns before WhatsApp has answered.** `sendMessage` writes the
  message to the connection and returns its id. A refusal comes afterwards, as
  a status of 0 on that message with WhatsApp's code. So `sent` means handed to
  WhatsApp; the adapter turns a later refusal into a receipt, `rejected`; the
  loop reports it like any receipt; and the row goes from `sent` to `failed`
  (D6).
- **A restriction does not close the connection**, so the halt rule as first
  written, which reads closes, would never have seen one. WhatsApp says it in
  two ways while the connection stays up: a notice, `reachoutTimeLock`, which
  Baileys describes as "WhatsApp prevents outgoing messages and calls"; and a
  refusal of one message with code 463, which Baileys' own comment calls
  "usually" a restricted account that may not start new chats, adding that a
  retry "counts as another reach out and worsens the restriction". On either,
  the sender now closes the connection itself and halts, reason `restricted`,
  written to the laptop first (D10). **Neither can be rehearsed without a
  restricted account**; the decision is unit-tested, the wiring is read, not
  run.
- **The status WhatsApp sends within a second of every send (2) is not its
  acceptance.** Six of the ten were sent with status events traced, and it was
  seen for each of the six. By Baileys' source it is the account's own other
  devices saying they have their copy of the message. It
  comes only while the phone is reachable, so the loop does not wait for it
  before calling a message sent.
- **WhatsApp keeps a count of new chats an account may start**, and Baileys can
  ask it (`fetchNewChatMessageCap`, and a `message-capping.update` event).
  Nothing asks yet. It is WhatsApp's own answer to "is a thousand in a day
  spam?" (proposal, decision 7), so it is worth asking once from the business
  number before the first campaign, and showing beside Send batch if it means
  what it appears to.
- **Every image message uploads the image again.** A batch of 100 with a
  picture is 100 uploads of the same file. Baileys has a `mediaCache` setting
  that reuses one upload for identical files; it is not turned on, because it
  changes a send path that is proved as it is. To be tried, on the owners'
  numbers, before a campaign with a picture.

**Decided while building, and now in D6.** The gap is waited before the first
message of a run and after every reconnect, not only between messages. The
database is asked once before each recipient, after the gap, so its answer is
fresh when acted on. A result the database could not be told is kept and
retried, and is not `unsure`. A failed lookup is `failed`, because nothing
left the laptop. Three sends in a row that went wrong pause the campaign, and
the sender does the pausing. The window is the database's reading, and the
laptop's clock only counts down to it. Three functions were added to the first
list (`campaign_report_result`, `campaign_outstanding_message_ids`, and the
sender's pause), and D5 gained `paused_reason`.

**For the session that writes the database (section 2).** `CampaignQueue` in
`core/contracts.ts` is the contract; `core/rehearsal-queue.ts` is a working
model of every answer it must give, and `core/rehearsal.test.ts` is that model
pinned. If a function has to differ from the model, change the model and the
interface in the same commit, so the loop's tests go on describing the real
thing.

## The business number, linked by QR code (2026-11-18)

Task 0.3. The partner came online late in his evening and the owner asked
whether to link then. The laptop could reach WhatsApp (`npm run check`), so
yes.

**It is linked in a folder of its own.** The laptop's usual folder still holds
the link to the owner's personal number, which is what everything so far was
rehearsed on and what the rough tests still to come (STOP, a closed lid, more
kills) should go on breaking. The business link is in
`%LOCALAPPDATA%\shawarmania-campaign-sender-business`, chosen by setting
`CAMPAIGN_SENDER_DATA_DIR` to it. Two senders on two accounts run side by side
without trouble; each folder has its own lock. **A command run without that
setting acts on the personal link**, including `rehearse` and `test-send`.
Before the first campaign, decide which folder is the real one and make it the
default by renaming it while no sender runs (D12): the sign-in of task 4.4 and
the logon task of 4.6 must point at the business link, not the test one.

| Tried | Result |
|---|---|
| Pairing code, read to the partner on a call | Code issued at once; **the business phone said the code was incorrect** |
| A second pairing code, a fresh run | Refused the same way |
| QR code on a page on the laptop, shown to him through a temporary tunnel | **Linked on his first scan**, eight minutes after the page went up, nearly all of it him getting to a screen. The sender had offered eighteen codes by then and the page had kept up with each |
| The business folder afterwards | Reads linked and not halted; login and its backup both saved; about 1,450 contact-mapping files within a minute |

- **Why the pairing code was refused is not established.** The same code path
  linked the owner's own number on the first code, twice, the day before. Not
  ruled out: the number typed not being the one that account is registered on
  (the code is made on the laptop, so one appears whatever number is typed and
  proves nothing about it), a character changed in the reading, or something
  about that account. The owner recalled trouble with codes on his own phone
  too. Nobody spent the partner's evening finding out: the QR code worked, and
  **the owner had the pairing-code way removed** rather than kept as a second
  path that fails at the worst moment.
- **The QR page began as a file and is now a page served on the laptop** [owner,
  2026-11-18]. The first version wrote an HTML file into the sender's folder
  and a throwaway script served it to the tunnel. `npm run link` now serves
  the page itself on `127.0.0.1`, and a tunnel is pointed at that port only
  when the phone is elsewhere.
- **The tunnel was Cloudflare's, which the laptop already had**
  (`cloudflared tunnel --url http://127.0.0.1:<port>`, no account needed, an
  address of four random words). Two things cost minutes and belong in the
  runbook (task 6.1):
  - **a `config.yml` already in `%USERPROFILE%\.cloudflared` makes that
    command answer "not found" for every page.** The laptop has one from
    another project. Passing `--config` with an empty file fixed it;
  - the new address did not open on the laptop that made it for a minute or
    two (its own name lookup had not caught up), and did open from anywhere
    else. Checking it from the laptop itself says nothing.
- **The folder now holds the business account's contacts**, as the rehearsal on
  the owner's number said it would: Baileys' contact-id mappings, which pair
  customers' numbers with WhatsApp's ids for them. On the laptop only, outside
  the repository and any synced folder, removed whole by `unlink`.
- **Not tried:** a custom device name by QR code (the phone shows "Google
  Chrome (Windows)"); linking with the phone in the same room.
- **The owner has said which numbers the business link may be tested on**: his
  own two, the ones used in every rehearsal so far. They are written nowhere in
  this repository. `rehearse` reads its one recipient from
  `test-recipient.txt` in whichever folder it is pointed at, so the business
  folder needs that file before a rehearsal can run from it.

## The Send batch page, the pinned card and the tray icon (2026-11-18)

Tasks 4.5 and 4.6, the part that tells the owner. Built against the stand-in
queue and run for real from the owner's personal link, because the database
does not exist yet. Start with Windows is not built: it has to start the
sender on the real queue, which does not exist either.

**As built.**

- The tick now says which batch is waiting for release, how many were sent
  today and when the last batch finished (D6). The loop passes every tick to
  its caller and can be told to ask again at once, so that a batch released by
  a press starts in a second and not at the end of an idle minute.
- `core/sender-view.ts` turns the loop's events and ticks into one summary: a
  mood, a headline, the waiting batch, this run's counts, and `attention`, the
  one thing that asks for the owner. Each `attention` has an id, and the same
  batch keeps the same id, which is how putting a card away sticks.
- `core/control-page-server.ts` serves the page on `127.0.0.1`, port
  `campaignSender` (7418), with `/state` for the summary and `POST /release`
  for the button. **It is guarded as the one place a press starts a hundred
  messages**: local only; it answers only requests addressed to it by its own
  name, so a made-up domain pointed at the laptop is refused; and the press
  must carry a token that exists only inside the page it served, which another
  site open in the same browser can neither read nor send. Its port is not the
  linking page's (D9).
- `windows/tray.ps1` is the icon and the card. It decides nothing: every two
  seconds it asks `/state` and draws what it is told. It stops by itself about
  half a minute after the sender does.
- `npm run rehearse` runs all of it. `-- new … --wait` makes a queue whose
  batch waits for Send batch, as a real campaign's does.

**What was run.** A queue of two with its batch waiting, on the owner's
personal link. The sender connected and said batch 1 was waiting; the page
showed it in light and dark; a press without the page's token was refused; the
helper was running and its card was on screen, 455 by 250 at the bottom right,
on top and not taking focus (read from the window itself, since an agent
cannot see the desktop).

**Then the owner used it.** He sent a picture of the card on his screen as
built, sitting over the corner of the window he was typing in without taking
the keyboard from it. Eight minutes after the batch began to wait he pressed
Open and then Send batch. The first message went within the same minute, the
second 16 seconds after it, the batch read finished, and the sender stopped by
itself with its lock released and the link intact; the helper and its icon
went about half a minute later. His tray icon was in Windows' overflow, as
expected. What he wants changed about the card is not yet said.

**Two things Windows did that cost an hour, and are now in the code.**

- **Windows PowerShell started with no console at all exits at once**, before
  it reads its script, with exit code 0 and no word. Node starts a child that
  way when asked to detach it. The helper is therefore started attached and
  hidden, not detached.
- **Windows hides the first window of a process that was itself started
  hidden**, whatever that window asked for. The helper is started hidden so no
  console flashes, so its first card never appeared while the process ran
  happily. It now spends its first show on a window nobody needs.
- The helper is plain ASCII. Windows PowerShell 5.1 reads a script without a
  byte-order mark in the system code page, and this repository refuses
  byte-order marks, so every character outside ASCII reaches the card through
  `/state`, as UTF-8.

**Not built yet.** Start with Windows (and with it, D7's Task Scheduler
choice is open: a logon task usually needs administrator rights, and a
shortcut in the Startup folder does not). Restart sender on the page: a halt
ends `rehearse`, and the long-running command that would stay up to show it
needs the real queue. The tray icon is hidden in Windows 11's overflow until
the owner drags it out once; nothing in code can do that for him. The card
ignores Do Not Disturb, being a window of its own.

## The pages, built in the demo (2026-11-18)

Tasks 1.1 to 1.5. What was decided while building, for the owner to accept or
change at 1.6 and for the sessions that write the database (section 2) and the
live adapter (3.1).

**Three pages and a sheet.** `campaigns` is the list; `campaigns/<id>` is one
campaign, and is the composer while that campaign is a draft (`new` in place of
an id is one not saved yet); `campaigns/stopped` is the stopped list. Who a
campaign goes to is a `FormSheet` over the composer. All four are gated by the
one registry entry, `owner-campaigns`.

**How the mock is typed before there is a migration.** #81 and #83 wrote their
shapes into the migration first and hand-edited `database.types.ts`. Here the
migration is section 2, after the owner's approval, so D5's five tables are
hand-written at the top of `src/data-access/campaigns.ts` in the generated
file's form, and the fixtures are typed from them. Task 2.4 replaces each with
`Tables<'…'>`. `audience` is typed as the filters' own shape; the generated
type will say `Json`, so the live adapter narrows it on the way out.

**What the pages need from the database, beyond D5 and D6.** The adapter
interface (`CampaignsAdapter`) is the list. In the terms section 2 will write:

- one read for the list: the sender row with **the database's own clock**
  beside `last_seen_at`, every campaign with its recipient and sent counts and
  which batch is out or next, and the stopped count. The page decides "online"
  as seen within ten minutes of that clock (D12's ten), never by the phone's;
- one read for a campaign: its counts, a row of counts per batch, the name of
  the campaign whose batch is out ahead of it if any, and a signed image URL;
- the audience count and a page of the audience, both from one definition, so
  what is counted, what is looked through and what scheduling cuts cannot
  differ. The page returns a name and the last four digits;
- `saveDraft` with an id the page makes (a retried save writes one campaign),
  `setImage`, `schedule(id, not_before)`, `pause`, `resume`, `stop`;
- the stopped list with a name and last four digits, add by complete number,
  remove.

**Decided in the mock, and needing a yes or a change.**

- **Who can be in an audience.** A customer with at least one settled,
  uncancelled bill at the chosen outlet. Proposal decision A says everyone
  with a number unless they said stop; a customer with a number and no bill
  anywhere is rare (a number is saved with a sale), and the filters are all
  about orders at an outlet, so the mock starts from the outlet's customers.
- **A campaign's *stopped* figure** counts the recipients who replied STOP to
  that campaign as well as the ones already stopped when their turn came. The
  proposal asks for "how many replied STOP"; D6's recipient state `stopped`
  is only the second. A replier is therefore counted in *sent* and in
  *stopped*, because both happened. It is read from `marketing_stopped` by
  `campaign_id`, so removing somebody from the list lowers it.
- **"Within N days"** includes a bill on the business date exactly N days
  back, as the spec's scenario says. **"Not sent a campaign within N days"**
  is counted on `sent_at`, N whole days back from now.
- **The message's length.** 1,024 characters with the stop line, judged with a
  40-character name so a campaign that passes is not too long for anybody. A
  saved name loses `*`, `_`, `~`, backticks and braces where it greets, since
  WhatsApp has no escape for them. 1,024 is the caption length usually given
  for an image and is not verified; check it at 5.2.
- **The bubble previews with the reader's own first name** [owner,
  2026-11-18]. It first used an invented customer's name, which would have
  read as a real person in the real app. In the demo the owner is "Demo
  Owner", so the bubble says "Hi Demo".
- **There is no start time** [owner, 2026-11-18, proposal decision 11]. The
  first build offered "as soon as possible" or "not before" a date and time;
  the owner had it removed as a promise the app cannot keep. The button is
  **Submit**, the shown state is *submitted*, and the next batch's row reads
  *send from the laptop*. The adapter still calls `schedule(id, null)`, and
  the rows keep D5's words (`scheduled`, `scheduled_at`). **`not_before` is
  never set by the app now**: section 2 may keep the column unused or leave it
  out, and D6's tick need not hold a batch for it.
- **Choosing customers is a list with a tick on each; only the list scrolls**
  [owner, same day, proposal decisions 10, 12 and 13]. The sheet opens on the
  customers in sending order, with nobody ticked, and loads more as the list
  scrolls. Above it, still: the search and a **Filter** button (Billing's:
  an icon; accent outline and a line under the search with **Clear** while
  any filter is on); the outlet as `OutletChips`, absent with one outlet,
  opening on the one last used; Select all with the order beside it. Behind
  Filter, as Billing's chips (`Option`, `Group`, exported from
  `bill-filter-sheet.tsx`) applied as tapped: last ordered (7, 30, 90 days;
  not for 30, 90), spent (₹500, ₹1,000, ₹2,000, ₹5,000 or more), members
  (gold, not gold), orders (2, 5, 10 or more; only 1), sent a campaign
  (never; not for 30, 90 days). The presets are the page's alone; a value no
  preset names is kept and shown. The one scroller needs `FormSheet`'s new
  `scrollsItself`: the body lays out as a column instead of scrolling, and on
  a phone the sheet takes its full 85 % height. The list's scroller is
  `relative`; without it, `sr-only` text in rows below the fold was placed
  against the dialog and gave the sheet a second scrollbar.
  The scroller is the list's own rounded box [owner, same day], so rows move
  inside its border and its corners are never cut; it is as high as its rows
  and no higher than the room left, with a thin scrollbar on a clear track.
  The order carries an up-and-down arrows icon, so it reads as an order.
- **One outlet per campaign** [owner, 2026-11-18, proposal decision 14]. The picker's outlet chips choose one,
  as the Customers page's do, because what the filters ask (orders, spend,
  gold, when last seen) is each a relationship with one shop. The database
  holds that too: `campaign_audience_*` refuses anything but one `outletId`.
  Several outlets is possible: the filters would sum orders and spend over the
  chosen outlets, read gold at any of them and the last order at any of them.
  It changes the audience shape on both sides, and the owner kept one: Kalyani
  Cafe is the only trading outlet for the months ahead, so there is nothing
  to combine yet. Revisit when a second outlet trades.
- **Who is picked is part of the audience**, `picked` in `CampaignAudience`:
  `{ kind: 'all', except: [ids] }` is everybody the filters match when the
  campaign is submitted but those unticked, which is what *Select all* sets
  and what holds at a thousand customers without loading a thousand rows;
  `{ kind: 'only', ids: [ids] }` is customers ticked one by one, whatever the
  filters say (still minus anybody stopped). **Section 2 must store and cut
  both**: `schedule_campaign` reads `picked` from the stored audience, and an
  `only` list of a few hundred ids in the jsonb is expected. `gold` replaced a
  `goldOnly` flag: `any`, `gold` or `not_gold`.
- **The list read takes a search** (`audiencePage(audience, offset, search)`),
  by the Customers page's rules (`@/domain` customer-search: three letters
  anywhere in the name, or three digits anywhere in the number). It narrows
  what the list shows and never who is picked, and like every audience read
  it returns a name and the last four digits only. The list ignores `picked`:
  it shows who matches, ticked or not.
- **The demo has a crowd** of 200 invented customers last seen more than 30
  days ago (`fixtures/customer-crowd.ts`), asked for by the demo root only, so
  the list scrolls and *Select all* means something. None is gold, none is on
  the Customers page's thirty-day list, and none matches the walkthrough's
  searches; the first hundred were Weekend combo's recipients, under the ids
  its rows already held.
- **The bubble shows the whole picture** [owner, same day]. The first build
  cut it to a strip. It is now drawn at its own shape, in a bubble no wider
  than a phone's, which is how WhatsApp shows an ordinary photo. How WhatsApp
  crops a very tall or very wide picture in the chat is not verified; see it
  on a device at 5.2.
- **Batches that have not started** are shown two at a time, with the rest as
  one row ("Batches 6 to 10 · waiting").

**The page asks again** when it opens, when the phone returns to the tab, and
once a minute while a campaign is scheduled and the page is in view. No
subscription. That is one small read a minute on an owner's phone while they
watch a batch; D6's reasoning about log lines applies to it and it may be
slowed.

**In the proposal and not built.** *Sending a test* to a number the owner
types: D5 and D6 hold no function or row for it, and tasks 1.4 does not list
it. It needs a design (the app cannot send; a test would be a one-recipient
row the sender picks up) before it is a page. Also absent: a page for the
owner's settings (batch size, window, gaps), and deleting a draft.

**The demo.** Its customer directory holds seven people, and audience counts
are over those seven and their demo bills, as D15 asks. The two campaigns
already scheduled are seeded at 1,000 and 418 recipients so that batch rows can
be judged; their recipient rows point mostly at customers the demo has no card
for, which the table's shape allows (D5: no name, no phone). The demo banner's
sender switch stands in for the laptop: six states, one of which puts the
part-sent campaign's third batch back to not yet released.

## The database, built (2026-11-18)

Tasks 2.1 to 2.4, on the branch `claude/campaigns-database-265c14`, cut before
the pages and the Send batch page were built and written to both: the pages'
adapter contract (`src/data-access/campaigns.ts` on the pages' branch) and the
sender's (`core/contracts.ts`, with the tick's three later fields and
`BatchReleaser`). One migration,
`20261119000000_a_campaign_goes_out_on_whatsapp.sql`.

**What exists.** Five tables as D5 lists them, RLS on, no policy, no client
privilege. One bucket. And these functions, each security definer with an empty
search path and each checking the owner and the account in its own body:

| For | Function | Answers |
|---|---|---|
| the sender (D6) | `campaign_sender_tick(status, halt_reason, installation_id, linked_number_last4)` | a document: contract version, stand-down, gaps, window, released batch, batch waiting for release, campaigns open, sent today, when the last batch finished |
| | `campaign_claim_next(campaign_id, batch_no)` | a document: `claimed` with the recipient, `nothing`, or `refused` with why |
| | `campaign_report_result(campaign_id, customer_id, state, message_id, failure_code)` | whether it was accepted |
| | `campaign_release_stale_claims()` | how many became unsure |
| | `campaign_report_receipts(receipts)` | nothing |
| | `campaign_outstanding_message_ids()` | the ids, as one array |
| | `pause_campaign(campaign_id, reason)` | nothing |
| | `campaign_record_stop(phone)` | whether the customer is now stopped |
| the Send batch page (D7) | `release_campaign_batch(campaign_id, batch_no)` | true when this call released it |
| the pages | `campaigns_overview()` | the list in one read: sender, campaigns, stopped count |
| | `campaign_reading(campaign_id)` | one campaign's page in one read, or null |
| | `campaign_audience_count(audience)`, `campaign_audience_list(audience, offset, search)` | how many are picked; 21 rows of the list, each an id, a name and the last four digits |
| | `save_campaign_draft(id, name, body, audience)`, `set_campaign_image(id, path)`, `schedule_campaign(id)` | nothing |
| | `pause_campaign(id)`, `resume_campaign(id)`, `stop_campaign(id)` | nothing |
| | `marketing_stopped_list()`, `marketing_stopped_add(phone)`, `marketing_stopped_remove(customer_id)` | rows of id, name, last four digits, when, how, which campaign, who |
| the owner's settings | `update_marketing_sender_settings(batch_size, window_start, window_end, min_gap, max_gap)` | nothing |

A refusal's message is the word the page reads: `not_permitted`,
`name_required`, `body_required`, `body_too_long`, `audience_required`,
`audience_invalid`, `nobody_matches`, `not_a_draft`, `not_found`,
`wrong_state`, `phone_incomplete`, `no_such_customer`, `image_path_invalid`,
`settings_invalid`.

### What the design did not settle, and what was chosen

Each is the smallest answer that works, **for the owner to accept or change**.
None is hidden in the SQL: each has a test that names it.

1. **Sending a test from the app is not in the database.** The proposal
   promises it; D5 and D6 hold no function or row for it, and tasks 1.4 does
   not list it. Nothing was added. A test today is `npm run test-send` on the
   laptop, which is what the staging rehearsal (5.2) can use. To put it in the
   app would take three things that are each a decision: a row that holds a
   typed number (the first phone number a campaign table would store), a
   second function that hands a number to the sender (D13 says only the claim
   does), and a path through the sending loop that is not a batch. Not built
   until the owner asks for it.
2. **`campaign_outstanding_message_ids` has an age limit: sent in the last 30
   days.** Without one the list grows for ever, by every customer who keeps
   read receipts off, and is sent whole each time WhatsApp connects. Thirty
   days is the window D11 already uses for STOP. A receipt for an older message
   is still recorded if one is reported; it is only no longer asked about.
   `core/rehearsal-queue.ts` has the same limit, with a test in
   `core/rehearsal.test.ts` [owner, 2026-11-18: change the stand-in too], so
   the stand-in queue and the database give the same answers again. The edit
   is inside that one function, away from the lines the sender's branch
   changed.
3. **"Seen recently" is ten minutes**, as D12 says. The tick must name its
   installation, and is refused without one. A second installation inside the
   ten minutes is told to stand down, is offered no batch, and leaves what the
   first last said as it is; after ten minutes it takes over. The installation
   id and the linked number's last four digits are arguments the sender's
   adapter supplies. The loop's own `tick(status, haltReason)` does not carry
   them.
4. **The claim hands over the image's path, not a signed address.** Signing a
   storage address inside the database needs the project's JWT secret in the
   database, which is the key that mints a service-role token. The sender and
   the page are both an owner's session, and the bucket's read policy lets an
   owner's session ask storage for a signed address itself. `imageUrl` in the
   loop's contract is unchanged: the adapter (task 4.4) fills it.
5. **Who is in an audience** is the pages' own definition, kept: a customer
   with a settled, uncancelled bill at the chosen outlet, not on the stopped
   list. The stored audience is the app's document as the page writes it
   (`CampaignAudience`: `outletId`, `ordered`, `orders`, `gold`,
   `spentAtLeastPaise`, `campaigns`, `sort`, `picked`), read by one function
   that the count, the list and submitting all use. **A key it does not know
   is refused**, because a filter dropped in silence would send to everybody;
   that includes `goldOnly`, which `gold` replaced. "Within N days" includes
   the business date exactly N back. "Sent a campaign" is `sent_at`, N whole
   days back from now; a customer left *unsure* does not count as sent one.

   **The list and the campaign are two readings of it** (proposal, decision
   12, which arrived after the first commit of this section and was added the
   same day). The list is everybody the filters match, whoever is ticked,
   narrowed by a search under the Customers page's rules: three letters
   anywhere in the name, exactly or in order with gaps, or three digits
   anywhere in the number. The campaign goes to who is picked: `all` is the
   filters' matches but the unticked, `only` is exactly the ids ticked,
   whatever the filters say. Three things the pages' note does not say and
   the SQL had to: **an audience with no `picked` has picked nobody**, so a
   document from before the change counts nought and cannot be submitted; a
   tick cannot add a customer the outlet has not served or one who said stop;
   and a pick list is at most 5,000 ids. A search by number still returns four
   digits.
6. **`not_before` is kept and nothing sets it** (proposal, decision 11).
   `schedule_campaign` takes no start time. The tick and the release still
   honour a row that carries one, which is what the sender's contract
   describes and costs one line each.
7. **One pause, two callers.** An owner's pause (no reason) is refused with
   `wrong_state` unless the campaign is going, as the pages expect. The
   sender's pause (reason `three_in_a_row`) is never an error for a campaign
   that is not going: it can arrive after an owner's own pause or stop, and
   the loop reads a refusal as the database being unreachable.
8. **Stopping a campaign closes its released batch.** One batch at a time
   across every campaign is an index on the batches table, so a stopped
   campaign's batch left `released` would block every later one for good. Its
   waiting recipients stay `waiting`, as D7 says.
9. **A paused campaign keeps its turn.** While a campaign is paused with a
   batch out, no other campaign's batch can be released. Pause is meant to be
   short; Stop frees the turn.
10. **Whose STOP counts** (D11's "a recipient of a campaign in the last 30
    days"): a customer a message was handed to WhatsApp for in the last 30
    days, or who was left *unsure* in them. The rehearsal showed an unsure
    message has usually arrived, and somebody who says stop has it. A customer
    sent nothing (not on WhatsApp, still waiting, passed over) is not stopped
    by the word.
11. **The message's length is the renderer's to judge.** The database refuses
    a body longer than 1,024 characters as written, which no rendering can
    bring under the limit, and stores at most 4,096. Whether a body fits with
    the stop line and a name is `shared/campaign-message.ts`, in the composer
    and again in the sender.
12. **The pictures.** The bucket takes JPEG and PNG up to 1 MB. An owner may
    read and upload; nobody may change or delete, so a picture a submitted
    campaign points at is still there when its batch goes. A draft's picture
    must sit in that campaign's own folder (`<campaign id>/<file>`). The
    first version allowed 5 MB; see *Pictures and the free plan* below.
13. **The owner's settings have bounds**: 1 to 1,000 a batch; gaps from 5
    seconds to an hour, shortest not above longest; a window that opens and
    closes at different times.

### Three statements the migration lint had to be told about

`npm run lint:migrations` refuses a row inserted into an existing table and a
policy added to one. The bucket is a row in `storage.buckets` and its two
policies are on `storage.objects`, so each of the three statements carries a
`release-lint: allow` with its reason: nothing a published build reads or
writes is touched, because no build knows a bucket by this name and both
policies are permissive and name only it. D5 and task 2.2 ask for the bucket
and its policies. AGENTS.md asks that an exception carry the owner's
agreement: **the owner agreed to all three on 2026-11-18**, after they were
explained as a new drawer in a cabinet that already exists, and each of the
three comments in the migration says so.

### Pictures and the free plan

**Storage and egress must stay inside Supabase's free plan** [owner,
2026-11-18]. Everything a campaign sends or reads through the database is small
text: about one request a minute while a batch is going, a few hundred bytes
each. The pictures are the only part that could add up, and three habits
decide how much:

- **Stored small.** The bucket refuses anything over 1 MB. WhatsApp shrinks a
  photo to a few hundred kilobytes before sending it, so a larger file costs
  storage and download and shows the customer nothing more. **The page shrinks
  a phone photo before uploading it** (task 3.2): to about 1,600 pixels on its
  longer side, JPEG, which is what WhatsApp sends anyway. At two or three
  campaigns a month that is a few megabytes a year. A picture replaced on a
  draft leaves the old file in the bucket, because nobody may delete; that is
  small enough to leave, and cleaning it up is a later decision.
- **Downloaded once by the sender, not once per message.** The claim returns
  the same `image_path` for every recipient of a campaign, and the database
  refuses to change a submitted campaign's picture. **The sender's adapter
  (task 4.4) downloads a path once and keeps the bytes for as long as the
  campaign runs.** Downloading per message would be a hundred downloads of the
  same file every batch, which at a large picture is most of a month's egress
  in one campaign. (Uploading it to WhatsApp a hundred times is the laptop's
  own bandwidth, not Supabase's: design, *The sending loop, rehearsed*, on
  `mediaCache`.)
- **Downloaded once per visit by the page, not on every refresh.** A
  campaign's page reads itself again every minute while a batch is going. A
  fresh signed address each time is a new address to the browser, so the
  picture would be downloaded every minute. **The live adapter (task 3.1)
  signs a path once per page visit, with an expiry longer than a visit, and
  reuses that address on every refresh.** The picture is shown on the draft
  and on a campaign's page; the Campaigns list shows none.

With those three, a campaign with a picture costs about one download by the
sender and one per time an owner opens its page, a few hundred kilobytes each.

### For the session that merges this

- **The hand-written rows in `src/data-access/campaigns.ts` become
  `Tables<'…'>`** (the pages' note on 1.2). Where the real rows differ:
  `marketing_sender` has `id` and `installation_id` as well; `audience` is
  `Json`; the state columns are the generated enums; `marketing_sender.status`
  starts as `not_linked` and is never null.
- **The live adapter (3.1)** reads two documents with snake_case keys and maps
  them; signs `image_path` through storage once per visit and reuses the
  address (*Pictures and the free plan*); maps a refusal's message to
  `CampaignActionError`. The look-through returns 21 rows, the pages' page is
  20: the twenty-first says there is a next page.
- **The sender's adapter (4.4)** maps snake_case to the contract's names, adds
  the installation id to every tick, downloads each `image_path` once and
  keeps it for the campaign, and may read
  `release_campaign_batch`'s false as "nothing to release".
- **The sender's `SenderStatus` has no `not_linked`**; the database accepts it,
  for the `link` and `status` commands to report.

### Not built, and waiting for somebody to ask

- Sending a test from the app (1 above).
- Deleting a draft: D5 has no state for it.
- **The finished-campaign message to the owner who submitted it (task 4.7)**
  needs that owner's own number to reach the sender, and no function hands one
  over. It is a second place a number would leave the database, so it is a
  decision, not a detail.
- A page for the owner's settings: the function exists, the page does not.

## Test numbers (2026-11-18)

The proposal promised *sending a test* and no section designed it; the pages
were built without it. The owner settled it on 2026-11-18, after the database
had been merged:

- **Any number, not a customer.** Their own, the co-owner's, a friend's who
  has never bought anything. Up to five on a campaign, a ten-digit Indian
  mobile or any full number with its country code (the owner tests from a US
  number). Kept as `+` and digits. **One rule, written twice and held
  together by the same cases**: `checkTestNumber` in
  `shared/campaign-test-number.ts` for the composer and
  `marketing_test_phone` in the migration, so what the page accepts is what
  the database keeps.
- **No release on the laptop.** Whenever the sender is connected it sends them
  by itself, ahead of any customer and whatever the sending window says. The
  owner wants to see the message on his own phone without being at the
  laptop, and the window protects customers, which these are not.
- **No privacy concern** [owner, his words in short: our own numbers, typed by
  us]. **So this is the one place a full number is kept on a campaign**: the
  rule that a campaign stores no phone (D5) still holds for every customer,
  and `99_whatsapp_campaigns_are_the_owners.sql` now names the two columns
  that hold test numbers, so a third fails by name.
- **Suggested next time**: the numbers used on earlier campaigns, most
  recently used first, ten at most, because they are mostly the same few.

**As built.** `marketing_campaigns.test_phones` holds the numbers. Each send is
a row in `marketing_campaign_tests`, carrying the message and picture as they
stood when it was queued, so a draft edited afterwards does not change a test
already on its way. Two things queue them: **Send test** on a draft (one round
at a time; a second press while the first is on its way is refused), and
**Submit**, which queues them itself for every test number that has no test of
that campaign still on its way, so a Send test not yet sent is not doubled. `campaign_claim_next_test` hands them over oldest first, with no
release and no window check, one in hand at a time across tests and customers
alike (each claim looks at both tables); `campaign_report_test_result` records
them; stale claims of either kind become unsure on start and on reconnect. A
stopped campaign's waiting tests are marked stopped and sent nothing. Tests
skip the stopped list and are in no figure: not the campaign's counts, not
sent today, not receipts. `campaign_reading` lists a campaign's test numbers
and its last twenty test sends.

**The sender.** The tick says how many tests wait (`testsWaiting`); the loop
sends those first, paced like everything else, then goes on to the customers.
A test's ref carries `testId` and batch number 0, which is how `report`
tells the two apart and how the laptop's page says "Sending to the test
numbers". `npm run rehearse -- new … --tests=1` adds test messages.

**Rehearsed once, for real**: a queue with one test and one customer, the
batch waiting for release and the window set shut. The test went out by
itself within seconds of connecting; the customer stayed waiting, untouched,
with the batch still unreleased. **It also found a fault**: that first test went
the instant the laptop connected, skipping the opening gap D6 requires of the
first message of a run, because the test branch ran before the loop had
learned the gap. Fixed, and pinned by a unit test proved to fail without the
fix.

**Not decided, and left as built:** tests go out at night in India too (the
window is skipped on purpose; a friend's phone may ring at 3 am); a test is
sent with `{name}` greeting nobody; receipts for tests are not recorded.

## The sender on the real database (2026-11-18)

Task 4.4, and the real `CampaignQueue`. Built while the pages were being
wired to the same functions (section 3), and run end to end against the local
database before anything reaches staging.

**As built.** `npm run sign-in` asks which database (its address and public
key, the two values the app is built with, neither a secret, kept in
`queue.json` in the sender's folder), then a username or email and a password,
the password not shown as it is typed. The session is kept in the same folder
and renewed by supabase-js; a signed-in account that is not an owner is
signed out at once and not kept. `npm run sign-out` forgets it. `npm start`,
signed in, runs the sender on the real queue with its page, tray icon and
card; not signed in, it only holds the link, as before. `src/database.ts` is
the queue: one function call per method, and a call that fails rejects, which
the loop treats as the database out of reach. What it reads and writes is
`core/queue-answers.ts`, which the root test run covers and which refuses an
answer it cannot read rather than guess at it. A message is rendered with
`renderCampaignMessage` from `shared/`, the function the composer's bubble
uses; a picture is downloaded once per path with the owner's session.
`--only-test-recipient` wraps the link so that it reaches the number in
`test-recipient.txt` and nobody else, whatever the database hands over: for a
rehearsal against a real database. The sender's name to the database (D12) is
a random id kept in `installation-id`.

**Run end to end on the local database**, to the owner's own number only: a
campaign with one customer and one test number, both his. The test went out
by itself with the batch waiting; the card said the batch was waiting; Send
batch on the laptop's page released it; the customer was sent; the batch and
the campaign read done. Two messages.

**What it found.**

- **The tick did not work over HTTP, and nothing had noticed.** Both writes to
  the sender's one row, in `campaign_sender_tick` and
  `update_marketing_sender_settings`, were UPDATEs with no WHERE. Supabase's
  API sessions refuse that (`pg_safeupdate`); psql and pgTAP never meet the
  rule, so 4,856 database tests passed, and the REST probes only proved that
  everybody else is refused. Each now names the row (`where s.id`), and the
  REST file calls both as the owner, over HTTP, so the next one fails there.
- **A second sender standing down works**, met by accident: the REST probe's
  tick, under another installation id, made the laptop stand down for ten
  minutes, as D12 says. The probe's id is fixed, so a rehearsal right after a
  REST run will meet it.
- **The local database is shared, and was reset mid-run** by another session.
  The sender said the database was out of reach and carried on when it was
  back, as designed; the campaign was gone, and was put back by hand.
- Rows made on the local database by hand cannot all be removed: bills are
  append-only, so a hand-made customer with a bill stays until the next reset.
  A rehearsal's customer row holding a real number must therefore end with a
  reset, which this one did.

**Not built yet.** Start with Windows (4.6). STOP (4.2a). Restart sender on the
page. The runbook's words for sign-in (6.1).

## The pages on the real database (2026-11-18)

Section 3, built by the session that built the pages, while the sender was
wired to the same functions. No database function had to change for it.

- **The live adapter** reads and writes through the functions alone; the five
  row types the pages first wrote by hand are now the generated ones.
- **A picture is shrunk on the phone before it is uploaded**: the longer side
  to at most 1,600 px, JPEG at quality 0.85; if that is still over the cap,
  1,600 at 0.72, then 1,280 at 0.72, then 1,024 at 0.65. A transparent picture
  is laid on white. The bucket's 1 MB cap stays the backstop.
- **Every upload is a new file**, `<campaign id>/<random id>.jpg`, because an
  owner may not overwrite in the bucket. Replacing or removing a picture
  leaves the old file there. Clearing them out is a possible later task; at
  two or three campaigns a month it costs nothing.
- **A picture's signed address is kept for six hours** per path and signed
  again with half an hour left, so the page's minute-by-minute refresh does not
  download it again. If signing fails, the campaign shows without its picture.
- **An address that is not a campaign's id** (Postgres error 22P02) reads as
  no campaign, not as an error.
- **The generated types are wrong in two places, and the adapter reads round
  them**: `set_campaign_image`'s `p_image_path` is typed as never null though
  null takes the picture off; and the JSON reads type `name`,
  `campaign_name` and `recorded_by_name` as never null though they can be.
- **`owner-campaigns` is `live`.** After the owner's Promote, every owner sees
  Campaigns in production. Nothing can be sent until a sender is signed in to
  production on a laptop and a batch is released there.

## Built whole, for the staging rehearsal (2026-11-19)

The owner asked for everything needed to run a campaign end to end from
staging with the real laptop: "build it fully complete and push it to
staging". What that added, beyond the sections above:

- **Renumbered #85.** `a-dish-can-show-its-photo` reached `main` as #84 while
  this change was being built under the same number. This change is #85 from
  here on; its earlier commits say #84.
- **STOP replies (4.2a).** The Baileys adapter listens to incoming messages
  only on a connection that sends, and looks at each for one thing: is the
  whole text, trimmed, any case, the word STOP (`core/stop-reply.ts`; "STOP!"
  and "stop please" are not). Only for a STOP is the sender's number worked
  out: from the message itself, or the number beside a LID, or Baileys' LID
  mapping. It is handed to the loop, which passes it to
  `campaign_record_stop` and keeps it nowhere; the database decides whether
  it was a customer sent a campaign in the last thirty days. Not yet seen on a
  device.
- **The finished-campaign message (4.7).** `campaign_finish_notices` lists
  campaigns finished in the last week whose owner has not been told, with the
  submitting owner's own number from their account and the totals;
  `campaign_mark_finish_notice` records that they were. The sender asks once
  a batch has stopped being out and nothing else is going, sends each one
  message (sent, of how many, and only the troubles there were; no delivered
  or read, which keep changing), and marks it. **The second place a full
  number leaves the database**, to an owner's session: an owner's own.
- **Sign-in by site.** `npm run sign-in -- staging` and `-- production`
  read the database's address and public key from the published app, as a
  browser does (`core/site-address.ts`), so nobody looks a key up. Staging's
  build carries the older key (a token, checked to say `anon` and to name the
  same project); production's carries the newer publishable kind, taken only
  when the script holds exactly one. Production asks nothing more but says,
  in capitals, that it is production.
- **Start with Windows (4.6)**: a script in the owner's own Startup folder,
  not D7's logon task, because a logon task usually needs an administrator.
  `npm run install-startup` refuses a folder that is not linked and signed
  in, and writes what the sender prints to `sender.log`. Proved with a
  stand-in for node, paths with spaces included; not yet tried at a real
  logon, and the tray icon's start from a sender with no console of its own
  is the part most likely to need a look.
- **The runbook** is in `docs/OPERATIONS.md`.

**Staging and production use the same sender.** Which database it sends for
is which it is signed in to, per data folder; switching is a sign-out and a
sign-in. Nothing in the laptop half differs between the two.

## No stop line, and ordered between two dates (2026-11-20)

The owner, on seeing the build on staging: "we can remove the reply STOP
feature since we are sending these messages directly and not via business api
of whatsapp. also i can imagine that we might ocassionally wanna send
campaigns to people from a specific date range from the past, and may even
further filter down to those who have not visited us again since then.
basically we wanna increase revisits." Asked, they chose no line at all, the
two-date filter with a "not since" switch, and replacing the database's
audience function in place (proposal, decisions 15 and 16).

### No stop line

- **The message is the body as written.** `renderCampaignMessage` adds
  nothing under it, so the bubble, the room left and the over-long check all
  judge the body alone. The 1,024-character limit is unchanged.
- **The sender reads no incoming message.** The `messages.upsert` listener,
  `core/stop-reply.ts`, the loop's hand-over of STOPs and the
  `recordStop` queue call are gone. Nothing in the sender now looks at what
  the account receives; D11's one question is no longer asked.
- **The stopped list stays.** An owner adds a customer who asks, at the counter
  or by replying, and removes them by hand. It keeps them out of every audience
  and passes them over at their turn, as before. The demo's list now holds only
  customers added by an owner, so it shows nothing that can no longer happen.
- **Kept in the database, uncalled:** `campaign_record_stop` and the
  `reply` source of `marketing_stopped`. Both are on staging; dropping
  them is a contract migration for nothing a reader would notice. A row of
  that source, if one was ever recorded, still shows as "replied STOP".
- **A campaign's "Stopped" tile** now counts only customers passed over at
  their turn because they were on the list.

### Ordered between two dates

`{"kind": "between", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "notSince": bool}`
under the audience's `ordered`, beside "within N days" and "not for N days".

- **What it matches**: a settled bill at the outlet with a business date in the
  stretch, both dates included; with `notSince`, also no settled bill after
  the second date. Business dates, never timestamps, as every recency here: a
  bill rung after midnight belongs to the date before. A cancelled bill is not
  a visit, in the stretch or after it.
- **What it refuses**: a first date after the second, a date that does not
  exist or is written any other way, a `notSince` that is not true or false,
  and a key the stretch does not have. Each is `audience_invalid`, never no
  filter.
- **Replaced in place** (`20261120000000_campaign_audience_ordered_between.sql`):
  `marketing_audience` with today's body verbatim plus the new kind, under a
  `function-change` lint exception. The lint's own way, a second function
  called from a gated path, would have split the count, the list and
  submitting across two definitions, which is the one thing this function is
  for. Safe because every audience a published build sends has a kind it
  already knew, and #85 has reached no production build. The owner agreed on
  2026-11-20.
- **The sheet**: *Between dates* is one more choice under *Last ordered*.
  Chosen, it shows two calendars, From and To, and a **Not back since 30 Sept**
  switch naming the second date. It opens on sixty business dates back to
  thirty, something to move rather than a suggestion. Neither date can pass
  the other (moving one past brings the other along), and neither can be after
  today. The summary under the search reads "Ordered 01 Sept to 30 Sept, not
  back since"; the campaign's page says "ordered 01 Sept to 30 Sept" and "not
  back since 30 Sept".
- **The demo** reads the same rule over its own bills, and its tests hold it to
  the database's: all time is everybody, the last seven days is "within 7
  days", and not back since a week ago is "not for 6 days".

## The sender keeps running (2026-11-21)

During the owner's first staging test the sender stopped answering: a second
test waited with nothing sending it. It had been started in a terminal inside
the Claude app, and went when the app closed its terminals on a restart of
the session, 40 minutes after it started. Not a halt, not WhatsApp: nothing
existed to bring it back. The owner: "It should not just auto stop", unless "I
really manually go and stop it".

- **A keeper** (`core/keep-running.ts`, `npm run keep-running`) runs the
  sender as a child and starts it again whenever it exits. Five seconds after a
  run of ten minutes or more; after quick exits in a row 5 s, 15 s, 1 min,
  2 min, then every 5 min, for ever. A recurring fault is retried slowly, never
  given up on.
- **It stays down for two reasons only.** The owner's stop request, a file in
  the data folder (`stopped-by-owner.json`) written by `npm run stop` or the
  tray's *Stop the sender…*, which the running sender checks every two seconds
  and obeys the way it obeys Ctrl+C, after the message in hand. Or a halt
  (exit code 2), which D10 says only a person may clear.
- **A stop holds across a restart of the laptop.** The keeper at logon reads
  the file and starts nothing. `npm run install-startup` clears it and starts
  the keeper; so does a person running `npm start` by hand. A sender the keeper
  starts carries `CAMPAIGN_SENDER_KEPT` and never clears it, so a stop asked
  for in the instant between two runs is not lost.
- **Nothing owns it but Windows.** The logon script runs the keeper, and
  `install-startup` also starts it at once through Explorer, so no terminal,
  app or window is its parent. One keeper per data folder (`keeper.lock`,
  beside the sender's own `sender.lock`).
- **Tried for real** on the business folder against staging: the sender
  killed outright was started again in 5 s and reconnected; `npm run stop`
  stopped it between messages and the keeper with it; a keeper started after
  that read the stop and started nothing; `install-startup` brought it back,
  kept running. Not yet tried: an actual logon, and the tray's Stop clicked
  (its script parses; what it writes is the file the sender already obeys).
- **Not covered:** the keeper itself ended from Task Manager is not restarted
  until the next logon. A sender it left behind keeps running; a new keeper
  waits for that one to stop and takes over.

## The sender's history (2026-11-21)

The owner asked to see, on the laptop, "what has been sent, what maybe is
planned to be sent, or whatever information it knows or it has known in the
past", kept locally and fine to lose with the laptop. Asked, they chose to read
the sends from the database and keep only the sender's own events locally, and
to see customers' whole numbers (proposal, decision 17).

- **Where**: under the tiles on the sender's page (`http://127.0.0.1:7418`,
  the tray's *Open the sender page*), refreshed every thirty seconds and after
  Send batch. Three lists: **Coming up**, **Sent**, **The sender's diary**.
- **Coming up and Sent are the database's** (`campaign_sender_history`, in
  `20261121000000_campaign_sender_history.sql`): tests waiting; every batch not
  yet done of a campaign submitted or paused, with what it waits for (Send
  batch, released, campaign paused); and the newest 300 messages the laptop
  picked up, customers' and tests', with the campaign, the batch, the saved
  name, the whole number as the customer's record holds it now, how it ended
  and the receipts. A customer passed over because they were stopped was
  picked up by nobody and is not in Sent; the app's batch counts hold them.
  Read from the database rather than kept on the laptop because it already
  records every message's fate, so the list is complete from the first
  campaign, agrees with the app, and costs the laptop nothing to keep.
- **Whole numbers, guarded like Send batch.** `GET /history` answers only the
  page's own token, so no other site open in the same browser can read it;
  `GET /state`, which the tray reads, still carries no number. Anyone using
  the laptop itself can open the page, which the owner accepted.
- **The diary is the laptop's** (`core/diary.ts`, `diary.jsonl` in the data
  folder, the newest 2,000 lines): started (by the keeper or by hand) and for
  which database, connected, connection dropped, Send batch pressed, a batch
  finished, cut off mid-send, the database out of reach, asked to stop,
  stopped, halted and why, restarted by the keeper. No number and no message:
  sends are the database's. The same line twice in a row is written once. A
  rehearsal keeps no diary and has no history.
- **Shaped on the laptop, placed by the page** (`core/history.ts`): plain
  sentences per row (*Read*, *Delivered*, *Not on WhatsApp*, *Failed (463)*,
  *Unsure*), Indian numbers grouped as they are said, a time today and a date
  before; a row it cannot read is left out rather than shown wrong. When the
  database cannot be reached the diary still shows and the page says the rest
  may be out of date.
