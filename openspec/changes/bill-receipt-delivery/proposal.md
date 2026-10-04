# Proposal: bill-receipt-delivery

## Current scope — owner decision, 3 October 2026

**This section supersedes the earlier consent, suppression and payment-dialog
design below.** The owner explicitly chose providing a valid phone at the counter
as opting into receipt SMS. No separate consent question, suppression preference,
or counter-layout redesign is part of #59. The existing number-or-skip flow stays.

**Current gate:** a new settled bill with a valid number automatically sends its
receipt, earned points and frozen outlet balance when it reaches the server,
including after offline sync, once per bill. No valid number, pre-activation bills
and demo sessions send nothing. Failures and uncertain sends are visible to the
owner and that outlet's managers; billing never waits for MSG91.

The landing repo is clean and fully pushed at `42b07a0`. That change removed
reply STOP, but separate stopping promises remain. This change updates messaging,
terms and privacy to match the owner's decision before delivery is enabled.
Customer-data removal remains a separate privacy request; directory deletion is
not implemented here. The older sections below retain the seed's reasoning,
not the current requirements. `design.md`, `tasks.md` and the delta are current.

> **Model**: Opus · **Wave**: F · **Depends on**: #54, #56, #62, #66 · **Gate**: **a customer who gave a valid number receives their receipt, earned points and frozen outlet balance by SMS automatically after server settlement**, including offline sync; providing the number is the opt-in, with no separate question or SMS suppression preference; no number, pre-activation bills and demo send nothing; one automatic submission per bill, with uncertain acceptance never retried; final delivery is distinguished from submission, failure and uncertainty are visible to the owner and that outlet managers, and billing never waits for SMS; matching landing messaging, terms and privacy are published before activation; the manual WhatsApp fallback and four-role demo still work.

## Why

This graduates [`openspec/todos/bill-receipt-delivery.md`](../../todos/bill-receipt-delivery.md),
whose trigger was *"the owner picks a channel and settles consent."* Both happened on 2026-09-21,
and not as a plan — **as something already published and filed with a regulator.**

That is what makes this change unusual, and it should be read before anything is designed.

## Where this stands, 2026-10-03: the channel is built and proved

**Everything outside this repository is done.** A real receipt SMS reached the
owner's phone on 2026-10-03 with its points and link filled in. What exists:

| Piece | Value |
|---|---|
| Sender | Airtel DLT principal entity `1001829618159358766` (De & Datta LLP), header **`DEDTTL`**; arrives as `CP-DEDTTL-S` (`-S`: service) |
| DLT template | `1077524620016122125`, Service Implicit, approved 2026-10-03; wording in #66 design D6 |
| DLT CTA | dynamic URL `https://shawarmania.in/bill?` (#66) |
| Telemarketer chain | Airtel to MSG91 (Walkover Web Solutions, TM `1302157225275643280`), chain `1015638052420708945`, active |
| MSG91 | workspace `de16`, sender `DEDTTL`, **template ID `6ac1321521ce1c2d3f08a382`**, variables `earned`, `balance`, `url` |
| Send call | `POST https://control.msg91.com/api/v5/flow`, header `authkey`, body `{template_id, short_url: "0", recipients: [{mobiles: "91XXXXXXXXXX", earned, balance, url}]}`; answers `{"type":"success","message":<request id>}` |
| Cost | ₹0.25 per SMS from a prepaid rupee wallet (₹3,349 on 2026-10-03), failed sends charged too; ~73 bills a day is ~₹550 a month |

What that settles for the build:

- **No inbound path exists.** A DLT header cannot receive a reply ("Sender can't
  accept replies" on the handset). So there is **no STOP webhook to build**, and the
  pages no longer offer one: `/messages/` and `/terms/` dropped *reply STOP* and
  *reply HELP* on 2026-10-03 (landing `42b07a0`). Stopping is the counter, the phone
  line or email, each of which ends as suppression set by staff or an admin.
- **`{#numeric#}` is digits only**: send `String(points)`, never grouped.
- **`short_url` stays `"0"`.** MSG91's shortener would replace the registered CTA
  and every message would fail DLT scrubbing.
- **The auth key** is an Edge Function secret (`MSG91_AUTHKEY`), never the client.
  The owner's key `ShawarmaniaSMS1` has the Owner rule and IP security off (Supabase
  has no fixed egress); a narrower key is worth asking MSG91 for before go-live.
- **The wallet can run dry silently.** MSG91 offers no balance threshold, only an
  alert recipient. The failure path below covers an empty wallet like any other
  failed send.
- **A bill that earned nothing** still sends *"You earned 0 points"*. The template is
  fixed; a second template is the only way to word it differently.
- **Points at Kalyani Cafe are on** (5 per ₹200, 10% use cap), but bill 199 (2026-10-03,
  the first with a customer attached) earned no row. Most likely the switch went on
  after it, since earning reads it when the bill arrives and settings keep no
  history. Confirm on the next bill with a customer before relying on it.

## When the number is asked, and when the message goes

> **Status, 4 October 2026.** *Send at settlement* is decided and built (design D1).
> *Ask at payment* is the owner's own request (3 October, in the session that set
> up DLT and MSG91) and is **not built**: the scope note above shipped #59 with the
> existing number-or-skip row. It is the open follow-up in `tasks.md` 7. The consent
> half of the last bullet below is superseded: giving a number is the opt-in, and a
> number with "no SMS" is not an option the counter offers [owner, 3 October 2026].

