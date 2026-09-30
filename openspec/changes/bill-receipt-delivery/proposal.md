# Proposal: bill-receipt-delivery

> **Model**: Opus · **Wave**: F · **Depends on**: #54, #56, #62 · **Gate**: **a customer who gave their number at the counter receives their own receipt link on their phone without anybody choosing to send it**, and one who did not receives nothing; the message says what `/messages/` already says it says — one per bill, no marketing; **replying STOP stops it**, proved by the next settled bill for that number sending nothing and by a hand-crafted request failing to clear the suppression; the counter asks the published consent question in the published words and records the answer, and a customer who gave their number only to earn points receives nothing; switching delivery on sends nothing for bills rung before it existed; a demo session provably sends no real message; a send that fails is visible to somebody rather than silently lost; and the four-role demo walkthrough still walks.

## Why

This graduates [`openspec/todos/bill-receipt-delivery.md`](../../todos/bill-receipt-delivery.md),
whose trigger was *"the owner picks a channel and settles consent."* Both happened on 2026-09-21,
and not as a plan — **as something already published and filed with a regulator.**

That is what makes this change unusual, and it should be read before anything is designed.

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
- **Two published promises may not survive the move, and the pages must be
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
- **Until DLT approves, the owner sends receipts by hand on WhatsApp**
  (#63 `a-receipt-goes-out-on-whatsapp`). That stays after this ships, as the
  manual resend when a send fails.

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
- **"Reply STOP any time."** Named on the opt-in page and in the terms. Whether SMS can honour a
  reply at all is the open question above.
- Telling the counter, calling, or writing to `hello@shawarmania.in` **also** stops it — so
  suppression must be settable by staff, not only by an inbound STOP.
- A number is **removed on request**, and the sale stays in the accounts without it attached.
- Numbers are **never sold or disclosed for third-party marketing**.

**The consent question the counter must ask is published verbatim**, and the counter does not
currently ask it:

> "Want your bill on your phone? Give us your mobile number. One message per bill, no offers.
> Reply STOP any time."

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

Two things have changed that bet, and they compound:

1. **Delivery makes misdelivery systematic rather than occasional.** A link handed over by hand
   reaches a stranger only when somebody hands it to one. An automatic send reaches a stranger
   **every time the digit is wrong**, with nobody in the loop to notice.
2. **#58 `the-receipt-names-its-customer` puts the name back on the page.** Its own proposal states
   the cost: a receipt link becomes a *"link → person lookup for whoever holds it."* Accepted for a
   link the customer is handed. Not yet argued for a link posted automatically to a number a busy
   counter typed.

**So #58 and this change together undo #54's bound, and neither one does it alone.** Whichever ships
second inherits the argument. This seed does not settle it; it insists the settlement be written
down, and offers the options: a confirmation step before the first message to a number, a
check-digit or read-back at the counter, delivery only to numbers seen on a previous bill, or
explicit acceptance that the bound is gone.

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
- The landing repository's receipt Worker, page and PDF are live at `shawarmania.in/bill/*`.

## Scope

- **Suppression as customer state**, set by an inbound STOP, by staff at the counter, and by an
  admin acting on a call or an email. Once set, no bill for that number sends.
- **Inbound handling** from MSG91, verified as genuinely from MSG91, **if MSG91 offers an inbound
  path for replies**. If it does not, this item leaves scope and the pages change first.
- **The send itself**, once per settled bill, idempotent — the counter's offline queue means a bill
  can reach the server more than once, and a customer must not receive the same receipt twice.
- **The counter's consent moment**: the published question, asked before the number is keyed.
- **A visible failure path.** A send that fails is somebody's to see.
- **Nothing for history.** Switching this on must not message everyone ever billed.

## Non-goals

- **No marketing, ever, on this sender.** Its DLT template is a receipt, the pages promise no
  offers, and India's promotional rules — traffic caps, communication hours — are a different
  regime. Promotional messaging would need a separate header and template, separate consent and a rewrite of the
  published pages, per those pages' own wording: *"we will ask you separately."*
- **No second consent path.** No web form, no checkbox. The counter is the consent.
- **No change to link issuance, revocation or the identical-refusal rule.**
- **Not the receipt's contents.** Naming the customer is #58.
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
- Reply STOP (if MSG91 gives the programme an inbound path). Ring that customer another bill.
  Nothing sends.
- Clear suppression by a hand-crafted request and confirm it is refused.
- Ask staff to stop it at the counter for a customer standing there; confirm the next bill is silent.
- Settle the same bill twice through the offline queue; confirm one message.
- Switch delivery on in an outlet with trading history; confirm no historical bill sends.
- In demo mode, ring and settle: confirm no real message leaves.
- With DLT not yet approved, confirm nothing sends and that the state is visible, not silently
  dropped.

## User-only gate steps

- 🧍 The owner reads `shawarmania.in/messages/` and confirms the system now does what it says,
  clause by clause.
- 🧍 The owner accepts the misdelivery position this change settles — see above — knowing #58 puts a
  name on the page.
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
