# Proposal: a-receipt-link-fits-an-sms

> **Model**: Opus · **Wave**: F · **Depends on**: #54 · **Gate**: every receipt link the app hands out reads `https://shawarmania.in/bill?t=<token>`, so the token is the only part after a `?` and the address whitelists on Airtel DLT as the dynamic URL `https://shawarmania.in/bill?`; that address opens the receipt, its counter view and its PDF exactly as before; a missing, repeated or malformed `t` is refused identically to any other refusal; a `/bill/<token>` link redirects to its new address, so neither repository's release can break the counter's **View receipt** or a link already copied; the brand site's other pages are untouched; a demo link is still recognised as one and still refused; a filled-in receipt message fits one SMS; and the four-role demo walkthrough still walks.

> **The parent of a pair.** The receipt page is served by the Worker in the
> landing repository (`C:\Users\iamro\Code\shawarmania`), whose child change is
> `a-receipt-link-fits-an-sms-page`. This change owns the link the app hands out;
> the child owns the address the Worker answers.

## Why

#59 (`bill-receipt-delivery`) sends the receipt link by SMS, under the business's
Airtel DLT registration. On 2026-10-02 the owner sat down to register the receipt
template on Airtel's DLT portal, and the link does not fit the rules it is checked
against.

TRAI's direction of 18 November 2025 requires every variable in an SMS template to
be pre-tagged, and a `{#url#}` variable to be validated against a URL the sender
has registered as a *call to action* (CTA): static, dynamic or short. A static URL
is one exact address, which a per-bill link can never be. A **dynamic** URL is
registered up to and including a `?`, and only what follows the `?` may vary.

Today's link is `https://shawarmania.in/bill/Ab3-_x9QzT`. The part that varies is
in the path. There is no `?`, so there is no prefix to register, and no way to
whitelist it at all. After TRAI's 60-day logger period a message whose URL fails
that check is rejected, not delivered.

So the token moves after a `?`:

```
https://shawarmania.in/bill?t=Ab3-_x9QzT
```

and the owner registers `https://shawarmania.in/bill?` as the dynamic CTA.

**It has to ship before the template is submitted**, not with #59. Airtel's
reviewer may open the sample URL the template carries, and an address the Worker
does not answer yet would read as a broken link. #59 is a large change with open
questions of its own (STOP, consent, the counter's question), and the DLT review
should not wait on them.

## What changes

- **The receipt link reads `https://shawarmania.in/bill?t=<token>`** wherever the
  app hands one out: **Send receipt**'s WhatsApp message, **Open receipt**, the
  counter's **View receipt**, and in demo mode, where it is still a link that
  never resolves.
- **The same receipt answers there**: the customer's page, the counter view
  (`?t=…&view=counter`) and the PDF. The PDF keeps its own address,
  `/bill/<token>.pdf`. It is never put in a message, so DLT has no say in its
  shape.
- **A `/bill/<token>` link redirects to `/bill?t=<token>`.** No customer has been
  sent one; the owner confirmed it on 2026-10-02, and nothing is owed to old
  links. The redirect exists for the release: the two repositories cannot deploy
  in the same instant, and the live app keeps handing out the old shape until its
  own deploy lands (design D2).
- **A refusal is still one refusal.** No `t`, two `t`s, an empty one or a malformed
  one gets the same page and status as an unknown token.
- **Nothing else on the brand site changes.** The Worker's route widens from
  `shawarmania.in/bill/*` to `shawarmania.in/bill*`, which the site has no other
  page under (design D3).

The DLT template itself, as filed, is recorded in design D6 for #59 to build
against. It is not built here: this change sends nothing.

## Non-goals

- **No sending.** The SMS, its provider, consent and STOP are #59.
- **No change to the token**: same generator, same ten characters, same column.
  No migration.
- **No URL shortener.** A short-URL CTA would need a registered shortener domain
  and would hide where the link goes; the full link is 40 characters and the
  whole message fits one SMS (design D5).
- **Not the receipt's contents.** What the page shows is #58's.
- **No retirement of `/bill/<token>`.** The redirect is cheap, and removing it
  would take a deploy that buys nothing.

## Docs to update before archiving

- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md): the receipt's address and
  the Worker's routes.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md): the routes, and the DLT CTA
  the address is registered as.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md): the public receipt's address.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md): the
  address a holder opens.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md): DLT, CTA.
- #59's proposal: the address it sends, and its dependency on this change.

## How to run the gate

- In the app (local preview, live mode and demo mode), Send receipt, Open receipt
  and View receipt each carry or open a `/bill?t=` link.
- Against the Worker: `/bill?t=<real token>` serves the page, `&view=counter` the
  counter view, and the page's Download PDF serves the PDF.
- `/bill`, `/bill?t=`, `/bill?t=a&t=b`, `/bill?t=<malformed>` and an unknown token
  each return the one refusal.
- `/bill/<token>` and `/bill/<token>?view=counter` redirect to the `?t=` form,
  keeping `view`.
- Another brand page (`/`, `/menu/`, `/privacy/`) is served as before.
- Count the filled-in template at the longest token and a four-digit balance.

## User-only gate steps

- 🧍 The owner chooses the release window: the Worker first, the ops push after.
- 🧍 The owner registers the dynamic CTA `https://shawarmania.in/bill?` on Airtel
  DLT, then the template, with a live receipt as the URL variable's sample.