**Send when the settled bill reaches the server, not after *Prepared*.** Everything
the message carries is final at payment: the items, the total, the tender, the
points earned and the balance. *Prepared* is a kitchen flag that changes nothing on
the bill, is tapped late or not at all, and comes after a takeaway customer has
already left. Nothing done afterwards can make the message wrong in a way that
matters: the link is live, so a void or a tender correction shows on the page the
moment it happens; only the two numbers in the text are frozen, and they move only
on a void. The send is **server-side**, keyed on the bill, so a bill rung offline
sends once when it syncs and the outbox retrying a bill cannot send it twice.

Rejected: **after both payment and *Prepared***. It delays the receipt for no gain,
and couples money to a kitchen switch that is not always used.

**Ask for the number at payment, as the payment dialog's first step.** This is
already what `/messages/` tells customers: *"When you pay at our counter, we ask
whether you want your bill on your phone."* The cashier asks once, with the reason
attached, and a dine-in customer who pays at the end is asked when they pay, not
when they sit down.

What that has to respect:

- **It must come before the tender, not after.** The customer decides the total:
  gold waives packaging (#62) and points can pay for part of the bill. So the
  dialog asks *number, then gold and points, then total, then tender*, and the bill
  is settled with the customer attached.
- **The order-time customer row stays optional, not removed.** A regular known when
  ordering still gets gold and points shown on the order, and the payment step then
  only confirms the message question. Moving the whole customer step out of the
  order is a larger change to #56 and #62 than this one needs.
- ~~**Consent is the answer to that question, recorded as its own fact** (who asked,
  when, the words), as below. A customer who gives the number but says no to the
  message keeps their points and gets no SMS.~~ Superseded [owner, 3 October 2026]:
  *"if they are giving a number, we can just assume they're fine with getting the
  SMS."* The payment step asks for the number, explaining it is for the receipt and
  points; it does not ask a separate message question.

## The channel is SMS through MSG91, 2026-09-29

**The owner dropped the RCS plan on 2026-09-29.** The channel is now **SMS, sent
through MSG91**, with the business's **Airtel DLT** registration (entity, header
and template) pending. Everything below that described RCS through Telinfy has
been rewritten to say SMS; where the RCS history still matters (the published
pages were filed with the RCS registration), it is kept as history.

What that moves:

- **DLT is no longer the fallback's problem. It is the whole channel.** Nothing
  sends until the entity, the six-letter header and the receipt template are
  approved. The template is fixed at approval, variables included, so the
  points slots #62 wants (below) must be in the template submitted now.
- **[Resolved 2026-10-03: no inbound path; the pages changed first, see
  above.]** **Two published promises may not survive the move, and the pages must be
  checked before anything sends.** `/messages/` and `/terms/` promise *"Reply
  STOP"* and *"reply HELP"*. An SMS sent from a DLT alphanumeric header is, as
  far as is known here, send-only: a customer's reply has nowhere to go. Confirm
  with MSG91 whether it offers an inbound number bound to this programme. If it
  does, inbound STOP is built as scoped below. If it does not, **the pages change
  first** (the order this proposal already insists on) to name the ways that do
  work: telling the counter, calling, emailing. The gate's STOP clause is then
  restated to match. `/terms/` also says messages *"sent as RCS use your data
  connection"*, which is simply no longer true.
