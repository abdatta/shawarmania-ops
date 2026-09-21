# Proposal: bill-receipt-delivery

> **Model**: Opus · **Wave**: F · **Depends on**: #54, #56 · **Gate**: **a customer who gave their number at the counter receives their own receipt link on their phone without anybody choosing to send it**, and one who did not receives nothing; the message says what `/messages/` already says it says — one per bill, no marketing; **replying STOP stops it**, proved by the next settled bill for that number sending nothing and by a hand-crafted request failing to clear the suppression; the counter asks the published consent question in the published words before a number is keyed; switching delivery on sends nothing for bills rung before it existed; a demo session provably sends no real message; a send that fails is visible to somebody rather than silently lost; and the four-role demo walkthrough still walks.

## Why

This graduates [`openspec/todos/bill-receipt-delivery.md`](../../todos/bill-receipt-delivery.md),
whose trigger was *"the owner picks a channel and settles consent."* Both happened on 2026-09-21,
and not as a plan — **as something already published and filed with a regulator.**

That is what makes this change unusual, and it should be read before anything is designed.

## The decisions the todo was waiting for are already made — and published

The todo listed four open questions. Three are now answered, and the answers are not internal notes.
They are live pages on `shawarmania.in` and a submitted RCS agent registration.

**The channel is RCS**, through Telinfy (GreenAds Global), registered as a **Transactional** agent on
2026-09-21. The todo framed the choice as WhatsApp Business API *against* SMS/DLT; the answer was
neither. Note what that does **not** dissolve: RCS falls back to SMS on handsets and networks that
cannot receive it, and **that fallback is still governed by TRAI's DLT rules** — entity registration,
header and template approval. The todo's DLT concern survives the choice of channel; it just moved
to the fallback path.

**Consent is taken at the counter, verbally, when the number is given.** There is no web form, and
that is deliberate rather than pending — the published opt-in page says so, because a web checkbox
would have been a second consent path that nothing in this system honours.

**Sending is automatic once consented, one message per bill.** Not per-bill opt-in. The counter is
busiest exactly when the extra tap would land.

The fourth question — **the mistyped number** — is still open, is still the real one, and is worse
now than when the todo was written. See below.

## What has been published, and therefore what this change is not free to decide

Three documents are live, indexed, and were submitted to the RCS registration as its terms, privacy
policy and opt-in page:

| | |
|---|---|
| `shawarmania.in/messages/` | the opt-in page: how consent is taken, what arrives, every way to stop |
| `shawarmania.in/privacy/` | what a phone number is used for, and that it is never sold or passed on |
| `shawarmania.in/terms/` | the messaging programme's terms |

They make commitments this change has to implement rather than revisit:

- **"One message per bill, no offers."** Transactional only. No marketing on this agent.
- **"Reply STOP any time."** Named on the opt-in page and in the terms.
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
because it is the document a carrier reads when it audits the agent.

## The gap, stated plainly

Nothing in this repository knows the word STOP. There is no suppression state on a customer, no
inbound webhook, and no send. The landing site is already telling customers, in public, that
replying STOP stops the messages.

That is a promise with no implementation, and the agent is in review pointing at the page that makes
it. It is the reason this is seeded now rather than when convenient.

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
- **Inbound handling** from the provider, verified as genuinely from the provider.
- **The send itself**, once per settled bill, idempotent — the counter's offline queue means a bill
  can reach the server more than once, and a customer must not receive the same receipt twice.
- **The counter's consent moment**: the published question, asked before the number is keyed.
- **A visible failure path.** A send that fails is somebody's to see.
- **Nothing for history.** Switching this on must not message everyone ever billed.

## Non-goals

- **No marketing, ever, on this agent.** It is registered Transactional, the pages promise no
  offers, and India's promotional rules — traffic caps, communication hours — are a different
  regime. Promotional messaging would need a separate agent, separate consent and a rewrite of the
  published pages, per those pages' own wording: *"we will ask you separately."*
- **No second consent path.** No web form, no checkbox. The counter is the consent.
- **No change to link issuance, revocation or the identical-refusal rule.**
- **Not the receipt's contents.** Naming the customer is #58.
- **No loyalty or re-engagement use of the number.** The privacy page forecloses it.

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
`/messages/` is the page a carrier audits.

Unlike #54's pair, the two sides are **already out of step**: the pages shipped first and describe
behaviour this repository has not built. So the coordination is the reverse of usual — this change
either implements what is published, or the pages are corrected **before** it ships, never after.

## How to run the gate

- Ring a bill with a number, settle it, and watch the message arrive on a real handset.
- Ring one with no number: nothing sends, nothing errors.
- Reply STOP. Ring that customer another bill. Nothing sends.
- Clear suppression by a hand-crafted request and confirm it is refused.
- Ask staff to stop it at the counter for a customer standing there; confirm the next bill is silent.
- Settle the same bill twice through the offline queue; confirm one message.
- Switch delivery on in an outlet with trading history; confirm no historical bill sends.
- In demo mode, ring and settle: confirm no real message leaves.
- On a handset with no RCS, confirm the SMS fallback path is either working under DLT or visibly
  disabled — not silently dropping.

## User-only gate steps

- 🧍 The owner reads `shawarmania.in/messages/` and confirms the system now does what it says,
  clause by clause.
- 🧍 The owner accepts the misdelivery position this change settles — see above — knowing #58 puts a
  name on the page.
- 🧍 The owner confirms the counter staff ask the published question in the published words.

## Docs to update before archiving

- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — consent basis, what
  suppression means, what a misdelivered message now discloses.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — suppression state on the customer.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md) — the provider, the kill switch, what to do
  when a send fails or a customer calls to be removed.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the counter's consent moment.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — the fallback, and the misdelivery position.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — RCS, DLT, suppression.
