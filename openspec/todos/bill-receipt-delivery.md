# Bill Receipt Delivery

**Type**: Feature · **Status**: Anticipated · **Area**: Billing

## Expectation

A customer who paid at the counter receives their receipt link **without anybody
choosing to send it** — a WhatsApp or SMS message going out on its own once the
bill reaches the server.

## Current behaviour

Since #54 every bill is reachable at a public URL from the moment the server has
it, and the owner or a franchise admin can share one from a bill they are already
looking at. Nothing sends it. So the receipt is real but its reach is a person's
habit: a customer gets one only if somebody deliberately hands it over.

## Why it was cut from #54

Delivery was the largest deliberate cut in that change, and it was cut because it
is not one feature. It is four decisions nobody has made, and each of them can
make the others wrong.

## Open questions

Promoted from `bill-digital-share`, which #54 discharged. These are the parts it
did **not** answer.

- **WhatsApp Business API, or SMS?** WhatsApp is how this business already
  communicates and avoids the TRAI/DLT registration transactional SMS requires in
  India. It needs a Business API account, with its own cost, template approval and
  approval path. SMS needs DLT registration and template pre-approval, which is
  slower but has no per-message platform relationship.
- **Opt-in per bill, or automatic whenever a phone number is present?** Automatic
  sending to a number captured casually at a busy counter is an efficient way to
  message the wrong person, repeatedly. Per-bill opt-in is one more tap at the
  moment the counter is busiest.
- **Where is consent recorded?** Sending a commercial message to a number needs a
  basis, and "they read it out at the counter" is not a record.
- **The mistyped number.** This is the real one, and no token length touches it: a
  wrong digit sends a stranger somebody else's receipt. #54's answer was to make
  that survivable — the page names no customer, so what the wrong reader learns is
  one order and no person. Delivery has to decide whether that is enough, or
  whether a confirmation step is wanted before the first message goes out.

## What already exists for it

- **Every bill is linkable and stays linkable**, with no backfill needed: the link
  is minted by a trigger, and bills rung before #54 were backfilled.
- **Revocation exists** and kills one link permanently without touching another,
  so a misdelivered link can be killed the moment it is noticed.
- **The page names no customer**, which is the control that makes misdelivery a
  survivable mistake rather than a disclosure.
- **A kill switch** disables the whole public endpoint at the database with no
  deploy, if delivery ever goes wrong at volume.
- **`customer_phone` is captured at billing**, so nothing needs a backfill.

## What it will probably drag in

The counter's customer fields as they stand. Today's names are placeholders typed
to satisfy a UI-only name-or-phone rule, and the owner expects the phone number to
become near-compulsory once links are delivered — the exact inverse of the field
an earlier draft of #54 planned to display. #54 deliberately did not make that
billing-UI change; delivery motivates it.

## Trigger to promote

The owner decides which channel, and accepts a consent and opt-in position. Until
both are settled this is research rather than a change.

**Dependencies when seeded**: `public-bill-receipt` (#54), archived.