- **The misdelivery argument is unchanged.** An automatic SMS to a mistyped
  number misdelivers exactly as an automatic RCS message would.
- **Until DLT approves, the owner sends receipts by hand on WhatsApp**, and a
  biller can show a customer their bill on the counter (#63
  `a-receipt-goes-out-on-whatsapp`). Both stay after this ships, the WhatsApp send
  as the manual resend when a send fails.

## What #62 changed here, 2026-09-28

`a-regular-earns-points-and-gold` (#62) ships points and gold on 2026-09-30, before
this change. It moves four things this proposal was written on:

**1. Giving a number is no longer consent to be messaged.** From 2026-10-01 the
Cafe asks every customer for their number *to earn points*. The owner aims to ship
this change the same day (2026-09-28), but that does not make the two one
question: a customer may want points and not messages, and until this change is
live the counter asks for the number with no messaging question at all. The published page says the
opposite: *"you give the cashier your mobile number, and that is the consent."*
So this change cannot infer consent from a customer existing. It needs **consent
as its own recorded fact** (when it was given, and that the published words were
asked), set only at the counter's consent moment. It must send only to customers
who carry it. "Switching on sends nothing for historical bills" is not enough:
a customer who first gave their number for points in October must not start
receiving messages in November because their *next* bill is new. The page's
*"that is the consent"* sentence changes first.

**Design the counter's two questions together with #62's.** Both live in the
customer dialog, and on day one the biller asks for a number, offers points and
asks about messages in one breath. #62's owner checkpoint is on 2026-09-29, so
settle this change's consent moment at that checkpoint, not at a second one.

**The template is drafted, and the link was reshaped to fit it (#66, 2026-10-02).**
Its wording, its three tagged variables and what each may carry are recorded in
[#66's design D6](../archive/2026-10-03-a-receipt-link-fits-an-sms/design.md#d6-the-template-as-filed-for-59-to-build-against).
Build the send against that, not against a fresh guess: `{#numeric#}` takes digits
only (send `String(points)`, never `1,250`), and `{#url#}` must start with the
registered CTA `https://shawarmania.in/bill?`, which is exactly what
`receiptLink()` returns in production.

**The DLT template must carry the points variables.** The DLT registration was
still in progress on 2026-09-28. A template approved without a slot for points
earned and balance cannot send them later without a fresh approval. So the
template submitted now should include them. If DLT is not approved by opening,
nothing sends, and that must be *visible* rather than silent. *(Until
2026-09-29 this said RCS alone could carry the launch. RCS is dropped; see
above.)*

**2. The message will carry points.** The owner wants it to include the points the
bill earned and the balance after it (2026-09-28). Those are the receipt's own
stored figures (#62 D14), transactional account information rather than an
offer, but confirm with MSG91 that a receipt template in the transactional or
service category may carry them. Never "use your points" or anything that reads as a nudge.
The page's *"One message per bill, no offers"* holds as written.

**3. STOP must not erase points.** The published page says that after stopping,
*"Your number comes out of our customer records, so the counter cannot message
you again."* With points, removing the number forfeits the customer's balance and
gold at every outlet, which is not what someone who only wanted fewer messages
asked for. **Stopping messages and leaving the programme are two different
requests.** STOP suppresses sending and keeps the customer. Removal on request
(the privacy page's separate promise) forfeits points and gold, and #62's
privacy amendment says so. The messages page is corrected first.

**4. A mistyped number now misattributes points too.** Beyond misdelivering a
receipt, a wrong digit earns a stranger's points and counts toward their gold.
#62 accepted that the number is unverified (the owner is not concerned yet), but
the options offered below, a read-back or a first-message confirmation, now buy
more than privacy.

Removal also meets #62's ledger: points entries reference the customer and are
append-only. Removing a customer means deciding what those rows keep. The
simplest honest answer is that they stay, attached to a customer record whose
name and phone are cleared, so the outlet's accounts still add up.

## The decisions the todo was waiting for are already made — and published

The todo listed four open questions. Three are now answered, and the answers are not internal notes.
They are live pages on `shawarmania.in`, first filed with an RCS agent registration.

**The channel is SMS through MSG91**, under the business's Airtel DLT registration, which was pending
on 2026-09-29. The todo framed the choice as WhatsApp Business API *against* SMS/DLT; after a detour
through RCS, the answer is SMS. *(From 2026-09-21 to 2026-09-29 the channel was RCS through Telinfy
(GreenAds Global), registered as a Transactional agent, with SMS under DLT as its fallback. The
published pages below were written for, and filed with, that registration.)*

**Consent is taken at the counter, verbally, when the number is given.** There is no web form, and
that is deliberate rather than pending — the published opt-in page says so, because a web checkbox
would have been a second consent path that nothing in this system honours.

**Sending is automatic once consented, one message per bill.** Not per-bill opt-in. The counter is
busiest exactly when the extra tap would land.

The fourth question — **the mistyped number** — is still open, is still the real one, and is worse
now than when the todo was written. See below.

## What has been published, and therefore what this change is not free to decide

Three documents are live and indexed. They were submitted to the RCS registration as its terms,
privacy policy and opt-in page, and they are what a customer reads whatever the channel. Two of their
promises need checking against SMS first (see *The channel is SMS through MSG91* above):

| | |
|---|---|
| `shawarmania.in/messages/` | the opt-in page: how consent is taken, what arrives, every way to stop |
| `shawarmania.in/privacy/` | what a phone number is used for, and that it is never sold or passed on |
| `shawarmania.in/terms/` | the messaging programme's terms |

They make commitments this change has to implement rather than revisit:

- **"One message per bill, no offers."** Transactional only. No marketing on this sender.
- **"Tell us any time and we stop."** *(Until 2026-10-03 this read "Reply STOP any time"; an
  SMS sender name cannot receive a reply, so the pages changed.)*
- Telling the counter, calling, or writing to `hello@shawarmania.in` stops it — so
  suppression is set by staff and admins; there is no inbound STOP.
- A number is **removed on request**, and the sale stays in the accounts without it attached.
- Numbers are **never sold or disclosed for third-party marketing**.

**The consent question the counter must ask is published verbatim**, and the counter does not
currently ask it:

> "Want your bill on your phone? Give us your mobile number. One message per bill, no offers.
> Tell us any time and we stop."

**If any of this is wrong, the page changes first and this change follows.** The order matters: a
published opt-in page that describes a programme the system does not run is worse than no page,
because it is the document a regulator or an operator reads when it audits the sender.

## The gap, stated plainly

Nothing in this repository knows the word STOP. There is no suppression state on a customer, no
inbound webhook, and no send. The landing site is already telling customers, in public, that
replying STOP stops the messages.

That is a promise with no implementation, and a DLT registration is now in review for the programme
the page describes. It is the reason this is seeded now rather than when convenient.

## The mistyped number is worse than the todo assumed

The todo called this "the real one" and recorded #54's answer: the receipt page names nobody, so a
wrong digit costs *"one order, never a person."*

**Delivery makes misdelivery systematic rather than occasional.** A link handed over by hand
reaches a stranger only when somebody hands it to one. An automatic send reaches a stranger
**every time the digit is wrong**, with nobody in the loop to notice.

**#54's bound still holds, because #58 no longer names the customer** [owner, 2026-09-30]. #58
(`the-receipt-says-its-yours`) was first seeded to put the customer's name on the page, which with
this change would have made every wrong digit a disclosure of a person. It was rewritten to show
only the last four digits of the number and *⭐ Gold at \<outlet\>*, never a name, and this
programme was the reason. So a misdelivered receipt costs one order, four digits the stranger
cannot connect to anybody, and a gold label: an order, not a person.

What is left to settle here is the order itself reaching a stranger, which is what it always was.
The options still stand, as a choice rather than a requirement: a confirmation step before the
first message to a number, a read-back at the counter, delivery only to numbers seen on a previous
bill, or explicit acceptance. *(Until 2026-09-30 this section argued that #58 and this change
together undid #54's bound, and that whichever shipped second inherited the argument.)*

## What already exists

Most of the durable half is built. From the todo, still true:

- **Every bill is linkable from the moment the server has it** — minted by a trigger, backfilled.
- **Revocation kills one link permanently** without touching another.
- **A kill switch** disables the public endpoint at the database with no deploy.
- **`customer_phone` is captured at billing**, so nothing needs a backfill.

Added since the todo was written:

- **#56 `a-customer-is-a-phone-number`** gives a customer identity keyed on the normalised number —
  which is where suppression belongs. A flag on the bill would be wrong: STOP is a statement about a
  person, not about one purchase.
- The landing repository's receipt Worker, page and PDF are live, and since #66 the link reads
  `https://shawarmania.in/bill?t=<token>`, the shape DLT can whitelist (below).

## Scope

- **Suppression as customer state**, set by staff at the counter and by an admin acting on a
  call or an email. Once set, no bill for that number sends. *(No inbound STOP: a DLT header
  cannot receive replies, 2026-10-03.)*
- **The send itself**, server-side through MSG91's Flow API (see *Where this stands*), triggered
  when a settled bill with a consenting customer reaches the server, once per bill and idempotent
  — the counter's offline queue means a bill can reach the server more than once, and a customer
  must not receive the same receipt twice.
- **The counter's consent moment, at payment**: the payment dialog asks for the number first (or
  confirms the one attached at ordering), with the published question, before gold, points and the
  tender are settled.
- **A visible failure path.** A send that fails is somebody's to see.
- **Nothing for history.** Switching this on must not message everyone ever billed.

## Non-goals

- **No marketing, ever, on this sender.** Its DLT template is a receipt, the pages promise no
  offers, and India's promotional rules — traffic caps, communication hours — are a different
  regime. Promotional messaging would need a separate header and template, separate consent and a rewrite of the
  published pages, per those pages' own wording: *"we will ask you separately."*
- **No second consent path.** No web form, no checkbox. The counter is the consent.
- **No change to link issuance, revocation or the identical-refusal rule.**
- **Not the receipt's contents.** What the receipt shows of its customer is #58, and it is never
  their name.
- **No re-engagement messaging.** No reminder about unused points, no win-back, no
  "you're close to gold". The number *is* now a loyalty identity (#62, which
  amends the privacy page to say so), but this programme only ever sends the bill.
  *(Until 2026-09-28 this read "No loyalty … use of the number. The privacy page
  forecloses it." #62 reopened the loyalty half and not the messaging half.)*

## Task ordering

1. **Suppression first, before anything can send.** Build the state and every way to set it, then
   the send. Built the other way round, the window where messages go out with no way to stop them is
   real and is exactly what the published page denies.
2. The provider integration and the idempotent send.
3. The counter's consent moment.
4. The two-repository coordination, if the published pages need amending — see below.

## This is a two-repository change

The send, the suppression and the counter are here. **The published opt-in, privacy and terms pages
are in the landing repository** (`shawarmania/`, change `legal-and-messaging-pages`), where
`/messages/` is the page an audit of the sender reads.

Unlike #54's pair, the two sides are **already out of step**: the pages shipped first and describe
behaviour this repository has not built. So the coordination is the reverse of usual — this change
either implements what is published, or the pages are corrected **before** it ships, never after.

## How to run the gate

- Ring a bill with a number, settle it, and watch the message arrive on a real handset.
- Ring one with no number: nothing sends, nothing errors.
- Pay a bill whose customer gives the number but says no to the message: points are earned, no SMS.
- Mark an order *Prepared* late, or never: the message has already gone at payment.
- Clear suppression by a hand-crafted request and confirm it is refused.
- Ask staff to stop it at the counter for a customer standing there; confirm the next bill is silent.
- Settle the same bill twice through the offline queue; confirm one message.
- Switch delivery on in an outlet with trading history; confirm no historical bill sends.
- In demo mode, ring and settle: confirm no real message leaves.
- Make a send fail (a wrong auth key, or an empty wallet): confirm the failure is visible to the
  owner, not silently dropped, and that the bill is otherwise unaffected.

## User-only gate steps

- 🧍 The owner reads `shawarmania.in/messages/` and confirms the system now does what it says,
  clause by clause.
- 🧍 The owner accepts the misdelivery position this change settles — see above — knowing a
  misdelivered receipt shows the last four digits and any gold mark (#58), and never a name.
- 🧍 The owner confirms the counter staff ask the published question in the published words.
- 🧍 The owner approves the amended `/messages/` wording on consent and on STOP, live before the
  first message is sent.

## Docs to update before archiving

- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — consent basis, what
  suppression means, what a misdelivered message now discloses.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — suppression state on the customer.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md) — the provider, the kill switch, what to do
  when a send fails or a customer calls to be removed.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the counter's consent moment.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — the fallback, and the misdelivery position.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — DLT, header, template, suppression.
