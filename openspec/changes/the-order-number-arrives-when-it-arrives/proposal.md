# Proposal: the-order-number-arrives-when-it-arrives

> **Model**: Opus · **Kind**: production correction with a contract change, not a
> roadmap change · **Gate**: an order saved at the counter shows a shimmer where
> its number will be, never a token that reads as one; the number replaces the
> shimmer when the server assigns it; nothing on screen ever shows an identifier
> that later turns into a different identifier; and the words about unsent work
> live in the sync indicator, which is always on screen and counts the same
> cards.

## Why

**A biller places an order and sees `Local · A7K3` where the order number goes,
for about half a second, before it becomes `#106`.** It reads as an error
message. The owner reported it on 2026-09-19.

The token was built for a good reason and answers the wrong half of it. Order
numbers are the server's — per outlet, sequential, assigned at insert — and the
tablet commits to IndexedDB first so the counter survives a dead connection. So
between those two moments the order genuinely has no number, and printing a
plausible integer would be the worst available lie: two tablets would print the
same one.

**But the badge changes anyway.** `A7K3` is four characters in an identifier
slot, so it reads as an identifier — and replacing it with `#106` reads as the
order's identity changing. The token does not avoid the switch the owner was
worried about; it makes the first half of it ugly. *"Won't it still cause
confusion?"* — it will, and that is the defect.

**A shimmer cannot be read as an identifier at all.** It is this repo's own
idiom for a value that is on its way ([`AGENTS.md`](../../../AGENTS.md): a
placeholder reserves the shape of what is arriving), `Shimmer` already gates its
animation on `prefers-reduced-motion`, and resolving into `#106` is what every
other loading region on the counter does. The transition stops reading as a
substitution and starts reading as an arrival.

## What the spec says, and what this changes

**This is a contract change, which is why it is a change folder and not a
`/quickfix`.** `counter-billing` requires more than "do not show a fake number":

> Until a bill has been sent, the surface SHALL identify it by a short local
> reference that cannot be mistaken for a bill number, **and SHALL state in plain
> words that it is not sent yet** and that its number arrives when it does.

That phrasing recurs — *"state plainly that it is not sent yet"* — and the same
requirement bans the word *provisional* outright, because *"a biller at 9pm needs
to know what to do next, and a word nobody says out loud is where that stops."*
The reasoning is sound and this change keeps it. What it moves is **where the
words are**.

The counter shell already carries them, permanently, at the top of the screen:
`synced`, `3 pending` with a cloud-off icon, `3 waiting — not sending` with a
warning icon. Those are plain words, they are always visible, and they count
exactly the cards that are shimmering. Repeating them on every card is the
mistake this repo has made and corrected before — the red *"Add a customer name
or phone to continue"* line was deleted in #56 because the disabled button
already said it.

So the delta says: the **card** shows no reference and no number until one
exists, and the **surface** states the unsent condition once, in the sync
indicator. One statement, not thirty.

**Two things the audit turned up and this change also settles.**

The `Queued · XXXX` helper written for that bill requirement is **used by no
surface at all**, so the requirement it was built for has never been
implemented. And the order-side requirement says only that an order's *number*
stays visible as a secondary reference — it never asked for a stand-in during the
gap. The token was filling a hole the spec did not describe.

## What changes

- `provisionalToken`, `provisionalReference` and their Crockford alphabet are
  deleted, with their tests. Nothing replaces them.
- `BillingOrder.localReference` is removed. An order awaiting its number is
  already `orderNumber: 0` in both adapters; that sentinel becomes a named
  domain predicate rather than a magic number repeated at each call site.
- The pipeline card's number badge and the open-order card's reference chip
  render a `Shimmer` sized to the number they are waiting for, with `sr-only`
  text, because `Shimmer` is `aria-hidden` and would otherwise be silent.
- Prose and accessible names that interpolated the token — *"More actions for
  …"*, *"Items for …"*, *"Cancel order …"*, *"Editing …"* — name an unsent order
  in words instead.

## Non-goals

- **No change to the outbox.** What is queued, retried and delivered is
  untouched; this is what an unsent order is *drawn* as.
- **No change to how numbers are assigned.** Still the server's, still per
  outlet, still sequential, still only on a successful send.
- **No implementation of the queued-bill reference.** That requirement stays
  unimplemented and is not this change's to build; the delta narrows it to what
  the product actually does rather than pretending otherwise.
- **No roadmap row.** A correction is not planned capability.
